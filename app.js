// ============================================
  Lekesafari – Main Application Logic
  ============================================

// --- Configuration ---
const CONFIG = {
  // Filter IDs
  FILTER_FENCED: 'filter-fenced',
  FILTER_DOGS: 'filter-dogs',
  FILTER_TOILETS: 'filter-toilets',
  FILTER_FREE_PARKING: 'filter-free-parking',
  FILTER_PAID_PARKING: 'filter-paid-parking',
  // Age range
  MIN_AGE: 0,
  MAX_AGE: 18,
  // Equipment categories
  EQUIPMENT_OPTIONS: [
    'slide', 'swing', 'climb', 'see-saw', 'spring', 'sandbox', 'roundabout', 'basketball'
  ],
  // Rating thresholds
  MIN_RATING: 0,
};

// --- State ---
let state = {
  filters: {
    fenced: true,
    dogs: true,
    toilets: true,
    freeParking: true,
    paidParking: false,
    ageMin: CONFIG.MIN_AGE,
    ageMax: CONFIG.MAX_AGE,
    equipment: [],
    ratingMin: CONFIG.MIN_RATING,
  },
  selectedPin: null,
  map: null,
};

// --- DOM References ---
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const mapEl = $('#map');
const sidebar = $('#sidebar');
const searchInput = $('#search-input');
const resultCount = $('#result-count');
const playgroundList = $('#playground-list');
const detailModal = $('#detail-modal');
const toast = $('#toast');
const locateBtn = $('#locate-btn');

// --- Initialize Map ---
function initMap() {
  if (state.map) return;

  const mapContainer = document.getElementById('map');
  if (!mapContainer) throw new Error('Map container not found');

  // Center map on screen
  mapContainer.style.width = '100%';
  mapContainer.style.height = '480px';

  // Create MapLibre instance
  state.map = new MapLibre.GlMap({
    container: mapContainer,
    style: {
      map: {
        attribution: '© OpenStreetMap, MapLibre',
        center: [51.505, 12.5],
        zoom: 12,
        pitch: 0,
      },
      tileLayer: {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        maxZoom: 19,
      },
    },
  });

  // Fit bounds to visible area
  state.map.fitView([[-50, 60], [90, 70]], { perspective: 450 });
}

// --- Filter Logic ---
function applyFilters() {
  const f = state.filters;
  const q = searchInput.value.toLowerCase().trim();

  // Clear previous results
  renderPlayground();

  // Apply equipment filter
  if (f.equipment.length > 0) {
    const selected = Array.from(state.equipment).filter(id => f.equipment.includes(id));
    state.filters.equipment = selected;
  }

  // Update result count
  const total = getTotalMatches(q);
  resultCount.textContent = `Finder: ${total}`;
}

function getTotalMatches(query) {
  // Simple search: check if any playground name contains the query
  const plays = readPlays(); // hypothetical – we'll simulate with spec data
  let count = 0;
  for (const p of plays) {
    if (p.name.toLowerCase().includes(query) || p.location.lat?.toString().includes(query) || p.location.lng?.toString().includes(query)) {
      count++;
    }
  }
  return count;
}

// --- Playlist Management ---
// Load plays from spec_notes (simulated)
async function loadPlays() {
  // In a real app, this would fetch from a backend
  // For now, we seed with example data based on spec_notes
  const plays = [
    { id: 'solbakken', name: 'Solbakken lekeplass', location: { lat: 59.9139, lng: 10.7522 }, age: { min: 2, max: 12 }, opening: 'Mo-Su 08:00-20:00', equipment: ['slide', 'swing', 'climb'], rating: 4 },
    { id: 'parken', name: 'Parke Solheimen', location: { lat: 59.5070, lng: 10.5520 }, age: { min: 3, max: 15 }, opening: 'Tue-Sun 09:00-18:00', equipment: ['slide', 'swing'], rating: 3 },
    { id: 'viktoria', name: 'Viktoria lekeplass', location: { lat: 59.5220, lng: 10.6550 }, age: { min: 4, max: 16 }, opening: 'Daily 07:00-19:00', equipment: ['climb', 'roundabout'], rating: 4 },
    { id: 'kongsvinger', name: 'Kongsvinger park', location: { lat: 59.4900, lng: 10.5800 }, age: { min: 1, max: 10 }, opening: 'Mon-Fri 08:00-17:00', equipment: ['slide', 'swing'], rating: 2 },
    { id: 'fjellstien', name: 'Fjellstien lekeplass', location: { lat: 59.5500, lng: 10.7200 }, age: { min: 5, max: 14 }, opening: 'Sat-Sun 09:00-16:00', equipment: ['climb', 'roundabout'], rating: 5 },
  ];
  plays.forEach(p => state.plays.push(p));
}

async function renderPlayground() {
  const q = searchInput.value.toLowerCase();
  const filtered = state.plays.filter(p => {
    const matches = p.name.toLowerCase().includes(q) ||
                    p.location.lat?.toString().includes(q) ||
                    p.location.lng?.toString().includes(q);
    return matches && (
      (q === 'fenced' ? state.filters.fenced : true) &&
      (q === 'dogs' ? state.filters.dogs : true) &&
      (q === 'toilets' ? state.filters.toilets : true) &&
      (q === 'free-parking' ? state.filters.freeParking : true) &&
      (q === 'paid-parking' ? !state.filters.paidParking : true) &&
      (q === 'rating' ? p.rating >= state.filters.ratingMin : true)
    );
  });

  if (filtered.length === 0) {
    playgroundList.innerHTML = '<p style="color:var(--text-muted);padding:1rem;">Ingen lekeplasser matcheder kravene.</p>';
    return;
  }

  playgroundList.innerHTML = filtered.map(p => {
    const eqStr = p.equipment.map(e => e.charAt(0)).join(', ');
    return `
      <div class="playground-item">
        <div class="pin-item">
          <div class="pin-icon">🧭</div>
          <div class="pin-info">
            <div class="pin-name">${p.name}</div>
            <div class="pin-details">
              <strong>Lage:</strong> ${p.location.lat.toFixed(4)}, ${p.location.lng.toFixed(4)}
              <strong>Alders:</strong> ${p.age.min}-${p.age.max}
              <strong>Tilgang:</strong> ${p.opening}
              <strong>Equipment:</strong> ${eqStr}
              <strong>Rating:</strong> ${p.rating}/5
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// --- Click Handler (Detail Popup) ---
function openDetail(pin) {
  state.selectedPin = pin.id;
  const play = state.plays.find(p => p.id === pin);
  if (!play) return;
  detailModal.hidden = false;
  $('#detail-content').innerHTML = `
    <h2>${play.name}</h2>
    <p><strong>Lage:</strong> ${play.location.lat.toFixed(4)}, ${play.location.lng.toFixed(4)}</p>
    <p><strong>Aldrer:</strong> ${play.age.min}-${play.age.max}</p>
    <p><strong>Tilgang:</strong> ${play.opening}</p>
    <p><strong>Equipment:</strong> ${play.equipment.join(', ') || '–\’}</p>
    <p><strong>Rating:</strong> ${play.rating}/5</p>
  `;
}

function closeDetail() {
  state.selectedPin = null;
  detailModal.hidden = true;
}

// --- Event Listeners ---
function setupEvents() {
  // Search
  searchInput.addEventListener('input', () => {
    applyFilters();
  });

  // Filters
  $('#filter-fenced').addEventListener('change', (e) => {
    state.filters.fenced = e.target.checked;
    applyFilters();
  });
  $('#filter-dogs').addEventListener('change', (e) => {
    state.filters.dogs = e.target.checked;
    applyFilters();
  });
  $('#filter-toilets').addEventListener('change', (e) => {
    state.filters.toilets = e.target.checked;
    applyFilters();
  });
  $('#filter-free-parking').addEventListener('change', (e) => {
    state.filters.freeParking = e.target.checked;
    applyFilters();
  });
  $('#filter-paid-parking').addEventListener('change', (e) => {
    state.filters.paidParking = e.target.checked;
    applyFilters();
  });

  // Age range
  $('#filter-age-min').addEventListener('input', (e) => {
    state.filters.ageMin = parseInt(e.target.value) || CONFIG.MIN_AGE;
    applyFilters();
  });
  $('#filter-age-max').addEventListener('input', (e) => {
    state.filters.ageMax = parseInt(e.target.value) || CONFIG.MAX_AGE;
    applyFilters();
  });

  // Equipment
  $('#filter-equipment').addEventListener('change', (e) => {
    const val = Array.from(e.target.selectedOptions).map(o => o.value);
    state.filters.equipment = val;
    applyFilters();
  });

  // Rating
  $('#filter-rating').addEventListener('change', (e) => {
    state.filters.ratingMin = parseInt(e.target.value) || CONFIG.MIN_RATING;
    applyFilters();
  });

  // Reset
  $('#reset-filters').addEventListener('click', () => {
    state.filters = {
      fenced: true,
      dogs: true,
      toilets: true,
      freeParking: true,
      paidParking: false,
      ageMin: CONFIG.MIN_AGE,
      ageMax: CONFIG.MAX_AGE,
      equipment: [],
      ratingMin: CONFIG.MIN_RATING,
    };
    applyFilters();
  });

  // Locate button
  locateBtn.addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (pos.coords) {
          mapEl.setView(pos.coords, 14, { pitch: 0 });
          showToast(`Lokasjon: ${pos.coords.latitude}, ${pos.coords.longitude}`);
        } else {
          showToast('Ikke mulig å få lokasjon');
        }
      },
      options: { enableHighAccuracy: true, timeout: 10 }
    );
  });

  // Modal
  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) closeDetail();
  });
  $('#detail-close').addEventListener('click', closeDetail);
  detailModal.addEventListener('click', (e) => {
    if (e.target === detailModal) closeDetail();
  });

  // Close on overlay click
  document.addEventListener('click', (e) => {
    if (detailModal.hidden && e.target !== detailModal) closeDetail();
  });
}

// --- Toast Notifications ---
function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => {
    toast.hidden = true;
  }, 2500);
}

// --- Main Entry ---
async function main() {
  await loadPlays();
  initMap();
  applyFilters();
  setupEvents();
}

// Boot
main().catch(err => console.error('Failed to initialize Lekesafari:', err));
