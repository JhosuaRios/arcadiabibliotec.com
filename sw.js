const CACHE = 'arcadia-web-155-gba-persistence';
const FILES = ['./', './index.html', './Arcadia.html', './renderer.js', './web-bridge.js', './online.js', './firebase-online.js', './manifest.webmanifest', './vendor/jsnes.min.js', './art/super-mario-bros.svg', './art/cover-super-mario-bros.webp', './art/cover-super-mario-bros-2.webp', './art/cover-super-mario-bros-3.webp', './art/cover-the-legend-of-zelda.webp', './art/cover-tetris.webp', './art/arcadia-icon.svg', './art/platform-nes.png', './art/platform-gba.png', './art/cover-pokemon-ruby.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('arcadia-web-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
// Network-first: evita que el navegador siga usando un online.js antiguo en caché.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match(event.request)));
});
