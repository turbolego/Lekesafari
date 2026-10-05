#!/usr/bin/env python3
"""Final probe: find a live, CORS-enabled playground dataset at Geonorge/Miljødatakilden."""
import json, urllib.request, urllib.error, time
H = {"User-Agent": "Lekesafari/1.0 (https://turbolego.github.io/Lekesafari)",
     "Origin": "https://turbolego.github.io"}

def probe(url, timeout=20):
    req = urllib.request.Request(url, headers=H)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("Access-Control-Allow-Origin", ""), r.read(400).decode("utf-8","replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Access-Control-Allow-Origin",""), e.read(200).decode("utf-8","replace")
    except Exception as e:
        return None, "", str(e)

urls = [
    # OGC API features discovery at the standard geonorge base
    "https://data.geonorge.no/geonorge-dagligoppdatert-pub/api/v1/collections",
    # Miljødatakilden OGC API features
    "https://api.miljodatakilden.no/api/v1/collections",
    # OGC records search for lekeanlegg at standard base
    "https://data.geonorge.no/geonorge-dagligoppdatert-pub/api/v1/records?search=lekeplass&limit=3",
]
for u in urls:
    st, cors, body = probe(u)
    print(f"HTTP {st} CORS={cors!r}  {u}")
    if st == 200:
        print("  body:", body[:300].replace("\n"," "))

# OGC features: try known geonorge dataset id for lekeplass if found
st, cors, body = probe("https://data.geonorge.no/geonorge-dagligoppdatert-pub/api/v1/collections")
if st == 200:
    cols = json.loads(urllib.request.urlopen(urllib.request.Request("https://data.geonorge.no/geonorge-dagligoppdatert-pub/api/v1/collections", headers=H)).read().decode())
    names = [c.get("title") for c in cols.get("collections", [])]
    hits = [n for n in names if n and ("leke" in n.lower() or "park" in n.lower() or "idrett" in n.lower())]
    print("leke/park collection hits:", hits)
