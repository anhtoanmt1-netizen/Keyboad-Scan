/* Service Worker – cache để chạy offline. Dùng đường dẫn tương đối (hợp với GitHub Pages project path). */
const CACHE = 'inventory-scanner-v1';
const LOCAL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'assets/icon-192.png', 'assets/icon-512.png'];
const CDN = [
  'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js',
  'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(LOCAL);
    await Promise.all(CDN.map((u) => c.add(u).catch(() => {}))); // CDN lỗi không làm hỏng cài đặt
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Cache-first, cập nhật nền (stale-while-revalidate)
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => { if (r && r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  })());
});
