// Bump this version every deploy — forces old cache to be deleted and fresh files fetched
const CACHE = 'sanctum-v6';

const SHELL = [
  './',
  './index.html',
  './auth.html',
  './folder.html',
  './deck.html',
  './stats.html',
  './settings.html',
  './duel.html',
  './leaderboard.html',
  './practice.html',
  './calendar.html',
  './icon.svg',
  './manifest.json'
];

// Install — pre-cache HTML shell only (JS/CSS fetched fresh every time)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

// Activate — nuke every old cache
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (!e.request.url.startsWith(self.location.origin)) return;

  const url = new URL(e.request.url);
  const ext = url.pathname.split('.').pop().toLowerCase();

  // ── Network-first for JS and CSS ──────────────────────────────
  // Always try the network so bug fixes land immediately.
  // Fall back to cache only when offline.
  if (ext === 'js' || ext === 'css') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // ── Cache-first for HTML, images, fonts, manifest ────────────
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
