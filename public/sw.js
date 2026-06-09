// ortho-v4：每次更新版本號可強制清除舊快取
const CACHE = 'ortho-v4';

// 預快取的靜態資源（不含 JS/CSS，改用 network-first）
const PRECACHE = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Install：預快取圖示等不常變的資源 ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ── Activate：清除所有舊版 cache ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => {
        console.log('[SW] deleting old cache:', k);
        return caches.delete(k);
      }))
    )
  );
  self.clients.claim();
});

// ── Fetch ──
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // 1. API 請求：完全不攔截，直接走網路
  if (url.includes('/api/')) return;

  // 2. Auth redirect（callback）：不攔截
  if (url.includes('/api/auth/')) return;

  // 3. JS / CSS：network-first（永遠取最新版）
  if (/\.(js|css)(\?|$)/.test(url)) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 4. HTML（頁面）：network-first
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request) || caches.match('/'))
    );
    return;
  }

  // 5. 其他靜態資源（圖示等）：cache-first
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
