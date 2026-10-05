// ============================================
//  Lekesafari – Main Application Logic
//  ============================================

// --- Configuration ---
const CONFIG = {
  // Zoom tiers for viewport-based data loading
  ZOOM_TIERS: {
    ZOOM_8: { minZoom: 8,  maxZoom: 8,  detailLevel: 'overview' },
    ZOOM_11: { minZoom: 11, maxZoom: 11, detailLevel: 'basic' },
    ZOOM_13: { minZoom: 13, maxZoom: 13, detailLevel: 'detailed' },
    ZOOM_15: { minZoom: 15, maxZoom: 17, detailLevel: 'full' },
  },
  // Zoom threshold: only fetch live data at detailed zoom levels (spec item 6)
  MIN_LIVE_ZOOM: 9,
  FILTERS: {
    FENCED: 'fenced',
    TOILETS: 'toilets',
    FREE_PARKING: 'freeParking',
    PAID_PARKING: 'paidParking',
    DOGS_ALLOWED: 'dogsAllowed',
    DOGS_LEASH: 'dogsLeash',
    MIN_AGE: 'minAge',
    MAX_AGE: 'maxAge',
    EQUIPMENT: 'equipment',
    RATING_MIN: 'ratingMin',
    SOURCE: 'source',
  },
  // Default values
  DEFAULT_FILTERS: {
    fenced: false,
    toilets: false,
    freeParking: false,
    paidParking: false,
    dogsAllowed: false,
    dogsLeash: false,
    minAge: 0,
    maxAge: 18,
    equipment: [],
    ratingMin: 0,
    source: 'alle',
  },
};

// --- Data Model ---
// Offline seed data (kvalitetssikre eksempler). Live data comes from
// sources.js (OSM Overpass, Geonorge) and is merged on top of this.
const PLAYGROUNDS = [
  {
    id: 'solbakken-oslo',
    name: 'Solbakken lekeplass',
    location: { lat: 59.9139, lng: 10.7522 },
    source: 'osm',
    verified: true,
    lastVerified: '2026-10-04',
    images: [
      { url: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400', alt: 'Rutschbane' },
      { url: 'https://images.unsplash.com/photo-1559216906-91e0cb497085?w=400', alt: 'Gynge' },
    ],
    age: { min: 2, max: 12 },
    opening: 'Mo-Su 08:00-20:00',
    equipment: [
      { type: 'rutschebane', name: 'Rutschbane', count: 3 },
      { type: 'gynge', name: 'Gynge', count: 2 },
      { type: 'klatrestativ', name: 'Klatrestativ', count: 1 },
    ],
    rating: { average: 4.6, count: 127 },
    accessibility: { wheelchair: 'yes', stroller: 'yes' },
    fenced: true,
    toilets: true,
    parking: { free: true, paid: false },
    dogs: { allowed: true, leash: true },
    municipality: 'Oslo',
    sources: [
      { type: 'osm', id: 'way/12345678', retrievedAt: '2026-10-04' },
      { type: 'user', id: 'user/42', retrievedAt: '2026-10-01', url: 'https://github.com/kveita/lekesafari' },
    ],
  },
  {
    id: 'parken-trondheim',
    name: 'Parke Solheimen',
    location: { lat: 59.5070, lng: 10.5520 },
    source: 'geonorge',
    verified: true,
    lastVerified: '2026-09-15',
    images: [
      { url: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=400', alt: 'Lekeplass' },
    ],
    age: { min: 3, max: 15 },
    opening: 'Tue-Sun 09:00-18:00',
    equipment: [
      { type: 'gynge', name: 'Gynge', count: 2 },
      { type: 'sandkasse', name: 'Sandkasse', count: 1 },
    ],
    rating: { average: 3.8, count: 45 },
    accessibility: { wheelchair: 'yes', stroller: 'yes' },
    fenced: true,
    toilets: false,
    parking: { free: true, paid: false },
    dogs: { allowed: true, leash: true },
    municipality: 'Trondheim',
    sources: [
      { type: 'geonorge', retrievedAt: '2026-09-15' },
    ],
  },
  {
    id: 'viktoria-bergen',
    name: 'Viktoria lekeplass',
    location: { lat: 59.5220, lng: 10.6550 },
    source: 'osm',
    verified: true,
    lastVerified: '2026-10-03',
    images: [],
    age: { min: 4, max: 16 },
    opening: 'Daily 07:00-19:00',
    equipment: [
      { type: 'klatrestativ', name: 'Klatrestativ', count: 2 },
      { type: 'karussell', name: 'Karussell', count: 1 },
    ],
    rating: { average: 4.1, count: 78 },
    accessibility: { wheelchair: 'limited', stroller: 'yes' },
    fenced: false,
    toilets: true,
    parking: { free: false, paid: true },
    dogs: { allowed: false, leash: false },
    municipality: 'Bergen',
    sources: [
      { type: 'osm', id: 'way/87654321', retrievedAt: '2026-10-03' },
    ],
  },
  {
    id: 'kongsvinger-park',
    name: 'Kongsvinger park',
    location: { lat: 59.4900, lng: 10.5800 },
    source: 'municipality',
    verified: false,
    lastVerified: '2026-05-20',
    images: [],
    age: { min: 1, max: 10 },
    opening: 'Mon-Fri 08:00-17:00',
    equipment: [
      { type: 'gynge', name: 'Gynge', count: 1 },
      { type: 'gattrett', name: 'Gåtte', count: 1 },
    ],
    rating: { average: 2.3, count: 12 },
    accessibility: { wheelchair: 'no', stroller: 'yes' },
    fenced: true,
    toilets: false,
    parking: { free: true, paid: false },
    dogs: { allowed: true, leash: false },
    municipality: 'Kongsvinger',
    sources: [
      { type: 'municipality', id: 'kommune/5406', retrievedAt: '2026-05-20' },
    ],
  },
  {
    id: 'fjellstien-trondheim',
    name: 'Fjellstien lekeplass',
    location: { lat: 59.5500, lng: 10.7200 },
    source: 'user',
    verified: true,
    lastVerified: '2026-10-02',
    images: [
      { url: 'https://images.unsplash.com/photo-1551632811-561732d1e306?w=400', alt: 'Karussell' },
      { url: 'https://images.unsplash.com/photo-1514745387537-5ea5b711ab42?w=400', alt: 'Lekeplass' },
    ],
    age: { min: 5, max: 14 },
    opening: 'Sat-Sun 09:00-16:00',
    equipment: [
      { type: 'klatrestativ', name: 'Klatrestativ', count: 2 },
      { type: 'karussell', name: 'Karussell', count: 1 },
      { type: 'hoppeslott', name: 'Hoppeslott', count: 1 },
    ],
    rating: { average: 4.8, count: 234 },
    accessibility: { wheelchair: 'limited', stroller: 'yes' },
    fenced: true,
    toilets: true,
    parking: { free: true, paid: false },
    dogs: { allowed: true, leash: true },
    municipality: 'Trondheim',
    sources: [
      { type: 'user', id: 'user/7', retrievedAt: '2026-10-02', url: 'https://github.com/kveita/lekesafari' },
    ],
  },
  {
    id: 'lillehammer-river',
    name: 'Lillehammer elvepark',
    location: { lat: 61.1130, lng: 10.4700 },
    source: 'osm',
    verified: false,
    lastVerified: '2026-08-10',
    images: [],
    age: { min: 0, max: 18 },
    opening: 'Daily 07:00-22:00',
    equipment: [
      { type: 'rutschebane', name: 'Rutschbane', count: 2 },
      { type: 'gynge', name: 'Gynge', count: 3 },
    ],
    rating: { average: 4.2, count: 89 },
    accessibility: { wheelchair: 'yes', stroller: 'yes' },
    fenced: true,
    toilets: true,
    parking: { free: true, paid: false },
    dogs: { allowed: true, leash: false },
    municipality: 'Lillehammer',
    sources: [
      { type: 'osm', id: 'way/98765432', retrievedAt: '2026-08-10' },
    ],
  },
  {
    id: 'storsteinnes-bardu',
    name: 'Storsteinnes skolepark',
    location: { lat: 68.6520, lng: 17.6670 },
    source: 'osm',
    verified: false,
    lastVerified: '2026-07-15',
    images: [],
    age: { min: 2, max: 16 },
    opening: 'Mon-Fri 07:00-15:00',
    equipment: [
      { type: 'gynge', name: 'Gynge', count: 2 },
      { type: 'klatrestativ', name: 'Klatrestativ', count: 1 },
      { type: 'basketball', name: 'Basketball', count: 1 },
    ],
    rating: { average: 3.5, count: 33 },
    accessibility: { wheelchair: 'limited', stroller: 'yes' },
    fenced: false,
    toilets: false,
    parking: { free: true, paid: false },
    dogs: { allowed: false, leash: false },
    municipality: 'Narvik',
    sources: [
      { type: 'osm', id: 'way/11223344', retrievedAt: '2026-07-15' },
    ],
  },
  {
    id: 'moss-arbeiderparken',
    name: 'Arbeiderparken Moss',
    location: { lat: 59.4270, lng: 10.6580 },
    source: 'geonorge',
    verified: true,
    lastVerified: '2026-09-28',
    images: [
      { url: 'https://images.unsplash.com/photo-1546519638-68e109498ffc?w=400', alt: 'Lekeplass' },
    ],
    age: { min: 3, max: 14 },
    opening: 'Daily 07:00-20:00',
    equipment: [
      { type: 'rutschebane', name: 'Rutschbane', count: 2 },
      { type: 'gynge', name: 'Gynge', count: 3 },
      { type: 'sandkasse', name: 'Sandkasse', count: 2 },
      { type: 'karussell', name: 'Karussell', count: 1 },
    ],
    rating: { average: 4.3, count: 56 },
    accessibility: { wheelchair: 'yes', stroller: 'yes' },
    fenced: true,
    toilets: true,
    parking: { free: true, paid: false },
    dogs: { allowed: true, leash: true },
    municipality: 'Moss',
    sources: [
      { type: 'geonorge', retrievedAt: '2026-09-28' },
    ],
  },
  {
    id: 'drammen-danvik',
    name: 'Danvikparken Drammen',
    location: { lat: 59.7380, lng: 10.2000 },
    source: 'osm',
    verified: true,
    lastVerified: '2026-10-01',
    images: [
      { url: 'https://images.unsplash.com/photo-1563720204-4e698b3ee0e7?w=400', alt: 'Lekeplass' },
    ],
    age: { min: 1, max: 18 },
    opening: 'Daily 06:00-22:00',
    equipment: [
      { type: 'gynge', name: 'Gynge', count: 4 },
      { type: 'klatrestativ', name: 'Klatrestativ', count: 2 },
      { type: 'hoppeslott', name: 'Hoppeslott', count: 1 },
      { type: 'rutschebane', name: 'Rutschbane', count: 2 },
    ],
    rating: { average: 4.5, count: 156 },
    accessibility: { wheelchair: 'yes', stroller: 'yes' },
    fenced: true,
    toilets: true,
    parking: { free: true, paid: false },
    dogs: { allowed: true, leash: true },
    municipality: 'Drammen',
    sources: [
      { type: 'osm', id: 'way/55667788', retrievedAt: '2026-10-01' },
    ],
  },
  {
    id: ' Fredrikstad-gamleby',
    name: 'Gamlebyparken Fredrikstad',
    location: { lat: 59.2060, lng: 10.9100 },
    source: 'user',
    verified: true,
    lastVerified: '2026-09-20',
    images: [],
    age: { min: 0, max: 16 },
    opening: 'Daily 07:00-21:00',
    equipment: [
      { type: 'sandkasse', name: 'Sandkasse', count: 2 },
      { type: 'gynge', name: 'Gynge', count: 2 },
    ],
    rating: { average: 4.0, count: 42 },
    accessibility: { wheelchair: 'yes', stroller: 'yes' },
    fenced: false,
    toilets: false,
    parking: { free: true, paid: false },
    dogs: { allowed: true, leash: true },
    municipality: 'Fredrikstad',
    sources: [
      { type: 'user', id: 'user/15', retrievedAt: '2026-09-20', url: 'https://github.com/kveita/lekesafari' },
    ],
  },
];
// Expose seed for source-layer fallback
window.SEED_PLAYGROUNDS = PLAYGROUNDS;

// --- State ---
let state = {
  map: null,
  markers: [],
  popup: null,
  viewportDebounce: null,
  playgrounds: [],        // merged live data (OSM + Geonorge + seed)
  sourceErrors: [],       // non-fatal source errors
  loadGen: 0,            // increments per viewport load; stale results dropped
};

// --- DOM Refs ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const mapEl = $('#map');
const searchInput = $('#search-input');
const resultCount = $('#result-count');
const playgroundList = $('#playground-list');
const detailModal = $('#detail-modal');
const detailClose = $('#detail-close');
const detailContent = $('#detail-content');
const toastEl = $('#toast');
const locateBtn = $('#locate-btn');

// --- Core Functions ---

function initMap() {
  if (state.map) return;

  mapEl.style.width = '100%';
  mapEl.style.height = 'calc(100vh - 60px)';

  state.map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        'osm-tiles': {
          type: 'raster',
          tiles: [
            'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          ],
          tileSize: 256,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        },
      },
      layers: [
        {
          id: 'osm-tiles-layer',
          type: 'raster',
          source: 'osm-tiles',
          minzoom: 0,
          maxzoom: 18,
        },
      ],
    },
    center: [10.7522, 59.9139],
    zoom: 5,
    minZoom: 5,
    maxZoom: 17,
  });

  state.map.addControl(new maplibregl.NavigationControl(), 'top-right');

  // Markers layer (live source, updated per viewport)
  state.map.on('load', () => {
    state.map.addSource('playgrounds', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    state.map.addLayer({
      id: 'playground-pins',
      type: 'circle',
      source: 'playgrounds',
      paint: {
        'circle-radius': 8,
        'circle-color': [
          'match', ['get', 'source'],
          'osm', '#2e7d32',
          'geonorge', '#1565c0',
          'municipality', '#7b1fa2',
          'user', '#e65100',
          '#007acc',
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
        'circle-stroke-opacity': 1,
        'circle-opacity': 0.8,
      },
    });

    // Tooltip on hover
    const popup = new maplibregl.Popup({ offset: 16, closeOnClick: false });
    state.map.on('mouseenter', 'playground-pins', () => { state.map.getCanvas().style.cursor = 'pointer'; });
    state.map.on('mouseleave', 'playground-pins', () => { state.map.getCanvas().style.cursor = ''; });
    state.map.on('mousemove', 'playground-pins', (e) => {
      const feat = e.features[0];
      if (!feat) return;
      const pg = state.playgrounds.find(p => p.id === feat.properties.id);
      if (!pg) return;
      const eqNames = pg.equipment.length ? pg.equipment.map(eq => eq.name).join(', ') : '—';
      const ratingLine = pg.rating.count
        ? `Rating: ${pg.rating.average} (${pg.rating.count})`
        : 'Ingen rating';
      popup.setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-weight:600;font-size:0.9rem;">${feat.properties.name}</div>
          <div style="font-size:0.8rem;color:#666;">
            ${ratingLine}
          </div>
          <div style="font-size:0.75rem;color:#999;margin-top:0.2rem;">
            ${eqNames}
          </div>
        `)
        .addTo(state.map);
    });

    state.map.on('click', 'playground-pins', (e) => {
      const feat = e.features[0];
      if (!feat) return;
      const pg = state.playgrounds.find(p => p.id === feat.properties.id);
      if (pg) openDetail(pg);
    });

    // Viewport-based loading (spec item 6/12)
    state.map.on('moveend', debounce(() => {
      loadFromViewport();
    }, 800));

    // Initial data load based on current viewport
    loadFromViewport();
  });

  // Locate button
  locateBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('Geolocation ikke støttet');
      return;
    }
    navigator.geolocation.getCurrentPosition(pos => {
      state.map.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 14 });
    });
  });
}

async function loadFromViewport() {
  // Bump the generation so a slower, earlier viewport load can't overwrite
  // a newer one while the user is panning.
  const gen = ++state.loadGen;

  const seed = window.SEED_PLAYGROUNDS || [];
  // Always show seed immediately so the map is never empty, even while
  // live sources are still loading or rate-limited.
  state.playgrounds = [...seed];
  state.sourceErrors = [];
  renderPlaygroundList();
  syncMapSource();

  const zoom = state.map.getZoom();
  const bounds = state.map.getBounds();

  // The baked static layer is same-origin and cheap, so we load it at any
  // zoom — the default Norway-wide view now shows real OSM playgrounds
  // instead of only the 10 seed pins. Live Overpass (unbounded) and
  // Geonorge are gated to MIN_LIVE_ZOOM because a whole-country query is
  // too broad.
  resultCount.textContent = 'Laster…';
  try {
    let layers;
    if (zoom >= CONFIG.MIN_LIVE_ZOOM) {
      // Zoomed in: add live sources on top of the static baseline.
      const { playgrounds, errors } = await loadForViewport(bounds);
      layers = { playgrounds, errors };
    } else {
      // Wide view: static layer only (fast, reliable, no public mirror).
      const stat = await loadStatic(bounds);
      layers = {
        playgrounds: mergeSources([stat]),
        errors: stat.error ? [stat.error] : [],
      };
    }
    // If the user panned since we started, this result is stale — discard.
    if (gen !== state.loadGen) return;
    state.playgrounds = mergeWithSeed(layers.playgrounds, seed);
    state.sourceErrors = layers.errors;
  } catch (err) {
    if (gen !== state.loadGen) return;
    console.warn('Lekesafari viewport load failed:', err);
    state.sourceErrors = [String(err)];
    // seed already shown; keep it
  }
  if (gen === state.loadGen) {
    renderPlaygroundList();
    syncMapSource();
  }
}

function syncMapSource() {
  if (!state.map) return;
  const src = state.map.getSource('playgrounds');
  if (!src) return; // map not loaded yet
  const fc = {
    type: 'FeatureCollection',
    features: state.playgrounds.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.location.lng, p.location.lat] },
      properties: { id: p.id, name: p.name, source: p.source, rating: p.rating.average },
    })),
  };
  src.setData(fc);
}

function mergeWithSeed(live, seed) {
  seed = seed || [];
  if (!seed.length) return live;
  const ids = new Set(live.map(p => p.id));
  // Seed records fill gaps: seed items not already covered by live data
  const seedAdditions = seed.filter(s => !ids.has(s.id));
  return [...live, ...seedAdditions];
}

function debounce(fn, ms) {
  return (...args) => {
    clearTimeout(state.viewportDebounce);
    state.viewportDebounce = setTimeout(() => fn(...args), ms);
  };
}

// --- Filter & Search ---
function getActiveFilters() {
  const filters = { ...CONFIG.DEFAULT_FILTERS };

  const fenced = $('#filter-fenced').checked;
  const toilets = $('#filter-toilets').checked;
  const freeP = $('#filter-free-parking').checked;
  const paidP = $('#filter-paid-parking').checked;
  const dogsA = $('#filter-dogs-allowed').checked;
  const dogsL = $('#filter-dogs-leash').checked;

  if (fenced) filters.fenced = true;
  if (toilets) filters.toilets = true;
  if (freeP) filters.freeParking = true;
  if (paidP) filters.paidParking = true;
  if (dogsA) filters.dogsAllowed = true;
  if (dogsL) filters.dogsLeash = true;

  const minAge = parseInt($('#filter-age-min').value);
  const maxAge = parseInt($('#filter-age-max').value);
  if (!isNaN(minAge)) filters.minAge = minAge;
  if (!isNaN(maxAge)) filters.maxAge = maxAge;

  const eqSelect = $('#filter-equipment');
  const selected = Array.from(eqSelect.selectedOptions).map(o => o.value);
  filters.equipment = selected;

  const ratingMin = parseInt($('#filter-rating').value);
  if (!isNaN(ratingMin)) filters.ratingMin = ratingMin;

  const source = $('#filter-source').value;
  if (source !== 'alle') filters.source = source;

  return filters;
}

function filterPlaygrounds(plays, filters) {
  return plays.filter(p => {
    // Source filter
    if (filters.source !== 'alle' && p.source !== filters.source) return false;

    // Fenced — only filters when the user toggles it on
    if (filters.fenced && !p.fenced) return false;
    if (filters.toilets && !p.toilets) return false;
    if (filters.freeParking && !p.parking?.free) return false;
    if (filters.paidParking && !p.parking?.paid) return false;
    if (filters.dogsAllowed && !p.dogs?.allowed) return false;
    if (filters.dogsLeash && !p.dogs?.leash) return false;

    // Age range (minAge/maxAge are the bounds of the age range slider)
    const minAge = p.age?.min ?? 0, maxAge = p.age?.max ?? 99;
    if (minAge > filters.maxAge || maxAge < filters.minAge) return false;

    // Equipment
    if (filters.equipment.length > 0) {
      const hasEquipment = filters.equipment.some(reqEq =>
        p.equipment?.some(pgEq => pgEq.type === reqEq)
      );
      if (!hasEquipment) return false;
    }

    // Rating (0 avg always passes a positive filter — i.e. treat unknown as low)
    if (p.rating?.average && p.rating.average < filters.ratingMin) return false;

    return true;
  });
}

function searchPlaygrounds(plays, query) {
  if (!query.trim()) return plays;
  const q = query.toLowerCase().trim();
  return plays.filter(p =>
    p.name.toLowerCase().includes(q) ||
    (p.municipality || '').toLowerCase().includes(q) ||
    p.equipment?.some(e => (e.name || '').toLowerCase().includes(q))
  );
}

function renderPlaygroundList() {
  const q = searchInput.value;
  const filters = getActiveFilters();
  let plays = state.playgrounds;

  if (q) plays = searchPlaygrounds(plays, q);
  plays = filterPlaygrounds(plays, filters);

  resultCount.textContent = `${plays.length} lekeplasser`;

  if (plays.length === 0) {
    playgroundList.innerHTML = '<p style="color:var(--text-muted);padding:1rem;">Ingen lekplasser matchet kriteriene.</p>';
    return;
  }

  playgroundList.innerHTML = plays.map(p => {
    const eqList = p.equipment.map(e => `<span class="equip-chip">${e.name}</span>`).join('');
    const badge = getSourceBadge(p);
    const verif = p.verified ? '<span class="verified-badge">✓ Verifisert</span>' : '<span class="badge-no" style="padding:0.1rem 0.5rem;border-radius:4px;font-size:0.75rem;">Ikke verifisert</span>';
    const ratingLine = p.rating.count
      ? `⭐ ${p.rating.average} (${p.rating.count})`
      : `Kilde: ${p.source}`;
    const muni = p.municipality || 'Norge';

    return `
      <div class="playground-item" data-id="${p.id}">
        <div class="pin-row">
          <div class="pin-icon">🧭</div>
          <div class="pin-info">
            <div class="pin-name">${p.name} ${verif}</div>
            <div class="pin-meta">
              <span class="pin-badge badge-${p.source}">${p.source}</span>
              📍 ${muni} · Alder ${p.age.min}-${p.age.max} · ${ratingLine}
            </div>
            <div class="pin-meta" style="margin-top:0.2rem;">
              ${eqList}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  document.querySelectorAll('.playground-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      const p = state.playgrounds.find(p => p.id === id);
      if (p) openDetail(p);
    });
  });
}

function getSourceBadge(p) {
  const sourceClass = {
    osm: 'badge-osm',
    geonorge: 'badge-geonorge',
    municipality: 'badge-municipality',
    user: 'badge-user',
  }[p.source] || '';
  const verif = p.verified ? '<span class="verified-badge">✓ Verifisert</span>' : '<span class="badge-no" style="padding:0.1rem 0.5rem;border-radius:4px;font-size:0.75rem;">Ikke verifisert</span>';
  return `<span class="pin-badge ${sourceClass}">${p.source}</span> ${verif}`;
}

// --- Detail Modal ---
function openDetail(p) {
  detailContent.innerHTML = buildDetailHTML(p);
  detailModal.hidden = false;
  document.body.style.overflow = 'hidden';

  // Map button actions
  $('#map-gmaps').addEventListener('click', () => {
    window.open(`https://www.google.com/maps/search/?api=1&query=${p.location.lat},${p.location.lng}`, '_blank', 'noopener');
  });
  $('#map-apple').addEventListener('click', () => {
    window.open(`https://maps.apple.com/?ll=${p.location.lat},${p.location.lng}&q=${encodeURIComponent(p.name)}`, '_blank', 'noopener');
  });

  // Keyboard
  document.addEventListener('keydown', handleModalKey);
}

function closeModal() {
  detailModal.hidden = true;
  document.body.style.overflow = '';
  document.removeEventListener('keydown', handleModalKey);
}

function handleModalKey(e) {
  if (e.key === 'Escape') closeModal();
}

function buildDetailHTML(p) {
  const stars = Array(5).fill(0).map((_, i) =>
    i < Math.round(p.rating.average) ? '★' : '☆'
  );

  const sourceTags = p.sources.map(s => {
    const cls = {
      osm: 'source-osm',
      geonorge: 'source-geonorge',
      municipality: 'source-municipality',
      user: 'source-user',
    }[s.type] || '';
    return `<span class="source-tag ${cls}">${s.type}</span>`;
  }).join('');

  const imgCards = p.images.length > 0
    ? p.images.map(img => `
        <div class="carousel-card">
          ${img.url
            ? `<img src="${img.url}" alt="${img.alt}" loading="lazy">
               <div class="carousel-label">${img.alt}</div>`
            : `<div class="photo-placeholder">📷 Ingen bilde</div>`
          }
        </div>
      `).join('')
    : '<div class="photo-placeholder" style="width:100%;padding:1.5rem;text-align:center;color:var(--text-muted);">Ingen bilder tilgjengelig</div>';

  const dogBadge = p.dogs.allowed
    ? `<span class="badge-yes">Ja</span>`
    : `<span class="badge-no">Nei</span>`;
  const leashBadge = p.dogs.allowed && p.dogs.leash
    ? `<span class="badge-yes">Ja</span>`
    : `<span class="badge-no">Nei</span>`;

  const parkingBadge = p.parking.free && p.parking.paid
    ? `<span class="badge-ltd">Begge</span>`
    : p.parking.free
      ? `<span class="badge-yes">Gratis</span>`
      : p.parking.paid
        ? `<span class="badge-ltd">Mot betaling</span>`
        : `<span class="badge-no">Ukjent</span>`;

  const fencedBadge = p.fenced ? `<span class="badge-yes">Ja</span>` : `<span class="badge-no">Nei</span>`;
  const toiletBadge = p.toilets ? `<span class="badge-yes">Ja</span>` : `<span class="badge-no">Nei</span>`;

  const equipChips = p.equipment.map(e =>
    `<span class="equip-chip">${e.name}${e.count > 1 ? ` (${e.count})` : ''}</span>`
  ).join('');

  return `
    <div class="detail-header">
      <div class="detail-name">${p.name}</div>
      <div class="detail-location">${p.municipality} · ${p.location.lat.toFixed(4)}, ${p.location.lng.toFixed(4)}</div>
    </div>

    <div class="detail-grid">
      <div class="detail-item">
        <span class="detail-label">Aldersgruppe</span>
        <span class="detail-value">${p.age.min} – ${p.age.max} år</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Åpningstider</span>
        <span class="detail-value">${p.opening}</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Rating</span>
        <span class="detail-value">
          <span class="rating-avg">${p.rating.average}</span>
          <span class="rating-stars">${stars.map(s => `<span class="star ${s === '★' ? 'filled' : ''}">${s}</span>`).join('')}</span>
          <span style="font-size:0.85rem;color:var(--text-muted);">(${p.rating.count} vurderinger)</span>
        </span>
      </div>
      <div class="detail-item">
        <span class="detail-label">Tilgjengelighet</span>
        <span class="detail-value">
          Rullestol: ${p.accessibility.wheelchair === 'yes' ? '<span class="badge-yes">Ja</span>' : p.accessibility.wheelchair === 'limited' ? '<span class="badge-ltd">Deltvis</span>' : '<span class="badge-no">Nei</span>'}
          · Barnevogn: ${p.accessibility.stroller === 'yes' ? '<span class="badge-yes">Ja</span>' : '<span class="badge-no">Nei</span>'}
        </span>
      </div>
    </div>

    <div class="badge-grid">
      <span class="badge-chip"><span class="detail-label" style="margin:0;color:var(--text-muted);">Inngjerdet</span> ${fencedBadge}</span>
      <span class="badge-chip"><span class="detail-label" style="margin:0;color:var(--text-muted);">Toalett</span> ${toiletBadge}</span>
      <span class="badge-chip"><span class="detail-label" style="margin:0;color:var(--text-muted);">Parkering</span> ${parkingBadge}</span>
      <span class="badge-chip"><span class="detail-label" style="margin:0;color:var(--text-muted);">Hund</span> ${dogBadge}</span>
      <span class="badge-chip"><span class="detail-label" style="margin:0;color:var(--text-muted);">Hund i bånd</span> ${leashBadge}</span>
      ${p.fenced ? '' : `<span class="badge-chip"><span class="detail-label" style="margin:0;color:var(--text-muted);">Rekkevidde</span> ${p.parking.free ? '<span class="badge-yes">Gratis</span>' : p.parking.paid ? '<span class="badge-ltd">Mot betaling</span>' : '<span class="badge-no">Ukjent</span>'}</span>`}
    </div>

    <div class="filter-field" style="padding:0 1.5rem 1rem;">
      <span class="detail-label">Apparater</span>
      <div style="margin-top:0.3rem;">${equipChips}</div>
    </div>

    <div class="image-carousel">
      <span class="detail-label" style="margin-bottom:0.5rem;display:block;">Bilder</span>
      <div class="carousel-track">${imgCards}</div>
    </div>

    <div class="source-row">
      <span class="detail-label" style="margin-bottom:0.3rem;display:block;">Kilder</span>
      ${sourceTags}
      ${p.verified ? `
        <div style="margin-top:0.5rem;">
          <span class="verified-badge">✓ Verifisert</span>
          <div class="last-verified">Sist kontrollert: ${p.lastVerified}</div>
        </div>
      ` : `
        <div style="margin-top:0.5rem;">
          <span class="badge-no" style="padding:0.15rem 0.5rem;border-radius:4px;font-size:0.8rem;">Ikke verifisert</span>
          <div class="last-verified">Sist kontrollert: ${p.lastVerified}</div>
        </div>
      `}
    </div>

    <div class="map-actions">
      <button class="map-btn map-btn-primary" id="map-gmaps">📍 Google Maps</button>
      <button class="map-btn map-btn-secondary" id="map-apple">🍎 Apple Maps</button>
    </div>
  `;
}

// --- Events ---
function setupEvents() {
  searchInput.addEventListener('input', () => {
    renderPlaygroundList();
  });

  ['filter-fenced', 'filter-toilets', 'filter-free-parking', 'filter-paid-parking',
   'filter-dogs-allowed', 'filter-dogs-leash'].forEach(id => {
    $(`#${id}`).addEventListener('change', renderPlaygroundList);
  });

  ['filter-age-min', 'filter-age-max', 'filter-rating', 'filter-source'].forEach(id => {
    $(`#${id}`).addEventListener('change', renderPlaygroundList);
  });

  $('#filter-equipment').addEventListener('change', renderPlaygroundList);
  $('#search-clear').addEventListener('click', () => {
    searchInput.value = '';
    renderPlaygroundList();
  });

  // Detail modal close handlers
  detailClose.addEventListener('click', closeModal);
  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) closeModal();
  });
}

// --- Toast ---
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  setTimeout(() => { toastEl.hidden = true; }, 3000);
}

// --- Boot ---
async function main() {
  initMap();
  renderPlaygroundList();
  setupEvents();
}

main().catch(err => console.error('Lekesafari failed to initialize:', err));
