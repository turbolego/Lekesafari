#!/usr/bin/env python3
"""Research probe: which Norwegian geodata sources actually serve vector
parks/POI data, are CORS-open to turbolego.github.io, and are reachable.
Prints a compact table. No secrets, no mutation.
"""
import urllib.request
import urllib.error
import ssl
import json
import concurrent.futures

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
UA = {"User-Agent": "Lekesafari/1.0 research"}

TARGETS = {
    # --- Geonorge OGC Features (new OGC API REST) ---
    "geonorge-ogc-daily": "https://data.geonorge.no/geonorge-dagligoppdatert-pub/api/v1/ogc/features?bbox=10.5,59.8,11.0,59.9&limit=2",
    "geonorge-ogc-daily2": "https://data.geonorge.no/geonorge-dagligoppdatert-pub/api/v1/ogc/features?limit=2",
    # --- Geonorge arcgis-rest (OGC via ArcGIS) ---
    "geonorge-arcgis": "https://data.geonorge.no/geonorge-dagligoppdatert-pub/api/v1/datasets?limit=2",
    # --- Miljødatakilden (Miljødirektoratet, OASIS/SEPA) ---
    "miljodatakilden": "https://data.kompetanse.no/api/v1/datasets?per_page=2",
    "miljodatakilden-search": "https://data.kompetanse.no/api/v1/search?query=lekeplass",
    # --- Kartkatalogen dataset catalog ---
    "kartkatalogen": "https://kartkatalog.geonorge.no/api/datasets?per_page=2",
    # --- Kartverket / Geonorge WMS (topo, green areas) ---
    "wms-topo": "https://wms.geonorge.no/skwms1/wms.topo?request=GetCapabilities&service=WMS&language=Norwegian",
    "wms-tilgjengelighet": "https://wms.geonorge.no/skwms1/wms.tilgjengelighet3?request=GetCapabilities&service=WMS",
    # --- Stedsnavn (place names; confirmed CORS *) ---
    "stedsnavn": "https://ws.geonorge.no/stedsnavn/v1/navn?sok=oslo&treffPerSide=1&side=1",
    # --- Oslo open data (lekeplasser) ---
    "oslo-openapi-lekeplasser": "https://fellesoslo.api.com/open-data/api/v1/lekeplasser",
}


def probe(name, url, timeout=18):
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            cors = r.headers.get("Access-Control-Allow-Origin", "(none)")
            ct = (r.headers.get("content-type", "") or "").lower()
            body = r.read(500).decode("utf-8", "replace")
            is_json = "json" in ct
            jsn = None
            if is_json:
                try:
                    jsn = json.loads(body)
                except Exception:
                    is_json = False
            return dict(name=name, code=r.status, cors=cors, ct=ct[:25],
                        json=is_json, snippet=body[:140].replace("\n", " "), payload=jsn)
    except urllib.error.HTTPError as e:
        return dict(name=name, code=e.code, err="http",
                    snippet=(e.read(140).decode("utf-8", "replace") if e.headers else "")[:140])
    except Exception as e:
        return dict(name=name, code="ERR:" + type(e).__name__,
                    snippet=str(e)[:90])


def main():
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        futs = {ex.submit(probe, k, v): k for k, v in TARGETS.items()}
        results = []
        for f in concurrent.futures.as_completed(futs):
            results.append(f.result())
    for r in results:
        cors = r.get("cors", "")
        marker = "CORS*" if cors == "*" else " "
        print(f"{marker} {str(r.get('code')):5} {r.get('name'):28} ct={r.get('ct',''):25} "
              f"cors={cors[:18]:18} json={r.get('json','')}")
        if r.get("snippet"):
            print(f"        {r['snippet']}")
    print()
    print("Summary: CORS-open sources that returned 200:")
    for r in results:
        if r.get("cors") == "*" and r.get("code") == 200:
            print("  +", r["name"])


if __name__ == "__main__":
    main()
