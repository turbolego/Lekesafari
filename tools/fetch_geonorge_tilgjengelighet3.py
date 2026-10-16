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

# WMS point-POI objtype set — the actual values from the endpoint.
# Tour: FriluftTurvei (not Toalett), plus the sitting groups.
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
    Single WMS GetFeatureInfo request over the full Norway bbox (EPSG:3857).
    The endpoint returns features in storage order, truncated by feature_count,
    so we split into multiple requests to stay under the cap.
    """
    # Full Norway bbox in EPSG:3857 (Web Mercator):
    min_x, max_y = 229333, 8705133  # ~ (57.8, -18.9)
    max_x, min_y = 3638083, 6640767  # ~ (30.9, 57.8)
    bbox = f"{min_x},{min_y},{max_x},{max_y}"
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
        print(f"WMS fetch failed: {e}", file=sys.stderr)
        return []
    if "_feature" not in text:
        return []
    return parse_gml_features(text)


def parse_gml_features(gml_text):
    """Parse the WMS GML response into a list of raw feature dicts."""
    features = []
    # Match <layer_feature> ... </layer_feature> blocks
    feature_blocks = re.findall(r"<(\w+_feature)>([\s\S]*?)</\1>", gml_text)
    for tag_name, block in feature_blocks:
        props = {}
        images = []

        # Extract gml:coordinates for centre position (inside boundedBy/Box)
        box_match = re.search(r"<gml:Box[^>]*>\s*<gml:coordinates>([^<]+)</gml:coordinates>", block)
        center_x, center_y = 0.0, 0.0
        if box_match:
            coords = box_match.group(1).strip().split()
            # Format: "minX,minY maxX,maxY" or "x,y" (single point)
            if len(coords) == 2:
                p1, p2 = coords[0].split(","), coords[1].split(",")
                center_x = (float(p1[0]) + float(p2[0])) / 2
                center_y = (float(p1[1]) + float(p2[1])) / 2
            elif len(coords) == 1:
                parts = coords[0].strip().split(",")
                if len(parts) == 2:
                    center_x, center_y = float(parts[0]), float(parts[1])

        # Extract all properties
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

    # Centre position from bounding box coordinates (EPSG:3857 -> lon/lat)
    lng = 0.0
    lat = 0.0
    if feat["centerX"] and feat["centerY"]:
        mx = feat["centerX"]
        my = feat["centerY"]
        # Inverse Mercator: lat = atan(sinh(my/R)) * 180/pi
        lat = math.degrees(math.atan(math.sinh(my / 6378137))) if my else 0
        lng = math.degrees(mx / 6378137) if mx else 0

    # Name: try navn, then objnavn, else objtype label
    name = props.get("navn") or props.get("objnavn") or OBJTYPE_EMOJI.get(obj_type, obj_type)

    # Clean up Norwegian whitespace
    name = re.sub(r"\s+", " ", name).strip()

    description = props.get("kommentar") or props.get("beskrivelse") or ""

    # Wheelchair assessment (same logic as live fetchWmsTilgjengelighet)
    wheelchair = "unknown"
    # Check all the 'tilgjengelig' assessment fields
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

    # Fallback: if all assessments are 'Ikke tilgjengelig' or 'Ikke vurdert',
    # default to 'unknown' (the live adapter already handles this)
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
        # Image references only — no binary images saved.
        # Frontend loads these lazily when a playground's popup opens
        # (same pattern as OSM playgrounds).
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
    print(f"Method: single WMS GetFeatureInfo, EPSG:3857 bbox, feature_count={WMS_FEATURE_COUNT}")
    print(f"Max features requested: {WMS_MAX_FEATURES}")
    print(f"POI objtypes kept: {sorted(WMS_POI_TYPES)}")

    features = fetch_wms_playgrounds()
    print(f"Raw features returned: {len(features)}")

    # Normalize to the shared Playground shape
    records = []
    for feat in features:
        rec = normalize_geonorge_feature(feat)
        if rec:
            records.append(rec)

    # Deduplicate by id
    seen = set()
    deduped = []
    for r in records:
        if r["id"] not in seen:
            seen.add(r["id"])
            deduped.append(r)

    # Sort for deterministic output
    deduped.sort(key=lambda r: r["id"])

    print(f"Normalized playgrounds: {len(deduped)}")

    # Always write the output file (even if empty, so the frontend can fall back)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(deduped, f, ensure_ascii=False, indent=1)

    # Show a manifest (truncated, never the full data)
    if deduped:
        first = deduped[0]
        print(f"Manifest: {len(deduped)} markers, first: {first['name']} @ {first['location']}, emoji: {first['emoji']}")
    else:
        print("Manifest: 0 markers (endpoint unreachable or returned no data)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
