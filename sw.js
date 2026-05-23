// xPanda Operations Platform — Service Worker for Push Notifications

self.addEventListener('push', (event) => {
  let data = { title: 'xPanda Ops', body: 'New notification' };

  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body || data.message || '',
    icon: '/logo/xpanda.png',
    badge: '/logo/xpanda.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/logistics/loading.html',
      type: data.type || '',
      entityType: data.entityType || '',
      entityId: data.entityId || '',
    },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'xPanda Ops', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/logistics/loading.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
