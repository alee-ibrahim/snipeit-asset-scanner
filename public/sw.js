// Bump CACHE_NAME on every UI release so installed PWAs drop old assets.
const CACHE_NAME = 'snipeit-scanner-v3';
const urlsToCache = [
  '/',
  '/admin',
  '/manifest.json',
  '/css/base.css',
  '/icons.svg',
  '/js/scanner.js',
  '/js/decoder-worker.js',
  '/vendor/zxing-wasm/es/reader/index.js',
  '/vendor/zxing-wasm/es/share.js',
  '/vendor/zxing-wasm/reader/zxing_reader.wasm'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .catch(err => console.warn('Precache incomplete:', err))
      .then(() => self.skipWaiting())
  );
});

// Network first, fall back to cache (offline). API calls always go to the network.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Remove old caches and take control of open pages straight away
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});
