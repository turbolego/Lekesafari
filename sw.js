// Service worker for the GitHub Pages subpath deployment.
const CACHE_VERSION = 'v5';
const SHELL_CACHE = `lekesafari-shell-${CACHE_VERSION}`;
const DATA_CACHE = `lekesafari-data-${CACHE_VERSION}`;
const TILE_CACHE = `lekesafari-tiles-${CACHE_VERSION}`;
const IMAGE_CACHE = `lekesafari-images-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './index-leaflet.html',
  './app-leaflet.js?v=13',
  './sources.js?v=8',
  './seed-data.js?v=3',
  './styles.css',
  './styles-leaflet.css',
  './static/leaflet.markercluster.js',
  './static/MarkerCluster.css',
  './static/MarkerCluster.Default.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

const MAX_TILES = 250;
const MAX_IMAGES = 100;

function isAppNavigation(request) {
  return request.mode === 'navigate' ||
    (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));
}

function isShellRequest(url) {
  return url.origin === self.location.origin &&
    (url.pathname.endsWith('.js') ||
      url.pathname.endsWith('.css') ||
      url.pathname.endsWith('.json') ||
      url.pathname.endsWith('.png') ||
      url.pathname.endsWith('.html'));
}

function isDataRequest(url) {
  return url.origin === self.location.origin &&
    /^\/(?:Lekesafari\/)?data\//.test(url.pathname);
}

function isTileRequest(url) {
  return url.hostname.endsWith('.tile.openstreetmap.org') ||
    url.hostname === 'tile.openstreetmap.org';
}

function isImageRequest(url) {
  return url.hostname === 'data.kartverket.no' ||
    url.hostname.endsWith('googleusercontent.com');
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const requests = await cache.keys();
  if (requests.length <= maxEntries) return;
  await Promise.all(requests.slice(0, requests.length - maxEntries).map(request => cache.delete(request)));
}

async function networkFirst(request, cacheName, fallbackRequest = request) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(fallbackRequest);
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const update = fetch(request).then(response => {
    if (response.ok) return cache.put(request, response.clone()).then(() => response);
    return response;
  }).catch(error => {
    if (!cached) throw error;
    return cached;
  });
  return cached || update;
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .catch(error => console.warn('Shell precache failed:', error))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys
        .filter(key => key.startsWith('lekesafari-') &&
          ![SHELL_CACHE, DATA_CACHE, TILE_CACHE, IMAGE_CACHE].includes(key))
        .map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (isAppNavigation(request)) {
    event.respondWith(networkFirst(request, SHELL_CACHE, './index.html'));
    return;
  }

  if (isDataRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, DATA_CACHE));
    return;
  }

  if (isTileRequest(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') {
          await cache.put(request, response.clone());
          event.waitUntil(trimCache(TILE_CACHE, MAX_TILES));
        }
        return response;
      })
    );
    return;
  }

  if (isImageRequest(url)) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') {
          await cache.put(request, response.clone());
          event.waitUntil(trimCache(IMAGE_CACHE, MAX_IMAGES));
        }
        return response;
      })
    );
    return;
  }

  if (isShellRequest(url)) {
    event.respondWith(
      caches.match(request).then(cached => cached || fetch(request))
    );
  }
});
