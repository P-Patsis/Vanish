// Vanish service worker: lets the app install and start without a network.
//  - this site's files: network first (so an update arrives at once), the cached copy when offline
//  - the segmentation runtime and model (big, versioned URLs): cache first, so they download only once
const VERSION = 'vn-31658a7b';
const HEAVY_CACHE = 'vn-heavy';           // the ~9 MB runtime lives in its own cache, so a site update never makes it download again
const SHELL = ['./', 'index.html', 'css/style.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/main.js', 'js/bg.js', 'js/engine.js', 'js/seg.js', 'js/capture.js', 'js/gif.js', 'js/util.js', 'js/pwa.js'];
const HEAVY = ['https://cdn.jsdelivr.net/npm/@mediapipe/', 'https://storage.googleapis.com/mediapipe-models/'];

self.addEventListener('install', e => {
  // 'reload' = fetch from the server, never the browser's HTTP cache, so the precache cannot capture a stale file
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: 'reload' }))))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== HEAVY_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = req.url;
  if (HEAVY.some(p => url.startsWith(p))) {
    e.respondWith(caches.open(HEAVY_CACHE).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  if (new URL(url).origin !== self.location.origin) return;
  // 'no-cache' = ask the server whether the file changed, so the page, its scripts and its styles are never a mix of two releases
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req).then(r => r || caches.match('index.html'))));
});
