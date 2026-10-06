// =============================================================
//  Lekesafari – Leaflet Application Logic
//  Ported from MapLibre to Leaflet
// =============================================================

// --- Configuration ---
const CONFIG = {
  MIN_LIVE_ZOOM: 9,
  ZOOM_TIERS: {
    ZOOM_8: { minZoom: 8, maxZoom: 8, detailLevel: 'overview' },
    ZOOM_11: { minZoom: 11, maxZoom: 11, detailLevel: 'basic' },
    ZOOM_13: { minZoom: 13, maxZoom: 13, detailLevel: 'detailed' },
    ZOOM_15: { minZoom: 15, maxZoom: 17, detailLevel: 'full' },
  },
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

// -------------------------------------------------------------
// Leaflet Map Initialization
// -------------------------------------------------------------
const map = L.map('map', {
  center: [61.5, 15.5],  // Norway center
  zoom: 5,
  minZoom: 4,
  maxZoom: 17,
  attributionControl: true,
});

// OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// Layer for playground markers
const playgroundLayer = L.layerGroup().addTo(map);

// State Management
// -------------------------------------------------------------
let state = {
  isLoading: false,
  playgrounds: [],
  sourceErrors: [],
  lastView: null,
  filteredPlaygrounds: [],
};

// -------------------------------------------------------------
// Data Loading Functions
// -------------------------------------------------------------
async function loadStatic(bounds) {
  // TODO: Load baked static GeoJSON
  return { playgrounds: [], error: null };
}

async function loadForViewport(bounds) {
  // TODO: Load live OSM/Geonorge data within viewport
  return { playgrounds: [], errors: [] };
}

function mergeSources(layers) {
  // Merge all sources into single array
  return layers.flat();
}

function mergeWithSeed(live, seed, bounds) {
  const ids = new Set(live.map(p => p.id));
  // Filter seed by viewport bounds
  const filteredSeed = seed.filter(s => {
    if (!bounds) return true;
    const lat = s.location.lat, lng = s.location.lng;
    return bounds.contains([lng, lat]);
  });
  const seedAdditions = filteredSeed.filter(s => !ids.has(s.id));
  return [...live, ...seedAdditions];
}

// -------------------------------------------------------------
// Viewport-based Loading
// -------------------------------------------------------------
function loadFromViewport() {
  if (state.isLoading) return;
  state.isLoading = true;

  const bounds = map.getBounds();
  const zoom = map.getZoom();

  // Record last viewport for moveend check
  const c = map.getCenter();
  state.lastView = { lng: c.lng, lat: c.lat, zoom };

  const seed = window.SEED_PLAYGROUNDS || [];

  // Show seed immediately
  state.playgrounds = [...seed];
  renderPlaygroundList();

  if (zoom >= CONFIG.MIN_LIVE_ZOOM) {
    loadForViewport(bounds).then(({ playgrounds, errors }) => {
      state.playgrounds = mergeWithSeed(playgrounds, seed, bounds);
      state.sourceErrors = errors;
      state.isLoading = false;
      renderPlaygroundList();
      syncMapMarkers();
    }).catch(err => {
      console.warn('Lekesafari viewport load failed:', err);
      state.isLoading = false;
    });
  } else {
    // Static layer only
    loadStatic(bounds).then(result => {
      state.playgrounds = mergeWithSeed(result.playgrounds || [], seed, bounds);
      state.isLoading = false;
      renderPlaygroundList();
      syncMapMarkers();
    }).catch(err => {
      state.isLoading = false;
    });
  }
}

// -------------------------------------------------------------
// Marker Rendering
// -------------------------------------------------------------
function getMarkerColor(source) {
  const colors = {
    osm: '#2e7d32',        // green
    geonorge: '#1565c0',   // blue
    municipality: '#7b1fa2', // purple
    user: '#e65100',       // orange
  };
  return colors[source] || '#007acc';
}

function syncMapMarkers() {
  // Clear existing markers
  playgroundLayer.clearLayers();

  state.playgrounds.forEach(p => {
    const marker = L.circleMarker([p.location.lat, p.location.lng], {
      radius: 8,
      fillColor: getMarkerColor(p.source),
      color: '#fff',
      weight: 2,
      fillOpacity: 0.8,
      className: 'playground-marker playground-' + p.source,
    });

    marker.on('click', () => openDetail(p));
    playgroundLayer.addLayer(marker);
  });
}

// -------------------------------------------------------------
// Detail Modal
// -------------------------------------------------------------
function openDetail(p) {
  const modal = document.getElementById('detail-modal');
  const content = document.getElementById('detail-content');

  const src = p.source || 'osm';
  const ratingLine = p.rating?.count
    ? `Rating: ${p.rating.average} (${p.rating.count})`
    : 'Ingen rating';

  const eqNames = p.equipment?.length
    ? p.equipment.map(eq => eq.name).join(', ')
    : '—';

  const verif = p.verified ? '<span class="verified-badge">✓ Verifisert</span>'
    : '<span class="badge-no" style="padding:0.1rem 0.5rem;border-radius:4px;font-size:0.75rem;">Ikke verifisert</span>';

  content.innerHTML = `
    <span class="detail-close" aria-label="Lukk">&times;</span>
    <h2 style="font-weight:600;font-size:1.1rem;">${p.name}</h2>
    <div style="font-size:0.9rem;color:#666;">
      ${ratingLine}
    </div>
    <div style="font-size:0.85rem;color:#555;margin-top:0.5rem;">
      <span class="pin-badge badge-${src}">${p.source}</span> ${verif}
    </div>
    <div style="font-size:0.8rem;color:#777;margin-top:0.3rem;">
      ${eqNames}
    </div>
    ${p.images?.map(img => `<img src="${img.url}" alt="${img.alt}" style="width:100%;margin-top:0.5rem;border-radius:4px;">`).join('') || ''}
  `;

  modal.style.display = 'block';

  // Close handlers
  modal.querySelector('.detail-close').onclick = () => {
    modal.style.display = 'none';
  };
  modal.onclick = (e) => {
    if (e.target === modal) modal.style.display = 'none';
  };
}

// -------------------------------------------------------------
// List Rendering
// -------------------------------------------------------------
function renderPlaygroundList() {
  const list = document.getElementById('playground-list');
  const count = document.getElementById('result-count');

  const filter = getActiveFilters();
  const filtered = filterPlaygrounds(state.playgrounds, filter);
  state.filteredPlaygrounds = filtered;

  count.textContent = filtered.length;

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">Ingen lekeplasser i dette området.</div>';
    return;
  }

  filtered.forEach(p => {
    const item = document.createElement('div');
    item.className = 'playground-item';
    item.style.cssText = 'cursor:pointer;border-bottom:1px solid #eee;padding:0.75rem;';
    item.dataset.id = p.id;
    item.addEventListener('click', () => openDetail(p));

    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-weight:500;margin-bottom:0.25rem;';
    nameDiv.textContent = p.name;

    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'font-size:0.8rem;color:#666;';
    const src = p.source || 'osm';
    infoDiv.innerHTML = '<span class="pin-badge badge-' + src + '">' + p.source + '</span>' +
      (p.verified ? '<span class="verified-badge">✓</span>' : '') +
      (p.rating?.count ? '<span style="margin-left:0.5rem;">⭐ ' + p.rating.average + '</span>' : '');

    item.appendChild(nameDiv);
    item.appendChild(infoDiv);
    list.appendChild(item);
  });
}

// -------------------------------------------------------------
// Filtering
// -------------------------------------------------------------
function getActiveFilters() {
  const filters = { ...CONFIG.DEFAULT_FILTERS };

  const fenced = document.getElementById('filter-fenced').checked;
  const toilets = document.getElementById('filter-toilets').checked;
  const freeP = document.getElementById('filter-free-parking').checked;
  const paidP = document.getElementById('filter-paid-parking').checked;
  const dogsA = document.getElementById('filter-dogs-allowed').checked;
  const dogsL = document.getElementById('filter-dogs-leash').checked;

  if (fenced) filters.fenced = true;
  if (toilets) filters.toilets = true;
  if (freeP) filters.freeParking = true;
  if (paidP) filters.paidParking = true;
  if (dogsA) filters.dogsAllowed = true;
  if (dogsL) filters.dogsLeash = true;

  const minAge = parseInt(document.getElementById('filter-age-min').value);
  const maxAge = parseInt(document.getElementById('filter-age-max').value);
  if (!isNaN(minAge)) filters.minAge = minAge;
  if (!isNaN(maxAge)) filters.maxAge = maxAge;

  const eqSelect = document.getElementById('filter-equipment');
  const selected = Array.from(eqSelect.selectedOptions).map(o => o.value);
  filters.equipment = selected;

  const ratingMin = parseInt(document.getElementById('filter-rating').value);
  if (!isNaN(ratingMin)) filters.ratingMin = ratingMin;

  const source = document.getElementById('filter-source').value;
  if (source !== 'alle') filters.source = source;

  return filters;
}

function filterPlaygrounds(plays, filters) {
  return plays.filter(p => {
    if (filters.source !== 'alle' && p.source !== filters.source) return false;
    if (filters.toilets && !p.toilets) return false;
    if (filters.fenced && !p.fenced) return false;
    if (filters.freeParking && !p.freeParking) return false;
    if (filters.paidParking && !p.paidParking) return false;
    if (filters.dogsAllowed && !p.dogsAllowed) return false;
    if (filters.dogsLeash && !p.dogsLeash) return false;
    if (p.minAge !== undefined && p.minAge > filters.minAge) return false;
    if (p.maxAge !== undefined && p.maxAge < filters.maxAge) return false;
    if (filters.equipment.length > 0) {
      const pEquip = p.equipment?.map(e => e.type) || [];
      if (!filters.equipment.some(e => pEquip.includes(e))) return false;
    }
    if (p.rating?.average < filters.ratingMin) return false;
    return true;
  });
}

// -------------------------------------------------------------
// Event Listeners
// -------------------------------------------------------------
// Moveend for viewport updates
map.on('moveend', () => {
  const c = map.getCenter();
  const z = map.getZoom();
  const last = state.lastView;
  if (last &&
      Math.abs(last.zoom - z) < 0.05 &&
      Math.abs(last.lng - c.lng) < 1e-4 &&
      Math.abs(last.lat - c.lat) < 1e-4) {
    return;
  }
  loadFromViewport();
});

// Zoom change
map.on('zoomend', () => {
  loadFromViewport();
});

// Geolocation button
document.getElementById('locate-btn').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      map.setView([pos.coords.latitude, pos.coords.longitude], 12);
    },
    () => {
      map.setView([10.7522, 59.9139], 5);
    },
    { timeout: 5000 }
  );
});

// Auto-trigger geolocation on load
(function triggerGeolocationOnLoad() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      map.setView([pos.coords.latitude, pos.coords.longitude], 12);
    },
    () => {
      map.setView([10.7522, 59.9139], 5);
    },
    { timeout: 5000 }
  );
})();

// Search input
const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', (e) => {
  const term = e.target.value.toLowerCase();
  if (!term) {
    renderPlaygroundList();
    syncMapMarkers();
    return;
  }
  const filtered = state.playgrounds.filter(p =>
    p.name.toLowerCase().includes(term) ||
    (p.location && 
      (String(p.location.lat).includes(term) || String(p.location.lng).includes(term)))
  );
  state.filteredPlaygrounds = filtered;
  document.getElementById('result-count').textContent = filtered.length;
});

// Rating range slider
document.getElementById('filter-rating').addEventListener('input', (e) => {
  document.getElementById('rating-value').textContent = e.target.value;
  loadFromViewport();
});

// Initial load
loadFromViewport();