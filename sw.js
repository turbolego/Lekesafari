// Service worker – sw.js
//
// The site is served from a GitHub Pages SUBPATH (turbolego.github.io/Lekesafari/),
// so every path here must be RELATIVE — no leading slash. A leading slash resolves
// to the domain root, which is not where the app lives, so an absolute precache
// list silently 404s and install() aborts.
//
// Bump CACHE_VERSION on every deploy that changes a precached asset so old
// caches are cleaned up on activate.
const CACHE_VERSION = 'v3';
const CACHE_NAME = `lekesafari-${CACHE_VERSION}`;

// Shell assets that must be available offline. Keep this list small and
// verified: addAll() is all-or-nothing, so one missing file aborts the
// whole install and the service worker never activates.
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './app-leaflet.js',
  './sources.js',
  './seed-data.js',
  './styles.css',
  './styles-leaflet.css',
  './manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      // Never let a precache failure block activation: a stale shell is far
      // better than a site that refuses to install its service worker.
      .catch((err) => console.warn('Precache failed:', err))
  );
  // Take over open pages immediately on first install.
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('lekesafari-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Only handle GET; POST/PUT/etc must go straight to the network.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cross-origin (tiles, OSM, CDNs) — never intercept.
  if (url.origin !== location.origin) return;

  // Precached shell: serve from cache first, fall back to network.
  // Match on the pathname so it works under the /Lekesafari/ subpath.
  const precached = PRECACHE_ASSETS.includes(url.pathname.replace(/^.*?(\/Lekesafari\/)/, '$1'))
    || PRECACHE_ASSETS.includes(url.pathname);
  if (precached) {
    e.respondWith(
      caches.match(req).then((cached) => cached || fetch(req))
    );
    return;
  }

  // Everything else (notably the ~3.5MB GeoJSON): network-first with a cache
  // fallback, so a flaky connection still yields data once it has been seen.
  e.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(req))
  );
});
