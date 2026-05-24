const path = window.location.pathname;

const isDashboard =
  path === "/logistics/" ||
  path === "/logistics/index.html";

// NOTE: document.write() is used here for legacy compatibility.
// Future refactor: switch to DOMContentLoaded + insertAdjacentHTML.
document.write(`

<header class="topbar">

    <a href="/" aria-label="Back to Operations Platform">
        <img src="/logo/xpanda.png" alt="xPanda Logo" class="logo">
    </a>

    <div class="header-center">

        <a href="/logistics/" class="badge logistics-badge" title="Back to Logistics">
            XPANDA FOAM • LOGISTICS
        </a>

        <h1 id="logistics-page-title">Logistics</h1>
        <p id="logistics-page-subtitle">Inbound deliveries and outbound shipments</p>

    </div>

    <div class="header-user-bar" style="position:absolute;top:10px;right:16px;font-size:12px;color:#5b6472;display:flex;align-items:center;gap:8px;">
      <a href="/logistics/loading.html" style="color:#1e293b;text-decoration:none;font-weight:600;font-size:11px;padding:4px 8px;background:#f1f5f9;border-radius:6px;">Loading</a>
      <span id="hdr-notif-bell" onclick="toggleNotifDropdown()" style="position:relative;cursor:pointer;font-size:18px;line-height:1;">🔔<span id="hdr-notif-badge" style="display:none;position:absolute;top:-4px;right:-6px;background:#dc2626;color:#fff;font-size:9px;font-weight:700;border-radius:50%;width:16px;height:16px;text-align:center;line-height:16px;"></span></span>
      <div id="hdr-notif-dropdown" style="display:none;position:absolute;top:36px;right:0;width:340px;max-height:420px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.12);overflow:hidden;z-index:9999;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #e5e7eb;">
          <span style="font-weight:700;font-size:14px;">Notifications</span>
          <button onclick="markAllRead()" style="background:none;border:none;color:#3b82f6;font-size:12px;font-weight:600;cursor:pointer;">Mark all read</button>
        </div>
        <div id="hdr-notif-list" style="overflow-y:auto;max-height:360px;"></div>
      </div>
      <span id="hdr-user-name"></span>
      <a href="#" id="hdr-logout" style="color:#dc2626;text-decoration:none;font-weight:600;">Sign Out</a>
    </div>

</header>

`);

window.addEventListener("DOMContentLoaded", () => {

  const footer = document.createElement("footer");
  footer.className = "logistics-platform-footer";
  footer.innerHTML = `<a href="/">← Back to Operations Platform</a>`;
  document.body.appendChild(footer);

  // 401 handler
  const _origFetch = window.fetch;
  window.fetch = async function(...args) {
    const res = await _origFetch.apply(this, args);
    if (res.status === 401 && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login.html';
      return res;
    }
    return res;
  };

  fetch('/api/auth/me').then(r => r.json()).then(d => {
    window.__xpandaUser = d.ok ? d.user : null;
    if (d.ok && d.user) {
      const el = document.getElementById('hdr-user-name');
      if (el) el.textContent = d.user.displayName || d.user.username;
    }
  }).catch(() => { window.__xpandaUser = null; });

  document.getElementById('hdr-logout')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  // Notification bell
  let notifDropdownOpen = false;

  window.toggleNotifDropdown = function() {
    notifDropdownOpen = !notifDropdownOpen;
    document.getElementById('hdr-notif-dropdown').style.display = notifDropdownOpen ? '' : 'none';
    if (notifDropdownOpen) loadNotifications();
  };

  document.addEventListener('click', (e) => {
    const bell = document.getElementById('hdr-notif-bell');
    const dropdown = document.getElementById('hdr-notif-dropdown');
    if (bell && dropdown && !bell.contains(e.target) && !dropdown.contains(e.target)) {
      notifDropdownOpen = false;
      dropdown.style.display = 'none';
    }
  });

  window.markAllRead = async function() {
    await fetch('/api/notifications/read', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    loadNotifications();
  };

  window.handleNotifClick = function(notifId, entityType, entityId) {
    fetch('/api/notifications/read', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [notifId] }),
    });
    if (entityType === 'loading_assignment') window.location.href = '/logistics/loading.html';
    notifDropdownOpen = false;
    const dd = document.getElementById('hdr-notif-dropdown');
    if (dd) dd.style.display = 'none';
  };

  async function loadNotifications() {
    try {
      const res = await fetch('/api/notifications');
      const data = await res.json();
      if (!data.ok) return;

      const badge = document.getElementById('hdr-notif-badge');
      if (badge) {
        if (data.unreadCount > 0) {
          badge.textContent = data.unreadCount > 99 ? '99+' : data.unreadCount;
          badge.style.display = '';
        } else {
          badge.style.display = 'none';
        }
      }

      const list = document.getElementById('hdr-notif-list');
      if (!list) return;

      if (!data.notifications.length) {
        list.innerHTML = '<div style="padding:24px;text-align:center;color:#9ca3af;font-size:13px;">No notifications</div>';
        return;
      }

      list.innerHTML = data.notifications.map(n => `
        <div class="notif-item" style="padding:10px 14px;border-bottom:1px solid #f3f4f6;cursor:pointer;${n.is_read ? 'opacity:0.6;' : 'background:#eff6ff;'}" onclick="handleNotifClick('${n.id}', '${n.entity_type}', '${n.entity_id}')">
          <div style="font-size:13px;font-weight:${n.is_read ? '400' : '600'};color:#111827;margin-bottom:2px;">${escNotif(n.title)}</div>
          <div style="font-size:12px;color:#6b7280;">${escNotif(n.message)}</div>
          <div style="font-size:10px;color:#9ca3af;margin-top:4px;">${formatTimeAgo(n.created_at)}</div>
        </div>
      `).join('');
    } catch {}
  }

  function escNotif(s) {
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
    return Math.floor(hrs / 24) + 'd ago';
  }

  // Poll for notifications every 60 seconds
  setInterval(() => { if (!notifDropdownOpen) loadNotifications(); }, 60000);
  loadNotifications();

  // Service worker + push notifications
  async function initPushNotifications() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      const existingSub = await reg.pushManager.getSubscription();
      if (existingSub) return;

      const vapidRes = await fetch('/api/push/vapid-public-key');
      const vapidData = await vapidRes.json();
      if (!vapidData.ok || !vapidData.key) return;

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.key),
      });

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

  setTimeout(initPushNotifications, 3000);

});
