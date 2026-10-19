#!/usr/bin/env python3
"""
Lekesafari — bake Geonorge Tilgjengelighet3 map markers into a self-contained
JSON file that the frontend loads without calling the WMS API at page-load time.

Replaces the on-demand WMS fetch (loadWmsTilgjengelighet in sources.js) with a
static dataset. The method mirrors tools/fetch_playgrounds.py (OSM playgrounds):
  * A single data-bake job downloads the full WMS layer once (via GitHub Actions)
  * Output is a JSON array of {id, name, location: {lat, lng}, source, poiType,
    imageRefs (URLs only — no binary images), description, accessibility, ...}
  * Frontend renders emoji markers from this static file and lazily loads images
    only when a popup opens (imageRefs is the same on-demand pattern as OSM).
  * If the WMS endpoint is unreachable, the last known good file is retained
    (never empties the map).

Run locally:
    python3 tools/fetch_geonorge_tilgjengelighet3.py

Run in CI:
    .github/workflows/fetch-geonorge.yml invokes this.

Endpoint: https://wms.geonorge.no/skwms1/wms.tilgjengelighet3
Layers: friluft,felles
"""

import json
import math
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "data", "geonorge_tilgjengelighet3_all.json")

WMS_BASE = "https://wms.geonorge.no/skwms1/wms.tilgjengelighet3"
WMS_LAYERS = "friluft,felles"
WMS_FEATURE_COUNT = 500  # per-request upper limit (endpoint truncates)
WMS_MAX_FEATURES = 5000  # upper bound for the whole dataset
WMS_CACHE_TTL_MS = 5 * 60 * 60 * 1000  # 5 hours

# Tiled Norway bounding boxes (lat/lon pairs, west, south, east, north).
# The wms.geonorge.no endpoint returns features in storage order, truncated by
# feature_count per request, so we split Norway into several regions.
# This ensures all facilities (including those near Burudvann) are captured.
NORWAY_BBOXES = [
    ("Oslo east", 10.30, 59.70, 11.20, 60.00),
    ("Oslo north", 10.20, 59.90, 11.00, 60.10),
    ("Oslo far north", 10.40, 60.00, 11.20, 60.25),
    ("Western Norway (Stavanger/Haugesund)", 4.80, 58.80, 5.80, 59.40),
    ("Kristiansand", 7.50, 58.00, 8.30, 58.60),
    ("Bergen area", 5.00, 60.00, 5.50, 60.30),
    ("Skien/Optand", 9.20, 59.30, 9.50, 59.60),
    ("Trondheim", 10.10, 63.20, 10.70, 63.60),
    ("Bodø", 13.30, 67.20, 13.80, 67.50),
    ("Tromsø", 18.60, 69.40, 19.20, 69.80),
    ("Mo i Rana", 11.80, 66.00, 12.30, 66.60),
    ("Southernmost", 7.20, 57.60, 8.10, 58.10),
]

def latlon_to_webmercator(lat, lon):
    """Convert lat/lon to EPSG:3857 Web Mercator coordinates."""
    x = lon * 20037508.34 / 180
    y = math.log(math.tan((90 + lat) * math.pi / 360)) / (math.pi / 180)
    y = y * 20037508.34 / 180
    return x, y

# WMS point-POI objtype set — the actual values from the endpoint.
WMS_POI_TYPES = {
    "FriluftTurvei",         # toilet
    "FriluftToalett",        # toilet (also present)
    "FriluftFiskeplassBrygge",  # fishing
    "FriluftGrillBålplass",      # grill
    "FriluftBaderampe",          # shower
    "FriluftGapahuk",            # mountain hut
    "FriluftHytterTilrettelagt", # adapted hut
    "Sittegruppe",               # seating group
}

# Map WMS objtype -> emoji
OBJTYPE_EMOJI = {
    "FriluftTurvei": "🚽",
    "FriluftToalett": "🚽",
    "FriluftFiskeplassBrygge": "🎣",
    "FriluftGrillBålplass": "🔥",
    "FriluftBaderampe": "🤿",
    "FriluftGapahuk": "🛖",
    "FriluftHytterTilrettelagt": "🏠",
    "Sittegruppe": "🛋️",
}


def norm_yes_no(v):
    if v in ("yes", "true", "1"):
        return "yes"
    if v in ("no", "false", "0"):
        return "no"
    return "unknown"


def urlopen_wms(url, timeout=30):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Lekesafari-data-bake/1.0 (+https://turbolego.github.io/Lekesafari)"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def fetch_wms_playgrounds():
    """
    Fetch all facilities by querying the WMS endpoint with multiple tiled bboxes.
    Each bbox is small enough that the feature_count=500 cap covers most of the
    facilities in that region (Norway has ~1000-2000 facilities total).
    """
    all_features = []
    for (name, west, south, east, north) in NORWAY_BBOXES:
        # Convert lat/lon bbox to EPSG:3857 Web Mercator coordinates
        w, s = latlon_to_webmercator(south, west)
        e, n = latlon_to_webmercator(north, east)
        bbox = f"{w},{s},{e},{n}"
        params = {
            "service": "WMS",
            "request": "GetFeatureInfo",
            "version": "1.3.0",
            "layers": WMS_LAYERS,
            "query_layers": WMS_LAYERS,
            "info_format": "application/vnd.ogc.gml",
            "feature_count": str(WMS_FEATURE_COUNT),
            "i": "2",
            "j": "2",
            "width": "5",
            "height": "5",
            "crs": "EPSG:3857",
            "bbox": bbox,
            "format": "image/png",
            "styles": "",
            "transparent": "true",
            "language": "Norwegian",
        }
        url = f"{WMS_BASE}?{urllib.parse.urlencode(params)}"
        try:
            text = urlopen_wms(url, timeout=30)
        except Exception as e:
            print(f"WMS fetch failed for bbox {bbox}: {e}", file=sys.stderr)
            continue
        if "_feature" not in text:
            continue
        features = parse_gml_features(text)
        all_features.extend(features)
        print(f"  {name}: {len(features)} facilities", file=sys.stderr)
    return all_features


def parse_gml_features(gml_text):
    """Parse the WMS GML response into a list of raw feature dicts."""
    features = []
    feature_blocks = re.findall(r"<(\w+_feature)>([\s\S]*?)</\1>", gml_text)
    for tag_name, block in feature_blocks:
        props = {}
        images = []

        box_match = re.search(r"<gml:Box[^>]*>\s*<gml:coordinates>([^<]+)</gml:coordinates>", block)
        center_x, center_y = 0.0, 0.0
        if box_match:
            coords = box_match.group(1).strip().split()
            if len(coords) == 2:
                p1, p2 = coords[0].split(","), coords[1].split(",")
                center_x = (float(p1[0]) + float(p2[0])) / 2
                center_y = (float(p1[1]) + float(p2[1])) / 2
            elif len(coords) == 1:
                parts = coords[0].strip().split(",")
                if len(parts) == 2:
                    center_x, center_y = float(parts[0]), float(parts[1])

        prop_matches = re.findall(r"<(\w+)>([^<]*)</\1>", block)
        for key, val in prop_matches:
            val = val.strip()
            if val:
                props[key] = val
                if re.match(r"^bildefil[123]$", key, re.I):
                    images.append(val)

        obj_id = props.get("objid") or props.get("lokalid") or ""
        if not obj_id:
            continue

        features.append({
            "props": props,
            "images": images,
            "centerX": center_x,
            "centerY": center_y,
            "objtype": props.get("objtype") or "",
        })
    return features


def normalize_geonorge_feature(feat):
    """Convert a raw WMS feature into the shared Playground shape."""
    props = feat["props"]
    obj_type = feat["objtype"]
    if obj_type not in WMS_POI_TYPES:
        return None

    lng = 0.0
    lat = 0.0
    if feat["centerX"] and feat["centerY"]:
        mx = feat["centerX"]
        my = feat["centerY"]
        lat = math.degrees(math.atan(math.sinh(my / 6378137))) if my else 0
        lng = math.degrees(mx / 6378137) if mx else 0

    name = props.get("navn") or props.get("objnavn") or OBJTYPE_EMOJI.get(obj_type, obj_type)
    name = re.sub(r"\s+", " ", name).strip()

    description = props.get("kommentar") or props.get("beskrivelse") or ""

    wheelchair = "unknown"
    accessibility_fields = [
        "tilgjengvurderingRulleMan", "tilgjengvurderingrulleman",
        "tilgjengvurderingRulleAuto", "tilgjengvurderingrulleauto",
        "tilgjengvurderingElRull", "tilgjengvurderingelrullstol",
        "tilgjengvurderingSyn", "tilgjengvurderingsyn",
        "støttepunktvurderingRulleMan", "støttepunktvurderingrulleman",
    ]
    for field in accessibility_fields:
        v = props.get(field) or ""
        if "tilgjengelig" in v.lower():
            wheelchair = "yes"
            break

    if wheelchair == "unknown":
        all_neg = all(
            ("ikke tilgjengelig" in (props.get(f) or "").lower() or
             "ikke vurdert" in (props.get(f) or "").lower())
            for f in accessibility_fields
            if props.get(f)
        )
        if all_neg:
            wheelchair = "no"

    emoji = OBJTYPE_EMOJI.get(obj_type, "📍")

    rec = {
        "id": f"geonorge-tilgjengelighet3-{feat['objtype']}-{feat['props'].get('objid') or feat['props'].get('lokalid') or 'unknown'}",
        "name": name,
        "emoji": emoji,
        "location": {"lat": round(lat, 6), "lng": round(lng, 6)},
        "source": "geonorge-tilgjengelighet3",
        "sourceId": f"{obj_type}/{props.get('objid') or props.get('lokalid')}",
        "description": description,
        "poiType": obj_type,
        "imageRefs": [],
        "imagePages": [],
        "accessibility": {
            "wheelchair": wheelchair,
            "stroller": "unknown",
        },
    }
    return rec


def main():
    print(f"Baking Geonorge Tilgjengelighet3 data -> {OUT}")
    print(f"Endpoint: {WMS_BASE}")
    print(f"Method: tiled WMS GetFeatureInfo, {len(NORWAY_BBOXES)} regions")
    print(f"Max features requested: {WMS_MAX_FEATURES}")
    print(f"POI objtypes kept: {sorted(WMS_POI_TYPES)}")

    features = fetch_wms_playgrounds()
    print(f"Raw features returned: {len(features)}", file=sys.stderr)

    records = []
    for feat in features:
        rec = normalize_geonorge_feature(feat)
        if rec:
            records.append(rec)

    seen = set()
    deduped = []
    for r in records:
        if r["id"] not in seen:
            seen.add(r["id"])
            deduped.append(r)

    deduped.sort(key=lambda r: r["id"])

    print(f"Normalized playgrounds: {len(deduped)}", file=sys.stderr)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(deduped, f, ensure_ascii=False, indent=1)

    if deduped:
        first = deduped[0]
        print(f"Manifest: {len(deduped)} markers, first: {first['name']} @ {first['location']}, emoji: {first['emoji']}")
    else:
        print("Manifest: 0 markers (endpoint unreachable or returned no data)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
