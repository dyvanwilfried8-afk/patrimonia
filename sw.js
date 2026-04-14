// ⚠️ Changer la version force le navigateur à vider l'ancien cache
const CACHE = 'patrimonia-v3';

self.addEventListener('install', e => {
  // Vider TOUS les anciens caches au démarrage
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;
  if (e.request.method !== 'GET') return;
  if (url.includes('googleapis.com') || url.includes('coingecko.com')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', {status:503})));
    return;
  }
  // Network first — toujours récupérer la dernière version
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
