/* Service worker: cachea la app completa para uso sin conexión.
   Suba el número de CACHE cada vez que edite index.html, styles.css o app.js. */
const CACHE = 'calendario-tec-v1';

const RECURSOS = [
  '.',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'data/calendario-tec.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(RECURSOS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(claves => Promise.all(claves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Peticiones a otros dominios (p. ej. buscar actualizaciones): siempre a la red.
  if (url.origin !== location.origin) return;

  // El archivo de datos usa "red primero" para que una copia nueva se note enseguida.
  if (url.pathname.endsWith('calendario-tec.json')) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copia = res.clone();
          caches.open(CACHE).then(c => c.put(req, copia));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Resto del shell: caché primero, con actualización en segundo plano.
  e.respondWith(
    caches.match(req).then(hit => {
      const red = fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copia = res.clone();
            caches.open(CACHE).then(c => c.put(req, copia));
          }
          return res;
        })
        .catch(() => hit);
      return hit || red;
    })
  );
});
