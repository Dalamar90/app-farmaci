// service-worker.js — cache offline (PWA).
// Strategia: "cache first" sui file dell'app, così funziona senza rete.
// Aumenta CACHE_VERSION quando modifichi i file per forzare l'aggiornamento.

const CACHE_VERSION = 'farmaci-v16';

const ASSETS = [
  'index.html',
  'css/style.css',
  'fonts/space-grotesk.woff2',
  'lib/chart.umd.min.js',
  'js/app.js',
  'js/nav.js',
  'js/db.js',
  'js/ui.js',
  'js/util.js',
  'js/icons.js',
  'js/defaults.js',
  'js/stats.js',
  'js/reminders.js',
  'js/ics.js',
  'js/exportImport.js',
  'js/views/day.js',
  'js/views/chart.js',
  'js/views/diary.js',
  'js/views/stats.js',
  'js/views/settings.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  // Non intercettare richieste verso altri domini (es. Google Drive/accounts):
  // devono passare dirette alla rete, senza cache.
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((resp) => {
          // Metti in cache le richieste riuscite, per usi futuri offline.
          if (resp && resp.status === 200) {
            const copy = resp.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return resp;
        })
        .catch(() => {
          // Offline: per le navigazioni (es. apertura dell'app senza rete)
          // serviamo la pagina dell'app dalla cache.
          if (request.mode === 'navigate') return caches.match('index.html');
          return Response.error();
        });
    }),
  );
});

// Tocco su una notifica di promemoria: apri/porta in primo piano l'app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) {
        client.postMessage({ type: 'open-checkin' });
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow('index.html');
  })());
});
