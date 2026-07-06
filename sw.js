/* Food & Symptom Tracker — offline service worker.
 * Strategy:
 *  - Navigations (the app page itself): network-first, so deployed updates
 *    arrive on next launch; falls back to the cached copy when offline.
 *  - Static assets (icons, manifest, fonts): stale-while-revalidate.
 * All user data lives in localStorage/IndexedDB on the device — the SW only
 * caches the app shell.
 */
const VERSION = 'v2';
const SHELL_CACHE = 'fst-shell-' + VERSION;
const ASSET_CACHE = 'fst-assets-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(ASSET_CACHE).then((cache) =>
        cache.addAll([
          './manifest.webmanifest',
          './icons/icon-192.png',
          './icons/icon-512.png',
          './icons/icon-512-maskable.png'
        ]).catch(() => {}) // icons missing must not brick install
      ),
      // Precache the app page itself: a user who installs on first visit and
      // next opens offline used to get a network error (nothing had populated
      // SHELL_CACHE yet).
      caches.open(SHELL_CACHE).then((cache) => cache.add('./').catch(() => {}))
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith('fst-') && k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // App page: network-first with cache fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // never cache an error page as the app shell — a transient 404/500
          // would otherwise be served on every offline launch
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((hit) => hit || caches.match('./'))
        )
    );
    return;
  }

  // Static assets + fonts: stale-while-revalidate
  const url = new URL(req.url);
  const cacheable =
    url.origin === self.location.origin ||
    url.hostname === 'fonts.googleapis.com' ||
    url.hostname === 'fonts.gstatic.com';
  if (!cacheable) return;

  event.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(ASSET_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || refresh;
    })
  );
});
