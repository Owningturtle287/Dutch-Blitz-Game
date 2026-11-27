const scope = self.registration.scope;
const CACHE_PREFIX = `overcurrent:${scope}:`;
const CACHE = `${CACHE_PREFIX}local-v1`;
const APP_FILES = [
  './', './index.html', './style.css', './engine.js', './main.js', './manifest.webmanifest',
  './assets/zap.svg', './assets/waves.svg', './assets/flame.svg', './assets/leaf.svg',
  './assets/card-art.svg', './assets/walnut-table.webp', './assets/card-hand.webp',
  './assets/icon-192.png', './assets/icon-512.png', './assets/LUCIDE-LICENSE.txt',
];
const appUrls = new Set(APP_FILES.map(path => new URL(path, scope).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(APP_FILES.map(path => new Request(new URL(path, scope), { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  url.search = '';
  url.hash = '';
  if (!appUrls.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(url.href)) ?? fetch(request);
  })());
});
