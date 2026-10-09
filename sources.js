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
  return { free: true, paid: false }; // assume free when unspecified (parks default)
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

function gridPoints(bounds, strideDeg = 0.008) {
  const points = [];
  for (let lng = bounds.getWest(); lng < bounds.getEast(); lng += strideDeg) {
    for (let lat = bounds.getSouth(); lat < bounds.getNorth(); lat += strideDeg) {
      points.push([lng, lat]);
    }
  }
  return points;
}

async function loadWmsTilgjengelighet(bounds) {
  const playgrounds = [];
  try {
    const capsResp = await fetch(WMS_BASE + '?request=GetCapabilities&service=WMS&version=1.1.0');
    if (!capsResp.ok) throw new Error('GetCapabilities failed: ' + capsResp.status);
    const capsXml = await capsResp.text();
    parseCapabilities(capsXml);
    const points = gridPoints(bounds, 0.008);
    const batchSize = 12;
    for (let i = 0; i < points.length; i += batchSize) {
      const batch = points.slice(i, i + batchSize);
      const promises = batch.map(([lng, lat]) => {
        const bbox = [lng - 0.004, lat - 0.004, lng + 0.004, lat + 0.004].join(',');
        const url = WMS_BASE + '?service=WMS&request=GetFeatureInfo&version=1.1.0&layers=friluft,felles&query_layers=friluft,felles&info_format=text/plain&width=1&height=1';
        return fetch(url + '&bbox=' + bbox, { method: 'GET' }).then(r => r.ok ? r.text() : '').catch(() => '');
      });
      const results = await Promise.allSettled(promises);
      for (const res of results) {
        if (res.status === 'fulfilled' && res.value) {
          const feats = parseFeatureInfoText(res.value);
          for (const f of feats) {
            const props = Object.fromEntries(f.props.entries());
            const normalized = normalizePlayground({
              name: props['Navn'] || props['Name'] || f.layerName || 'Ukjent',
              lat: parseFloat(bounds.getCenter().lat.toFixed(6)),
              lng: parseFloat(bounds.getCenter().lng.toFixed(6)),
              description: props['Beskrivelse'] || '',
              source: 'wms-tilgjengelighet',
            });
            if (normalized) playgrounds.push(normalized);
          }
        }
      }
    }
  } catch (e) { console.warn('loadWmsTilgjengelighet:', e); }
  return { playgrounds, error: null };
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
  return {
    id: o.id,
    name: o.name,
    location: { lat: o.lat, lng: o.lng },
    source: o.source,
    sourceId: o.sourceId,
    images: o.images || [],
    imageRefs: o.imageRefs || [],  // raw OSM image URLs; fetched on-demand for detail modal
    imagePages: o.imagePages || [],  // original Google Photos page URL for each image (for the link under it)
    age: o.age || { min: 0, max: 16 },
    opening: o.opening || '',
    equipment: o.equipment || [],
    rating: o.rating || { average: 0, count: 0 },
    accessibility: o.accessibility || { wheelchair: o.wheelchair || 'unknown', stroller: 'unknown' },
    fenced: o.fenced === true,
    toilets: o.toilets === true,
    freeParking: o.parking?.free || false,
    paidParking: o.parking?.paid || false,
    dogsAllowed: o.dogs?.allowed || false,
    dogsLeash: o.dogs?.leash || false,
    municipality: o.municipality || '',
    verified: o.verified === true,
    lastVerified: o.lastVerified || null,
    sources: [{ type: o.source, id: o.sourceId || o.id, retrievedAt: o.lastVerified || new Date().toISOString().slice(0, 10) }],
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
async function loadStatic() {
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
        sourceId: p.id || `osm-node-${p.osm_id || ''}`,
        verified: p.verified,
        lastVerified: p.lastVerified,
        images: [],  // images are NOT fetched here; resolved on-demand via getImagesForPlayground()
        imageRefs: p.imageRefs || [],  // direct image URLs (resolved at bake time)
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
}

// --- One-shot loader the app calls on viewport change ---
async function loadForViewport(bounds) {
  const [osm, geo, stat] = await Promise.all([
    loadOSM(bounds),
    loadGeonorge(bounds),
    loadStatic(bounds),
  ]);
  // Static is the reliable baseline; live OSM + Geonorge enrich it.
  // Seed is merged at the app layer so the user layer can be controlled
  // independently of the map sources.
  const merged = mergeSources([stat, osm, geo]);
  return {
    playgrounds: merged,
    errors: [stat.error, osm.error, geo.error].filter(Boolean),
  };
}

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
