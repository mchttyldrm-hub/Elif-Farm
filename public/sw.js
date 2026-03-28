// ============================================================
// Service Worker — Elif Farm
// Push bildirimleri + offline fallback
// ============================================================

const CACHE_NAME = 'elif-farm-v1';
const SHELL_ASSETS = ['/','  /css/main.css', '/js/api.js', '/js/app.js'];

// Kurulumda shell asset'leri cache'le
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first fetch stratejisi (API'ye cache uygulanmaz)
self.addEventListener('fetch', event => {
  if (event.request.url.includes('/api/')) return; // API istekleri pass-through

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then(r => r ?? caches.match('/'))
    )
  );
});

// Web Push bildirimi al
self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Elif Farm', body: event.data.text(), url: '/' };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Elif Farm', {
      body:  payload.body ?? '',
      icon:  '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data:  { url: payload.url ?? '/' },
    })
  );
});

// Bildirime tıklandığında ilgili sayfayı aç
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(list => {
      const existing = list.find(c => c.url === url);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
