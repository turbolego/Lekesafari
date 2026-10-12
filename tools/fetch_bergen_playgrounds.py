#!/usr/bin/env python3
"""
Fetches official Bergen playground polygons from the PBL På bunnen MapServer.
Outputs features in the same JSON format as the existing playground_all.json.
"""
import json, os, sys
import requests

BASE = "https://kart.bergen.kommune.no/arcgis/rest/services/Plan/Reguleringsplaner_på_bunnen/MapServer"
LAYERS = [81]  # Arealformål PBL §12-5 layer - contains playground tags
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "playgrounds_bergen.geojson")

def fetch_layer(lid):
    url = f"{BASE}/{lid}/query"
    params = {
        "where": "1=1",
        "outFields": "*",
        "outSR": "4326",
        "f": "geojson",
    }
    r = requests.get(url, params=params, timeout=20)
    r.raise_for_status()
    return r.json()

def main():
    features = []
    for lid in LAYERS:
        geo = fetch_layer(lid)
        for feat in geo.get("features", []):
            props = feat.get("properties", {})
            # Look for the word "lekeplass" in any descriptive field
            leke = any("lekeplass" in str(v).lower() for v in props.values())
            if not leke:
                continue
            features.append(feat)
    if not features:
        print("No playground features found in Bergen")
        sys.exit(1)
    fc = {"type": "FeatureCollection", "features": features}
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(fc, f)
    print(f"{len(features)} Bergen playground features written to {OUT}")

if __name__ == "__main__":
    main()
