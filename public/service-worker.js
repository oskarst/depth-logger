const STATIC_CACHE = 'lake-logger-static-1764603901';
const STATIC_ASSETS = [
  '/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest',
  '/icon-192.png', '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS).catch(()=>{}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: network only, offline fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(event.request).catch(() =>
      new Response(JSON.stringify({ ok:false, offline:true }), { headers: { 'Content-Type':'application/json' } })
    ));
    return;
  }

  // Static assets: network-first, cache fallback (ensures fresh content on refresh)
  event.respondWith(
    fetch(event.request)
      .then(networkRes => {
        const clone = networkRes.clone();
        caches.open(STATIC_CACHE).then(cache => cache.put(event.request, clone));
        return networkRes;
      })
      .catch(() => caches.match(event.request))
  );
});
