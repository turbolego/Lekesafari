#!/usr/bin/env python3
"""
Fetches Oslo playgrounds from the municipality web‑api.
Writes a GeoJSON to data/playgrounds_oslo.geojson.
"""
import json, os, sys
import requests

BASE_URL = "https://oslo.apilinks.io/api/v1/markers"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "playgrounds_oslo.geojson")

PAGE = 1
RECORDS = []
while True:
    r = requests.get(BASE_URL, params={"page": PAGE, "perPage": 100}, timeout=15)
    if not r.ok:
        print(f"HTTP {r.status_code} while fetching page {PAGE}")
        sys.exit(1)
    data = r.json()
    RECORDS.extend(data.get("rows", []))
    if data.get("page") >= data.get("totalPages"):
        break
    PAGE += 1

features = []
for rec in RECORDS:
    prop = {
        "id": f"oslo-{rec.get('docId')}",
        "name": rec.get("Temanavn", "Ukjent lekeplass"),
        "location": rec.get("location", {}),
        "source": "oslo-api",
        "sourceId": rec.get("docId"),
        "images": [],
        "imageRefs": [],
        "imagePages": [],
        "age": {"min": 0, "max": 16},
        "opening": "",
        "equipment": [],
        "rating": {"average": 0, "count": 0},
        "accessibility": {"wheelchair": "unknown", "stroller": "unknown"},
        "fenced": False,
        "toilets": False,
        "parking": {"free": True, "paid": False},
        "dogs": {"allowed": "unknown", "leash": "unknown"},
        "municipality": "oslo",
        "verified": False,
        "lastVerified": "2026-10-10",
        "sources": [
            {"type": "api", "id": rec.get("docId"), "retrievedAt": "2026-10-10"}
        ],
    }
    features.append({"type": "Feature", "properties": prop, "geometry": {"type": "Point", "coordinates": [rec["location"]["longitude"], rec["location"]["latitude"]]}})

geojson = {"type": "FeatureCollection", "metadata": {"generated": "2026-10-10", "source": "oslo-api", "recordCount": len(features)}, "features": features}
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(geojson, f, indent=2)
print(f"wrote {len(features)} Oslo playgrounds to {OUT}")
