# Prompt 42 — Notification System: Frontend

## Goal

Add the notification bell icon to the platform header, a dropdown showing recent notifications, mark-as-read functionality, service worker registration for push notifications, and push permission flow.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

**Prerequisites:** Prompt 41 (notification backend) must be completed.

---

## Step 1 — Bell icon in platform headers

Add a notification bell to the header bar on every page. The bell shows an unread count badge and opens a dropdown on click.

### 1a. Update all module header JS files

In each header JS file (`logistics/logistics-header.js`, `jobs/jobs-header.js`, `production/production-header.js`), find the user bar area (where the username and Sign Out link are rendered).

Add the bell icon BEFORE the username display:

```html
<div class="notif-bell-wrap" style="position:relative;cursor:pointer;" id="hdr-notif-bell" onclick="toggleNotifDropdown()">
  <span style="font-size:18px;">🔔</span>
  <span id="hdr-notif-badge" style="display:none;position:absolute;top:-4px;right:-6px;background:#dc2626;color:#fff;font-size:9px;font-weight:700;border-radius:50%;width:16px;height:16px;text-align:center;line-height:16px;"></span>
</div>
<div id="hdr-notif-dropdown" style="display:none;position:absolute;top:36px;right:0;width:340px;max-height:420px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.12);overflow:hidden;z-index:9999;">
  <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #e5e7eb;">
    <span style="font-weight:700;font-size:14px;">Notifications</span>
    <button onclick="markAllRead()" style="background:none;border:none;color:#3b82f6;font-size:12px;font-weight:600;cursor:pointer;">Mark all read</button>
  </div>
  <div id="hdr-notif-list" style="overflow-y:auto;max-height:360px;"></div>
</div>
```

Make sure the parent container has `position:relative` so the dropdown positions correctly.

### 1b. For the homepage (`index.html`)

Add the same bell + dropdown to the user bar div (the fixed top-right element).

### 1c. For admin pages

Add the bell to each admin page's header area (`admin/parts.html`, `admin/activity-log.html`, `admin/users.html`, `admin/roles.html`).

---

## Step 2 — Notification fetching and rendering

Add to each header JS file (and to homepage/admin scripts):

```javascript
let notifDropdownOpen = false;

async function loadNotifications() {
  try {
    const res = await fetch('/api/notifications');
    const data = await res.json();
    if (!data.ok) return;

    // Update badge
    const badge = document.getElementById('hdr-notif-badge');
    if (badge) {
      if (data.unreadCount > 0) {
        badge.textContent = data.unreadCount > 99 ? '99+' : data.unreadCount;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }

    // Render list
    const list = document.getElementById('hdr-notif-list');
    if (!list) return;

    if (!data.notifications.length) {
      list.innerHTML = '<div style="padding:24px;text-align:center;color:#9ca3af;font-size:13px;">No notifications</div>';
      return;
    }

    list.innerHTML = data.notifications.map(n => `
      <div class="notif-item" style="padding:10px 14px;border-bottom:1px solid #f3f4f6;cursor:pointer;${n.is_read ? 'opacity:0.6;' : 'background:#eff6ff;'}" onclick="handleNotifClick('${n.id}', '${n.entity_type}', '${n.entity_id}')">
        <div style="font-size:13px;font-weight:${n.is_read ? '400' : '600'};color:#111827;margin-bottom:2px;">${escHtml(n.title)}</div>
        <div style="font-size:12px;color:#6b7280;">${escHtml(n.message)}</div>
        <div style="font-size:10px;color:#9ca3af;margin-top:4px;">${formatTimeAgo(n.created_at)}</div>
      </div>
    `).join('');
  } catch {}
}

function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

function formatTimeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ago';
}

function toggleNotifDropdown() {
  notifDropdownOpen = !notifDropdownOpen;
  document.getElementById('hdr-notif-dropdown').style.display = notifDropdownOpen ? '' : 'none';
  if (notifDropdownOpen) loadNotifications();
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const bell = document.getElementById('hdr-notif-bell');
  const dropdown = document.getElementById('hdr-notif-dropdown');
  if (bell && dropdown && !bell.contains(e.target) && !dropdown.contains(e.target)) {
    notifDropdownOpen = false;
    dropdown.style.display = 'none';
  }
});

async function markAllRead() {
  await fetch('/api/notifications/read', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ all: true }),
  });
  loadNotifications();
}

function handleNotifClick(notifId, entityType, entityId) {
  // Mark as read
  fetch('/api/notifications/read', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [notifId] }),
  });

  // Navigate based on entity type
  if (entityType === 'loading_assignment') {
    window.location.href = '/logistics/loading.html';
  }

  toggleNotifDropdown();
}

// Poll for new notifications every 60 seconds
setInterval(() => {
  if (!notifDropdownOpen) loadNotifications();
}, 60000);

// Initial load
loadNotifications();
```

---

## Step 3 — Service worker for push notifications

Create `sw.js` at the project root:

```javascript
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
      // If a window is already open, focus it and navigate
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Otherwise open a new window
      return clients.openWindow(url);
    })
  );
});
```

---

## Step 4 — Service worker registration and push subscription

Add to each module header JS file, in the `DOMContentLoaded` block:

```javascript
// Register service worker and manage push subscription
async function initPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');

    // Check if already subscribed
    const existingSub = await reg.pushManager.getSubscription();
    if (existingSub) return; // Already subscribed

    // Get VAPID public key
    const vapidRes = await fetch('/api/push/vapid-public-key');
    const vapidData = await vapidRes.json();
    if (!vapidData.ok || !vapidData.key) return;

    // Request permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    // Subscribe
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidData.key),
    });

    // Send subscription to server
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    });
  } catch (e) {
    console.error('Push notification setup failed:', e);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

// Initialize after auth check completes
setTimeout(initPushNotifications, 3000);
```

---

## Step 5 — Ensure service worker is served correctly

In `_worker.js`, the service worker file needs to be served from the root path with the correct headers. The session gate must allow it through without auth (like the login page):

Add to the auth bypass section (near the login page bypass):

```javascript
if (url.pathname === "/sw.js") {
  return env.ASSETS.fetch(request);
}
```

Also add to the static asset bypass:

```javascript
if (url.pathname === "/manifest.json") {
  return env.ASSETS.fetch(request);
}
```

---

## Step 6 — PWA manifest (if not already present)

Create `manifest.json` at the project root:

```json
{
  "name": "xPanda Operations Platform",
  "short_name": "xPanda Ops",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f0f2f5",
  "theme_color": "#1e293b",
  "icons": [
    {
      "src": "/logo/xpanda.png",
      "sizes": "192x192",
      "type": "image/png"
    }
  ]
}
```

Add to `index.html` and `login.html` `<head>`:
```html
<link rel="manifest" href="/manifest.json">
```

---

## What NOT to touch

- Do NOT modify `_worker.js` API handlers beyond adding the sw.js/manifest.json bypass and the VAPID public key endpoint
- Do NOT modify the Loading Dashboard frontend
- Do NOT modify the job board
- Do NOT modify the BOL generator or load builder
- Do NOT modify business logic

---

## Completion checklist

- [ ] Bell icon with unread count badge added to ALL module headers + homepage + admin pages
- [ ] Notification dropdown: shows recent notifications, unread highlighted, mark-all-read button
- [ ] Clicking a notification marks it read and navigates to the relevant page
- [ ] Notifications poll every 60 seconds for updates
- [ ] `sw.js` service worker created at project root
- [ ] Service worker handles push events and notification clicks
- [ ] Service worker registered on page load (after auth check)
- [ ] Push subscription sent to `/api/push/subscribe`
- [ ] `sw.js` and `manifest.json` bypass the session gate
- [ ] `manifest.json` created with app name, colors, icon
- [ ] Manifest linked in `index.html` and `login.html`
- [ ] `urlBase64ToUint8Array` helper included for VAPID key conversion
- [ ] Close-on-outside-click works for dropdown (not the modal pattern)

**Notify Steve:** Run `notifications.sql` migration first (if not already done from Prompt 41). After deploying:
1. The bell icon appears in the header on all pages
2. In-app notifications appear when loading status changes
3. Browser will prompt "Allow notifications?" on first visit (after login)
4. For push to work, set VAPID env vars in Cloudflare Workers settings
5. Test: pull a job into loading → all users with notification roles see the bell badge update
