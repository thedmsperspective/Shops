// Offline support. Bump VERSION when publishing an update.
const VERSION = 'shops-v6';
const FILES = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'icon.svg', 'js/app.js', 'js/rules.js', 'js/names.js', 'js/srd-shops.js', 'js/player.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES).then(() => c.add('/core/suite.js').catch(() => {}))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x.startsWith('shops-') && x !== VERSION).map(x => caches.delete(x)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  const core = new URL(e.request.url).pathname.startsWith('/core/');
  e.respondWith(fetch(e.request, core ? { cache: 'no-cache' } : {}).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
