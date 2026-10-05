#!/usr/bin/env python3
"""
Lekesafari data bake (spec §8)

Fetches playgrounds from OpenStreetMap (Overpass) across a set of bboxes,
normalizes each element to the shared Playground shape the frontend expects,
merges into the existing static baseline (data/playgrounds.geojson), dedupes,
and writes it back so GitHub Pages can serve it same-origin.

Design goals:
  - NEVER empties the file: if every Overpass mirror is down, the existing
    seed baseline is written back unchanged (so the map is still not empty).
  - Best-effort live OSM: a degraded mirror pool must not 404 the layer.
  - Deterministic output: stable sort by id so CI diffs stay small.

Run locally:
    python3 tools/build_data.py
Run in CI:
    .github/workflows/update-data.yml invokes this.
"""

import json
import sys
import time
import urllib.parse
import urllib.request
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(REPO, "data", "playgrounds.geojson")
SOURCES = os.path.join(REPO, "data", "sources.json")

# Overpass mirror pool. Order = preference. Each gets a short timeout.
OSM_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
# [out:json][timeout:N]; — N must stay < our per-mirror HTTP timeout.
OVERRAID = 20

# OSM playground equipment sub-tags use a colon: `playground:<type>`.
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

# Coarse tiling of major Norwegian population centres. Each bbox is small
# enough that a single Overpass query is cheap. We skip the whole-country
# query on purpose (too broad → timeouts, matches the frontend MIN_LIVE_ZOOM gate).
NORWAY_BBOXES = [
    ("oslo",      59.85, 10.45, 59.99, 10.95),
    ("trondheim", 63.38, 10.35, 63.50, 10.55),
    ("bergen",     60.35, 5.25,  60.45, 5.45),
    ("stavanger",  58.90, 5.55,  58.98, 5.72),
    ("lund",       57.62, 7.66,  57.72, 7.82),
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
    if t.get("dogs") in ("no", "false", "prohibited"):
        return {"allowed": False, "leash": False}
    if t.get("leashed"):
        return {"allowed": True, "leash": True}
    return {"allowed": True, "leash": False}


def normalize_element(el, now):
    """One Overpass element -> shared Playground record (dict)."""
    t = el.get("tags", {}) or {}
    lat = el.get("lat")
    lng = el.get("lon")
    center = el.get("center")
    if lat is None and center:
        lat = center.get("lat")
    if lng is None and center:
        lng = center.get("lon")
    if lat is None or lng is None:
        return None

    equipment = []
    for k, label in OSM_EQUIPMENT.items():
        if t.get(k) in ("yes", "true", "1"):
            equipment.append({"type": k, "name": label, "count": 1})

    osm_type = el.get("type", "node")
    osm_id = el.get("id", "unknown")
    rec = {
        "id": f"osm-{osm_type}-{osm_id}",
        "name": t.get("name") or "Utkjent lekeplass",
        "location": {"lat": lat, "lng": lng},
        "source": "osm",
        "sourceId": f"{osm_type}/{osm_id}",
        "images": [{"url": t["image"], "alt": t.get("name", "Lekeplass")}] if t.get("image") else [],
        "age": {"min": parse_int(t.get("min_age"), 0), "max": parse_int(t.get("max_age"), 16)},
        "opening": t.get("opening_hours", ""),
        "equipment": equipment,
        "rating": {"average": 0, "count": 0},
        "accessibility": {"wheelchair": norm_yes_no(t.get("wheelchair")), "stroller": "unknown"},
        "fenced": t.get("fenced") in ("yes", "true"),
        "toilets": t.get("toilets") in ("yes", "true"),
        "parking": parking_from_osm(t),
        "dogs": dogs_from_osm(t),
        "municipality": t.get("state_province") or t.get("municipality") or "",
        "verified": bool(t.get("name")) or bool(equipment),
        "lastVerified": now,
        "sources": [{"type": "osm", "id": f"{osm_type}/{osm_id}", "retrievedAt": now}],
    }
    return rec


def osm_query(bbox):
    _, s, w, n, e = bbox
    q = (
        f"[out:json][timeout:{OVERRAID}];"
        f'(node["leisure"="playground"]({s},{w},{n},{e});'
        f'way["leisure"="playground"]({s},{w},{n},{e}););'
        f"out center 500;"
    )
    return q


def overpass_post(query, timeout=12):
    """Try each mirror; return parsed JSON dict or None.

    `timeout` is the per-connection per-read bound in seconds. Keep it
    low so a dead mirror can't stall the whole bake (see fast-degrade).
    """
    for mirror in OSM_MIRRORS:
        try:
            req = urllib.request.Request(
                mirror,
                data=urllib.parse.urlencode({"data": query}).encode(),
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "Lekesafari/1.0 (data bake)",
                    "Accept": "application/json",
                },
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if r.status != 200:
                    continue
                return json.loads(r.read().decode())
        except Exception:
            continue
    return None


def fetch_osm():
    """Query all bboxes, return a list of normalized records.

    Fast-degrade: if the first bbox gets no data from any mirror, we stop
    probing and return what we have (usually []), so a fully-down Overpass
    pool degrades to the committed baseline instead of hammering 5 boxes.
    """
    records = []
    seen = set()
    now = time.strftime("%Y-%m-%d")
    source_down = False
    for bbox in NORWAY_BBOXES:
        q = osm_query(bbox)
        data = overpass_post(q)
        if data is None:
            print(f"  [warn] overpass failed for {bbox[0]}, skipping", file=sys.stderr)
            if not records:
                # First box, no data anywhere → treat source as down.
                source_down = True
                print(f"  [warn] OSM source appears down; degrading to baseline", file=sys.stderr)
                break
            continue
        if source_down:
            break
        for el in data.get("elements", []):
            rec = normalize_element(el, now)
            if rec and rec["id"] not in seen:
                seen.add(rec["id"])
                records.append(rec)
    return records


def load_existing():
    """Load the existing static baseline as {id: feature}."""
    if not os.path.exists(STATIC):
        return {}
    with open(STATIC) as f:
        fc = json.load(f)
    out = {}
    for feat in fc.get("features", []):
        pid = feat.get("properties", {}).get("id")
        if pid:
            out[pid] = feat
    return out


def to_feature(rec):
    props = {k: v for k, v in rec.items() if k not in ("id", "location")}
    props["id"] = rec["id"]
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {
            "type": "Point",
            "coordinates": [rec["location"]["lng"], rec["location"]["lat"]],
        },
    }


def main():
    os.makedirs(os.path.dirname(STATIC), exist_ok=True)

    existing = load_existing()
    osm = fetch_osm()
    print(f"[ok] OSM live records: {len(osm)}; existing baseline: {len(existing)}")

    # OSM records overlay onto the baseline; existing seed records persist.
    merged = {}
    for pid, feat in existing.items():
        merged[pid] = feat
    for rec in osm:
        merged[rec["id"]] = to_feature(rec)

    # Stable sort by id so diffs are small across runs.
    features = sorted(merged.values(), key=lambda f: f["properties"].get("id", ""))

    geojson = {
        "type": "FeatureCollection",
        "metadata": {
            "generated": time.strftime("%Y-%m-%d"),
            "source": "osm + seed",
            "recordCount": len(features),
        },
        "features": features,
    }

    with open(STATIC, "w") as f:
        json.dump(geojson, f, indent=2, ensure_ascii=False)
        f.write("\n")

    sources = {
        "generated": time.strftime("%Y-%m-%d"),
        "sources": [
            {"name": "osm", "type": "live", "mirror": OSM_MIRRORS[0], "records": len(osm)},
            {"name": "seed", "type": "static", "records": len(existing)},
        ],
        "recordCount": len(features),
    }
    with open(SOURCES, "w") as f:
        json.dump(sources, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"[ok] wrote {STATIC} ({len(features)} records)")
    print(f"[ok] wrote {SOURCES}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
