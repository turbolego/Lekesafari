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
    hasImage: false,
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
  staticPlaygrounds: [],
  sourceErrors: [],
  lastView: null,
  filteredPlaygrounds: [],
  searchTerm: '',
  markerLookup: new Map(),  // id -> marker
  markerObjects: new Map(),  // id -> {marker, playground}
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

  // Static GeoJSON is the PRIMARY source: loaded at ALL zooms, same-origin,
  // never viewport-filtered so the list/markers never vanish on pan.
  // Live Overpass only enriches the viewport at zoom >= 9.
  state.isLoading = true;
  loadStatic().then(result => {
    const staticPlaygrounds = result.playgrounds || [];
    state.staticPlaygrounds = staticPlaygrounds;
    // Always start from the full static set (never empties).
    state.playgrounds = dedupePlaygrounds(staticPlaygrounds);
    state.sourceErrors = result.error ? [result.error] : [];
    renderPlaygroundList();
    syncMapMarkers();
    reapplySearch();

    if (zoom >= CONFIG.MIN_LIVE_ZOOM) {
      loadForViewport(bounds).then(({ playgrounds: live, errors }) => {
        // Enrich: merge live viewport data over the static baseline.
        // Dedupe is critical — the live viewport can return records that
        // are already in the static set, and concat alone would double them.
        state.playgrounds = dedupePlaygrounds(staticPlaygrounds.concat(live));
        state.sourceErrors = errors || state.sourceErrors;
        state.isLoading = false;
        renderPlaygroundList();
        syncMapMarkers();
        reapplySearch();
      }).catch(err => {
        state.isLoading = false;
        renderPlaygroundList();
        syncMapMarkers();
        console.warn('Live viewport load failed:', err);
      });
    } else {
      state.isLoading = false;
    }
  }).catch(err => {
    state.isLoading = false;
    console.warn('Static load failed:', err);
    // Fallback: keep whatever the static layer produced (may be []),
    // so we never show a fully-empty map without surfacing the error.
    renderPlaygroundList();
    syncMapMarkers();
    reapplySearch();
  });
}

// Re-apply current search term + filters after a data refresh
function reapplySearch() {
  if (state.searchTerm) {
    renderPlaygroundList();
    syncMapMarkers();
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
  // Always render ALL markers from the full workflow dataset.
  // Filters only hide some; they never remove the base set.
  playgroundLayer.clearLayers();
  state.markerLookup.clear();
  state.markerObjects.clear();

  const list = state.playgrounds || [];
  if (!list.length) {
    console.warn('No playgrounds to render on map');
    return;
  }

  list.forEach(p => {
    if (!p.location || p.location.lat == null || p.location.lng == null) return;
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
    state.markerLookup.set(p.id, marker);
    state.markerObjects.set(p.id, { marker, playground: p });
  });

  // Apply the active filter to show/hide markers immediately.
  updateMarkerVisibility();
}

// Toggle individual marker visibility based on the current filters.
// Called after syncMapMarkers and whenever a filter value changes.
function updateMarkerVisibility() {
  const filter = getActiveFilters();
  const filterFn = (p) => filterPlaygrounds([p], filter).length === 1;

  state.markerObjects.forEach(({ marker, playground: p }) => {
    const visible = filterFn(p);
    if (visible) {
      playgroundLayer.addLayer(marker);
    } else {
      playgroundLayer.removeLayer(marker);
    }
  });
}

// -------------------------------------------------------------
// Detail Modal
// -------------------------------------------------------------
async function openDetail(p) {
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

  // Placeholder while images load lazily
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
    <div id="lazy-images-container"></div>
  `;

  modal.style.display = 'block';

  // Lazy-fetch images from imageRefs (only if present in OSM data)
  const images = await getImagesForPlayground(p);
  const imagesContainer = document.getElementById('lazy-images-container');
  if (images.length > 0) {
    imagesContainer.innerHTML = images.map(img =>
      `<img src="${img.url}" alt="${img.alt}" style="width:100%;margin-top:0.5rem;border-radius:4px;" onerror="this.style.display='none'">`
    ).join('');
  } else {
    imagesContainer.innerHTML = '<div style="font-size:0.75rem;color:#999;margin-top:0.5rem;">Ingen bilder tilgjengelig</div>';
  }

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
function getOsmUrl(p) {
  // Find the OSM node/way URL from the sources array
  if (!p.sources || !Array.isArray(p.sources)) return null;
  const osmSource = p.sources.find(s => s.type === 'osm');
  if (!osmSource || !osmSource.id) return null;
  // osmSource.id format is like "node/123456" or "way/123456"
  const [type, id] = osmSource.id.split('/');
  if (id) {
    return `https://www.openstreetmap.org/${type}/${id}`;
  }
  return null;
}

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

  // Only show images for OSM sources (remove hallucinated images from other sources)
  const imagesHtml = (p.source === 'osm' && p.images?.length)
    ? p.images.map(img => `<img src="${img.url}" alt="${img.alt}" style="width:100%;margin-top:0.4rem;border-radius:4px;" onerror="this.style.display='none'">`).join('')
    : '';

  const osmUrl = getOsmUrl(p);
  const osmLink = osmUrl
    ? `<a href="${osmUrl}" target="_blank" rel="noopener noreferrer" style="display:block;text-align:center;margin-top:0.5rem;font-size:0.75rem;color:#1a73e8;">Vis på OpenStreetMap →</a>`
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
    ${imagesHtml}
    ${osmLink}
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
  const list = document.getElementById('result-list') || document.getElementById('playground-list');
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

  // Clear existing list items before adding new ones
  list.innerHTML = '';

  filtered.forEach(p => {
    const item = document.createElement('div');
    item.className = 'playground-item';
    item.style.cssText = 'cursor:pointer;border-bottom:1px solid #eee;padding:0.75rem;';
    item.dataset.id = p.id;
    item.addEventListener('click', () => {
      // Find the marker for this playground and open its popup on the map
      const marker = state.markerLookup.get(p.id);
      if (marker) {
        const popupContent = buildPopupContent(p);
        marker.bindPopup(popupContent).openPopup();
        // Pan map to show the popup
        map.setView(marker.getLatLng(), map.getZoom(), { animate: true });
      }
    });

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
// Dedupe helper — keeps the first occurrence of each playground by id.
// Critical: repeated viewport fetches can return the same OSM record
// that is already in the static set, and concat alone would double it.
// -------------------------------------------------------------
function dedupePlaygrounds(list) {
  const seen = new Set();
  const out = [];
  (list || []).forEach(p => {
    const key = p.id || p.sourceId || p.osm_id || p.name + '|' + (p.location?.lat) + '|' + (p.location?.lng);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p);
  });
  return out;
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

  const hasImage = document.getElementById('filter-has-image');
  if (hasImage && hasImage.checked) filters.hasImage = true;

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
    if (filters.hasImage) {
      // Static records keep OSM image URLs in imageRefs (images are lazy-loaded).
      const hasImg = (p.imageRefs && p.imageRefs.length > 0) || (p.images && p.images.length > 0);
      if (!hasImg) return false;
    }
    if (p.minAge !== undefined && p.minAge > filters.minAge) return false;
    if (p.maxAge !== undefined && p.maxAge < filters.maxAge) return false;
    if (filters.equipment.length > 0 && filters.equipment.some(e => e)) {
      const pEquip = p.equipment?.map(e => e.name) || [];
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

// -------------------------------------------------------------
// Filter event listeners — all re-render the list and toggle marker
// visibility (markers are always present; filters only hide them).
// Checkboxes/selects fire 'change'; the rating slider fires 'input'.
// -------------------------------------------------------------
function onFilterChange() {
  // Re-filter the list AND rebuild the sidebar list (markers are already
  // on the map — we only toggle their visibility, never rebuild them).
  renderPlaygroundList();
  updateMarkerVisibility();
}

const filterIds = [
  'filter-fenced', 'filter-toilets', 'filter-free-parking',
  'filter-paid-parking', 'filter-dogs-allowed', 'filter-dogs-leash',
  'filter-age-min', 'filter-age-max', 'filter-equipment', 'filter-source',
  'filter-has-image',
];

filterIds.forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('change', onFilterChange);
});

// Rating range slider — continuous, fire on every input.
const ratingSlider = document.getElementById('filter-rating');
if (ratingSlider) {
  ratingSlider.addEventListener('input', (e) => {
    const rv = document.getElementById('rating-value');
    if (rv) rv.textContent = e.target.value;
    onFilterChange();
  });
}


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