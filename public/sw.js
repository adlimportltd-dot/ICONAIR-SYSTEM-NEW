// Service Worker — רק להתראות Web Push (לא offline caching של האפליקציה
// עצמה, שכבר עובדת בלי SW דרך offlineQueue.js/localStorage — ר' App.jsx).
// היקף מכוון וצר: push + notificationclick, שום דבר אחר.

self.addEventListener('push', (event) => {
  let data = { title: 'ICON AIR', body: '', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // מטען לא-JSON (לא אמור לקרות, /api/send-push תמיד שולח JSON) — עדיין מציגים משהו במקום לא להציג כלום
    data.body = event.data?.text() || '';
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      dir: 'rtl',
      lang: 'he',
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = clientsList.find((c) => c.url.includes(self.location.origin));
      if (existing) {
        existing.focus();
        existing.navigate?.(targetUrl);
      } else {
        self.clients.openWindow(targetUrl);
      }
    })()
  );
});
