const CACHE_NAME = 'reborn-shell-v84';
const ICON_CACHE_NAME = 'reborn-bungie-icons-v1';
const SHELL_PRECACHE = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== ICON_CACHE_NAME)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Cache-first for immutable Bungie Destiny 2 gear/emblem icons (huge mobile speed boost!)
  if (url.hostname === 'www.bungie.net' && url.pathname.startsWith('/common/destiny2_content/icons/')) {
    event.respondWith(
      caches.open(ICON_CACHE_NAME).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((res) => {
            if (res && (res.ok || res.type === 'opaque')) {
              cache.put(req, res.clone()).catch(() => {});
            }
            return res;
          });
        })
      )
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Navigation / HTML: network-first so updates land immediately, fallback to cache if offline
  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
    );
    return;
  }

  // Immutable versioned JS/CSS, audio SFX, and icons: cache-first
  const isCacheableStatic =
    url.searchParams.has('v') ||
    url.pathname.startsWith('/sfx/') ||
    url.pathname.startsWith('/icon-') ||
    url.pathname === '/manifest.json';

  if (isCacheableStatic) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        });
      })
    );
  }
});
