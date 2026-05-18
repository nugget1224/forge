const CACHE = 'forge-v28';
const SHELL = [
  '/',
  '/calories.html',
  '/fitness.html',
  '/meals.html',
  '/plants.html',
  '/draft.html',
  '/settings.html',
  '/commander.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // API calls: network only, never cache
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request));
    return;
  }

  // HTML pages: stale-while-revalidate — serve cache instantly, refresh in background
  const isHTML = url.pathname === '/' || url.pathname.endsWith('.html');
  if (isHTML) {
    e.respondWith(
      caches.open(CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          const networkFetch = fetch(e.request).then(resp => {
            cache.put(e.request, resp.clone());
            return resp;
          }).catch(() => null);
          // Return cached instantly if available; otherwise wait for network
          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // Other assets (JS libs, fonts, etc): cache first, fall back to network
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return resp;
    }))
  );
});
