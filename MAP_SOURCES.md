# Map Layer Data Sources in Lekesafari

## Currently Implemented

| # | Source | Type | URL | Status |
|---|--------|------|-----|--------|
| 1 | **Static OSM-baked layer** | GeoJSON | `data/playgrounds_all.geojson` | ✅ Active — 4,333 playgrounds + 5 cities |
| 2 | **Live Overpass API** | JSON (CORS) | 4 mirrors: `overpass-api.de`, `overpass.kumi.systems`, `overpass.openstreetmap.fr`, `overpass.osm.ch` | ✅ Active — viewport enrichment at zoom ≥ 9 |
| 3 | **Geonorge WMS** | GML GetFeatureInfo | `wms.geonorge.no/skwms1/wms.tilgjengelihat3` | ✅ Active — 7 point-POI types |
| 4 | **Stedsnavn API** | JSON (CORS) | `ws.geonorge.no/stedsnavn/v1/navn` | ✅ Active — place name search |
| 5 | **Seed data** | JS object | `window.SEED_PLAYGROUNDS` | ✅ Active — offline fallback |
| 6 | **Municipality adapter** | JS function | — | ⚠️ Stub — returns empty `{ source: 'municipality', playgrounds: [], error: 'no-adapter' }` |
| 7 | **OSM raster basemap** | Tile layer | `tile.openstreetmap.org/{z}/{x}/{y}.png` | ✅ Active — background map |
| 8 | **Geonorge Dagligoppdatert** | OGC API Features | `https://data.geonorge.no/geonorge-dagligoppdatert-pub/api/v1/` | ✅ Active — daily-updated Norwegian geodata |

## Not Yet Implemented

| # | Source | Type | Relevance |
|---|--------|------|-----------|
| 1 | **Kartkatalog Geonorge** | Dataset catalog | National geodata catalog — discovery layer for new sources |
| 2 | **Kartverket Topographic WMS** | WMS | `wms.geonorge.no/skwms1/wms.topo` — official Norwegian topographic basemap |
| 3 | **Miljodatakilden** | API | Environmental data API — may contain park/green space data |
| 4 | **FellesOslo API** | API | Oslo-specific open data — could add city-level playground coverage |
| 5 | **Oslo Apilinks** | API | Oslo markers API — alternative Oslo playground source |
| 6 | **Bergen Kommune ArcGIS** | ArcGIS REST | Bergen-specific regulatory/planning data |
| 7 | **OpenCom** | API | Hiking routes / day trips — outdoor recreation data |
| 8 | **Geonorge Vector** | Vector tiles | Modern vector tile service — more flexible than WMS |
| 9 | **Norgestoppe** | Topographic data | Norwegian peak/place name database — elevation enrichment |
| 10 | **NPDC (Norsk Polarinstitutt)** | WMS | Polar region data — Svalbard/Jan Mayen coverage |
| 11 | **MapTiler Norway** | Raster/vector tiles | Commercial dataset — alternative basemap |
| 12 | **Simplemaps GIS** | GeoJSON download | General-purpose country/admin boundaries |