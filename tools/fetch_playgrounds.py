#!/usr/bin/env python3
"""
Lekesafari — fetch ALL playgrounds in Norway into a self-contained GeoJSON.

Writes data/playgrounds_all.geojson (FeatureCollection). This file is the
source the webapp loads without ever calling the OSM API at page-load time.

Design:
  * Whole-country single Overpass query TIMES OUT. We tile the country into
    per-city bboxes so each query is cheap and finishes inside the timeout.
  * A pool of public Overpass mirrors with retries; a rate-limited mirror
    (429/504) triggers backoff + retry on the NEXT mirror, and each city's
    query is retried across mirrors. A timed-out query (OSM `remark`) is
    NOT treated as "no playgrounds here" — it is retried.
  * Images are referenced by URL ONLY (the OSM `image` tag). The frontend
    fetches the <img> lazily when a playground's popup opens.
  * If a mirror is 429/504 we back off; if a query times out we retry.
    We only exit non-zero if the final dataset is empty (total outage).

Run locally:
    python3 tools/fetch_playgrounds.py
Run in CI:
    .github/workflows/fetch-playgrounds.yml invokes this.
"""

import json
import os
import re
import sys
import time
from datetime import date

import requests

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "data", "playgrounds_all.geojson")

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
OVERRAID = 35  # OSM per-query timeout; HTTP timeout is OVERRAID + 15
RETRIES = 2     # attempts per city across the mirror pool
BACKOFF = 5     # seconds to wait after a rate-limit before the next mirror

HEADERS = {
    "User-Agent": "Lekesafari/1.0 research (github.com/turbolego/Lekesafari)",
    "Accept": "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
}

# Norwegian equipment sub-tags -> label.
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

# Coarse tiling of Norwegian population centres: (label, south, west, north, east).
# Wider than before so the dataset actually covers the country. Each box is
# small enough that one Overpass query is cheap; big regions may need 2 tries.
NORWAY_BBOXES = [
    ("oslo",             59.80, 10.40, 59.99, 11.00),
    ("trondheim",        63.38, 10.32, 63.52, 10.58),
    ("bergen",           60.30,  5.15, 60.48,  5.50),
    ("stavanger",        58.85,  5.50, 58.98,  5.75),
    ("lund",             57.55,  7.55, 57.75,  7.90),
    ("drammen",          59.92,  9.90, 60.05, 10.12),
    ("tromso",           69.55, 18.85, 69.68, 19.00),
    ("os",               59.70, 10.55, 59.85, 10.80),
    ("bodo",             67.35, 13.50, 67.45, 13.75),
    ("mo-i-rana",        66.35, 12.90, 66.45, 13.10),
    ("halden",           59.10, 10.70, 59.25, 10.95),
    ("kristiansand",     58.12,  7.98, 58.25,  8.15),
    ("moss",             59.40, 10.30, 59.52, 10.45),
    ("larvik",           59.10,  9.55, 59.25,  9.70),
    ("skien",            59.30,  9.30, 59.40,  9.45),
    ("kongsberg",        59.70,  9.50, 59.80,  9.65),
    ("porsgrunn",        59.20,  9.55, 59.30,  9.70),
    ("haugesund",        59.38,  5.20, 59.48,  5.35),
    ("aleksandrukirken", 58.40,  8.00, 58.55,  8.20),
    ("sandnes",          58.80,  5.50, 58.95,  5.70),
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


# ------------------------------------------------------------------
# Google Photos share links cannot be embedded in <img> — the browser
# gets a page, not image bytes. Resolve them to a direct public image
# URL (og:image) so the popup can render the photo, and keep the share
# page URL for the "open" link underneath.
# ------------------------------------------------------------------
_OG_RE = re.compile(r'<meta\s+property="og:image"\s+content="([^"]+)"', re.I)


def resolve_image(raw_url, timeout=12):
    """Return {url, page, alt} for an OSM image tag.

    * Direct image URL  -> embed it as-is.
    * Google Photos share link -> scrape og:image for the direct thumbnail
      and keep the share page as the link target.
    * Anything unresolvable -> leave the raw URL; the frontend falls back
      to a clickable link card. Never raises.
    """
    if not raw_url:
        return None
    alt = "Lekeplass"
    # Already a direct image file.
    if re.search(r"\.(png|jpe?g|gif|webp|svg)(\?|#|$)", raw_url, re.I):
        return {"url": raw_url, "page": raw_url, "alt": alt}
    try:
        r = requests.get(
            raw_url,
            headers={"User-Agent": "Lekesafari-data-bake/1.0 (+https://turbolego.github.io/Lekesafari)"},
            timeout=timeout,
            allow_redirects=True,
        )
        page_url = r.url
        m = _OG_RE.search(r.text[:400_000])
        if m:
            direct = m.group(1)
            # Strip sizing params (=w..-h..) to get a usable thumbnail.
            direct = re.sub(r"=w\d+-h\d+.*$", "", direct)
            return {"url": direct, "page": page_url, "alt": alt}
        return {"url": page_url, "page": page_url, "alt": alt}
    except Exception:
        return {"url": raw_url, "page": raw_url, "alt": alt}


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
    resolved = resolve_image(image_url) if image_url else None
    image_refs = [{"url": resolved["url"], "alt": t.get("name", "Lekeplass")}] if resolved else []
    image_pages = [resolved["page"]] if resolved else []

    rec = {
        "id": f"osm-{osm_type}-{osm_id}",
        "name": t.get("name") or "Ukjent lekeplass",
        "location": {"lat": lat, "lng": lng},
        "source": "osm",
        "sourceId": f"{osm_type}/{osm_id}",
        "images": [],               # never embedded; resolved lazily on popup open
        "imageRefs": image_refs,    # direct image URLs (Google Photos share links resolved)
        "imagePages": image_pages,  # corresponding share-page URL for the "open" link
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
    """POST one query across the mirror pool with retries + backoff.

    Returns a list of OSM elements. Distinguishes a genuine empty area
    (200, no OSM `remark`) from a rate-limit/timeout (429/504 or an OSM
    timeout remark), which is retried on the next mirror.
    """
    for attempt in range(RETRIES * len(OVERPASS_MIRRORS)):
        mirror = OVERPASS_MIRRORS[attempt % len(OVERPASS_MIRRORS)]
        try:
            r = requests.post(mirror, data={"data": query}, headers=HEADERS,
                              timeout=OVERRAID + 15)
            if r.status_code in (429, 503, 504):
                time.sleep(BACKOFF)
                continue
            if r.status_code != 200:
                time.sleep(3)
                continue
            data = r.json()
            # OSM reports a timeout/timeout-error in `remark`; treat as retryable.
            if data.get("remark"):
                time.sleep(BACKOFF)
                continue
            return data.get("elements", [])
        except Exception:
            time.sleep(3)
    # Best effort: one final attempt with the first mirror, return whatever we get.
    try:
        r = requests.post(OVERPASS_MIRRORS[0], data={"data": query},
                          headers=HEADERS, timeout=OVERRAID + 15)
        data = r.json()
        return data.get("elements", [])
    except Exception as exc:
        raise RuntimeError(f"All Overpass mirrors failed: {exc}")


def main():
    now = date.today().isoformat()
    elements = []
    for bbox in NORWAY_BBOXES:
        city = bbox[0]
        try:
            got = run_query(build_query(bbox))
        except RuntimeError as exc:
            print(f"[warn] {city}: {exc}", file=sys.stderr)
            continue
        elements.extend(got)
        print(f"[ok] {city}: {len(got)} elements", file=sys.stderr)
        time.sleep(2)  # stay under rate limits between cities

    # Dedup by OSM source id (city tiles can overlap).
    seen = set()
    features = []
    for el in elements:
        rec = normalize(el, "os", now)
        if rec is None:
            continue
        key = rec["sourceId"]
        if key in seen:
            continue
        seen.add(key)
        features.append({
            "type": "Feature",
            "properties": rec,
            "geometry": {
                "type": "Point",
                "coordinates": [rec["location"]["lng"], rec["location"]["lat"]],
            },
        })
    features.sort(key=lambda f: f["properties"]["id"])

    # Fail loudly on a total outage so CI surfaces it.
    if not features:
        print("Error: no playgrounds fetched (total Overpass outage) — refusing to write empty data.",
              file=sys.stderr)
        sys.exit(1)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    payload = {
        "type": "FeatureCollection",
        "metadata": {
            "generated": now,
            "source": "osm",
            "recordCount": len(features),
        },
        "features": features,
    }
    with open(OUT, "w") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)

    print(f"Successfully wrote {len(features)} playgrounds to {OUT}")


if __name__ == "__main__":
    main()
