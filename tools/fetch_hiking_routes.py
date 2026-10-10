#!/usr/bin/env python3
"""
Fetches '52 hverdagsturer' (Everyday Hikes) GeoJSON routes from opencom.no.
Merges them into a single FeatureCollection for the Lekesafari map.
"""
import json
import os
import sys
import requests
from bs4 import BeautifulSoup

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "data", "hiking_routes.geojson")
START_URL = "https://opencom.no/dataset/52-hverdagsturer"

def fetch_geojson(url):
    try:
        r = requests.get(url, timeout=15)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        print(f"  [warn] Failed to fetch {url}: {e}")
        return None

def main():
    print(f"Fetching hiking routes from {START_URL}...")
    try:
        r = requests.get(START_URL, timeout=15)
        r.raise_for_status()
    except Exception as e:
        print(f"Error accessing start page: {e}")
        sys.exit(1)

    soup = BeautifulSoup(r.text, 'html.parser')
    links = []
    for a in soup.find_all('a', href=True):
        href = a['href']
        if '.geojson' in href.lower():
            url = href if href.startswith('http') else 'https://opencom.no' + href
            links.append(url)
    print(f"  found {len(links)} geojson URLs")

    all_features = []
    for url in links:
        data = fetch_geojson(url)
        if data and 'features' in data:
            all_features.extend(data['features'])
    if not all_features:
        print("  no features found; aborting")
        sys.exit(1)
    geojson = {"type": "FeatureCollection", "features": all_features}
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(geojson, f, indent=2)
    print(f"wrote {len(all_features)} hiking routes to {OUT}")

if __name__ == "__main__":
    main()
