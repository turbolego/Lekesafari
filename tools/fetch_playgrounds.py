#!/usr/bin/env python3
"""
Lekesafari — fetch ALL playgrounds in Norway into a self-contained GeoJSON.

Writes data/playgrounds_all.geojson (FeatureCollection). This file is the
source the webapp loads without ever calling the OSM API at page-load time.

Design (matches tools/build_data.py):
  * Whole-country single Overpass query TIMES OUT. We tile the country into
    small per-city bboxes so each query is cheap and finishes well inside the
    mirror timeout.
  * A pool of public Overpass mirrors with a short HTTP timeout; one stalled
    mirror must not fail the whole bake.
  * Images are referenced by URL ONLY (the tag "image"). The frontend fetches
    the <img> lazily when the user opens a playground's popup — we never
    embed image bytes or fetch them here.
  * If every mirror is down for a city, we keep whatever was fetched so the
    output never regresses to empty, and we only exit non-zero when ZERO
    cities could be served at all (a real outage), so CI surfaces the failure.

Run locally:
    python3 tools/fetch_playgrounds.py
Run in CI:
    .github/workflows/fetch-playgrounds.yml invokes this.
"""

import json
import os
import sys
import time
from datetime import date

import requests

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "data", "playgrounds_all.geojson")

# Overpass mirror pool. Order = preference; each gets a short HTTP timeout.
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
OVERRAID = 40  # per-query OSM timeout; must stay < per-mirror HTTP timeout.

HEADERS = {
    "User-Agent": "Lekesafari/1.0 research (github.com/turbolego/Lekesafari)",
    "Accept": "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
}

# Norwegian equipment sub-tags use a colon: `playground:<type>` -> label.
OSM_EQUIPMENT = {
    "playground:slide": "Rutschbane",
    "playground:seesaw": "Vippe",
    "playground:swing": "Gynge",
    "playground:springer": "Hoppeslott",
    "playground:sandpit": "Sandkasse",
    "playground:climbing_frame": "Klatrestativ",
    "playground:maze": "Labyrint",
    "playground:rope": "Trosse",
    "playground:mechanized": "Karussell",
    "playground:ball_court": "Ballbane",
    "playground:sheltered": "Sikringshus",
    "playground:water": "Vannleke",
    "playground:trampoline": "Trampolin",
}

# Coarse tiling of Norwegian population centres. Each bbox is small enough
# that one Overpass query is cheap: (south, west, north, east).
NORWAY_BBOXES = [
    ("oslo",          59.85, 10.45, 59.99, 10.95),
    ("trondheim",     63.38, 10.32, 63.52, 10.58),
    ("bergen",        60.30,  5.20, 60.48,  5.45),
    ("stavanger",     58.85,  5.50, 58.98,  5.72),
    ("lund",          57.55,  7.55, 57.75,  7.90),
    ("drammen",       59.95,  9.95, 60.05, 10.10),
    ("tromso",        69.55, 18.85, 69.68, 19.00),
    ("os",            59.72,  10.62, 59.84, 10.78),
]


def parse_int(v, default):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def norm_yes_no(v):
    if v in ("yes", "true", "limited"):
        return v
    if v in ("no", "false"):
        return "no"
    return "unknown"


def parking_from_osm(t):
    if t.get("parking") == "no" or t.get("parking_access") == "no":
        return {"free": False, "paid": False}
    free = t.get("parking") == "yes" or t.get("parking_fee") == "no"
    paid = t.get("parking_fee") == "yes" or (t.get("parking") == "yes" and not free)
    if free or paid:
        return {"free": free, "paid": paid}
    return {"free": True, "paid": False}


def dogs_from_osm(t):
    if t.get("dogs") in ("yes", "true", "permitted"):
        return {"allowed": True, "leash": t.get("dogs") == "leash"}
    if t.get("dogs") in ("no", "false"):
        return {"allowed": False, "leash": False}
    if t.get("leashed") in ("yes", "true"):
        return {"allowed": True, "leash": True}
    return {"allowed": "unknown", "leash": "unknown"}


def normalize(el, city, now):
    """Turn one OSM element into the shared Playground shape."""
    t = el.get("tags", {}) or {}
    lat = el.get("lat")
    lng = el.get("lon")
    if lat is None and "center" in el:
        lat = el["center"].get("lat")
        lng = el["center"].get("lon")
    if lat is None or lng is None:
        return None

    equipment = []
    for k, label in OSM_EQUIPMENT.items():
        if t.get(k) in ("yes", "true", "1"):
            equipment.append({"type": k.split(":", 1)[1], "name": label, "count": 1})

    osm_type = el.get("type", "node")
    osm_id = el.get("id", "unknown")

    # Image: reference by URL only. The frontend loads it lazily on popup open.
    image_url = t.get("image")
    images = [{"url": image_url, "alt": t.get("name", "Lekeplass")}] if image_url else []

    rec = {
        "id": f"osm-{osm_type}-{osm_id}",
        "name": t.get("name") or "Ukjent lekeplass",
        "location": {"lat": lat, "lng": lng},
        "source": "osm",
        "sourceId": f"{osm_type}/{osm_id}",
        "images": images,
        "age": {"min": parse_int(t.get("min_age"), 0), "max": parse_int(t.get("max_age"), 16)},
        "opening": t.get("opening_hours", ""),
        "equipment": equipment,
        "rating": {"average": 0, "count": 0},
        "accessibility": {"wheelchair": norm_yes_no(t.get("wheelchair")), "stroller": "unknown"},
        "fenced": t.get("fenced") in ("yes", "true"),
        "toilets": t.get("toilets") in ("yes", "true"),
        "parking": parking_from_osm(t),
        "dogs": dogs_from_osm(t),
        "municipality": t.get("addr:city") or city,
        "verified": bool(t.get("name")) or bool(equipment),
        "lastVerified": now,
        "sources": [{"type": "osm", "id": f"{osm_type}/{osm_id}", "retrievedAt": now}],
    }
    return rec


def build_query(bbox):
    _, s, w, n, e = bbox
    return (
        f"[out:json][timeout:{OVERRAID}];"
        f'(node["leisure"="playground"]({s},{w},{n},{e});'
        f'way["leisure"="playground"]({s},{w},{n},{e}););'
        f"out center 1000;"
    )


def run_query(query):
    """POST one query across the mirror pool. Returns a list of OSM elements.

    Raises RuntimeError only if EVERY mirror fails (real outage). A mirror
    that returns 200 with an empty `elements` list is a legit empty result.
    """
    last_err = None
    for mirror in OVERPASS_MIRRORS:
        try:
            r = requests.post(mirror, data={"data": query}, headers=HEADERS,
                              timeout=OVERRAID + 20)
            # A 200 always gives JSON; non-2xx -> fall through to next mirror.
            if r.status_code != 200:
                last_err = f"{mirror} -> HTTP {r.status_code}"
                time.sleep(1)
                continue
            data = r.json()
            # Distinguish "timed out / server error" (remark present, empty)
            # from a genuine empty area.
            if data.get("elements") is not None:
                return data.get("elements", [])
            last_err = f"{mirror} -> no elements key"
        except Exception as exc:  # network / abort / JSON
            last_err = f"{mirror} -> {exc}"
        time.sleep(1)
    raise RuntimeError(f"All Overpass mirrors failed: {last_err}")


def main():
    now = date.today().isoformat()
    features = []
    served = 0

    for bbox in NORWAY_BBOXES:
        city = bbox[0]
        try:
            elements = run_query(build_query(bbox))
        except RuntimeError as exc:
            # One city's outage must not abort the whole bake; log and continue.
            print(f"[warn] {city}: {exc}", file=sys.stderr)
            continue

        for el in elements:
            rec = normalize(el, city, now)
            if rec is None:
                continue
            features.append({
                "type": "Feature",
                "properties": rec,
                "geometry": {
                    "type": "Point",
                    "coordinates": [rec["location"]["lng"], rec["location"]["lat"]],
                },
            })
        served += 1
        print(f"[ok] {city}: {len(elements)} elements")

    # Hard-fail only if not a single city was served (total outage).
    if served == 0:
        print("Error: no Overpass mirror served any city — refusing to write empty data.",
              file=sys.stderr)
        sys.exit(1)

    # Dedup by OSM source id (a city tile may overlap a neighbour).
    seen = set()
    deduped = []
    for f in features:
        key = f["properties"]["sourceId"]
        if key in seen:
            continue
        seen.add(key)
        deduped.append(f)
    deduped.sort(key=lambda f: f["properties"]["id"])

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    payload = {
        "type": "FeatureCollection",
        "metadata": {
            "generated": now,
            "source": "osm",
            "recordCount": len(deduped),
        },
        "features": deduped,
    }
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"Successfully wrote {len(deduped)} playgrounds to {OUT}")


if __name__ == "__main__":
    main()
