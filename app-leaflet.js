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
  zoomControl: false,
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);

// Zoom control at bottom-right
L.control.zoom({ position: 'bottomright' }).addTo(map);

const playgroundLayer = L.layerGroup().addTo(map);
window.playgroundLayer = playgroundLayer;

// Geonorge WMS layer (raster)
const geonorgeLayer = L.tileLayer.wms('https://wms.geonorge.no/skwms1/wms.tilgjengelighet3', {
  layers: 'tilgjengelighet',
  format: 'image/png',
  transparent: true,
  attribution: 'Geonorge',
});
// Initially hidden – toggle with button
let geonorgeVisible = false;
const geonorgeToggle = document.getElementById('geonorge-toggle');
if (geonorgeToggle) {
  geonorgeToggle.addEventListener('click', () => {
    geonorgeVisible = !geonorgeVisible;
    if (geonorgeVisible) {
      geonorgeLayer.addTo(map);
    } else {
      map.removeLayer(geonorgeLayer);
    }
  });
}

const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.getElementById('sidebar');
if (sidebarToggle && sidebar) {
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    // Invalidate map size after layout change
    setTimeout(() => map.invalidateSize(), 300);
  });
}

// -------------------------------------------------------------
let state = {
  isLoading: false,
  playgrounds: [],
  sourceErrors: [],
  lastView: null,
  filteredPlaygrounds: [],
  searchTerm: '',
};

// -------------------------------------------------------------
// Data Loading Functions
// Use shared implementations from sources.js (already loaded)
// loadStatic(bounds) and loadForViewport(bounds) are defined in sources.js
// -------------------------------------------------------------

// mergeWithSeed: merges live playgrounds with seed (viewport-filtered)
function mergeWithSeed(live, seed, bounds) {
  const ids = new Set(live.map(p => p.id));
  const filteredSeed = seed.filter(s => {
    if (!bounds) return true;
    const lat = s.location.lat, lng = s.location.lng;
    return bounds.contains([lat, lng]);
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

  const c = map.getCenter();
  state.lastView = { lng: c.lng, lat: c.lat, zoom };

  const seed = window.SEED_PLAYGROUNDS || [];

  // Show seed immediately
  state.playgrounds = [...seed];
  renderPlaygroundList();

  // Static GeoJSON is always loaded (same-origin, CORS-safe, 1631 features)
  // Live data is merged on top at zoom >= 9
  loadStatic(bounds).then(result => {
    let playgrounds = result.playgrounds || [];

    if (zoom >= CONFIG.MIN_LIVE_ZOOM) {
      loadForViewport(bounds).then(({ playgrounds: live, errors }) => {
        playgrounds = playgrounds.concat(live);
        state.sourceErrors = errors || [];
        state.playgrounds = mergeWithSeed(playgrounds, seed, bounds);
        state.isLoading = false;
        renderPlaygroundList();
        syncMapMarkers();
        // Re-run search if user typed before data loaded
        if (state.searchTerm) {
          renderPlaygroundList();
          syncMapMarkers();
        }
      }).catch(err => {
        state.playgrounds = mergeWithSeed(playgrounds, seed, bounds);
        state.isLoading = false;
        renderPlaygroundList();
        syncMapMarkers();
        // Re-run search if user typed before data loaded
        if (state.searchTerm) {
          renderPlaygroundList();
          syncMapMarkers();
        }
      });
    } else {
      state.playgrounds = mergeWithSeed(playgrounds, seed, bounds);
      state.isLoading = false;
      renderPlaygroundList();
      syncMapMarkers();
      // Re-run search if user typed before data loaded
      if (state.searchTerm) {
        renderPlaygroundList();
        syncMapMarkers();
      }
    }
  }).catch(err => {
    console.warn('Static load failed:', err);
    state.playgrounds = [...seed];
    state.isLoading = false;
    syncMapMarkers();
    renderPlaygroundList();
    // Re-run search if user typed before data loaded
    if (state.searchTerm) {
      renderPlaygroundList();
      syncMapMarkers();
    }
  });
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

  // Use the filtered list of playgrounds (respecting source filter)
  const list = state.filteredPlaygrounds && state.filteredPlaygrounds.length ? state.filteredPlaygrounds : state.playgrounds;
  list.forEach(p => {
    const marker = L.circleMarker([p.location.lat, p.location.lng], {
      radius: 8,
      fillColor: getMarkerColor(p.source),
      color: '#fff',
      weight: 2,
      fillOpacity: 0.8,
      className: 'playground-marker playground-' + p.source,
    });

    marker.on('click', () => openPopup(p, marker));
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
// Leaflet Popup (replaces custom modal for map markers)
// Uses Leaflet's built-in L.popup per the docs:
// https://leafletjs.com/reference.html#popup
// -------------------------------------------------------------
function buildPopupContent(p) {
  const src = p.source || 'osm';
  const ratingLine = p.rating?.count
    ? `Rating: ${p.rating.average} (${p.rating.count})`
    : 'Ingen rating';

  const eqNames = p.equipment?.length
    ? p.equipment.map(eq => eq.name).join(', ')
    : '—';

  const verif = p.verified
    ? '<span class="verified-badge">✓ Verifisert</span>'
    : '';

  return `
    <div style="font-weight:600;font-size:1rem;margin-bottom:0.3rem;">${p.name}</div>
    <div style="font-size:0.85rem;color:#666;margin-bottom:0.3rem;">
      ${ratingLine}
    </div>
    <div style="font-size:0.8rem;color:#555;">
      <span class="pin-badge badge-${src}">${p.source}</span> ${verif}
    </div>
    <div style="font-size:0.75rem;color:#777;margin-top:0.3rem;">
      ${eqNames}
    </div>
    ${p.images?.length
      ? p.images.map(img => `<img src="${img.url}" alt="${img.alt}" style="width:100%;margin-top:0.4rem;border-radius:4px;">`).join('')
      : ''}
  `;
}

function openPopup(p, marker) {
  const popupContent = buildPopupContent(p);

  marker.bindPopup(popupContent, {
    maxWidth: 300,
    closeButton: true,
    closeOnClick: true,
    autoClose: false,
    className: 'playground-popup',
  }).openPopup();
}

// -------------------------------------------------------------
// List Rendering
// -------------------------------------------------------------
function renderPlaygroundList() {
  const list = document.getElementById('playground-list');
  const count = document.getElementById('result-count');

  const filter = getActiveFilters();
  let filtered = filterPlaygrounds(state.playgrounds, filter);

  // If search term is active, further filter by name
  if (state.searchTerm) {
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(state.searchTerm) ||
      (p.location &&
        (String(p.location.lat).includes(state.searchTerm) || String(p.location.lng).includes(state.searchTerm)))
    );
  }
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
  const selected = Array.from(eqSelect.selectedOptions).map(o => o.value).filter(v => v !== '');
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
    if (filters.equipment.length > 0 && filters.equipment.some(e => e)) {
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
  // Load if view changed (any change triggers reload)
  if (!last || last.zoom !== z || last.lng !== c.lng || last.lat !== c.lat) {
    loadFromViewport();
  }
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
      map.setView([59.9139, 10.7522], 5);
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
      map.setView([59.9139, 10.7522], 5);
    },
    { timeout: 5000 }
  );
})();

// Search input - wait for playgrounds to be loaded
const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', (e) => {
  state.searchTerm = e.target.value.toLowerCase();
  // Always render - re-search even if data was already loaded
  renderPlaygroundList();
  syncMapMarkers();
});

// Rating range slider
document.getElementById('filter-rating').addEventListener('input', (e) => {
  document.getElementById('rating-value').textContent = e.target.value;
  loadFromViewport();
});

// Search clear button
const searchClear = document.getElementById('search-clear');
if (searchClear) {
  searchClear.addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    state.searchTerm = '';
    renderPlaygroundList();
    syncMapMarkers();
  });
}

// Sidebar close button (mobile)
const detailClose = document.getElementById('detail-close');
if (detailClose) {
  detailClose.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    setTimeout(() => map.invalidateSize(), 300);
  });
}

// Initial load
loadFromViewport();