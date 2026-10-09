// /shared/notif-bell.js — the ONE notification bell (notif-bell-01).
// Replaces the per-page copies (home page, shared-header.js, 4 admin pages) and is also loaded by
// the v2 PlatformHeader (cutting-pilot/src/components/NotificationBell.tsx), so legacy and /v2
// pages render the identical bell: the home page's outline SVG + badge + dropdown.
//
// Usage: put <span data-xp-notif-bell></span> where the bell goes and load this script. It
// auto-mounts every such slot (now + on DOMContentLoaded); window.XpNotifBell.mount(el) mounts
// one explicitly (v2). Plain <script src>, no modules, no globals beyond window.XpNotifBell.
//
// Visibility uses the `hidden` attribute, never style.display = '' — the old home-page bell's
// CSS class set display:none, so clearing the inline style re-hid the dropdown and badge
// (the "bell does nothing" bug).
//
// Push self-heal: a browser can hold a subscription the server no longer knows (VAPID keys
// rotated, or the row was deleted). The old code hid the "Enable push" banner whenever ANY
// subscription existed, so those users could never re-enable. Now: a subscription made with a
// different VAPID key is unsubscribed and the banner shown; a matching one is re-sent to
// /api/push/subscribe (deduped by endpoint server-side) at most every 10 min per tab.
(function () {
  if (window.XpNotifBell) return;

  var POLL_MS = 60000;
  var PUSH_RESYNC_MS = 10 * 60 * 1000;
  var PUSH_SYNC_KEY = 'xp_push_synced';

  var STRINGS = {
    en: {
      notifications: 'Notifications', markAllRead: 'Mark all read', noNotifications: 'No notifications',
      enablePush: 'Enable push notifications', enablePushSub: 'Tap to get alerts on this device',
      pushBlocked: 'Push notifications are blocked', pushBlockedSub: 'Allow notifications for this site in your browser settings',
      justNow: 'Just now', minsAgo: '{m}m ago', hoursAgo: '{h}h ago', daysAgo: '{d}d ago',
    },
    es: {
      notifications: 'Notificaciones', markAllRead: 'Marcar todo como leído', noNotifications: 'Sin notificaciones',
      enablePush: 'Activar notificaciones push', enablePushSub: 'Toca para recibir alertas en este dispositivo',
      pushBlocked: 'Las notificaciones push están bloqueadas', pushBlockedSub: 'Permite las notificaciones de este sitio en la configuración del navegador',
      justNow: 'Ahora mismo', minsAgo: 'hace {m}m', hoursAgo: 'hace {h}h', daysAgo: 'hace {d}d',
    },
    ht: {
      notifications: 'Notifikasyon', markAllRead: 'Make tout kòm li', noNotifications: 'Pa gen notifikasyon',
      enablePush: 'Aktive notifikasyon push', enablePushSub: 'Tape pou resevwa alèt sou aparèy sa a',
      pushBlocked: 'Notifikasyon push yo bloke', pushBlockedSub: 'Pèmèt notifikasyon pou sit sa a nan paramèt navigatè a',
      justNow: 'Kounye a', minsAgo: 'sa fè {m}min', hoursAgo: 'sa fè {h}è', daysAgo: 'sa fè {d}j',
    },
  };

  // Same localStorage key as legacy i18n.js and v2 lib/i18n.ts.
  function lang() {
    var l = null;
    try { l = localStorage.getItem('xpanda_lang'); } catch (e) {}
    return STRINGS[l] ? l : 'en';
  }
  function t(key, vars) {
    var s = STRINGS[lang()][key] || STRINGS.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }
  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }
  function ago(iso) {
    var m = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (!(m >= 1)) return t('justNow');
    if (m < 60) return t('minsAgo', { m: m });
    var h = Math.floor(m / 60);
    if (h < 24) return t('hoursAgo', { h: h });
    return t('daysAgo', { d: Math.floor(h / 24) });
  }

  // entity_type -> deep-link URL builder (unchanged from the per-page copies).
  var DEEPLINKS = {
    loading_assignment: function (id) { return '/v2/logistics/loading?assignment=' + encodeURIComponent(id); },
    shipment: function (id) { return '/v2/logistics/loading?shipment=' + encodeURIComponent(id); },
    job: function (id) { return '/v2/board?job=' + encodeURIComponent(id); },
  };

  // var() fallbacks = light-theme tokens.css values, for pages that don't load tokens.css
  // (admin/*, safety/*); token pages (home, modules, /v2) get the real, theme-aware values.
  var CSS =
    '.xp-nb{position:relative;display:inline-flex;align-items:center;}' +
    '.xp-nb-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;background:none;border:none;padding:4px;margin:0;cursor:pointer;line-height:1;color:var(--muted,#4b5563);border-radius:6px;}' +
    '.xp-nb-btn:hover{color:var(--text,#111827);}' +
    '.xp-nb-btn:focus-visible{outline:2px solid var(--brand,var(--accent,#0f172a));outline-offset:2px;}' +
    '.xp-nb-badge{position:absolute;top:-2px;right:-4px;min-width:16px;height:16px;padding:0 3px;box-sizing:border-box;border-radius:8px;background:var(--danger-bg,#dc2626);color:var(--danger-text,#fff);font:700 9px/16px var(--font-sans,system-ui,sans-serif);text-align:center;}' +
    '.xp-nb[hidden],.xp-nb-badge[hidden],.xp-nb-dd[hidden],.xp-nb-push[hidden]{display:none;}' +
    '.xp-nb-dd{position:absolute;top:calc(100% + 8px);right:0;width:340px;max-height:420px;display:flex;flex-direction:column;background:var(--surface,#ffffff);color:var(--text,#111827);border:1px solid var(--line,#e5e7eb);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.12);overflow:hidden;z-index:9999;text-align:left;font-family:var(--font-sans,system-ui,sans-serif);}' +
    '.xp-nb-head{display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid var(--line,#e5e7eb);}' +
    '.xp-nb-title{font-weight:700;font-size:14px;}' +
    '.xp-nb-markall{background:none;border:none;color:var(--accent,#0f172a);font-size:12px;font-weight:600;cursor:pointer;padding:0;}' +
    '.xp-nb-push{padding:10px 14px;background:var(--accent-soft,#f1f5f9);border-bottom:1px solid var(--line,#e5e7eb);cursor:pointer;}' +
    '.xp-nb-push.is-blocked{cursor:default;}' +
    '.xp-nb-push-t{font-size:13px;font-weight:600;color:var(--accent,#0f172a);}' +
    '.xp-nb-push-s{font-size:11px;color:var(--muted,#4b5563);margin-top:2px;}' +
    '.xp-nb-list{overflow-y:auto;max-height:360px;}' +
    '.xp-nb-item{padding:10px 14px;border-bottom:1px solid var(--line,#e5e7eb);cursor:pointer;}' +
    '.xp-nb-item.is-unread{background:var(--accent-soft,#f1f5f9);}' +
    '.xp-nb-item.is-read{opacity:0.6;}' +
    '.xp-nb-item-t{font-size:13px;color:var(--text,#111827);margin-bottom:2px;}' +
    '.xp-nb-item.is-unread .xp-nb-item-t{font-weight:600;}' +
    '.xp-nb-item-m{font-size:12px;color:var(--muted,#4b5563);}' +
    '.xp-nb-item-a{font-size:10px;color:var(--text-hint,#9ca3af);margin-top:4px;}' +
    '.xp-nb-empty{padding:24px;text-align:center;color:var(--text-hint,#9ca3af);font-size:13px;}' +
    '@media (max-width:480px){.xp-nb-dd{position:fixed;top:56px;left:8px;right:8px;width:auto;}}';

  var BELL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';

  var roots = [];
  var lastData = null;
  var pushState = 'hidden'; // 'hidden' | 'enable' | 'blocked'
  var started = false;

  function injectCss() {
    if (document.getElementById('xp-nb-style')) return;
    var s = document.createElement('style');
    s.id = 'xp-nb-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  function liveRoots() {
    roots = roots.filter(function (r) { return r.isConnected; });
    return roots;
  }
  function q(root, sel) { return root.querySelector(sel); }

  function renderLabels(root) {
    q(root, '.xp-nb-btn').setAttribute('aria-label', t('notifications'));
    q(root, '.xp-nb-title').textContent = t('notifications');
    q(root, '.xp-nb-markall').textContent = t('markAllRead');
    var push = q(root, '.xp-nb-push');
    push.hidden = pushState === 'hidden';
    push.classList.toggle('is-blocked', pushState === 'blocked');
    push.setAttribute('role', pushState === 'enable' ? 'button' : 'note');
    push.tabIndex = pushState === 'enable' ? 0 : -1;
    q(root, '.xp-nb-push-t').textContent = pushState === 'blocked' ? t('pushBlocked') : t('enablePush');
    q(root, '.xp-nb-push-s').textContent = pushState === 'blocked' ? t('pushBlockedSub') : t('enablePushSub');
  }

  function renderData(root) {
    if (!lastData) return;
    var badge = q(root, '.xp-nb-badge');
    var n = lastData.unreadCount || 0;
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.hidden = n <= 0;
    var list = q(root, '.xp-nb-list');
    var items = lastData.notifications || [];
    if (!items.length) {
      list.innerHTML = '<div class="xp-nb-empty">' + esc(t('noNotifications')) + '</div>';
      return;
    }
    list.innerHTML = items.map(function (n) {
      return '<div class="xp-nb-item ' + (n.is_read ? 'is-read' : 'is-unread') + '" data-id="' + esc(n.id) +
        '" data-et="' + esc(n.entity_type) + '" data-eid="' + esc(n.entity_id) + '">' +
        '<div class="xp-nb-item-t">' + esc(n.title) + '</div>' +
        '<div class="xp-nb-item-m">' + esc(n.message) + '</div>' +
        '<div class="xp-nb-item-a">' + esc(ago(n.created_at)) + '</div></div>';
    }).join('');
  }

  function renderAll() {
    liveRoots().forEach(function (r) { renderLabels(r); renderData(r); });
  }

  function anyOpen() {
    return liveRoots().some(function (r) { return !q(r, '.xp-nb-dd').hidden; });
  }

  function setOpen(root, open) {
    q(root, '.xp-nb-dd').hidden = !open;
    q(root, '.xp-nb-btn').setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function closeAll() { liveRoots().forEach(function (r) { setOpen(r, false); }); }

  function load() {
    return fetch('/api/notifications', { credentials: 'same-origin' })
      .then(function (res) {
        if (res.status === 401) { liveRoots().forEach(function (r) { r.hidden = true; }); return null; }
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (!data || !data.ok) return;
        liveRoots().forEach(function (r) { r.hidden = false; });
        lastData = data;
        renderAll();
      })
      .catch(function () {});
  }

  function markRead(body) {
    return fetch('/api/notifications/read', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(function () {});
  }

  // ── Push ────────────────────────────────────────────────────────────────────────────────
  function b64ToBytes(base64String) {
    var padding = '='.repeat((4 - base64String.length % 4) % 4);
    var raw = atob((base64String + padding).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function sameBytes(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function getVapidKey() {
    return fetch('/api/push/vapid-public-key', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) { return d && d.ok && d.key ? d.key : null; });
  }
  function sendSub(sub) {
    return fetch('/api/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    }).then(function (r) {
      if (r.ok) { try { sessionStorage.setItem(PUSH_SYNC_KEY, sub.endpoint + '|' + Date.now()); } catch (e) {} }
      return r.ok;
    });
  }
  function recentlySynced(endpoint) {
    var v = null;
    try { v = sessionStorage.getItem(PUSH_SYNC_KEY); } catch (e) {}
    if (!v) return false;
    var i = v.lastIndexOf('|');
    return v.slice(0, i) === endpoint && Date.now() - Number(v.slice(i + 1)) < PUSH_RESYNC_MS;
  }
  function setPushState(s) { pushState = s; renderAll(); }

  function initPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return;
    if (Notification.permission === 'denied') { setPushState('blocked'); return; }
    navigator.serviceWorker.register('/sw.js')
      .then(function () { return navigator.serviceWorker.ready; })
      .then(function (reg) {
        return reg.pushManager.getSubscription().then(function (sub) {
          if (!sub || Notification.permission !== 'granted') { setPushState('enable'); return; }
          return getVapidKey().then(function (key) {
            var subKey = sub.options && sub.options.applicationServerKey;
            if (key && subKey && !sameBytes(new Uint8Array(subKey), b64ToBytes(key))) {
              // Made with an old VAPID key — the server can never push to it. Drop it, re-offer.
              return sub.unsubscribe().catch(function () {}).then(function () { setPushState('enable'); });
            }
            setPushState('hidden');
            if (!recentlySynced(sub.endpoint)) return sendSub(sub);
          });
        });
      })
      .catch(function (e) { console.error('Push init check failed:', e); });
  }

  function enablePush() {
    if (!('Notification' in window)) return;
    Notification.requestPermission().then(function (permission) {
      if (permission !== 'granted') { setPushState(permission === 'denied' ? 'blocked' : 'enable'); return; }
      return navigator.serviceWorker.ready.then(function (reg) {
        return getVapidKey().then(function (key) {
          if (!key) return;
          return reg.pushManager.getSubscription()
            .then(function (old) { return old ? old.unsubscribe().catch(function () {}) : null; })
            .then(function () {
              return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
            })
            .then(sendSub)
            .then(function (ok) { if (ok) setPushState('hidden'); });
        });
      });
    }).catch(function (e) { console.error('Push subscribe failed:', e); });
  }

  // ── Wiring ──────────────────────────────────────────────────────────────────────────────
  function startOnce() {
    if (started) return;
    started = true;
    document.addEventListener('click', function (e) {
      liveRoots().forEach(function (r) { if (!r.contains(e.target)) setOpen(r, false); });
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });
    setInterval(function () { if (!anyOpen() && liveRoots().length) load(); }, POLL_MS);
    load();
    setTimeout(initPush, 2000);
  }

  function mount(el) {
    if (!el || el.__xpNotifBell) return;
    el.__xpNotifBell = true;
    injectCss();
    el.classList.add('xp-nb');
    el.innerHTML =
      '<button type="button" class="xp-nb-btn" aria-haspopup="true" aria-expanded="false">' + BELL_SVG +
      '<span class="xp-nb-badge" hidden></span></button>' +
      '<div class="xp-nb-dd" hidden>' +
      '<div class="xp-nb-head"><span class="xp-nb-title"></span><button type="button" class="xp-nb-markall"></button></div>' +
      '<div class="xp-nb-push" hidden><div class="xp-nb-push-t"></div><div class="xp-nb-push-s"></div></div>' +
      '<div class="xp-nb-list"></div></div>';

    q(el, '.xp-nb-btn').addEventListener('click', function () {
      var open = q(el, '.xp-nb-dd').hidden;
      setOpen(el, open);
      if (open) { renderLabels(el); load(); }
    });
    q(el, '.xp-nb-markall').addEventListener('click', function () { markRead({ all: true }).then(load); });
    var push = q(el, '.xp-nb-push');
    push.addEventListener('click', function () { if (pushState === 'enable') enablePush(); });
    push.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && pushState === 'enable') { e.preventDefault(); enablePush(); }
    });
    q(el, '.xp-nb-list').addEventListener('click', function (e) {
      var item = e.target.closest && e.target.closest('.xp-nb-item');
      if (!item) return;
      markRead({ ids: [item.getAttribute('data-id')] });
      var build = DEEPLINKS[item.getAttribute('data-et')];
      var eid = item.getAttribute('data-eid');
      setOpen(el, false);
      if (build && eid && eid !== 'null' && eid !== 'undefined') window.location.href = build(eid);
      else load();
    });

    roots.push(el);
    renderLabels(el);
    renderData(el);
    startOnce();
  }

  function mountAll() {
    var slots = document.querySelectorAll('[data-xp-notif-bell]');
    for (var i = 0; i < slots.length; i++) mount(slots[i]);
  }

  window.XpNotifBell = { mount: mount, mountAll: mountAll };
  mountAll();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
})();
