/* SoloTracker web — service worker: rede primeiro, cache como reserva (abre sem internet). */
const CACHE = 'solotracker-__BUILD__';
const V = '?v=__BUILD__';
const SHELL = [
  './',
  ...['styles.css', 'web.css', 'web-api.js', 'i18n.js', 'timeline.js', 'app.js', 'mobile.js', 'manifest.webmanifest'].map((f) => f + V),
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('solotracker-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // YouTube etc. passam direto
  e.respondWith(
    // Navegação vai como veio (mudar o pedido quebraria redirecionamentos); o resto sempre revalida.
    fetch(req.mode === 'navigate' ? req : new Request(req, { cache: 'no-cache' }))
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : undefined)).then((r) => r || Response.error()),
      ),
  );
});
