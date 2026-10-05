#!/usr/bin/env python3
import json, urllib.parse, urllib.request, urllib.error, time, sys
UA="Lekesafari/1.0"
def fetch(url, data=None, method=None):
    h={"User-Agent":UA,"Origin":"https://turbolego.github.io"}
    if method=="POST": h["Content-Type"]="application/x-www-form-urlencoded"
    req=urllib.request.Request(url, data=data.encode("utf-8") if data else None, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, r.headers.get("Access-Control-Allow-Origin",""), r.read(300).decode("utf-8","replace")
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Access-Control-Allow-Origin",""), e.read(300).decode("utf-8","replace")
    except Exception as e:
        return None,"",str(e)

# Smaller bbox around central Oslo, fewer results, POST form
q='[out:json][timeout:15][maxsize:500];node["leisure"="playground"](59.91,10.74,59.93,10.77);out 3;'
data="data="+urllib.parse.quote(q, safe="")
mirrors=["https://overpass-api.de/api/interpreter",
         "https://overpass.kumi.systems/api/interpreter",
         "https://overpass.osm.jp/api/interpreter"]
for m in mirrors:
    for attempt in range(3):
        st,cors,body=fetch(m,data=data,method="POST")
        n=0
        if st==200:
            try:
                d=json.loads(body) if False else None
                # body truncated; re-count from full
            except: pass
        tag = "OK" if st==200 else "FAIL"
        print(f"{m.split('/')[2]} attempt {attempt+1}: HTTP {st} CORS={cors!r} {tag}")
        if st==200:
            print("  preview:", repr(body[:150]))
            break
        else:
            print("  preview:", repr(body[:120]))
            time.sleep(2)
    print()
