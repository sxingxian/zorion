// Zorion service worker: keeps the app shell available offline.
// API responses are never cached, so votes, codes and locations stay off the device.
const SHELL = 'zorion-shell-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(['/', '/icon.svg', '/icon-192.png', '/manifest.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/')));
    return;
  }
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && url.pathname.startsWith('/assets/')) { const copy = res.clone(); caches.open(SHELL).then((cache) => cache.put(req, copy)); }
      return res;
    })),
  );
});
