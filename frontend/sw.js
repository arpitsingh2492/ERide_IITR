const CACHE_NAME = 'eride-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/rider.html',
  '/driver.html',
  '/history.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/map.js',
  '/js/rider.js',
  '/js/driver.js',
  '/js/history.js',
  '/manifest.json',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Network-first for API/WS, cache-first for assets
  if (e.request.url.includes('/api/') || e.request.url.includes('/ws/')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
