// ⚠️ Changer la version force le navigateur à vider l'ancien cache
const CACHE = 'patrimonia-v6';

// Fichiers à mettre en cache au premier chargement
const PRECACHE = [
  './',
  './index.html',
  './dashboard.html',
  './app.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    // Supprimer TOUS les anciens caches
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => caches.open(CACHE))
      .then(cache => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Ignorer les requêtes non-HTTP
  if (!url.startsWith('http://') && !url.startsWith('https://')) return;
  if (e.request.method !== 'GET') return;

  // APIs externes : réseau uniquement, fallback 503 propre
  if (
    url.includes('googleapis.com') ||
    url.includes('coingecko.com') ||
    url.includes('supabase.co') ||
    url.includes('cdn.jsdelivr.net') ||
    url.includes('fonts.googleapis.com') ||
    url.includes('fonts.gstatic.com')
  ) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Fichiers locaux : Network First
  // → Toujours essayer le réseau en premier (pour avoir la dernière version)
  // → Si hors-ligne, utiliser le cache
  // → Si pas dans le cache non plus, retourner une réponse 503 propre (jamais undefined)
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Mettre à jour le cache avec la nouvelle version
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(e.request).then(cached => {
          if (cached) return cached;
          // Fallback HTML pour navigation offline
          if (e.request.headers.get('accept')?.includes('text/html')) {
            return new Response(
              '<html><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0b0b0f;color:#f0f2f5;">' +
              '<h2>📡 Hors-ligne</h2><p>Reconnectez-vous pour accéder à Patrimonia.</p>' +
              '<button onclick="location.reload()" style="margin-top:16px;padding:10px 20px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;">Réessayer</button>' +
              '</body></html>',
              { status: 503, headers: { 'Content-Type': 'text/html' } }
            );
          }
          // Pour JS/CSS/autres : réponse vide mais valide (jamais undefined)
          return new Response('', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          });
        })
      )
  );
});
