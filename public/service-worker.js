const VERSION = 'v3';
const STATIC_CACHE = `eshq-static-${VERSION}`;
const RUNTIME_CACHE = `eshq-runtime-${VERSION}`;
const CORE_ASSETS = ['/', '/index.html'];

self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(STATIC_CACHE).then(c =>
      c.addAll(CORE_ASSETS.map(u => new Request(u, {cache: 'reload'})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => ![STATIC_CACHE, RUNTIME_CACHE].includes(k)).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
  
  // Notify clients when SW takes control
  evt.waitUntil(
    self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(clientsList => {
      for (const client of clientsList) {
        client.postMessage({type: 'SW_ACTIVE', version: VERSION});
      }
    })
  );
});

// Utility strategies
const fromNetwork = async (req, cacheName) => {
  const res = await fetch(req);
  if (cacheName && req.method === 'GET' && res.ok) {
    const cache = await caches.open(cacheName);
    cache.put(req, res.clone());
  }
  return res;
};

const fromCache = (req, cacheName) => caches.open(cacheName).then(c => c.match(req));

const staleWhileRevalidate = async (req, cacheName) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const net = fetch(req).then(res => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || net || Promise.reject('no-match');
};

// Heuristics to route requests
const isHTMLNav = req => req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
const isAPI = req => new URL(req.url).pathname.startsWith('/api/') || (req.headers.get('accept') || '').includes('application/json');
const isSameOrigin = req => new URL(req.url).origin === self.location.origin;
const isHashedAsset = url => /\.[0-9a-f]{8,}\.(?:js|css|png|jpg|svg|woff2?)$/i.test(url.pathname);

self.addEventListener('fetch', evt => {
  const req = evt.request;

  // 1) Always try network-first for HTML navigations to reflect latest app/UI
  if (isHTMLNav(req)) {
    evt.respondWith(
      fromNetwork(req, STATIC_CACHE)
        .catch(() => fromCache('/index.html', STATIC_CACHE))
    );
    return;
  }

  // 2) API/data -> network-first (update runtime cache), fallback to cache offline
  if (isAPI(req)) {
    evt.respondWith(
      fromNetwork(req, RUNTIME_CACHE)
        .catch(() => fromCache(req, RUNTIME_CACHE))
    );
    return;
  }

  // 3) Same-origin static assets
  if (isSameOrigin(req)) {
    const url = new URL(req.url);
    // Fingerprinted assets: cache-first (they'll change URL on deploy)
    if (isHashedAsset(url)) {
      evt.respondWith(fromCache(req, STATIC_CACHE).then(r => r || fromNetwork(req, STATIC_CACHE)));
      return;
    }
    // Everything else: stale-while-revalidate for snappy loads + silent refresh
    evt.respondWith(staleWhileRevalidate(req, STATIC_CACHE));
    return;
  }

  // 4) Third-party: network-first with fallback
  evt.respondWith(
    fetch(req).catch(() => fromCache(req, RUNTIME_CACHE))
  );
});

// Allow app to trigger immediate activation after update
self.addEventListener('message', evt => {
  if (evt.data === 'SKIP_WAITING') self.skipWaiting();
});