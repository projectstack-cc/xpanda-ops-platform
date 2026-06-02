# Prompt 80 — New Manufacturing Module: Move Calculators + Cutting Dashboard Placeholder

## Agents to assume

**Read BOTH `AGENTS.md` AND `xpanda-ops-agents.md`.** Assume:
- **Lead: production-agent** — owns existing calculators being moved.
- **Coordinating with: admin-auth-agent** (permission maps, PERMISSION_LABELS, home page card) and **db-api-agent** (`_worker.js` PATH_PERMISSION_MAP).

## Goal

Create a new top-level **Manufacturing** module at `/manufacturing/`. Move Block Calculator and Holey Board Calculator out of `/production/` into it. Add a Cutting Dashboard placeholder page. Production keeps inventory + bead-inventory. Permissions, home-page navigation, and the production dashboard all update to reflect the split.

No API or DB schema changes — only file moves, new files, link updates, and permission-map edits.

## File operations

### Move (copy to new location, delete from old)
- `production/block-calculator.html` → `manufacturing/block-calculator.html`
- `production/holey-board-calculator.html` → `manufacturing/holey-board-calculator.html`

### New files (create)
- `manufacturing/index.html` — dashboard with tiles for Block Calculator, Holey Board Calculator, Cutting Dashboard
- `manufacturing/manufacturing-header.js` — thin shim following the F1a pattern (model exactly on `production/production-header.js`)
- `manufacturing/manufacturing-shared.css` — copy of `production/production-shared.css`, with class names rewritten to `mfg-*` so it doesn't fight the production module's styles
- `manufacturing/cutting-dashboard.html` — placeholder page

### Modify
- `production/index.html` — remove the Block Calculator and Holey Board Calculator tiles. Update the gate-nav script to drop the now-moved hrefs. Keep the Inventory tile.
- `index.html` (home page) — replace the single Production card with two cards: Production (inventory only) and Manufacturing (calculators + cutting). Both use the existing `hp-card` markup pattern.
- `_worker.js` — update `PATH_PERMISSION_MAP` to add a `/manufacturing/*` pattern and remove the now-obsolete `/production/(block-calculator|holey-board-calculator)/` line.
- `admin/roles.html` — add new permission keys to `PERMISSION_LABELS`.

---

## Part 1 — Manufacturing module files

### 1a. `manufacturing/manufacturing-header.js` (shim)

Copy of `production/production-header.js` with these field substitutions:

```javascript
// manufacturing/manufacturing-header.js — thin shim for F1a.
// All header logic lives in /shared/shared-header.js.
window.__xpandaHeaderConfig = {
  moduleKey:         'manufacturing',
  badgeText:         'XPANDA FOAM • MANUFACTURING',
  badgeClass:        'mfg-badge',
  badgeTitle:        'Back to Manufacturing Dashboard',
  dashboardPath:     '/manufacturing/',
  backLinkLabel:     '← Back to Manufacturing',
  pageTitle:         'Manufacturing Dashboard',
  pageSubtitle:      'Production calculators and cutting operations',
  pageTitleId:       'mfg-page-title',
  pageSubtitleId:    'mfg-page-subtitle',
  footerClass:       'mfg-platform-footer',
  userBarLocation:   'topbar',
  showNotifications: true,
};
if (!window.__xpandaSharedHeaderLoaded) {
  window.__xpandaSharedHeaderLoaded = true;
  document.write('<script src="/shared/shared-header.js"><\/script>');
} else {
  window.initXpandaHeader(window.__xpandaHeaderConfig);
  window.__xpandaHeaderConfig = null;
}
```

### 1b. `manufacturing/manufacturing-shared.css`

Take `production/production-shared.css` verbatim, then global-replace these class-name prefixes (only when they're class names — leave words inside comments and unrelated identifiers alone):
- `prod-wrap` → `mfg-wrap`
- `prod-tile` → `mfg-tile`
- `prod-section-intro` → `mfg-section-intro`
- `prod-section-title` → `mfg-section-title`
- `prod-section-subtitle` → `mfg-section-subtitle`
- `prod-badge` → `mfg-badge`
- `prod-platform-footer` → `mfg-platform-footer`
- Any other `.prod-` class prefix → `.mfg-`

If you find a class name in `production-shared.css` that doesn't fit this rename pattern, leave it but flag it in a comment so it can be addressed later.

### 1c. `manufacturing/index.html`

Model on `production/index.html`. Three tiles:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>xPanda Manufacturing Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="manifest" href="/manifest.json">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="mobile-web-app-capable" content="yes">
<link rel="icon" href="/assets/img/favicon.png" sizes="any">
<link rel="apple-touch-icon" href="/assets/img/favicon.png">
<link rel="stylesheet" href="/manufacturing/manufacturing-shared.css">
</head>
<body>
<script src="/manufacturing/manufacturing-header.js"></script>

<div class="mfg-wrap">
  <div class="mfg-section-intro">
    <h1 class="mfg-section-title">Manufacturing Tools</h1>
    <p class="mfg-section-subtitle">Select a tool to begin</p>
  </div>

  <a class="mfg-tile" href="/manufacturing/block-calculator.html">
    <h2>Block Calculator</h2>
    <p>Calculate parts per block, generate cut lists, and visualize cut layouts</p>
  </a>

  <a class="mfg-tile" href="/manufacturing/holey-board-calculator.html">
    <h2>Holey Board Calculator</h2>
    <p>Calculate chunks needed for board orders with thickness optimization</p>
  </a>

  <a class="mfg-tile" href="/manufacturing/cutting-dashboard.html">
    <h2>Cutting Dashboard</h2>
    <p>Live status of cutting operations across the floor — coming soon</p>
  </a>
</div>

<script>
function getUser() {
  return new Promise(resolve => {
    if (window.__xpandaUser !== undefined) return resolve(window.__xpandaUser);
    let attempts = 0;
    const check = setInterval(() => {
      if (window.__xpandaUser !== undefined || ++attempts > 20) {
        clearInterval(check);
        resolve(window.__xpandaUser || null);
      }
    }, 50);
  });
}

async function gateMfgNav() {
  try {
    const user = await getUser();
    if (!user || user.isAdministrator) return;
    const perms = user.permissions || {};
    if (!perms['manufacturing.calculators']?.view) {
      document.querySelectorAll('a[href*="block-calculator"], a[href*="holey-board"]').forEach(el => el.style.display = 'none');
    }
    if (!perms['manufacturing.cutting']?.view) {
      document.querySelectorAll('a[href*="cutting-dashboard"]').forEach(el => el.style.display = 'none');
    }
  } catch {}
}
gateMfgNav();
</script>
</body>
</html>
```

### 1d. `manufacturing/cutting-dashboard.html` (placeholder)

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Cutting Dashboard — xPanda Manufacturing</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/assets/img/favicon.png" sizes="any">
<link rel="stylesheet" href="/manufacturing/manufacturing-shared.css">
</head>
<body>
<script src="/manufacturing/manufacturing-header.js"></script>

<div class="mfg-wrap">
  <div class="mfg-section-intro">
    <h1 class="mfg-section-title">Cutting Dashboard</h1>
    <p class="mfg-section-subtitle">Live cutting floor status — coming soon</p>
  </div>

  <div style="background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:48px 32px; text-align:center; max-width:720px; margin:0 auto;">
    <div style="font-size:48px; margin-bottom:16px;">🪚</div>
    <h2 style="margin:0 0 12px 0; color:#111827;">Coming Soon</h2>
    <p style="color:#4b5563; line-height:1.6; margin:0 auto; max-width:480px;">
      Real-time visibility into cutting operations: which blocks are on which cutter (cross, main, blue line),
      cycle status, queue, operator assignments, and throughput. Designed for floor TVs and supervisor tablets.
    </p>
  </div>
</div>
</body>
</html>
```

### 1e. `manufacturing/block-calculator.html` and `manufacturing/holey-board-calculator.html`

These are **verbatim moves** of the existing files from `/production/`. After copying to the new path, update inside each moved file:

1. Any `<link rel="stylesheet" href="/production/production-shared.css">` → `/manufacturing/manufacturing-shared.css`
2. Any `<script src="/production/production-header.js">` → `/manufacturing/manufacturing-header.js`
3. Any class names referenced in inline HTML/JS that were renamed (`prod-*` → `mfg-*`)
4. Any internal hrefs to `/production/block-calculator.html` or `/production/holey-board-calculator.html` (in case they self-link or cross-link) → `/manufacturing/...`

**Do NOT modify any calculator logic, DOM IDs that drive the calculator behavior, or anything other than the four categories above.** These pages are large; the rename is mechanical.

After confirming the new files work, **delete the originals** at `production/block-calculator.html` and `production/holey-board-calculator.html`.

---

## Part 2 — Update Production module

### 2a. `production/index.html`

Remove the two `<a class="prod-tile">` blocks for Block Calculator and Holey Board Calculator. Keep the Inventory tile.

In the `gateProductionNav` script, remove the line that hides `a[href*="block-calculator"], a[href*="holey-board"]` — those hrefs no longer exist on this page. Keep the inventory gate line.

Update the dashboard subtitle (visible heading area) to reflect the narrower scope. Change "Production planning and manufacturing tools" to "Inventory and production planning" in both `production/index.html` and `production/production-header.js`.

### 2b. `production/production-header.js`

Update `pageSubtitle` from `'Production planning and manufacturing tools'` to `'Inventory and production planning'`. Everything else stays.

---

## Part 3 — Home page `index.html`

Find the existing Production card (around line 336):

```html
<!-- Production -->
<article class="hp-card" data-permission="production.calculators,production.inventory">
  ...
  <div class="hp-card-title">Production</div>
  ...
  <div class="hp-card-desc">Block calculator, inventory, molding log</div>
  ...
  <a class="hp-btn hp-btn-production" href="/production/">Open</a>
</article>
```

Replace with **two cards**, in this order:

```html
<!-- Manufacturing -->
<article class="hp-card" data-permission="manufacturing.calculators,manufacturing.cutting">
  <div class="hp-card-header">
    <div class="hp-card-icon hp-icon-production">🏭</div>
    <div class="hp-card-title">Manufacturing</div>
  </div>
  <div class="hp-card-desc">Block calculator, holey board calculator, cutting dashboard</div>
  <div class="hp-card-actions">
    <a class="hp-btn hp-btn-production" href="/manufacturing/">Open</a>
  </div>
</article>

<!-- Production -->
<article class="hp-card" data-permission="production.inventory">
  <div class="hp-card-header">
    <div class="hp-card-icon hp-icon-production">📦</div>
    <div class="hp-card-title">Production</div>
  </div>
  <div class="hp-card-desc">Bead inventory, block inventory, molding log</div>
  <div class="hp-card-actions">
    <a class="hp-btn hp-btn-production" href="/production/">Open</a>
  </div>
</article>
```

**Implementer note:** if the existing card uses slightly different inner markup than the simplified version shown above (different wrapper divs, etc.), preserve the actual existing pattern — just split it into two cards with the new titles, descriptions, hrefs, icons, and `data-permission` values. Both cards reuse the `hp-icon-production` background color and `hp-btn-production` button color (orange amber) for visual consistency. The icons (`🏭` for Manufacturing, `📦` for Production) are easily changed if you want different ones.

---

## Part 4 — `_worker.js` permission maps

Find `PATH_PERMISSION_MAP` (around line ~449). Make these changes:

```javascript
const PATH_PERMISSION_MAP = [
  { pattern: /^\/admin\//,                                                    key: 'admin' },
  { pattern: /^\/jobs\//,                                                     key: 'jobs' },
  { pattern: /^\/logistics\/bol-generator/,                                   key: 'logistics.bol' },
  { pattern: /^\/logistics\/load-builder/,                                    key: 'logistics.load-builder' },
  { pattern: /^\/logistics\/loading/,                                         key: 'logistics.loading' },
  { pattern: /^\/logistics\//,                                                key: 'logistics.dashboard' },

  // NEW Manufacturing module
  { pattern: /^\/manufacturing\/cutting-dashboard/,                           key: 'manufacturing.cutting' },
  { pattern: /^\/manufacturing\//,                                            key: 'manufacturing.calculators' },

  // Production now inventory-only
  { pattern: /^\/production\//,                                               key: 'production.inventory' },

  { pattern: /^\/qc\//,                                                       key: 'qc' },
  { pattern: /^\/safety\//,                                                   key: 'safety' },
  { pattern: /^\/reports\//,                                                  key: 'reports' },
];
```

Notes:
- The old `^/production/(block-calculator|holey-board-calculator)/` line is **deleted** — those URLs no longer exist.
- More specific `manufacturing/cutting-dashboard` comes before the general `manufacturing/` prefix so it matches first.
- API_PERMISSION_MAP does NOT change — `/api/parts`, `/api/combos`, etc., are still keyed `production.calculators`. **Important:** rename those API map keys to `manufacturing.calculators` as well, since the calculators that consume those APIs have moved.

Update `API_PERMISSION_MAP` (around line ~463): change every occurrence of `key: 'production.calculators'` to `key: 'manufacturing.calculators'`. Leave `production.inventory` keyed routes alone (`/api/bead`, `/api/block`, `/api/molding-log`).

---

## Part 5 — `admin/roles.html` PERMISSION_LABELS

Find the `PERMISSION_LABELS` block (around line ~408). Edit so the keys become:

```javascript
const PERMISSION_LABELS = {
  // ... existing entries above unchanged ...
  'manufacturing.calculators': { group: 'Manufacturing', label: 'Calculators' },
  'manufacturing.cutting':     { group: 'Manufacturing', label: 'Cutting Dashboard' },
  'production.inventory':      { group: 'Production',    label: 'Inventory' },
  // ... existing entries below unchanged ...
};
```

**Remove** the old `'production.calculators'` entry. Existing roles in the database that still reference `production.calculators` will silently no-op against the new schema — no migration needed because permission keys are stored as JSON blobs and missing keys default to false. Admin can re-toggle the new `manufacturing.calculators` key for the affected roles via the roles page.

---

## Scope (strict)

- File operations: 2 moves (block/holey calculators from production → manufacturing), 4 new files (manufacturing index/header/css/cutting-dashboard), and edits to 5 existing files (production/index.html, production/production-header.js, /index.html, _worker.js, admin/roles.html).
- Do NOT change any API route, any DB schema, any calculator's internal logic, or any other module.
- After all changes: `/production/block-calculator.html` and `/production/holey-board-calculator.html` should be deleted (`git rm`).
- No new dependencies. No worker route changes (calculators don't have a dedicated API endpoint; they call `/api/parts` which keeps working).

## Verify

1. `/manufacturing/` loads — shows three tiles (Block Calculator, Holey Board Calculator, Cutting Dashboard).
2. Block Calculator and Holey Board Calculator load at the new URLs, fully functional, identical to before.
3. Cutting Dashboard loads — shows the placeholder card.
4. `/production/` loads — shows only the Inventory tile.
5. Home page shows two cards in this area: Manufacturing (🏭) and Production (📦). Both link correctly.
6. As admin, both new permission keys appear in the Manufacturing group on `/admin/roles.html`.
7. Going to an old URL (`/production/block-calculator.html`) returns a 404 — that's expected and fine.

## After this lands

Re-run F3 (permissions audit) to confirm `/api/parts` and `/api/combos` now show `manufacturing.calculators` as their gate. Any existing non-admin role that had `production.calculators` checked needs the new `manufacturing.calculators` re-toggled — that's a one-time admin click in the roles page.
