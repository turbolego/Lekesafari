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
  zoom: 10,
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
  // Per-type toggles for Geonorge WMS POIs (all default ON for the initial
  // load; the sidebar checkboxes turn them off individually, and the sidebar
  // is built from WMS_POI_TYPES at page load time so new types are auto-picked
  // up).
  wmsTypeFilter: new Set(),
};

// WMS_POI_TYPES is declared in sources.js (loaded before this script via
// <script src="sources.js">); it holds the 7 Geonorge tilgjengelighet3
// point-POI objtypes. Populate the active Set with all types so they are
// all enabled initially.
[...WMS_POI_TYPES].forEach(t => state.wmsTypeFilter.add(t));

// -------------------------------------------------------------
// --- Data Loading Functions
// Use shared implementations from sources.js (already loaded)
// loadStatic(bounds) and loadForViewport(bounds) are defined in sources.js
// -------------------------------------------------------------

// Fetch images for a Geonorge Tilgjengelighet3 playground from the API
// (same method as the live WMS adapter for OSM markers). Called on-demand
// when a playground's popup opens. Returns {url, alt} objects.
async function fetchImagesForPopup(p) {
  // Geonorge Tilgjengelighet3 markers already store image URLs in imageRefs
  // (resolved from the WMS GML bildefil1/2/3 fields). Use those directly —
  // no need to call the non-existent api/images/{id} endpoint on GitHub Pages.
  if (p && Array.isArray(p.imageRefs) && p.imageRefs.length > 0) {
    return p.imageRefs.map(img => ({
      url: img,
      page: img,
      alt: p.name || 'Lekeplass',
    }));
  }

  const id = p.sourceId || p.id;
  if (!id) return [];

  try {
    const r = await fetch(`api/images/${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!r.ok) return [];
    const data = await r.json();
    return (data || []).map(img => ({
      url: img.url || '',
      alt: img.alt || p.name || 'Lekeplass',
      page: img.page || img.url,
    }));
  } catch (e) {
    console.warn('fetchImagesForPopup failed:', e);
    return [];
  }
}

// Build popup content for a playground marker (shared by markers + list rows).
// Shared with OSM source: images come from imageRefs, but Geonorge Tilgjengelighet3
// has empty imageRefs, so those are replaced with the on-demand API fetch
// (see openPopup()).

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
  // Live Overpass + Geonorge WMS enrich it at zoom >= 9.
  loadStatic().then(result => {
    const staticPlaygrounds = result.playgrounds || [];
    state.staticPlaygrounds = staticPlaygrounds;
    // Always start from the full static set (never empties).
    state.playgrounds = dedupePlaygrounds(staticPlaygrounds);
    state.sourceErrors = result.error ? [result.error] : [];
    renderPlaygroundList();
    syncMapMarkers();

    // Load Geonorge Tilgjengelighet3 data from JSON at ALL zooms.
    // The JSON file (data/geonorge_tilgjengelighet3_all.json) replaces the
    // on-demand WMS fetch (loadWmsTilgjengelighet in sources.js).
    // Images in popups are fetched from the API on-demand (see openPopup).
    if (typeof loadGeonorgeStatic === 'function') {
      loadGeonorgeStatic(bounds).then(geoRes => {
        if (geoRes && geoRes.playgrounds && geoRes.playgrounds.length > 0) {
          state.playgrounds = dedupePlaygrounds(staticPlaygrounds.concat(geoRes.playgrounds));
          state.sourceErrors = geoRes.error ? [geoRes.error] : state.sourceErrors;
          renderPlaygroundList();
          syncMapMarkers();
        }
      }).catch(err => {
        console.warn('Geonorge static load failed:', err);
      });
    }
  }).catch(err => {
    // data/geonorge_tilgjengelighet3_all.json (loaded above), and images are
    // loaded on-demand via fetchImagesForPopup() when a popup opens.
    state.isLoading = false;
  }).catch(err => {
    state.isLoading = false;
    console.warn('Static load failed:', err);
    state.staticPlaygrounds = [];
    renderPlaygroundList();
  });
}

// Re-apply current search term + filters after a data refresh.
// Markers are already synced by the caller; only the sidebar list needs
// rebuilding here.
function reapplySearch() {
  if (state.searchTerm) renderPlaygroundList();
}

// -------------------------------------------------------------
// Marker Rendering
// -------------------------------------------------------------
// Emoji to display for each WMS POI type.
const POI_EMOJI = {
  Sittegruppe: '🛋️',
  FriluftToalett: '🚽',
  FriluftGrillBålplass: '🔥',
  FriluftFiskeplassBrygge: '🎣',
  FriluftBaderampe: '🤿',
  FriluftGapahuk: '🛖',
  FriluftHytterTilrettelagt: '🏠',
};

// Return the emoji icon for a playground marker.
// - OSM source markers always display the 🛝 slide emoji.
// - Other sources use their POI type emoji; fallback to a generic pin.
function getMarkerEmoji(p) {
  if (p.source === 'osm') return '🛝';
  const label = p.poiType ? POI_EMOJI[p.poiType] : null;
  return label || '📍';
}

function getMarkerIcon(p) {
  return L.divIcon({
    html: `<div class="playground-marker-emoji">${getMarkerEmoji(p)}</div>`,
    className: 'playground-marker-container emoji-marker',
    // 50% of the standard size (half of the previous 200% size)
    iconSize: [32, 32],
    iconAnchor: [16, 32],
  });
}

function getMarkerColor(source) {
  const colors = {
    osm: '#2e7d32',        // green
    geonorge: '#1565c0',   // blue
    'wms-tilgjengelighet': '#1565c0', // blue — Geonorge WMS (same family)
    municipality: '#7b1fa2', // purple
    user: '#e65100',       // orange
  };
  return colors[source] || '#007acc';
}

function syncMapMarkers() {
  // Always render ALL markers from the full workflow dataset.
  // Filters only hide some; they never remove the base set.
  const list = state.playgrounds || [];
  if (!list.length) {
    console.warn('No playgrounds to render on map');
    return;
  }

  // Build a map of existing markers by id for efficient updates
  const existing = new Map();
  playgroundLayer.eachLayer(m => {
    if (m.__playgroundId) {
      existing.set(m.__playgroundId, m);
    }
  });

  // Update or create markers
  list.forEach(p => {
    if (!p.location || p.location.lat == null || p.location.lng == null) return;
    const id = p.id;
    const existingMarker = existing.get(id);

    if (existingMarker) {
      // Update marker position (fast, no DOM recreation)
      existingMarker.setLatLng([p.location.lat, p.location.lng]);
      existingMarker.setIcon(getMarkerIcon(p));
      existingMarker.off('click');
      existingMarker.on('click', () => openPopup(p, existingMarker));
    } else {
      // New marker - create and add
      const marker = L.marker([p.location.lat, p.location.lng], {
        icon: getMarkerIcon(p),
        zIndexOffset: 1000,
      });
      marker.__playgroundId = id;
      marker.on('click', () => openPopup(p, marker));
      playgroundLayer.addLayer(marker);
      state.markerLookup.set(id, marker);
      state.markerObjects.set(id, { marker, playground: p });
    }
  });

  // Remove markers that are no longer in the list
  for (const [id, marker] of existing.entries()) {
    if (!list.find(p => p.id === id)) {
      playgroundLayer.removeLayer(marker);
      state.markerLookup.delete(id);
      state.markerObjects.delete(id);
    }
  }

  // Apply the active filter to show/hide markers immediately.
  updateMarkerVisibility();
}

// Toggle individual marker visibility based on the current filters.
// Called after syncMapMarkers and whenever a filter value changes.
function updateMarkerVisibility() {
  const filter = getActiveFilters();
  // Include the active search term: markers now hide/show in step with the
  // sidebar list instead of requiring a full marker rebuild per keystroke.
  const filterFn = (p) => filterPlaygrounds([p], filter).length === 1 && matchesSearch(p);

  state.markerObjects.forEach(({ marker, playground: p }) => {
    const visible = filterFn(p);
    marker._leaflet_id = visible ? 'visible' : 'hidden';
    marker.getElement().classList.toggle('hidden', !visible);
  });
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
    // Deep-link so OSM opens centred on the feature: /way/123#map=19/lat/lng
    let url = `https://www.openstreetmap.org/${type}/${id}`;
    if (p.location && p.location.lat != null && p.location.lng != null) {
      url += `#map=19/${p.location.lat}/${p.location.lng}`;
    }
    return url;
  }
  return null;
}

// Renders an image entry inside the popup/modal.
// - For a direct image URL: an <img> followed by a link to the source page (if any).
// - For a Google Photos share link (not embeddable): a clickable link card that
//   opens the album/photo page so the user can view it in the browser.
function renderImageHTML(img) {
  if (!img || !img.url) return '';
  const url = img.url;
  const page = img.page || url;
  const alt = String(img.alt || 'Lekeplass').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Embeddable when it's a real image: a known image-file extension, OR a
  // Google CDN thumbnail (lh3.googleusercontent.com/pw/... has no extension
  // but serves image bytes). Bare Google Photos share links (photos.app.goo.gl)
  // are NOT embeddable — those fall through to the link card below.
  let host = '';
  try { host = new URL(url).host; } catch (e) {}
  const isImageFile = /\.(png|jpe?g|gif|webp|svg)(\?|#|$)/i.test(url);
  const isGoogleCdn = host && (host === 'lh3.googleusercontent.com' || /^lh\d\.googleusercontent\.com$/.test(host));
  const isShareLink = /^https?:\/\/photos\.app\.goo\.gl\//i.test(url);
  const isDirect = isImageFile || (isGoogleCdn && !isShareLink);
  if (isDirect) {
    const link = page && page !== url
      ? `<a href="${page}" target="_blank" rel="noopener noreferrer" style="display:block;text-align:center;margin-top:0.25rem;font-size:0.75rem;color:#1a73e8;">🔗 Åpne bilde</a>` : '';
    return `<img src="${url}" alt="${alt}" style="width:100%;margin-top:0.4rem;border-radius:4px;" onerror="this.style.display='none'">` + link;
  }
  // Share link / unknown host -> render a link card the user can open.
  return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="display:block;width:100%;box-sizing:border-box;margin-top:0.4rem;padding:0.5rem 0.6rem;border:1px solid #cfd8dc;border-radius:4px;font-size:0.75rem;color:#1a73e8;text-align:center;background:#f5f9ff;">📷 Vis bilde (åpne i nettleser)</a>`;
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

  // Only show images for OSM + WMS sources (the static OSM-baked layer and the
  // Geonorge WMS adapter both carry resolved direct image URLs in imageRefs;
  // other/legacy sources had hallucinated images and are excluded). imagePages
  // holds the original page link per image so we can render a link below the
  // embedded <img>. Alt text is OSM/Geonorge-supplied, so renderImageHTML
  // escapes it before it is interpolated into an HTML string.
  const hasImages = (p.source === 'osm' || p.source === 'wms-tilgjengelighet');
  const imgSrc = (p.imageRefs && p.imageRefs.length) ? p.imageRefs : (p.images || []);
  const pages = (p.imagePages && p.imagePages.length) ? p.imagePages : (imgSrc.map(() => null));
  const imagesHtml = (hasImages && imgSrc.length)
    ? imgSrc.map((img, i) => renderImageHTML({ ...img, page: pages[i] })).join('')
    : '';


  const osmUrl = getOsmUrl(p);
  const osmLink = osmUrl
    ? `<a href="${esc(osmUrl)}" target="_blank" rel="noopener noreferrer" style="display:block;text-align:center;margin-top:0.5rem;font-size:0.75rem;color:#1a73e8;">Vis på OpenStreetMap →</a>`
    : '';

  return `
    <div style="font-weight:600;font-size:1rem;margin-bottom:0.3rem;">${esc(p.name)}</div>
    <div style="font-size:0.85rem;color:#666;margin-bottom:0.3rem;">
      ${ratingLine}
    </div>
    <div style="font-size:0.8rem;color:#555;">
      <span class="pin-badge badge-${esc(src)}">${esc(p.source)}</span> ${verif}
    </div>
    <div style="font-size:0.75rem;color:#777;margin-top:0.3rem;">
      ${esc(eqNames)}
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

  // For Geonorge Tilgjengelighet3 markers: images are NOT in the static JSON
  // (imageRefs is empty). Fetch them from the API on popup open (on-demand
  // pattern, same as the live WMS adapter for OSM markers). While images
  // load, show a placeholder so the popup doesn't look broken.
  if (p.source === 'geonorge-tilgjengelighet3') {
    fetchImagesForPopup(p).then(imgs => {
      // Rebuild popup with images when they arrive.
      const imgHtml = imgs.map(img => renderImageHTML(img)).join('');
      const content = popupContent.replace('</div>', imgHtml + '</div>');
      const popup = marker.getPopup();
      if (popup) {
        popup.setContent(content);
        popup.update();
      } else {
        marker.bindPopup(content, {
          maxWidth: 300,
          closeButton: true,
          closeOnClick: true,
          autoClose: false,
          className: 'playground-popup',
        }).openPopup();
      }
    }).catch(err => {
      console.warn('Geonorge image fetch failed:', err);
      const imgHtml = '<div style="padding:1rem 0;font-size:0.75rem;color:#777;">No images available</div>';
      const content = popupContent.replace('</div>', imgHtml + '</div>');
      const popup = marker.getPopup();
      if (popup) {
        popup.setContent(content);
        popup.update();
      } else {
        marker.bindPopup(content, {
          maxWidth: 300,
          closeButton: true,
          closeOnClick: true,
          autoClose: false,
          className: 'playground-popup',
        }).openPopup();
      }
    });
  }
}

// -------------------------------------------------------------
// List Rendering
// -------------------------------------------------------------
// True when the active search term matches this playground.
// Shared by the sidebar list and the marker-visibility toggle so both stay
// in sync without rebuilding every marker on each keystroke.
function matchesSearch(p) {
  if (!state.searchTerm) return true;
  const term = state.searchTerm;
  if (p.name && p.name.toLowerCase().includes(term)) return true;
  if (p.municipality && p.municipality.toLowerCase().includes(term)) return true;
  if (p.equipment && p.equipment.some(e => e.name && e.name.toLowerCase().includes(term))) return true;
  return false;
}

const MAX_LIST_ROWS = 200;

function renderPlaygroundList() {
  const list = document.getElementById('result-list') || document.getElementById('playground-list');
  const count = document.getElementById('result-count');

  const filter = getActiveFilters();
  const filtered = filterPlaygrounds(state.playgrounds, filter).filter(matchesSearch);
  state.filteredPlaygrounds = filtered;

  // The count always reflects the TRUE total; only the rendered rows are
  // capped (see MAX_LIST_ROWS).
  count.textContent = filtered.length;

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">Ingen lekeplasser i dette området.</div>';
    return;
  }

  // Build into a DocumentFragment and attach ONE delegated click listener
  // (see bindListClicks). Creating ~2850 per-item listeners on every filter
  // change made filtering noticeably janky.
  const frag = document.createDocumentFragment();

  const rendered = filtered.slice(0, MAX_LIST_ROWS);

  rendered.forEach(p => {
    const item = document.createElement('div');
    item.className = 'playground-item';
    item.style.cssText = 'cursor:pointer;border-bottom:1px solid #eee;padding:0.75rem;';
    item.dataset.id = p.id;

    const nameDiv = document.createElement('div');
    nameDiv.style.cssText = 'font-weight:500;margin-bottom:0.25rem;';
    nameDiv.textContent = p.name;

    const infoDiv = document.createElement('div');
    infoDiv.style.cssText = 'font-size:0.8rem;color:#666;';
    const src = p.source || 'osm';
    infoDiv.innerHTML =
      '<span class="pin-badge badge-' + esc(src) + '">' + esc(src) + '</span>' +
      (p.verified ? '<span class="verified-badge">✓</span>' : '') +
      (p.rating?.count ? '<span style="margin-left:0.5rem;">⭐ ' + esc(String(p.rating.average)) + '</span>' : '');

    item.appendChild(nameDiv);
    item.appendChild(infoDiv);
    frag.appendChild(item);
  });

  // Replace contents in one go; appending 2850 nodes one-by-one forces a
  // reflow per append.
  list.innerHTML = '';
  list.appendChild(frag);

  // Only MAX_LIST_ROWS rows were rendered, so be explicit about the rest.
  if (filtered.length > rendered.length) {
    const more = document.createElement('div');
    more.className = 'list-overflow';
    more.textContent =
      'Viser ' + rendered.length + ' av ' + filtered.length +
      ' – zoom inn eller avgrens filteret for å se flere.';
    list.appendChild(more);
  }
}

// One click listener for the whole result list (event delegation). The list
// is fully rebuilt on each filter change, so per-item listeners would be
// allocated and thrown away thousands of times.
function bindListClicks() {
  const list = document.getElementById('result-list') || document.getElementById('playground-list');
  if (!list) return;
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.playground-item');
    if (!item) return;
    const id = item.dataset.id;
    const p = state.filteredPlaygrounds.find(x => x.id === id) ||
              state.playgrounds.find(x => x.id === id);
    const marker = state.markerLookup.get(id);
    if (!p || !marker) return;
    marker.bindPopup(buildPopupContent(p)).openPopup();
    // Pan map to show the popup
    map.setView(marker.getLatLng(), map.getZoom(), { animate: true });
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

  // Slider steps are 0.5, so parseFloat: parseInt silently turned 2.5 into 2.
  const ratingMin = parseFloat(document.getElementById('filter-rating').value);
  if (!isNaN(ratingMin)) filters.ratingMin = ratingMin;

  const hasImage = document.getElementById('filter-has-image');
  if (hasImage && hasImage.checked) filters.hasImage = true;

  const source = document.getElementById('filter-source').value;
  if (source !== 'alle') filters.source = source;

  return filters;
}

// Apply the current WMS POI type filter to the dropdown and re-render
// markers when the selection changes.
function applyWmsTypeFilter() {
  const dropdown = document.getElementById('filter-poi-type');
  const selected = new Set();
  for (const option of dropdown.selectedOptions) {
    selected.add(option.value);
  }
  for (const option of dropdown.options) {
    option.selected = selected.has(option.value);
  }
  updateMarkerVisibility();
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
    // Age: keep playgrounds whose recommended range OVERLAPS the selected
    // range. The previous strict containment test (`maxAge < filters.maxAge`)
    // excluded every playground once maxAge was populated, because the data's
    // max age (16) is below the control's default (18).
    const pMin = p.minAge ?? p.age?.min;
    const pMax = p.maxAge ?? p.age?.max;
    if (pMin !== undefined && pMax !== undefined) {
      if (pMax < filters.minAge || pMin > filters.maxAge) return false;
    }
    if (filters.equipment.length > 0 && filters.equipment.some(e => e)) {
      const pEquip = p.equipment?.map(e => e.name) || [];
      if (!filters.equipment.some(e => pEquip.includes(e))) return false;
    }
    if (p.rating?.average < filters.ratingMin) return false;
    // WMS POI type filter: a `poiType` must be in the active Set.
    if (p.poiType && !state.wmsTypeFilter.has(p.poiType)) return false;
    return true;
  });
}

// -------------------------------------------------------------
// Event Listeners
// -------------------------------------------------------------
// Moveend for viewport updates
let loadTimeout = null;
map.on('moveend', () => {
  // Debounce: only reload after 300ms of no panning
  clearTimeout(loadTimeout);
  loadTimeout = setTimeout(() => {
    const c = map.getCenter();
    const z = map.getZoom();
    const last = state.lastView;
    // Load if view changed (any change triggers reload)
    if (!last || last.zoom !== z || last.lng !== c.lng || last.lat !== c.lat) {
      loadFromViewport();
    }
  }, 300);
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
      // Default to Burudvann so Geonorge WMS POI markers (e.g. toilet) render
      // visibly without requiring manual panning.
      map.setView([59.9739, 10.5133], 13);
    },
    { timeout: 5000 }
  );
})();

// Search input - wait for playgrounds to be loaded
const searchInput = document.getElementById('search-input');
searchInput.addEventListener('input', (e) => {
  state.searchTerm = e.target.value.toLowerCase();
  // Re-filter in place: markers are already on the map, so only toggle their
  // visibility. Rebuilding all ~2850 markers per keystroke was very janky.
  renderPlaygroundList();
  updateMarkerVisibility();
  queueStedsnavnSearch(e.target.value);
});

// -------------------------------------------------------------
// Stedsnavn (place-name) search — live lookup in Kartverket's Stedsnavn API
// (same source the reference Tilgjengelighet app uses). Results render in a
// small dropdown under the search box; clicking one flies the map to it.
// -------------------------------------------------------------
const stedsnavnResults = document.getElementById('stedsnavn-results');
let stedsnavnTimer = null;
let stedsnavnSeq = 0;

function clearStedsnavnResults() {
  stedsnavnSeq++;
  if (stedsnavnResults) stedsnavnResults.innerHTML = '';
}

function renderStedsnavnResults(places) {
  if (!stedsnavnResults) return;
  stedsnavnResults.innerHTML = places.map(p =>
    `<div class="stedsnavn-item" data-lat="${p.lat}" data-lng="${p.lng}" role="option" tabindex="0">` +
    `<strong>${esc(p.name)}</strong>` +
    (p.kommune ? ` <span>· ${esc(p.kommune)}</span>` : '') +
    (p.type ? ` <span class="stedsnavn-type">· ${esc(p.type)}</span>` : '') +
    `</div>`
  ).join('');
  stedsnavnResults.querySelectorAll('.stedsnavn-item').forEach(el => {
    const fly = () => {
      const lat = parseFloat(el.dataset.lat);
      const lng = parseFloat(el.dataset.lng);
      if (!isNaN(lat) && !isNaN(lng)) {
        map.flyTo([lat, lng], Math.max(map.getZoom(), 14));
      }
      clearStedsnavnResults();
    };
    el.addEventListener('click', fly);
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter') fly(); });
  });
}

function queueStedsnavnSearch(raw) {
  clearTimeout(stedsnavnTimer);
  if (String(raw).trim().length < 3) {
    clearStedsnavnResults();
    return;
  }
  stedsnavnTimer = setTimeout(async () => {
    const seq = ++stedsnavnSeq;
    const places = await searchStedsnavn(raw);
    if (seq !== stedsnavnSeq) return;  // stale — a newer request superseded it
    if (places.length) renderStedsnavnResults(places);
    else if (stedsnavnResults) stedsnavnResults.innerHTML = '';
  }, 400);
}

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
    clearStedsnavnResults();
    renderPlaygroundList();
    updateMarkerVisibility();
  });
}

// Sidebar close button (mobile)
const sidebarClose = document.getElementById('sidebar-close');
if (sidebarClose) {
  sidebarClose.addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('open');
    setTimeout(() => map.invalidateSize(), 300);
  });
}

// Toggle WMS POI type checkboxes — no marker rebuild needed (markers already
// on map; we just filter visibility).
document.querySelectorAll('.wms-poi-toggle').forEach(cb => {
  cb.addEventListener('change', () => {
    const t = cb.getAttribute('data-poi-type');
    if (cb.checked) state.wmsTypeFilter.add(t);
    else state.wmsTypeFilter.delete(t);
    onFilterChange();
  });
});

// One delegated click listener for the whole result list.
bindListClicks();

// Initialize the dropdown from state.
document.getElementById('filter-poi-type').addEventListener('change', () => {
  const selected = new Set();
  for (const option of document.getElementById('filter-poi-type').selectedOptions) {
    selected.add(option.value);
  }
  state.wmsTypeFilter = selected;
  applyWmsTypeFilter();
});

// Initial load
loadFromViewport();