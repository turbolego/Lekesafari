#!/usr/bin/env python3
"""Fetch a real OSM playground sample from Overpass to build the normalizer."""
import json, urllib.parse, urllib.request, urllib.error
UA = "Lekesafari/1.0 (https://turbolego.github.io/Lekesafari)"

q = ('[out:json][timeout:25];'
     '(node["leisure"="playground"](59.905,10.735,59.935,10.775);'
     'way["leisure"="playground"](59.905,10.735,59.935,10.775););'
     'out tags center 10;')
data = "data=" + urllib.parse.quote(q, safe="")
req = urllib.request.Request("https://overpass-api.de/api/interpreter",
                             data=data.encode(), method="POST",
                             headers={"User-Agent": UA, "Origin": "https://turbolego.github.io",
                                      "Content-Type": "application/x-www-form-urlencoded"})
with urllib.request.urlopen(req, timeout=40) as r:
    d = json.loads(r.read().decode())
els = d.get("elements", [])
print("total elements:", len(els))
# Show a few with interesting tags
shown = 0
for el in els:
    t = el.get("tags", {})
    interesting = any(k in t for k in ("playground","min_age","max_age","opening_hours","fenced","fee","wheelchair","surface","access","operator"))
    if interesting and shown < 6:
        print("\n---", el.get("type"), el.get("id"), "lat/lon:", el.get("lat"), el.get("lon"), el.get("center"))
        print("   tags:", json.dumps(t, ensure_ascii=False))
        shown += 1
# Count how many have each tag
from collections import Counter
cnt = Counter()
for el in els:
    for k in el.get("tags",{}):
        cnt[k]+=1
print("\nTag frequency:", dict(cnt.most_common(20)))
