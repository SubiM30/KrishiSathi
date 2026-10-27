/**
 * KrishiSathi service worker — makes the app a PWA:
 *   • installable on the phone's home screen
 *   • the interface (HTML/CSS/JS) loads offline
 *   • live data (API calls) still requires a connection — offline you
 *     get the offline page with a graceful explanation
 *
 * Strategy:
 *   - app shell (static files)  → cache-first (instant loads)
 *   - third-party assets         → cache-first (fonts + the Lucide icon
 *                                  library, so icons work offline too)
 *   - page navigations           → network-first, fall back to cache/offline
 *   - /api/*                     → always network (never cache live prices)
 *
 * ► Bump CACHE whenever you change any cached file.
 */
const CACHE = 'krishisathi-v19';

const SHELL = [
  '/',
  '/index.html',
  '/offline.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/i18n.js',
  '/js/views.js',
  '/js/icons.js',
  '/js/api.js',
  '/js/auth.js',
  '/js/data.js',
  '/js/store.js',
  '/js/sheet.js',
  '/js/firebase-config.js',
  '/assets/farm-hero.svg',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

/* Third-party assets we cache so the UI (and its icons/fonts) survive offline. */
const CDN_HOSTS = ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(async (cache) => {
        await cache.addAll(SHELL).catch(() => {});
        // best-effort: pull the icon library in now so it is ready offline
        await Promise.allSettled(
          [
            'https://unpkg.com/lucide@1.58.0/dist/umd/lucide.js',
          ].map((u) => cache.add(new Request(u, { mode: 'cors' })).catch(() => {}))
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // POSTs (chat, diagnosis) always go to network

  const url = new URL(req.url);

  /* Third-party (fonts, Lucide): stale-while-revalidate. */
  if (url.origin !== location.origin) {
    if (CDN_HOSTS.some((h) => url.host.endsWith(h))) {
      event.respondWith(
        caches.match(req).then((hit) => {
          const refresh = fetch(req)
            .then((res) => {
              if (res && (res.ok || res.type === 'opaque')) {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
              }
              return res;
            })
            .catch(() => hit);
          return hit || refresh;
        })
      );
    }
    return;
  }

  if (url.pathname.startsWith('/api/')) return; // live data — never cached

  // Page navigations: network first, cache/offline as fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then((hit) => hit || caches.match('/index.html'))
            .then((hit) => hit || caches.match('/offline.html'))
        )
    );
    return;
  }

  /* Static files: stale-while-revalidate —
     serve the cached copy instantly, but fetch a fresh copy in the
     background and update the cache. */
  event.respondWith(
    caches.match(req).then((hit) => {
      const refresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || refresh;
    })
  );
});
