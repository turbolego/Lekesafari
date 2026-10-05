#!/usr/bin/env python3
"""Test candidate data sources for Lekesafari: CORS + payload shape."""
import json, urllib.parse, urllib.request, urllib.error, sys

ORIGIN = "https://turbolego.github.io"
UA = "Lekesafari/1.0"

def fetch(url, data=None, method=None):
    """Return (status, has_cors, body_head)."""
    headers = {
        "User-Agent": UA,
        "Origin": ORIGIN,
    }
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            cors = r.headers.get("Access-Control-Allow-Origin", "")
            body = r.read(400).decode("utf-8", "replace")
            return r.status, cors, body
    except urllib.error.HTTPError as e:
        cors = e.headers.get("Access-Control-Allow-Origin", "")
        body = e.read(400).decode("utf-8", "replace")
        return e.code, cors, body
    except Exception as e:
        return None, "", str(e)

# 1) Overpass OSM playgrounds around Oslo
osm_q = "[out:json][timeout:25];node[leisure=playground](59.9,10.7,59.95,10.8);out 3;"
enc = urllib.parse.quote(osm_q, safe="")
print("=== OSM Overpass ===")
for host in ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]:
    st, cors, body = fetch(host + "?data=" + enc)
    n_nodes = 0
    if st == 200:
        try:
            d = json.loads(body) if "json" in body else None
        except Exception:
            d = None
    ok = "OK" if st == 200 else "FAIL"
    print(f"  {host.split('/')[2]}: HTTP {st} CORS={cors!r} -> {ok}")
    print(f"    preview: {body[:180]!r}")

print()
print("=== Geonorge OGC records search (lekeanlegg) ===")
for u in [
    "https://data.geonorge.no/geonorge-dagligoppdatert-pub/api/v1/records?search=lekeanlegg&f=json&limit=3",
    "https://data.geonorge.no/api/v1/records?search=lekeanlegg&f=json&limit=3",
]:
    st, cors, body = fetch(u)
    print(f"  HTTP {st} CORS={cors!r}")
    print(f"    preview: {body[:200]!r}")
