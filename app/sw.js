// Einfacher Service Worker: App-Shell cachen, Daten-JSON network-first
const VERSION = 'esc-hitster-v14';
const SHELL = [
  './', 'index.html', 'css/style.css', 'js/app.js', 'js/data.js', 'js/player.js', 'js/settings.js', 'js/fireworks.js', 'js/ikonen.js',
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // YouTube, Flaggen usw. direkt aus dem Netz
  if (url.pathname.endsWith('.mp3')) return; // Safari verlangt für Audio Range-Antworten, die der Cache nicht liefert

  if (url.pathname.endsWith('.json')) {
    // Daten: network-first, Cache als Fallback (offline)
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || new Response('', { status: 404 }))));
    return;
  }

  // App-Shell: cache-first mit Aktualisierung im Hintergrund
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((cached) => {
    const net = fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => cached);
    return cached || net;
  }));
});
