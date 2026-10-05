#!/usr/bin/env python3
"""Probe Geonorge/Kartverket API endpoints for playground (lekeanlegg) data + CORS."""
import json, urllib.parse, urllib.request, urllib.error

UA = "Lekesafari/1.0"
H = {"User-Agent": UA, "Origin": "https://turbolego.github.io"}

def probe(url):
    req = urllib.request.Request(url, headers=H)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read(300).decode("utf-8", "replace")
            return r.status, r.headers.get("Access-Control-Allow-Origin", ""), body
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Access-Control-Allow-Origin", ""), e.read(200).decode("utf-8", "replace")
    except Exception as e:
        return None, "", str(e)

candidates = [
    # OGC records / features discovery
    "https://data.geonorge.no/geonorge-dagligoppdatert-pub/api/v1/openapi.json",
    "https://data.geonorge.no/geonorge-dagligoppdatert-pub/api/v1/records",
    "https://data.geonorge.no/geonorge-dagligoppdatert-pub/api/v1/collections",
    # older ogc features
    "https://opendata.kartverket.no/geonorge/api/v1/collections",
    # env/search portal API
    "https://data.geonorge.no/opensearch/records?search=lekeanlegg&f=json",
]
for u in candidates:
    st, cors, body = probe(u)
    print(f"HTTP {st} CORS={cors!r}\n  {u}\n  {body[:150]!r}\n")
