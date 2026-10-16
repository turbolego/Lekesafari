// ============================================================
//  Lekesafari – Source adapters
//  Turns heterogeneous open-map sources into one Playground[]
//  so the map is never pinned to hardcoded data.
// ============================================================

const OSM_EQUIPMENT = {
  'playground:slide': 'Rutschbane',
  'playground:seesaw': 'Vippe',
  'playground:swing': 'Gynge',
  'playground:springer': 'Hoppeslott',
  'playground:sandpit': 'Sandkasse',
  'playground:climbing_frame': 'Klatrestativ',
  'playground:maze': 'Labyrint',
  'playground:rope': 'Trosse',
  'playground:mechanized': 'Karussell',
  'playground:ball_court': 'Ballbane',
  'playground:sheltered': 'Sikringshus',
  'playground:water': 'Vannleke',
  'playground:trampoline': 'Trampolin',
};

// --- OSM source adapter (live, Overpass, CORS *) ---
// Overpass mirrors are public and frequently rate-limited; a single
// stalled mirror must not hang the map. Every request gets a short
// client-side abort timeout, and we try a pool of mirrors.
const OSM_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
];

async function overpassFetch(query) {
  for (const mirror of OSM_MIRRORS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const r = await fetch(mirror, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal: ctrl.signal,
      });
      if (!r.ok) continue; // 504/429 → try next mirror
      return await r.json();
    } catch (err) {
      // network / abort → next mirror
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

async function loadOSM(bounds) {
  // Static source is already baked into playgrounds_all.geojson.
  // Live Overpass is disabled to prevent 504 timeouts and CORS errors.
  return { source: 'osm', playgrounds: [], error: null };
}

function parkFromOSM(t) {
  if (t.parking === 'no') return { free: false, paid: false };
  if (t.parking_access === 'no') return { free: false, paid: false };
  // "fee=no" on the playground itself means free entry; parking is a separate tag.
  const free = t.parking === 'yes' || t.parking_fee === 'no';
  const paid = t.parking_fee === 'yes' || (t.parking === 'yes' && !free);
  if (free || paid) return { free, paid };
  // Untagged means UNKNOWN. Do not assert free parking for every untagged
  // playground — that made the free-parking filter match the entire dataset.
  return { free: false, paid: false };
}

function dogsFromOSM(t) {
  if (['yes', 'true', 'permitted'].includes(t.dogs)) return { allowed: true, leash: t.dogs === 'leash' };
  if (['no', 'false', 'prohibited'].includes(t.dogs)) return { allowed: false, leash: false };
  if (t.leashed) return { allowed: true, leash: true };
  return { allowed: true, leash: false }; // default: allowed, off leash
}

function normYesNoLimited(v) {
  if (!v) return 'unknown';
  if (['yes', 'true', 'limited'].includes(v)) return v;
  if (['no', 'false'].includes(v)) return 'no';
  return 'unknown';
}

// --- WMS Tilgjengelighet adapter (CORS *) ---
// Geonorge's wms.tilgjengelighet3 supports CORS for GetMap/GetFeatureInfo,
// so we can fetch it directly from the browser without a proxy.
// Layers: friluft (grillbalplass, friluftsomrade, turisthytte, etc.),
//         felles (toalett, sittegruppebenk),
//         t_vei_r (accessibility assessment)
const WMS_BASE = 'https://wms.geonorge.no/skwms1/wms.tilgjengelighet3';
const STEDSNAVN_URL = 'https://ws.geonorge.no/stedsnavn/v1/navn';
const IMAGE_BASE_URL = 'https://data.kartverket.no/tilgjengelighet/tilgjengelighet';

// Query the group layers friluft + felles (same as the reference
// Tilgjengelighet-WMS-OpenLayers app). Querying the numbered _01/_02/_03
// sublayers individually triple-bloats every facility (same objid appears in
// each quality tier) and wastes the feature_count budget on duplicates.
const WMS_QUERY_LAYERS = 'friluft,felles';
// Point-POI objtypes worth showing as markers. Everything else in the
// tilgjengelighet3 dataset is either a long line (FriluftTurvei — hundreds
// of trail segments) or a large area/polygon (Friluftsområde,
// Parkeringsområde, HCparkering, StSikrFriluftomr) that doesn't make a
// sensible single marker.
const WMS_POI_TYPES = new Set([
  'Sittegruppe',
  'FriluftToalett',
  'FriluftGrillBålplass',
  'FriluftFiskeplassBrygge',
  'FriluftBaderampe',
  'FriluftGapahuk',
  'FriluftHytterTilrettelagt',
]);
const WMS_TYPE_LABELS = {
  Sittegruppe: 'Sittedue',
  FriluftToalett: 'Toalett',
  'FriluftGrillBålplass': 'Grillplass',
  FriluftFiskeplassBrygge: 'Fiskeplass',
  FriluftBaderampe: 'Baderampe',
  FriluftGapahuk: 'Gapahuk',
  FriluftHytterTilrettelagt: 'Tilrettelagt hytte',
};
// This WMS returns features in storage order, truncated by feature_count —
// it is a sampling service, not a precise spatial filter (verified against
// the live endpoint). A single request over the viewport bbox with a high
// feature_count is the efficient way to get the sample; extra grid cells
// re-download the same global sample without improving POI recall.
const WMS_FEATURE_COUNT = 5000;
const WMS_MAX_FEATURES = 200;  // cap markers shown per scan
// Zoom gate: only scan at district/city scale (span <= 0.1 deg, ~zoom 12+).
const WMS_SPAN_LIMIT = 0.5;
// Small in-memory cache keyed on a coarsened viewport so panning a little
// (and panning back) doesn't re-download the multi-MB GML sample.
const WMS_CACHE = new Map();
const WMS_CACHE_TTL_MS = 5 * 60 * 1000;

// ── Coordinate conversion: EPSG:4326 (lng/lat) ⇄ EPSG:3857 (Web Mercator m) ──
// Required because WMS 1.3.0 with EPSG:4326 uses reversed axis order
// (lat,lon), which silently misaligns BBOX queries. All GetFeatureInfo
// requests therefore use EPSG:3857 — the same approach the reference
// Tilgjengelighet-WMS-OpenLayers app uses.
function lonLatToMercator(lng, lat) {
  const x = (lng * 20037508.34) / 180;
  const y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180) * (20037508.34 / 180);
  return [x, y];
}
function mercatorToLonLat(mx, my) {
  const lng = (mx / 20037508.34) * 180;
  let lat = (my / 20037508.34) * 180;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return [lng, lat];
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function tagText(str, tag) {
  const alts = tag === 'Name' ? '(?:Name|n)' : tag;
  const m = str.match(new RegExp(`<${alts}[^>]*>([\\s\\S]*?)<\\/${alts}>`));
  return m ? m[1].trim() : '';
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
}

function parseCapabilities(xml) {
  const results = [];
  let i = 0;
  while (i < xml.length) {
    const start = xml.indexOf('<Layer', i);
    if (start === -1) break;
    let depth = 1, j = start + 6;
    while (j < xml.length && depth > 0) {
      const no = xml.indexOf('<Layer', j), nc = xml.indexOf('</Layer>', j);
      if (nc === -1) { j = xml.length; break; }
      if (no !== -1 && no < nc) { depth++; j = no + 6; }
      else { depth--; j = nc + 8; }
    }
    const block = xml.slice(start, j);
    const firstNested = block.indexOf('<Layer', 6);
    const header = firstNested > -1 ? block.slice(0, firstNested) : block;
    const name = tagText(header, 'Name');
    const title = tagText(header, 'Title') || name;
    let legendUrl = '';
    const styleBlock = header.match(/<Style>([\s\S]*?)<\/Style>/);
    if (styleBlock) {
      const hrefMatch = styleBlock[1].match(/xlink:href="([^"]+)"/);
      if (hrefMatch) legendUrl = decodeEntities(hrefMatch[1]);
    }
    const innerStart = block.indexOf('>') + 1;
    const innerEnd = block.lastIndexOf('</Layer>');
    const innerXml = innerStart < innerEnd ? block.slice(innerStart, innerEnd) : '';
    if (name || innerXml.includes('<Layer')) {
      results.push({ name, title, legendUrl, innerXml });
    }
    i = j;
  }
  return results;
}

function parseFeatureInfoText(text) {
  const features = [];
  const lines = text.split('\n');
  let currentLayer = null, currentProps = {}, currentId = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (line.startsWith('LayerName') || (!line.includes(':') && line.match(/^[a-z]/i))) {
      if (currentLayer && Object.keys(currentProps).length > 0) {
        features.push({ layerName: currentLayer, featureId: currentId, props: new Map(Object.entries(currentProps).filter(([,v]) => v !== undefined)), images: [] });
      }
      currentLayer = trimmed.replace(/[\r\n]/g, '');
      currentProps = {};
      currentId = '';
      continue;
    }
    const match = line.match(/^\s{2,}(\w+)\s*:\s*(.+)$/);
    if (match) {
      const [, key, val] = match;
      const v = val.replace(/[\r\n]/g, '').trim();
      if (!currentId) currentId = v;
      currentProps[key] = v;
    }
  }
  if (currentLayer && Object.keys(currentProps).length > 0) {
    features.push({ layerName: currentLayer, featureId: currentId, props: new Map(Object.entries(currentProps).filter(([,v]) => v !== undefined)), images: [] });
  }
  return features;
}

// GML GetFeatureInfo parser (vendored from the Tilgjengelighet-WMS-OpenLayers
// shared package, extended with layer-name capture). MapServer wraps features
// in <xxx_layer> groups, but the <xxx_feature> blocks are self-contained leaf
// elements (gml:Box geometry + property tags), so we match them directly — a
// layer-block backreference over <(\w+)_layer> is fragile and the features
// are what we actually need.
// Geometry arrives as a gml:Box in the request CRS (EPSG:3857 metres); a
// point is a degenerate box with two identical coordinates.
function parseGMLFeatureInfo(gmlText) {
  const features = [];
  const featureBlocks = gmlText.matchAll(/<(\w+_feature)>([\s\S]*?)<\/\1>/g);
  for (const m of featureBlocks) {
    // m = [fullMatch, tagName, blockContent] — the block content is group 2.
    const tagName = m[1];
    const block = m[2];
    const layerName = tagName.replace(/_feature$/, '');
    const props = new Map();
    const images = [];
    const boxMatch = block.match(/<gml:coordinates>([\d.,\s]+)<\/gml:coordinates>/);
    let centerX = 0;
    let centerY = 0;
    if (boxMatch) {
      const coords = boxMatch[1].trim().split(/\s+/);
      if (coords.length === 1) {
        const [x, y] = coords[0].split(',').map(Number);
        centerX = x;
        centerY = y;
      } else if (coords.length === 2) {
        const [x1, y1] = coords[0].split(',').map(Number);
        const [x2, y2] = coords[1].split(',').map(Number);
        centerX = (x1 + x2) / 2;
        centerY = (y1 + y2) / 2;
      }
    }
    const propMatches = block.matchAll(/<(?!gml:)(\w+)>([^<]*)<\/\1>/g);
    for (const pm of propMatches) {
      const v = pm[2].trim();
      if (!v) continue;
      props.set(pm[1], v);
      if (/^bildefil[123]$/i.test(pm[1])) images.push(v);
    }
    const objid = props.get('objid') || props.get('lokalid') || '';
    if (objid) {
      features.push({ layerName, featureId: objid, props, images, centerX, centerY });
    }
  }
  return features;
}

// A feature is fully wheelchair-accessible when every populated
// rullestol/elrull/syn assessment equals 'Tilgjengelig' (case-insensitive).
function filterFullyAccessible(features) {
  return features.filter((feature) => {
    const r1 = feature.props.get('tilgjengvurderingRulleMan') || feature.props.get('tilgjengvurderingrulleman');
    const r2 = feature.props.get('tilgjengvurderingRulleAuto') || feature.props.get('tilgjengvurderingrulleauto');
    const r3 = feature.props.get('tilgjengvurderingElRull') || feature.props.get('tilgjengvurderingelrullstol');
    const r4 = feature.props.get('tilgjengvurderingSyn') || feature.props.get('tilgjengvurderingsyn');
    const vals = [r1, r2, r3, r4].filter(v => v && v.length > 0);
    if (vals.length === 0) return false;
    return vals.every(v => v.toLowerCase() === 'tilgjengelig');
  });
}

// --- WMS viewport scan (same method family as the reference OpenLayers
// app: WMS 1.3.0 GetFeatureInfo, EPSG:3857 Mercator bbox, GML replies). ---
// One request over the viewport bbox. Verified behaviour of this endpoint:
// it returns features in storage order, truncated by feature_count, biased
// toward the requested bbox — a sampling service, not a strict spatial
// filter. Extra grid cells would just re-download the same global sample,
// so a single high-feature_count request is the efficient way to get it.
// The GML geometry (gml:Box) gives each feature's real position, so
// records are placed at their own coordinates (the old version dropped
// every feature on the viewport centre).
async function loadWmsTilgjengelighet(bounds) {
  const playgrounds = [];
  if (!bounds) return { playgrounds, error: 'wms-no-bounds' };
  // Zoom gate: at region/country scale the sample is useless — only scan
  // at district/city scale (span <= 0.1 deg ~= zoom 12+).
  if (Math.abs(bounds.getNorth() - bounds.getSouth()) > WMS_SPAN_LIMIT) {
    return { playgrounds, error: null };
  }

  // Cache key: viewport coarsened to 0.005 deg (~550 m) so small pans hit.
  const r5 = v => Math.round(v / 0.005) * 0.005;
  const cacheKey = [
    r5(bounds.getWest()), r5(bounds.getSouth()),
    r5(bounds.getEast()), r5(bounds.getNorth()),
  ].join(',');
  const now = Date.now();
  for (const [k, hit] of WMS_CACHE) {
    if (now - hit.at > WMS_CACHE_TTL_MS) WMS_CACHE.delete(k);
  }
  const hit = WMS_CACHE.get(cacheKey);
  if (hit && now - hit.at <= WMS_CACHE_TTL_MS) {
    return { playgrounds: hit.playgrounds, error: null };
  }
  try {
    const [mxMin, myMax] = lonLatToMercator(bounds.getWest(), bounds.getNorth());
    const [mxMax, myMin] = lonLatToMercator(bounds.getEast(), bounds.getSouth());
    // WMS 1.3.0 + EPSG:3857: bbox order is xmin,ymin,xmax,ymax (meters).
    const bbox = `${mxMin},${myMin},${mxMax},${myMax}`;
    const params = new URLSearchParams({
      service: 'WMS', request: 'GetFeatureInfo', version: '1.3.0',
      layers: WMS_QUERY_LAYERS, query_layers: WMS_QUERY_LAYERS,
      info_format: 'application/vnd.ogc.gml',
      feature_count: String(WMS_FEATURE_COUNT),
      i: '2', j: '2', width: '5', height: '5',
      crs: 'EPSG:3857', bbox,
      format: 'image/png', styles: '', transparent: 'true',
      language: 'Norwegian',
    });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    let text = '';
    try {
      const r = await fetch(`${WMS_BASE}?${params.toString()}`, { signal: ctrl.signal });
      text = r.ok ? await r.text() : '';
    } finally {
      clearTimeout(timer);
    }
    if (text.indexOf('_feature') === -1) return { playgrounds, error: null };

    const seen = new Set();
    for (const f of parseGMLFeatureInfo(text)) {
      if (seen.has(f.featureId)) continue;
      seen.add(f.featureId);
      const objtype = f.props.get('objtype') || '';
      // Keep only point facilities; skip trail lines and area polygons.
      if (!WMS_POI_TYPES.has(objtype)) continue;
      const mx = f.centerX;
      const my = f.centerY;
      if (!mx && !my) continue;
      const [lng, lat] = mercatorToLonLat(mx, my);
      // Drop features outside the requested viewport (the sample is global).
      if (lat < bounds.getSouth() || lat > bounds.getNorth() ||
          lng < bounds.getWest() || lng > bounds.getEast()) continue;

      const name = WMS_TYPE_LABELS[objtype] || objtype.replace(/([a-z])([A-Z])/g, '$1 $2');
      // Wheelchair: prefer the Kartverket assessment fields (all populated
      // rullestol/elrull/syn values == 'Tilgjengelig'); fall back to the
      // turning-circle diameter (>= 150 cm) when those are absent.
      let wheelchair = 'unknown';
      if (filterFullyAccessible([f]).length === 1) wheelchair = 'yes';
      else {
        const diameter = parseFloat(f.props.get('diameter') || '');
        if (!isNaN(diameter) && diameter >= 150) wheelchair = 'yes';
      }
      const rec = normalizePlayground({
        id: `wms-tilgjengelighet-${f.featureId}`,
        sourceId: f.featureId,
        name: name || 'Ukjent',
        lat: +lat.toFixed(6),
        lng: +lng.toFixed(6),
        description: f.props.get('kommentar') || '',
        source: 'wms-tilgjengelighet',
        poiType: objtype,
        imageRefs: f.images.slice(0, 3).map(fn => ({ url: `${IMAGE_BASE_URL}/${encodeURIComponent(fn)}`, alt: name })),
        imagePages: f.images.slice(0, 3).map(fn => `${IMAGE_BASE_URL}/${encodeURIComponent(fn)}`),
        accessibility: {
          wheelchair,
          stroller: 'unknown',
        },
      });
      if (rec && playgrounds.length < WMS_MAX_FEATURES) playgrounds.push(rec);
    }
    WMS_CACHE.set(cacheKey, { playgrounds, at: now });
  } catch (e) { console.warn('loadWmsTilgjengelighet:', e); }
  return { playgrounds, error: null };
}

// --- Stedsnavn place search (Kartverket, CORS-open, no key) ---
// Used by the search box: 3+ characters triggers a place-name lookup;
// results fly the map to the representation point.
async function searchStedsnavn(term) {
  const q = String(term || '').trim();
  if (q.length < 3) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const url = `${STEDSNAVN_URL}?sok=${encodeURIComponent(q)}*&treffPerSide=15&side=1`;
    const r = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: ctrl.signal });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.navn || []).map(n => {
      const rp = n.representasjonspunkt || {};
      const kommune = (n.kommuner || [])[0];
      const fylke = (n.fylker || [])[0];
      return {
        id: n.navneobjektid,
        name: n.skrivemaa || n.skrivemaae || n.skrivemaade || n.navneobjekttype || q,
        lat: rp.nord,
        lng: rp.øst,
        type: n.navneobjekttype,
        kommune: kommune ? kommune.kommunenavn : '',
        fylke: fylke ? fylke.fylkesnavn : '',
      };
    }).filter(p => p.lat != null && p.lng != null);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// --- Geonorge / Kartverket adapter ---
// Geonorge's OGC Features endpoint is not CORS-open to arbitrary
// origins, so we attempt it but always degrade to "no data" rather
// than throwing. Swap the URL below once a CORS-friendly mirror or a
// small proxy (Cloudflare Worker, per the spec notes) is available.
async function loadGeonorge(bounds) {
  if (!bounds) return { source: 'geonorge', playgrounds: [], error: 'geonorge-no-bounds' };
  return { source: 'geonorge', playgrounds: [], error: 'geonorge-unavailable' };
}

// --- Municipality / user adapters (stubs for now) ---
async function loadMunicipality() {
  return { source: 'municipality', playgrounds: [], error: 'no-adapter' };
}

// --- Seed / offline fallback so the map is never empty ---
function loadSeed() {
  return { source: 'seed', playgrounds: (window.SEED_PLAYGROUNDS || []), error: null };
}

// --- Normalization: every source returns the SAME shape ---
function normalizePlayground(o) {
  // Age is exposed BOTH nested (age.min/age.max, the data-file shape) and flat
  // (minAge/maxAge) because filterPlaygrounds() reads the flat form. Without the
  // flat aliases the "Alder" filter silently matched everything.
  const age = o.age || {};
  const minAge = o.minAge ?? age.min;
  const maxAge = o.maxAge ?? age.max;
  // Preserve the real source references when the adapter supplies them
  // (e.g. static loader passes the OSM {type:'osm', id:'node/123'} entries).
  // Falling back to sourceId/id here would break deep links, because those
  // are the internal `osm-node-123` form rather than OSM's `node/123`.
  const sources = Array.isArray(o.sources) && o.sources.length
    ? o.sources
    : [{ type: o.source, id: o.sourceId || o.id, retrievedAt: o.lastVerified || new Date().toISOString().slice(0, 10) }];
  return {
    id: o.id,
    name: o.name,
    location: { lat: o.lat, lng: o.lng },
    source: o.source,
    sourceId: o.sourceId,
    images: o.images || [],
    imageRefs: o.imageRefs || [],  // raw OSM image URLs; fetched on-demand for detail modal
    imagePages: o.imagePages || [],  // original Google Photos page URL for each image (for the link under it)
    // Flat minAge/maxAge aliases: filterPlaygrounds reads these, so normalizing
    // only the nested `age` object left the age filter a silent no-op.
    age: { min: minAge ?? o.age?.min ?? 0, max: maxAge ?? o.age?.max ?? 16 },
    minAge: minAge ?? o.age?.min ?? 0,
    maxAge: maxAge ?? o.age?.max ?? 16,
    opening: o.opening || '',
    equipment: o.equipment || [],
    rating: o.rating || { average: 0, count: 0 },
    accessibility: o.accessibility || { wheelchair: o.wheelchair || 'unknown', stroller: 'unknown' },
    fenced: o.fenced === true,
    toilets: o.toilets === true,
    // Only an explicit true counts. The baked data stores 'unknown' strings
    // for dogs and 'free' defaults, and a truthy string previously made every
    // record pass the dog/parking filters.
    freeParking: o.parking?.free === true,
    paidParking: o.parking?.paid === true,
    dogsAllowed: o.dogs?.allowed === true,
    dogsLeash: o.dogs?.leash === true,
    municipality: o.municipality || '',
    verified: o.verified === true,
    lastVerified: o.lastVerified || null,
    poiType: o.poiType || null,
    sources,
  };
}

// --- Merge + dedup (spec: coordinates + name + distance) ---
function haversineMiles(a, b) {
  const R = 3958.8, toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad, dLng = (b.lng - a.lng) * toRad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function mergeSources(results) {
  const merged = [];
  for (const res of results) {
    if (!res) continue;
    for (const pg of res.playgrounds) {
      // Skip duplicate within the same source
      if (merged.some(m => m.id === pg.id)) continue;
      // Dedup across sources: near-identical name within ~60m
      const dup = merged.find(m => {
        const a = m.name.toLowerCase(), b = pg.name.toLowerCase();
        if (a === b || a.includes(b) || b.includes(a)) {
          return haversineMiles(m.location, pg.location) < 0.04; // ~60m
        }
        return false;
      });
      if (dup) {
        // Keep the richer record, but note the merged source
        dup.sources.push({ type: pg.source, id: pg.sourceId || pg.id, retrievedAt: pg.lastVerified });
        if (pg.rating && pg.rating.count > 0) dup.rating = pg.rating;
        if (pg.opening && !dup.opening) dup.opening = pg.opening;
        if (pg.equipment.length && !dup.equipment.length) dup.equipment = pg.equipment;
      } else {
        merged.push(pg);
      }
    }
  }
  return merged;
}

// --- Static baked layer (same-origin, always available) ---
// data/playgrounds_all.geojson is served by GitHub Pages same-origin (no CORS),
// so it never hangs on public-mirror outages. It's the primary baseline —
// loaded at ALL zooms. Live OSM enriches it only at zoom >= 9.
// The nightly GitHub Actions workflow (fetch-playgrounds.yml) bakes fresh
// Norwegian OSM playgrounds into this file.
//
// The payload is ~3.5 MB and used to be re-fetched and re-normalized on every
// map moveend/zoomend. Memoize the parsed result for the lifetime of the page:
// the file only changes when the nightly bake commits, so a page reload is the
// natural refresh point.
let staticCache = null;
async function loadStatic() {
  if (staticCache) return staticCache;
  staticCache = (async () => {
    try {
      const r = await fetch('data/playgrounds_all.geojson', { cache: 'no-store' });
      if (!r.ok) return { source: 'static', playgrounds: [], error: `static-${r.status}` };
      const fc = await r.json();

      const out = (fc.features || []).map(f => {
        const p = f.properties || {};
        if (!f.geometry || f.geometry.type !== 'Point') return null;
        const [lng, lat] = f.geometry.coordinates;
        return normalizePlayground({
          id: p.id,
          name: p.name,
          lat, lng,
          source: p.source || 'static',
          // Prefer OSM's own `node/123` form (props.sourceId) so deep links work.
          // p.id is the internal `osm-node-123` form and cannot be split into a
          // valid openstreetmap.org path.
          sourceId: p.sourceId || p.id,
          verified: p.verified,
          lastVerified: p.lastVerified,
          images: [],  // images are NOT fetched here; resolved on-demand via getImagesForPlayground()
          imageRefs: p.imageRefs || [],  // raw OSM image URLs for lazy load
          imagePages: p.imagePages || [],  // source page URL (e.g. Google Photos share) for the "open" link
          age: p.age,
          opening: p.opening || '',
          equipment: p.equipment || [],
          rating: p.rating || { average: 0, count: 0 },
          accessibility: p.accessibility,
          fenced: p.fenced,
          toilets: p.toilets,
          parking: p.parking,
          dogs: p.dogs,
          municipality: p.municipality,
          sources: p.sources,
        });
      });
      return { source: 'static', playgrounds: out.filter(Boolean), error: null };
    } catch (e) {
      return { source: 'static', playgrounds: [], error: 'static-' + String(e).slice(0, 40) };
    }
  })();
  // Never cache a failure — the next viewport change should retry the fetch.
  staticCache.then(res => { if (res.error) staticCache = null; });
  return staticCache;
}

// --- One-shot loader the app calls on viewport change ---
async function loadForViewport(bounds) {
  const [osm, geo, stat, geoStatic, wms] = await Promise.all([
    loadOSM(bounds),
    loadGeonorge(bounds),
    loadStatic(bounds),
    loadGeonorgeStatic(bounds),   // Geonorge Tilgjengelighet3 JSON (NEW)
    loadWmsTilgjengelighet(bounds),
  ]);
  // Static is the reliable baseline; live OSM + Geonorge WMS enrich it.
  // Seed is merged at the app layer so the user layer can be controlled
  // independently of the map sources.
  const merged = mergeSources([stat, osm, geo, geoStatic, wms]);
  return {
    playgrounds: merged,
    errors: [stat.error, osm.error, geo.error, geoStatic.error, wms.error].filter(Boolean),
  };
}

// --- Static baked layer: Geonorge Tilgjengelighet3 ---
// data/geonorge_tilgjengelighet3_all.json is served by GitHub Pages
// same-origin (no CORS), so it never hangs on the public WMS endpoint.
// It's the primary source at ALL zooms. Lowest priority (comes after
// static + live OSM), so live OSM enrichment wins ties.
let geonorgeStaticCache = null;
async function loadGeonorgeStatic(bounds) {
  if (geonorgeStaticCache) return geonorgeStaticCache;
  geonorgeStaticCache = (async () => {
    try {
      const r = await fetch('data/geonorge_tilgjengelighet3_all.json', { cache: 'no-store' });
      if (!r.ok) return { source: 'geonorge-static', playgrounds: [], error: `geonorge-static-${r.status}` };
      const data = await r.json();

      const out = data.map(rec => {
        const base = {
          id: rec.id,
          name: rec.name,
          emoji: rec.emoji,
          location: { lat: rec.location.lat, lng: rec.location.lng },
          source: 'geonorge-tilgjengelighet3',
          sourceId: rec.sourceId,
          description: rec.description || '',
          poiType: rec.poiType,
          imageRefs: [],        // no image URLs embedded; API for popup images
          imagePages: [],
          accessibility: rec.accessibility || { wheelchair: 'unknown', stroller: 'unknown' },
          verified: true,
          lastVerified: new Date().toISOString().slice(0, 10),
          size: rec.size || 'small',
        };
        // Merge the shared normalized shape via normalizePlayground so the
        // rest of the app (filterPlaygrounds, syncMapMarkers, openPopup) sees
        // the same field names as other sources.
        return normalizePlayground(base);
      });
      return { source: 'geonorge-static', playgrounds: out, error: null };
    } catch (e) {
      return { source: 'geonorge-static', playgrounds: [], error: 'geonorge-static-' + String(e).slice(0, 40) };
    }
  })();
  // Never cache a failure — the next viewport change should retry the fetch.
  geonorgeStaticCache.then(res => { if (res.error) geonorgeStaticCache = null; });
  return geonorgeStaticCache;
}

// --- Static baked layer (same-origin, always available) ---
// data/playgrounds_all.geojson is served by GitHub Pages same-origin (no CORS),
// so it never hangs on public-mirror outages. It's the primary baseline —

/**
 * Fetch images for a playground on-demand.
 * Records that have image URLs in their raw OSM data get them lazily.
 * @param {Object} p - Playground record with imageRefs array of {url, alt} objects.
 * @returns {Promise<Array<{url:string, alt:string}>>}
 */
async function getImagesForPlayground(p) {
  if (!p || !p.imageRefs || !p.imageRefs.length) return p?.images || [];
  // imageRefs is already {url, alt} from OSM; inject page link if available.
  const pages = p.imagePages || [];
  return p.imageRefs.map((img, i) => ({ ...img, page: pages[i] || img.url }));
}
