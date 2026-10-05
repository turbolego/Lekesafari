// ============================================================
//  Lekesafari – Source adapters
//  Turns heterogeneous open-map sources into one Playground[]
//  so the map is never pinned to hardcoded data.
// ============================================================

const OSM_EQUIPMENT = {
  playground_slide: 'Rutschbane',
  playground_seesaw: 'Vippe',
  playground_swing: 'Gynge',
  playground_springer: 'Hoppeslott',
  playground_sandpit: 'Sandkasse',
  playground_climbing_frame: 'Klatrestativ',
  playground_maze: 'Labyrint',
  playground_rope: 'Trosse',
  playground_mechanized: 'Karussell',
  playground_ball_court: 'Ballbane',
  playground_sheltered: 'Sikringshus',
};

// --- OSM source adapter (live, Overpass, CORS *) ---
// Overpass mirrors are public and frequently rate-limited; a single
// stalled mirror must not hang the map. Every request gets a short
// client-side abort timeout, and we try a pool of mirrors.
const OSM_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
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
  const [s, n, w, e] = [bounds.getSouth(), bounds.getNorth(), bounds.getWest(), bounds.getEast()];
  const q = `[out:json][timeout:10];` +
    `(node["leisure"="playground"](${s},${w},${n},${e});` +
    `way["leisure"="playground"](${s},${w},${n},${e}););` +
    `out tags center 500;`;

  const data = await overpassFetch(q);
  if (!data) return { source: 'osm', playgrounds: [], error: 'overpass-failed' };

  const now = new Date().toISOString().slice(0, 10);
  const out = data.elements.map(el => {
    const t = el.tags || {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (lat == null || lng == null) return null;

    const equipment = [];
    for (const k of Object.keys(t)) {
      if (k.startsWith('playground:') && OSM_EQUIPMENT[k]) {
        equipment.push({ type: k, name: OSM_EQUIPMENT[k], count: 1 });
      }
    }

    return normalizePlayground({
      id: `osm-${el.type}-${el.id}`,
      name: t.name || 'Utkjent lekeplass',
      lat, lng,
      source: 'osm',
      sourceId: `${el.type}/${el.id}`,
      images: t.image ? [{ url: t.image, alt: t.name || 'Lekeplass' }] : [],
      age: { min: parseInt(t.min_age, 10) || 0, max: parseInt(t.max_age, 10) || 16 },
      opening: t.opening_hours || '',
      equipment,
      fenced: t.fenced === 'yes' || t.fenced === 'true',
      toilets: t.toilets === 'yes' || t.toilets === 'true',
      parking: parkFromOSM(t),
      dogs: dogsFromOSM(t),
      wheelchair: normYesNoLimited(t.wheelchair),
      verified: !!t.name || equipment.length > 0,
      lastVerified: now,
    });
  }).filter(Boolean);

  return { source: 'osm', playgrounds: out, error: null };
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

// --- Geonorge / Kartverket adapter ---
// Geonorge's OGC Features endpoint is not CORS-open to arbitrary
// origins, so we attempt it but always degrade to "no data" rather
// than throwing. Swap the URL below once a CORS-friendly mirror or a
// small proxy (Cloudflare Worker, per the spec notes) is available.
async function loadGeonorge(bounds) {
  const endpoints = [
    'https://data.geonorge.no/geonorge-dagligoppdatert-pub/api/v1/features',
  ];
  for (const base of endpoints) {
    try {
      const r = await fetch(base + '?bbox=' + [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].join(',') + '&limit=100');
      if (!r.ok) continue;
      const d = await r.json();
      const feats = d.features || [];
      const out = feats.map((f, i) => normalizePlayground({
        id: `geonorge-${f.id || i}`,
        name: f.properties?.name || 'Lekeplass',
        lat: f.geometry?.coordinates?.[1] ?? 0,
        lng: f.geometry?.coordinates?.[0] ?? 0,
        source: 'geonorge',
        sourceId: String(f.id || i),
        images: [],
        equipment: [],
        verified: true,
        lastVerified: new Date().toISOString().slice(0, 10),
      })).filter(p => p.location.lat);
      if (out.length) return { source: 'geonorge', playgrounds: out, error: null };
    } catch (err) { /* CORS or network — fall through */ }
  }
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
    age: o.age || { min: 0, max: 16 },
    opening: o.opening || '',
    equipment: o.equipment || [],
    rating: o.rating || { average: 0, count: 0 },
    accessibility: o.accessibility || { wheelchair: o.wheelchair || 'unknown', stroller: 'unknown' },
    fenced: o.fenced === true,
    toilets: o.toilets === true,
    parking: o.parking || { free: true, paid: false },
    dogs: o.dogs || { allowed: true, leash: false },
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

// --- One-shot loader the app calls on viewport change ---
async function loadForViewport(bounds) {
  const [osm, geo] = await Promise.all([
    loadOSM(bounds),
    loadGeonorge(bounds),
  ]);
  // Seed is merged at the app layer so the user layer can be controlled
  // independently of the map sources.
  const merged = mergeSources([osm, geo]);
  return {
    playgrounds: merged,
    errors: [osm.error, geo.error].filter(Boolean),
  };
}
