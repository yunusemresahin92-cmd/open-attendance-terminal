// Açık Personel Takip Terminali — çevrimdışı açılış için basit önbellek.
// Veriler (Firebase) önbelleğe alınmaz; yalnızca uygulama dosyaları saklanır.
const CACHE_PREFIX = 'personel-takip-';
// `npm run build` bu değeri tüm Vite çıktılarının listesiyle değiştirir (scripts/vite-precache.mjs).
const PRECACHE = /*__PRECACHE_MANIFEST__*/null;
const CACHE = `${CACHE_PREFIX}${PRECACHE ? PRECACHE.version : 'v5'}`;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const contentType = response => (response.headers && response.headers.get('content-type')) || '';
const isHtml = response => /^text\/html\b/i.test(contentType(response));
// Hosting'in "** -> /index.html" yönlendirmesi eksik dosya için HTML döndürür; bu yanıt varlık yerine saklanmaz.
const isAsset = response => !isHtml(response);

function requestFor(url) {
  return new Request(new URL(url, self.location.origin), { cache: 'reload' });
}

async function installShell() {
  const cache = await caches.open(CACHE);
  const indexResponse = await fetch(requestFor('./index.html'));
  if (!indexResponse.ok) throw new Error('Uygulama kabuğu indirilemedi.');
  const html = await indexResponse.text();
  const referenced = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)]
    .map(match => match[1])
    .filter(url => new URL(url, self.location.origin).origin === self.location.origin);
  const built = PRECACHE ? PRECACHE.assets.map(file => `./${file}`) : [];
  const urls = [...new Set([...SHELL, ...referenced, ...built].map(url => new URL(url, self.location.origin).href))];
  await cache.addAll(urls.map(requestFor));
}

self.addEventListener('install', event => {
  event.waitUntil(installShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Firebase, yazı tipleri vb. doğrudan ağdan.

  // Sayfa: önce ağ (yeni sürüm hemen gelsin), bağlantı yoksa önbellek.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then(response => {
        // Yalnızca HTML sayfa kabuğun yerine geçer (ör. yeni sekmede açılan görsel geçmez).
        if (response.ok && isHtml(response)) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy));
        }
        return response;
      })
      .catch(() => caches.match('./index.html')));
    return;
  }

  // Derlenmiş dosyalar adlarında sürüm özeti taşır: önce önbellek.
  if (url.pathname.includes('/assets/') || url.pathname.includes('/icons/')) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      if (response.ok && isAsset(response)) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
      return response;
    })));
  }
});
