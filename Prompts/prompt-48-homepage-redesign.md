# Prompt 48 — Homepage Redesign + Loading Dashboard Card Split

## Goal

Redesign `index.html` (the homepage) to fix a permissions bug and modernize the UI. Two deliverables:

1. **Split Loading Dashboard into its own card** with `data-permission="logistics.loading"` so floor operators with only `logistics.loading` permission can see and access it without needing `logistics.dashboard`.
2. **Visual redesign** — replace the current tall, wordy cards with compact, icon-driven cards. Remove the hero paragraph, feature bullet lists, and filler copy. The result should look like a professional internal tool dashboard, not a marketing page.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Context — the permissions bug

The current Logistics card has `data-permission="logistics.dashboard,logistics.bol,logistics.load-builder"`. The `logistics.loading` key is missing from that list. Additionally, the per-link permission check (lines 418–427) maps any `/logistics/...` URL to `logistics.dashboard`, so the Loading Dashboard link is hidden when a user has `logistics.loading` but not `logistics.dashboard`.

The fix: Loading Dashboard becomes its own card with its own `data-permission`. The per-link permission check is updated to account for the new card structure.

---

## Design direction

**Tone:** Industrial, utilitarian, professional. This is a factory floor operations tool, not a SaaS marketing page. It needs to be fast, scannable, and functional on iPads.

**No:**
- Hero section with paragraph description
- Feature bullet lists on cards
- Tall cards with lots of whitespace
- Arial/Helvetica body text (keep it, but use it well)
- Decorative gradients or animations

**Yes:**
- Compact cards with colored icon + title + one-line description + action buttons
- Tight grid layout that shows all modules at a glance
- Clean header bar with logo, company name, user controls
- Cards sized by content, not forced to a min-height
- Mobile-first: 1 column on phone, 2 on tablet, 3–4 on desktop

---

## Step 1 — Replace the full `index.html`

Replace the entire file. Below is the complete new markup. Preserve ALL existing JavaScript functions exactly (auth, notifications, push, logout) — only the HTML structure and CSS change.

### New HTML structure

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>xPanda Operations Platform</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="mobile-web-app-capable" content="yes">
  <link rel="icon" href="/assets/img/favicon.png" sizes="any">
  <link rel="apple-touch-icon" href="/assets/img/favicon.png">
  <link rel="manifest" href="/manifest.json">
```

### New CSS

Replace the entire `<style>` block with:

```css
<style>
  :root {
    --bg: #f4f6f9;
    --surface: #ffffff;
    --surface-2: #f8f9fb;
    --text: #111827;
    --text-muted: #6b7280;
    --text-hint: #9ca3af;
    --border: #e5e7eb;
    --radius: 12px;
    --max-w: 960px;
  }

  * { box-sizing: border-box; margin: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }

  /* ── Header bar ─────────────────────────────── */
  .hp-header {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 12px 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .hp-header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .hp-header-left img {
    height: 32px;
    width: auto;
  }
  .hp-header-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--text);
    line-height: 1.2;
  }
  .hp-header-sub {
    font-size: 11px;
    color: var(--text-hint);
    font-weight: 400;
  }
  .hp-header-right {
    display: flex;
    align-items: center;
    gap: 14px;
    font-size: 13px;
    color: var(--text-muted);
    position: relative;
  }
  .hp-header-right a {
    color: #dc2626;
    text-decoration: none;
    font-weight: 600;
    font-size: 12px;
  }

  /* ── Card grid ──────────────────────────────── */
  .hp-grid-wrap {
    max-width: var(--max-w);
    margin: 0 auto;
    padding: 24px 16px 48px;
  }
  .hp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px;
  }

  /* ── Card ────────────────────────────────────── */
  .hp-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 18px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: box-shadow 0.15s ease, border-color 0.15s ease;
  }
  .hp-card:hover {
    border-color: #d1d5db;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }
  .hp-card-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .hp-card-icon {
    width: 34px;
    height: 34px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 18px;
  }
  .hp-card-title {
    font-size: 15px;
    font-weight: 700;
    color: var(--text);
  }
  .hp-card-desc {
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.5;
  }
  .hp-card-actions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: auto;
    padding-top: 4px;
  }

  /* ── Buttons ─────────────────────────────────── */
  .hp-btn {
    display: inline-block;
    font-size: 12px;
    font-weight: 600;
    padding: 5px 12px;
    border-radius: 6px;
    text-decoration: none;
    cursor: pointer;
    transition: opacity 0.15s;
    border: none;
  }
  .hp-btn:hover { opacity: 0.85; }
  .hp-btn-outline {
    background: var(--surface);
    color: var(--text-muted);
    border: 1px solid var(--border);
  }
  .hp-btn-outline:hover { background: var(--surface-2); }

  /* Module-specific button colors */
  .hp-btn-safety     { background: #2563eb; color: #fff; }
  .hp-btn-qc         { background: #dc2626; color: #fff; }
  .hp-btn-reports     { background: #7c3aed; color: #fff; }
  .hp-btn-jobs        { background: #0891b2; color: #fff; }
  .hp-btn-logistics   { background: #475569; color: #fff; }
  .hp-btn-loading     { background: #2563eb; color: #fff; }
  .hp-btn-production  { background: #d97706; color: #fff; }
  .hp-btn-admin       { background: #475569; color: #fff; }

  /* Module-specific icon backgrounds */
  .hp-icon-safety     { background: #dbeafe; color: #1e40af; }
  .hp-icon-qc         { background: #fee2e2; color: #991b1b; }
  .hp-icon-reports    { background: #ede9fe; color: #5b21b6; }
  .hp-icon-jobs       { background: #cffafe; color: #155e75; }
  .hp-icon-logistics  { background: #f1f5f9; color: #334155; }
  .hp-icon-loading    { background: #dbeafe; color: #1e40af; }
  .hp-icon-production { background: #fef3c7; color: #92400e; }
  .hp-icon-admin      { background: #f1f5f9; color: #334155; }

  /* ── Notification dropdown (reused from existing) ── */
  .hp-notif-bell { position: relative; cursor: pointer; font-size: 18px; line-height: 1; }
  .hp-notif-badge {
    display: none; position: absolute; top: -4px; right: -6px;
    background: #dc2626; color: #fff; font-size: 9px; font-weight: 700;
    border-radius: 50%; width: 16px; height: 16px; text-align: center; line-height: 16px;
  }
  .hp-notif-dropdown {
    display: none; position: absolute; top: 36px; right: 0; width: 340px; max-height: 420px;
    background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.12); overflow: hidden; z-index: 9999;
  }

  /* ── Access denied banner ────────────────────── */
  .hp-denied-banner {
    background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px;
    padding: 10px 18px; color: #991b1b; font-size: 13px; text-align: center;
    max-width: var(--max-w); margin: 16px auto 0; 
  }

  /* ── Responsive ──────────────────────────────── */
  @media (max-width: 600px) {
    .hp-grid { grid-template-columns: 1fr 1fr; gap: 10px; }
    .hp-grid-wrap { padding: 16px 12px 32px; }
    .hp-card { padding: 14px 12px; gap: 8px; }
    .hp-card-desc { display: none; }
    .hp-header-sub { display: none; }
  }
  @media (max-width: 380px) {
    .hp-grid { grid-template-columns: 1fr; }
  }
</style>
```

### New body HTML

Replace everything inside `<body>` (from `<div id="user-bar"...>` through the closing `</script>`) with:

```html
<body>

<!-- Header bar -->
<header class="hp-header">
  <div class="hp-header-left">
    <img src="/logo/xpanda.png" alt="xPanda Foam">
    <div>
      <div class="hp-header-title">xPanda Operations</div>
      <div class="hp-header-sub">XPanda Foam, LLC — Orlando, FL</div>
    </div>
  </div>
  <div class="hp-header-right">
    <span id="hdr-notif-bell" class="hp-notif-bell" onclick="toggleNotifDropdown()">🔔<span id="hdr-notif-badge" class="hp-notif-badge"></span></span>
    <div id="hdr-notif-dropdown" class="hp-notif-dropdown">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #e5e7eb;">
        <span style="font-weight:700;font-size:14px;">Notifications</span>
        <button onclick="markAllRead()" style="background:none;border:none;color:#3b82f6;font-size:12px;font-weight:600;cursor:pointer;">Mark all read</button>
      </div>
      <div id="hdr-push-banner" style="display:none;padding:10px 14px;background:#eff6ff;border-bottom:1px solid #e5e7eb;cursor:pointer;" onclick="enablePushFromBanner()">
        <div style="font-size:13px;font-weight:600;color:#1e40af;">🔔 Enable push notifications</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px;">Tap to get alerts on this device</div>
      </div>
      <div id="hdr-notif-list" style="overflow-y:auto;max-height:360px;"></div>
    </div>
    <span id="user-display" style="font-size:13px;"></span>
    <a href="#" onclick="doLogout(); return false;">Sign Out</a>
  </div>
</header>

<!-- Access denied banner (shown via JS if redirected) -->
<div id="access-denied-banner" class="hp-denied-banner" style="display:none;">
  You do not have permission to access that page.
</div>

<!-- Card grid -->
<main class="hp-grid-wrap">
  <div class="hp-grid">

    <!-- Safety -->
    <article class="hp-card" data-permission="safety">
      <div class="hp-card-head">
        <div class="hp-card-icon hp-icon-safety">🛡️</div>
        <div class="hp-card-title">Safety</div>
      </div>
      <div class="hp-card-desc">SDS library, multilingual training</div>
      <div class="hp-card-actions">
        <a class="hp-btn hp-btn-safety" href="/safety/">Open</a>
        <a class="hp-btn hp-btn-outline" href="/safety/training/">Training</a>
      </div>
    </article>

    <!-- QC -->
    <article class="hp-card" data-permission="qc">
      <div class="hp-card-head">
        <div class="hp-card-icon hp-icon-qc">📋</div>
        <div class="hp-card-title">QC</div>
      </div>
      <div class="hp-card-desc">Inspections, incidents, scrap tracking</div>
      <div class="hp-card-actions">
        <a class="hp-btn hp-btn-qc" href="/qc/">Open</a>
      </div>
    </article>

    <!-- Reports -->
    <article class="hp-card" data-permission="reports">
      <div class="hp-card-head">
        <div class="hp-card-icon hp-icon-reports">📊</div>
        <div class="hp-card-title">Reports</div>
      </div>
      <div class="hp-card-desc">Scrap dashboards, incident analytics</div>
      <div class="hp-card-actions">
        <a class="hp-btn hp-btn-reports" href="/reports/">Open</a>
      </div>
    </article>

    <!-- Job Board -->
    <article class="hp-card" data-permission="jobs">
      <div class="hp-card-head">
        <div class="hp-card-icon hp-icon-jobs">📦</div>
        <div class="hp-card-title">Job Board</div>
      </div>
      <div class="hp-card-desc">Kanban tracking, order entry to shipment</div>
      <div class="hp-card-actions">
        <a class="hp-btn hp-btn-jobs" href="/jobs/">Open</a>
      </div>
    </article>

    <!-- Logistics (shipments, BOL, load builder — NOT loading dashboard) -->
    <article class="hp-card" data-permission="logistics.dashboard,logistics.bol,logistics.load-builder">
      <div class="hp-card-head">
        <div class="hp-card-icon hp-icon-logistics">🚛</div>
        <div class="hp-card-title">Logistics</div>
      </div>
      <div class="hp-card-desc">Shipments, BOL generator, load builder</div>
      <div class="hp-card-actions">
        <a class="hp-btn hp-btn-logistics" href="/logistics/" data-perm-key="logistics.dashboard">Dashboard</a>
        <a class="hp-btn hp-btn-outline" href="/logistics/bol-generator.html" data-perm-key="logistics.bol">BOL</a>
        <a class="hp-btn hp-btn-outline" href="/logistics/load-builder.html" data-perm-key="logistics.load-builder">Load Builder</a>
      </div>
    </article>

    <!-- Loading Dashboard (own card, own permission) -->
    <article class="hp-card" data-permission="logistics.loading">
      <div class="hp-card-head">
        <div class="hp-card-icon hp-icon-loading">🏗️</div>
        <div class="hp-card-title">Loading</div>
      </div>
      <div class="hp-card-desc">Bay assignments, trailer loading status</div>
      <div class="hp-card-actions">
        <a class="hp-btn hp-btn-loading" href="/logistics/loading.html">Open</a>
      </div>
    </article>

    <!-- Production -->
    <article class="hp-card" data-permission="production.calculators,production.inventory">
      <div class="hp-card-head">
        <div class="hp-card-icon hp-icon-production">🧮</div>
        <div class="hp-card-title">Production</div>
      </div>
      <div class="hp-card-desc">Block calculator, inventory, molding log</div>
      <div class="hp-card-actions">
        <a class="hp-btn hp-btn-production" href="/production/">Open</a>
      </div>
    </article>

    <!-- Admin -->
    <article class="hp-card" data-permission="admin">
      <div class="hp-card-head">
        <div class="hp-card-icon hp-icon-admin">⚙️</div>
        <div class="hp-card-title">Admin</div>
      </div>
      <div class="hp-card-desc">Parts library, users, roles, activity log</div>
      <div class="hp-card-actions">
        <a class="hp-btn hp-btn-admin" href="/admin/parts.html">Parts</a>
        <a class="hp-btn hp-btn-outline" href="/admin/users.html">Users</a>
        <a class="hp-btn hp-btn-outline" href="/admin/roles.html">Roles</a>
        <a class="hp-btn hp-btn-outline" href="/admin/activity-log.html">Log</a>
      </div>
    </article>

  </div>
</main>
```

### Updated JavaScript

Replace the entire `<script>` block. The logic is the same but the permission checks are updated for the new card structure:

```html
<script>
const _origFetch = window.fetch;
window.fetch = async function(...args) {
  const res = await _origFetch.apply(this, args);
  if (res.status === 401 && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login.html';
    return res;
  }
  return res;
};

async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
}

async function initHomepage() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (!data.ok || !data.user) return;

    const user = data.user;

    document.getElementById('user-display').textContent = user.displayName || user.username;

    if (!user.isAdministrator) {
      const perms = user.permissions || {};

      // Hide cards the user has no access to
      document.querySelectorAll('.hp-card[data-permission]').forEach(card => {
        const keys = card.dataset.permission.split(',');
        const canView = keys.some(key => perms[key.trim()]?.view === true);
        if (!canView) card.style.display = 'none';
      });

      // Hide individual action links the user can't access
      document.querySelectorAll('.hp-card a[data-perm-key]').forEach(link => {
        const permKey = link.dataset.permKey;
        if (permKey && !perms[permKey]?.view) link.style.display = 'none';
      });

      // Also hide admin links if not admin
      document.querySelectorAll('.hp-card a[href*="/admin/"]').forEach(link => {
        if (!perms['admin']?.view) link.style.display = 'none';
      });
    }
  } catch {}
}

// Access denied banner
if (new URLSearchParams(window.location.search).get('access_denied')) {
  const banner = document.getElementById('access-denied-banner');
  if (banner) banner.style.display = '';
  history.replaceState(null, '', '/');
}

initHomepage();
setTimeout(loadNotifications, 500);

// ── Notification system (unchanged) ──────────────────────
let notifDropdownOpen = false;

function toggleNotifDropdown() {
  notifDropdownOpen = !notifDropdownOpen;
  document.getElementById('hdr-notif-dropdown').style.display = notifDropdownOpen ? '' : 'none';
  if (notifDropdownOpen) loadNotifications();
}

document.addEventListener('click', (e) => {
  const bell = document.getElementById('hdr-notif-bell');
  const dd = document.getElementById('hdr-notif-dropdown');
  if (bell && dd && !bell.contains(e.target) && !dd.contains(e.target)) {
    notifDropdownOpen = false;
    dd.style.display = 'none';
  }
});

async function markAllRead() {
  await fetch('/api/notifications/read', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) });
  loadNotifications();
}

function handleNotifClick(notifId, entityType, entityId) {
  fetch('/api/notifications/read', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [notifId] }) });
  if (entityType === 'loading_assignment') window.location.href = '/logistics/loading.html';
  notifDropdownOpen = false;
  const dd = document.getElementById('hdr-notif-dropdown');
  if (dd) dd.style.display = 'none';
}

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
        <div style="font-size:13px;font-weight:${n.is_read ? '400' : '600'};color:#111827;margin-bottom:2px;">${escN(n.title)}</div>
        <div style="font-size:12px;color:#6b7280;">${escN(n.message)}</div>
        <div style="font-size:10px;color:#9ca3af;margin-top:4px;">${fmtAgo(n.created_at)}</div>
      </div>`).join('');
  } catch {}
}

function escN(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
function fmtAgo(iso) {
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'Just now'; if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60); if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

setInterval(() => { if (!notifDropdownOpen) loadNotifications(); }, 60000);

// ── Push notifications (unchanged) ───────────────────────
async function initPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    if (reg.installing || reg.waiting) {
      await new Promise(resolve => {
        const sw = reg.installing || reg.waiting;
        sw.addEventListener('statechange', () => {
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

async function enablePushFromBanner() {
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
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

setTimeout(initPushNotifications, 2000);
</script>
</body>
</html>
```

---

## Key changes summary

### Permission fix
- Loading Dashboard card has `data-permission="logistics.loading"` — completely independent from the Logistics card
- The old buggy per-link permission check (which mapped all `/logistics/` URLs to `logistics.dashboard`) is replaced with a `data-perm-key` attribute approach — each action link can declare its own permission key, and the JS checks it directly
- The Logistics card retains `data-permission="logistics.dashboard,logistics.bol,logistics.load-builder"` (same as before minus the loading link)

### Visual changes
- Hero section removed (logo + title + paragraph → compact sticky header bar)
- Cards are compact: icon + title + one-liner + action buttons (no bullet lists, no paragraphs)
- Grid uses `auto-fill` with `minmax(220px, 1fr)` — naturally responsive
- On mobile (<600px), descriptions hide to keep cards tight; grid goes to 2 columns
- On very small screens (<380px), single column
- Consistent icon color scheme per module
- System font stack (no custom font loading = faster)
- Notification dropdown and push notification system preserved exactly

### Card icon reference
| Module | Emoji | Icon bg | Button color |
|--------|-------|---------|-------------|
| Safety | 🛡️ | Blue-100 | Blue |
| QC | 📋 | Red-100 | Red |
| Reports | 📊 | Purple-100 | Purple |
| Job Board | 📦 | Cyan-100 | Cyan |
| Logistics | 🚛 | Slate-100 | Slate |
| Loading | 🏗️ | Blue-100 | Blue |
| Production | 🧮 | Amber-100 | Amber |
| Admin | ⚙️ | Slate-100 | Slate |

---

## What NOT to touch

- Do NOT modify `_worker.js` — no API changes, no permission map changes
- Do NOT modify any page other than `index.html`
- Do NOT modify notification API endpoints or push subscription logic
- Do NOT change notification dropdown behavior or markup structure (except moving it into the new header layout — same IDs, same event handlers)
- Do NOT add any JavaScript frameworks, build tools, or CDN imports
- Do NOT remove the service worker registration or push notification setup

---

## Completion checklist

- [ ] Loading Dashboard has its own card with `data-permission="logistics.loading"`
- [ ] A user with only `logistics.loading: view` sees the Loading card and nothing else
- [ ] A user with only `logistics.dashboard: view` sees the Logistics card (without Loading link)
- [ ] Admin sees all cards
- [ ] Per-link permission hiding uses `data-perm-key` attributes (no more URL substring matching)
- [ ] Hero section removed, replaced with sticky header bar
- [ ] Cards are compact with icon + title + one-liner + buttons
- [ ] Grid is responsive: 3-4 columns desktop → 2 columns tablet → 1 column phone
- [ ] Card descriptions hide on mobile (<600px) for tighter layout
- [ ] Notification bell, dropdown, push banner all work exactly as before
- [ ] Sign out works
- [ ] Access denied banner shows when redirected with `?access_denied=1`
- [ ] No console errors

**Notify Steve:** No migration needed. No worker changes. Test:
1. Log in as admin → all 8 cards visible, all action links visible
2. Log in as a role with ONLY `logistics.loading: view` → should see ONLY the Loading card
3. Log in as a role with `logistics.dashboard: view` but NOT `logistics.loading` → should see Logistics card but NOT Loading card
4. Click notification bell → dropdown works, push banner works
5. Test on mobile → 2-column grid, no descriptions, cards are compact
6. Navigate to a page you don't have permission for → redirected to homepage with "You do not have permission" banner
