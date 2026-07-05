/* Enkel offline-cache: appskalet cachas vid installation, nätet först för
   uppdateringar, cache som fallback. Höj CACHE-versionen vid varje release. */
const CACHE = 'longevity-v2';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/store.js',
  './js/charts.js',
  './js/import.js',
  './js/config.js',
  './js/cloud.js',
  './js/sync.js',
  './js/vendor/supabase-js.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // API-anrop mot Supabase ska aldrig cachas (färsk data + auth)
  if (new URL(e.request.url).hostname.endsWith('.supabase.co')) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
