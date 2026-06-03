// /shared/shared-header.js — unified module header (F1a).
// Consumed by every module via /<module>/<module>-header.js (thin shims).
// TODO: replace document.write() with DOMContentLoaded + insertAdjacentHTML (deferred — separate refactor).

// ThemeManager — loaded from /shared/theme.js so homepage and all module pages share one mechanism.
if (!window.__xpandaThemeLoaded) {
  window.__xpandaThemeLoaded = true;
  document.write('<script src="/shared/theme.js"><\/script>');
}

// Auto-load companion shared modules.
if (!window.__xpandaSharedApiLoaded) {
  window.__xpandaSharedApiLoaded = true;
  document.write('<script src="/shared/shared-api.js"><\/script>');
}
if (!window.__xpandaSharedUtilsLoaded) {
  window.__xpandaSharedUtilsLoaded = true;
  document.write('<script src="/shared/shared-utils.js"><\/script>');
}
if (!window.__xpandaPhotoGalleryLoaded) {
  window.__xpandaPhotoGalleryLoaded = true;
  document.write('<script src="/shared/photo-gallery.js"><\/script>');
}

/* UI density mode (office | floor) — Prompt 86.
   One responsive codebase; floor mode bumps touch targets + type via CSS keyed on
   html[data-mode]. Auto-defaults by pointer/viewport, user-toggleable, remembered. */
(function initXpandaUiMode() {
  var KEY = 'xpanda-ui-mode';
  function autoMode() {
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return (coarse && window.innerWidth < 1024) ? 'floor' : 'office';
  }
  function apply(mode) {
    document.documentElement.setAttribute('data-mode', mode);
    if (window.__xpandaUpdateModeToggle) window.__xpandaUpdateModeToggle(mode);
  }
  window.__xpandaSetUiMode = function (mode) {
    try { localStorage.setItem(KEY, mode); } catch (e) {}
    apply(mode);
  };
  window.__xpandaGetUiMode = function () {
    return document.documentElement.getAttribute('data-mode') || 'office';
  };
  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  apply(saved || autoMode());
  if (!saved && window.matchMedia) {
    window.matchMedia('(pointer: coarse)').addEventListener('change', function () {
      var s = null; try { s = localStorage.getItem(KEY); } catch (e) {}
      if (!s) apply(autoMode());
    });
  }
})();

(function () {
  if (window.initXpandaHeader) return;

  // Private helpers — available to all closures inside this IIFE.
  function notifEsc(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
  }

  function notifFmtAgo(iso) {
    const m = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  window.initXpandaHeader = function (config) {
    const path = window.location.pathname;
    const isDashboard = path === config.dashboardPath || path === config.dashboardPath + 'index.html';

    // Bell + notification dropdown — only when showNotifications is true.
    const notifBellHtml = config.showNotifications ? `
      <span id="hdr-notif-bell" onclick="toggleNotifDropdown()" style="position:relative;cursor:pointer;font-size:18px;line-height:1;">🔔<span id="hdr-notif-badge" style="display:none;position:absolute;top:-4px;right:-6px;background:#dc2626;color:#fff;font-size:9px;font-weight:700;border-radius:50%;width:16px;height:16px;text-align:center;line-height:16px;"></span></span>
      <div id="hdr-notif-dropdown" style="display:none;position:absolute;top:36px;right:0;width:340px;max-height:420px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.12);overflow:hidden;z-index:9999;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #e5e7eb;">
          <span style="font-weight:700;font-size:14px;">Notifications</span>
          <button onclick="markAllRead()" style="background:none;border:none;color:#3b82f6;font-size:12px;font-weight:600;cursor:pointer;">Mark all read</button>
        </div>
        <div id="hdr-push-banner" style="display:none;padding:10px 14px;background:#eff6ff;border-bottom:1px solid #e5e7eb;cursor:pointer;" onclick="enablePushFromBanner()">
          <div style="font-size:13px;font-weight:600;color:#1e40af;">🔔 Enable push notifications</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px;">Tap to get alerts on this device</div>
        </div>
        <div id="hdr-notif-list" style="overflow-y:auto;max-height:360px;"></div>
      </div>` : '';

    // User name + logout — in topbar when userBarLocation !== 'footer'.
    const topbarUserItemsHtml = config.userBarLocation !== 'footer' ? `
      <span id="hdr-user-name"></span>
      <a href="#" id="hdr-logout" style="color:#dc2626;text-decoration:none;font-weight:600;">Sign Out</a>` : '';

    // Mode toggle button — always rendered on every module header.
    const modeToggleHtml = `<button type="button" id="hdr-mode-toggle" class="xpanda-mode-toggle" aria-label="Toggle floor mode" aria-pressed="false" onclick="window.__xpandaSetUiMode(window.__xpandaGetUiMode()==='floor'?'office':'floor')" style="background:none;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;padding:4px 10px;color:#5b6472;display:inline-flex;align-items:center;gap:4px;line-height:1;"><span id="hdr-mode-label">Office</span></button>`;

    // Theme toggle button — sun/moon SVG, no emoji.
    const themeToggleHtml = `<button type="button" id="hdr-theme-toggle" aria-label="Toggle dark mode" onclick="window.ThemeManager&&window.ThemeManager.toggle()" style="background:none;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;padding:4px 8px;color:#5b6472;display:inline-flex;align-items:center;line-height:1;"><svg class="theme-icon-sun" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg><svg class="theme-icon-moon" style="display:none" xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></button>`;

    window.__xpandaUpdateModeToggle = function (mode) {
      var btn = document.getElementById('hdr-mode-toggle');
      var lbl = document.getElementById('hdr-mode-label');
      if (!btn || !lbl) return;
      lbl.textContent = mode === 'floor' ? 'Floor' : 'Office';
      btn.setAttribute('aria-pressed', mode === 'floor' ? 'true' : 'false');
    };

    // Topbar user-bar div — always rendered (mode toggle + theme toggle on every page).
    const topbarUserBarHtml = `
    <div class="header-user-bar" style="position:absolute;top:10px;right:16px;font-size:12px;color:#5b6472;display:flex;align-items:center;gap:8px;">
      ${modeToggleHtml}
      ${themeToggleHtml}
      ${notifBellHtml}
      ${topbarUserItemsHtml}
    </div>`;

    // Back-link — rendered on non-dashboard pages when backLinkLabel is non-empty.
    const backLinkHtml = config.backLinkLabel && !isDashboard
      ? `\n    <a href="${config.dashboardPath}" class="${config.badgeClass.replace('-badge', '-back-link')}">${config.backLinkLabel}</a>\n`
      : '';

    document.write(`
<header class="topbar">
    <a href="/" aria-label="Back to Operations Platform">
        <img src="/logo/xpanda.png" alt="xPanda Logo" class="logo">
    </a>

    <div class="header-center">

        <a href="${config.dashboardPath}" class="badge ${config.badgeClass}" title="${config.badgeTitle}">
            ${config.badgeText}
        </a>

        <h1 id="${config.pageTitleId}">${config.pageTitle}</h1>
        <p id="${config.pageSubtitleId}">${config.pageSubtitle}</p>

    </div>
    ${topbarUserBarHtml}
</header>
`);

    window.__xpandaUpdateModeToggle(window.__xpandaGetUiMode ? window.__xpandaGetUiMode() : 'office');
    // ThemeManager.updateToggleUI() is handled by DOMContentLoaded in /shared/theme.js.

    // Module nav bar — single shared source, renders on every operational page.
    (function () {
      var _p = window.location.pathname;
      var _mods = [
        { label: 'Job board',     href: '/jobs/',         perm: 'jobs' },
        { label: 'Logistics',     href: '/logistics/',     perm: 'logistics.dashboard' },
        { label: 'Manufacturing', href: '/manufacturing/', perm: 'manufacturing.calculators' },
        { label: 'Production',    href: '/production/',    perm: 'production.inventory' },
        { label: 'QC',            href: '/qc/',            perm: 'qc' },
        { label: 'Reports',       href: '/reports/',       perm: 'reports' },
        { label: 'Safety',        href: '/safety/',        perm: 'safety' },
        { label: 'Admin',         href: '/admin/',         perm: 'admin' },
      ];
      var _links = _mods.map(function (m) {
        var active = _p.startsWith(m.href);
        return '<a href="' + m.href + '" class="nav-link' + (active ? ' active' : '') + '" data-nav-perm="' + m.perm + '">' + m.label + '</a>';
      }).join('');
      var _ham = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
      document.write(
        '<style>' +
        '.xpanda-module-nav{background:var(--surface);border-bottom:1px solid var(--line);font-family:var(--font-sans);}' +
        '.xpanda-nav-inner{display:flex;align-items:center;padding:0 12px;min-height:44px;}' +
        '.xpanda-nav-links{display:flex;align-items:center;flex:1;gap:2px;overflow-x:auto;scrollbar-width:none;}' +
        '.xpanda-nav-links::-webkit-scrollbar{display:none;}' +
        '.nav-link{display:inline-flex;align-items:center;padding:6px 12px;font-size:13px;font-weight:500;color:var(--muted);text-decoration:none;border-radius:8px;white-space:nowrap;min-height:36px;transition:color .15s,background .15s;}' +
        '.nav-link:hover{background:var(--ghost-bg);color:var(--text);}' +
        '.nav-link.active{color:var(--brand);background:rgba(227,24,55,.08);font-weight:600;}' +
        '.nav-link:focus-visible{outline:2px solid var(--brand);outline-offset:2px;}' +
        '.xpanda-nav-menu-btn{display:none;align-items:center;justify-content:center;background:none;border:1px solid var(--line);border-radius:8px;cursor:pointer;color:var(--text);width:44px;height:44px;padding:0;margin-left:auto;flex-shrink:0;}' +
        '.xpanda-nav-menu-btn:focus-visible{outline:2px solid var(--brand);outline-offset:2px;}' +
        '.xpanda-nav-drawer{background:var(--surface);border-bottom:1px solid var(--line);padding:6px 12px;display:flex;flex-direction:column;gap:2px;}' +
        '.xpanda-nav-drawer[hidden]{display:none;}' +
        '.xpanda-nav-drawer .nav-link{min-height:44px;width:100%;}' +
        '@media(max-width:767px){.xpanda-nav-links{display:none;}.xpanda-nav-menu-btn{display:inline-flex;}}' +
        '@media(min-width:768px){.xpanda-nav-drawer{display:none;}}' +
        '</style>' +
        '<nav class="xpanda-module-nav" id="xpanda-module-nav" aria-label="Module navigation">' +
          '<div class="xpanda-nav-inner">' +
            '<div class="xpanda-nav-links" id="xpanda-nav-links">' + _links + '</div>' +
            '<button type="button" class="xpanda-nav-menu-btn" id="xpanda-nav-menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="xpanda-nav-drawer">' + _ham + '</button>' +
          '</div>' +
          '<div class="xpanda-nav-drawer" id="xpanda-nav-drawer" hidden>' + _links + '</div>' +
        '</nav>'
      );
    })();

    window.addEventListener('DOMContentLoaded', function () {

      // Footer
      const footer = document.createElement('footer');
      footer.className = config.footerClass;
      if (config.userBarLocation === 'footer') {
        footer.innerHTML = `
  <div id="footer-user-bar" style="margin-bottom:8px;font-size:12px;color:#6b7280;">
    <span id="hdr-user-name"></span>
    <span style="margin:0 4px;">•</span>
    <a href="#" id="hdr-logout" style="color:#dc2626;text-decoration:none;font-weight:600;font-size:12px;">Sign Out</a>
  </div>
  <a href="/">← Back to Operations Platform</a>
`;
      } else {
        footer.innerHTML = `<a href="/">← Back to Operations Platform</a>`;
      }
      document.body.appendChild(footer);

      // Module nav hamburger toggle (mobile <768px).
      const _navBtn = document.getElementById('xpanda-nav-menu-btn');
      const _navDrawer = document.getElementById('xpanda-nav-drawer');
      if (_navBtn && _navDrawer) {
        _navBtn.addEventListener('click', function () {
          const open = !_navDrawer.hidden;
          _navDrawer.hidden = open;
          _navBtn.setAttribute('aria-expanded', open ? 'false' : 'true');
          _navBtn.setAttribute('aria-label', open ? 'Open menu' : 'Close menu');
        });
      }

      // 401 interceptor — guard prevents double-wrap if two shims are accidentally loaded.
      if (!window.__xpandaFetchWrapped) {
        window.__xpandaFetchWrapped = true;
        const _origFetch = window.fetch;
        window.fetch = async function (...args) {
          const res = await _origFetch.apply(this, args);
          if (res.status === 401 && !window.location.pathname.startsWith('/login')) {
            window.location.href = '/login.html';
            return res;
          }
          return res;
        };
      }

      // Auth
      fetch('/api/auth/me').then(r => r.json()).then(d => {
        window.__xpandaUser = d.ok ? d.user : null;
        if (d.ok && d.user) {
          const el = document.getElementById('hdr-user-name');
          if (el) el.textContent = d.user.displayName || d.user.username;

          // Nav permission filtering — 1:1 match with PATH_PERMISSION_MAP key per nav item.
          if (!d.user.isAdministrator) {
            const _navPerms = d.user.permissions || {};
            document.querySelectorAll('[data-nav-perm]').forEach(function (link) {
              const k = link.dataset.navPerm;
              if (!(_navPerms[k] && _navPerms[k].view === true)) {
                link.style.display = 'none';
              }
            });
          }

          if (d.user.simulatingRole) {
            const simBanner = document.createElement('div');
            simBanner.id = 'sim-role-banner';
            simBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;background:#f59e0b;color:#000;padding:6px 16px;display:flex;align-items:center;justify-content:center;gap:12px;font-size:14px;font-weight:600;box-shadow:0 2px 4px rgba(0,0,0,0.2);';
            simBanner.innerHTML = `<span>🔍 Testing as: ${d.user.simulatingRole.name}</span><button id="sim-stop-btn" style="background:#fff;color:#000;border:1px solid #000;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:13px;font-weight:600;">Stop Testing</button>`;
            document.body.prepend(simBanner);
            document.body.style.paddingTop = simBanner.offsetHeight + 'px';
            document.getElementById('sim-stop-btn').addEventListener('click', async () => {
              try {
                const res = await fetch('/api/auth/simulate-role', { method: 'DELETE' });
                const data = await res.json();
                if (data.ok) { window.location.reload(); } else { alert('Failed to stop simulation: ' + (data.error || 'Unknown error')); }
              } catch (e) { alert('Error stopping simulation: ' + e.message); }
            });
          }
        }
      }).catch(() => { window.__xpandaUser = null; });

      document.getElementById('hdr-logout')?.addEventListener('click', async (e) => {
        e.preventDefault();
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/login.html';
      });

      // Notifications — only installed when showNotifications is true.
      if (config.showNotifications) {
        let notifDropdownOpen = false;

        window.toggleNotifDropdown = function () {
          notifDropdownOpen = !notifDropdownOpen;
          document.getElementById('hdr-notif-dropdown').style.display = notifDropdownOpen ? '' : 'none';
          if (notifDropdownOpen) loadNotifications();
        };

        document.addEventListener('click', function (e) {
          const bell = document.getElementById('hdr-notif-bell');
          const dropdown = document.getElementById('hdr-notif-dropdown');
          if (bell && dropdown && !bell.contains(e.target) && !dropdown.contains(e.target)) {
            notifDropdownOpen = false;
            dropdown.style.display = 'none';
          }
        });

        window.markAllRead = async function () {
          await fetch('/api/notifications/read', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ all: true }),
          });
          loadNotifications();
        };

        window.handleNotifClick = function (notifId, entityType, entityId) {
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
              if (data.unreadCount > 0) { badge.textContent = data.unreadCount > 99 ? '99+' : data.unreadCount; badge.style.display = ''; }
              else badge.style.display = 'none';
            }
            const list = document.getElementById('hdr-notif-list');
            if (!list) return;
            if (!data.notifications.length) { list.innerHTML = '<div style="padding:24px;text-align:center;color:#9ca3af;font-size:13px;">No notifications</div>'; return; }
            list.innerHTML = data.notifications.map(n => `
        <div style="padding:10px 14px;border-bottom:1px solid #f3f4f6;cursor:pointer;${n.is_read ? 'opacity:0.6;' : 'background:#eff6ff;'}" onclick="handleNotifClick('${n.id}','${n.entity_type}','${n.entity_id}')">
          <div style="font-size:13px;font-weight:${n.is_read ? '400' : '600'};color:#111827;margin-bottom:2px;">${notifEsc(n.title)}</div>
          <div style="font-size:12px;color:#6b7280;">${notifEsc(n.message)}</div>
          <div style="font-size:10px;color:#9ca3af;margin-top:4px;">${notifFmtAgo(n.created_at)}</div>
        </div>`).join('');
          } catch {}
        }

        setInterval(function () { if (!notifDropdownOpen) loadNotifications(); }, 60000);
        loadNotifications();

        async function initPushNotifications() {
          if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
          try {
            const reg = await navigator.serviceWorker.register('/sw.js');
            if (reg.installing || reg.waiting) {
              await new Promise(resolve => {
                const sw = reg.installing || reg.waiting;
                sw.addEventListener('statechange', function () {
                  if (sw.state === 'activated') resolve();
                });
                if (reg.active) resolve();
              });
            }
            const existingSub = await reg.pushManager.getSubscription();
            if (existingSub) return;
            const banner = document.getElementById('hdr-push-banner');
            if (banner) banner.style.display = 'block';
          } catch (e) {
            console.error('Push init check failed:', e);
          }
        }

        window.enablePushFromBanner = async function () {
          try {
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
              document.getElementById('hdr-push-banner').style.display = 'none';
              return;
            }
            const reg = await navigator.serviceWorker.ready;
            const vapidRes = await fetch('/api/push/vapid-public-key');
            const vapidData = await vapidRes.json();
            if (!vapidData.ok || !vapidData.key) return;
            const sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(vapidData.key),
            });
            await fetch('/api/push/subscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(sub.toJSON()),
            });
            document.getElementById('hdr-push-banner').style.display = 'none';
          } catch (e) {
            console.error('Push subscribe failed:', e);
          }
        };

        setTimeout(initPushNotifications, 2000);
      }
    });
  };

  // Auto-call with any config the shim stored before triggering this load.
  // The shim sets window.__xpandaHeaderConfig synchronously, then document.write's
  // this script tag. By the time this IIFE runs, the config is ready.
  if (window.__xpandaHeaderConfig) {
    window.initXpandaHeader(window.__xpandaHeaderConfig);
    window.__xpandaHeaderConfig = null;
  }

})();
