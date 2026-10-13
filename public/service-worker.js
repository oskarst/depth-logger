const STATIC_CACHE = 'lake-logger-static-1791887744';
const TILE_CACHE = 'lake-logger-tiles-v1';
const MAX_TILES = 600;

// Everything the app needs to start and draw a map with no network at all.
const STATIC_ASSETS = [
  '/', '/index.html', '/styles.css', '/manifest.webmanifest',
  '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png',
  '/vendor/leaflet.js', '/vendor/leaflet.css', '/vendor/turf.min.js',
  '/vendor/images/marker-icon.png', '/vendor/images/marker-icon-2x.png',
  '/vendor/images/marker-shadow.png', '/vendor/images/layers.png', '/vendor/images/layers-2x.png',
  '/js/app.js', '/js/api.js', '/js/data.js', '/js/depth.js', '/js/events.js',
  '/js/fish.js', '/js/gps.js', '/js/logger.js', '/js/maplayers.js', '/js/maps.js',
  '/js/pad.js', '/js/projects.js', '/js/readings.js', '/js/state.js',
  '/js/store.js', '/js/sync.js', '/js/ui.js', '/js/waterlevel.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      // One failed asset must not abandon the whole precache.
      Promise.all(STATIC_ASSETS.map(url => cache.add(url).catch(e => console.warn('precache miss', url, e))))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== STATIC_CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

// Map tiles: serve from cache when we have them, otherwise fetch and keep a
// bounded number, so a lake you have already looked at still draws offline.
async function tileFirst(request) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    // Tiles are cross-origin, so a successful response is opaque: status 0 and
    // res.ok false. Caching only res.ok would cache nothing at all.
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(request, res.clone());
      trimTiles(cache);
    }
    return res;
  } catch (e) {
    return new Response('', { status: 504, statusText: 'tile unavailable offline' });
  }
}

async function trimTiles(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_TILES) return;
  for (const key of keys.slice(0, keys.length - MAX_TILES)) await cache.delete(key);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) (await caches.open(STATIC_CACHE)).put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  try {
    const res = await fetch(request);
    if (res.ok) (await caches.open(STATIC_CACHE)).put(request, res.clone());
    return res;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;

  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(tileFirst(event.request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ ok: false, offline: true }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Vendored libraries are version-pinned, so cache wins; app files check the
  // network first so a deploy lands on the next refresh.
  event.respondWith(
    url.pathname.startsWith('/vendor/') ? cacheFirst(event.request) : networkFirst(event.request)
  );
});
