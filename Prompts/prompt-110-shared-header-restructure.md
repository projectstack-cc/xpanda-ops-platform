# Prompt 110 — Shared Header Restructure (nav-on-top, logo in nav, settings gear, pill removed)

## Agent setup
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` before doing anything. Operate primarily as the **Frontend Designer** agent (`agent-frontend-designer.md`); this also touches the shared auth/header bar documented under the **admin-auth-agent**, so respect its patterns (the `*-header.js` shim contract, `window.__xpandaUser`, 401 interceptor).

**Hard constraints (do not violate):** vanilla HTML/CSS/JS, no frameworks, no build step, no ES modules. The header ships via `document.write` from `/shared/shared-header.js` — keep that mechanism. Use CSS custom properties from `/shared/tokens.css` (`--surface`, `--line`, `--text`, `--muted`, `--brand`, `--ghost-bg`, `--shadow-md`); do not hardcode new hex values.

## Goal
Restructure the shared header so the **module nav sits at the top** with the **logo inside it** (left) and the **notification bell + a new settings gear + user items** on the right. The **page title/subtitle move to a centered description band beneath the nav**. **Remove the “XPANDA FOAM • …” context pill** (the nav’s active link now conveys the module). The **Office/Floor mode toggle and the Light/Dark theme toggle move off the nav bar into a popover behind the gear icon** — they are not removed, just relocated.

## Files to change
1. `shared/shared-header.js` — 6 exact edits below.
2. `jobs/jobs-shared.css`, `logistics/logistics-shared.css`, `manufacturing/manufacturing-shared.css`, `production/production-shared.css`, `qc/qc-shared.css`, `reports/reports-shared.css` — delete the now-dead header layout rules.

## DO NOT TOUCH
- Any `*-header.js` shim (the per-module config files) — the contract is unchanged.
- `/shared/theme.js` and the `__xpandaUpdateModeToggle` / `__xpandaGetUiMode` / `ThemeManager` logic — the **same** toggle buttons are reused inside the popover, so their wiring must keep working untouched.
- `.badge`, `.<module>-badge` (e.g. `.logistics-badge`), and `.pill` rules in the module CSS — leave them (they may be used elsewhere; only the header layout rules are dead).
- The **admin** pages (`admin/*.html`) — they hand-roll their own inline `.topbar` header and do **not** use `shared-header.js`. Out of scope for this prompt.
- No D1 migration. No API changes.

---

## Part A — `shared/shared-header.js` (6 exact find/replace edits)

### Edit 1 — replace the old `<header class="topbar">` block + pill with the gear/actions builders

**FIND:**
```js
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
```

**REPLACE WITH:**
```js
    // Settings popover (gear) — display-mode + theme toggles, relocated out of the nav row.
    const gearSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    const gearMenuHtml = `
      <div class="xpanda-gear" id="hdr-gear">
        <button type="button" id="hdr-gear-btn" class="xpanda-gear-btn" aria-label="Settings" aria-haspopup="true" aria-expanded="false" onclick="window.__xpandaToggleGear&&window.__xpandaToggleGear()">${gearSvg}</button>
        <div class="xpanda-gear-popover" id="hdr-gear-popover" role="menu" hidden>
          <div class="xpanda-gear-row"><span class="xpanda-gear-label">Display</span>${modeToggleHtml}</div>
          <div class="xpanda-gear-row"><span class="xpanda-gear-label">Theme</span>${themeToggleHtml}</div>
        </div>
      </div>`;

    // Nav actions cluster — notification bell + settings gear + user items, rendered inside the top nav.
    const navActionsHtml = `${notifBellHtml}${gearMenuHtml}${topbarUserItemsHtml}`;

    // Back-link — rendered on non-dashboard pages when backLinkLabel is non-empty.
    const backLinkHtml = config.backLinkLabel && !isDashboard
      ? `\n    <a href="${config.dashboardPath}" class="${config.badgeClass.replace('-badge', '-back-link')}">${config.backLinkLabel}</a>\n`
      : '';
```

### Edit 2 — give the nav inner row a gap and a bit more height

**FIND:**
```js
        '.xpanda-nav-inner{display:flex;align-items:center;padding:0 12px;min-height:44px;}' +
```
**REPLACE WITH:**
```js
        '.xpanda-nav-inner{display:flex;align-items:center;gap:6px;padding:0 12px;min-height:48px;}' +
```

### Edit 3 — add logo / nav-actions / gear popover / page-desc styles (insert before the closing `</style>`)

**FIND:**
```js
        '</style>' +
```
**REPLACE WITH:**
```js
        '.xpanda-nav-logo{display:inline-flex;align-items:center;flex-shrink:0;padding-right:4px;}' +
        '.xpanda-nav-logo img{height:30px;width:auto;display:block;}' +
        '.xpanda-nav-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;}' +
        '.xpanda-gear{position:relative;display:inline-flex;}' +
        '.xpanda-gear-btn{background:none;border:1px solid var(--line);border-radius:6px;cursor:pointer;padding:5px 8px;color:var(--muted);display:inline-flex;align-items:center;line-height:1;}' +
        '.xpanda-gear-btn:hover{color:var(--text);background:var(--ghost-bg);}' +
        '.xpanda-gear-btn:focus-visible{outline:2px solid var(--brand);outline-offset:2px;}' +
        '.xpanda-gear-popover{position:absolute;top:40px;right:0;min-width:210px;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow-md);padding:10px;z-index:9999;display:flex;flex-direction:column;gap:10px;}' +
        '.xpanda-gear-popover[hidden]{display:none;}' +
        '.xpanda-gear-row{display:flex;align-items:center;justify-content:space-between;gap:12px;}' +
        '.xpanda-gear-label{font-size:12px;font-weight:600;color:var(--muted);}' +
        '.xpanda-page-desc{text-align:center;padding:16px;background:var(--surface);border-bottom:1px solid var(--line);}' +
        '.xpanda-page-desc h1{margin:0 0 4px;font-size:20px;font-weight:600;color:var(--text);}' +
        '.xpanda-page-desc p{margin:0;font-size:13px;color:var(--muted);}' +
        '</style>' +
```

### Edit 4 — restructure the nav markup (logo + actions inside nav, description band beneath)

**FIND:**
```js
        '<nav class="xpanda-module-nav" id="xpanda-module-nav" aria-label="Module navigation">' +
          '<div class="xpanda-nav-inner">' +
            '<div class="xpanda-nav-links" id="xpanda-nav-links">' + _links + '</div>' +
            '<button type="button" class="xpanda-nav-menu-btn" id="xpanda-nav-menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="xpanda-nav-drawer">' + _ham + '</button>' +
          '</div>' +
          '<div class="xpanda-nav-drawer" id="xpanda-nav-drawer" hidden>' + _links + '</div>' +
        '</nav>'
```
**REPLACE WITH:**
```js
        '<nav class="xpanda-module-nav" id="xpanda-module-nav" aria-label="Module navigation">' +
          '<div class="xpanda-nav-inner">' +
            '<a class="xpanda-nav-logo" href="/" aria-label="xPanda Operations Platform"><img src="/logo/xpanda.png" alt="xPanda"></a>' +
            '<div class="xpanda-nav-links" id="xpanda-nav-links">' + _links + '</div>' +
            '<button type="button" class="xpanda-nav-menu-btn" id="xpanda-nav-menu-btn" aria-label="Open menu" aria-expanded="false" aria-controls="xpanda-nav-drawer">' + _ham + '</button>' +
            '<div class="xpanda-nav-actions">' + navActionsHtml + '</div>' +
          '</div>' +
          '<div class="xpanda-nav-drawer" id="xpanda-nav-drawer" hidden>' + _links + '</div>' +
        '</nav>' +
        '<div class="xpanda-page-desc"><h1 id="' + config.pageTitleId + '">' + config.pageTitle + '</h1><p id="' + config.pageSubtitleId + '">' + config.pageSubtitle + '</p></div>'
```

### Edit 5 — run the mode-toggle UI sync after the nav exists

**FIND:**
```js
    })();

    window.addEventListener('DOMContentLoaded', function () {
```
**REPLACE WITH:**
```js
    })();

    // Reflect current UI mode on the toggle now that the nav (and its toggle button) exist.
    window.__xpandaUpdateModeToggle(window.__xpandaGetUiMode ? window.__xpandaGetUiMode() : 'office');

    window.addEventListener('DOMContentLoaded', function () {
```

### Edit 6 — wire the gear popover (toggle + click-outside-to-close)

**FIND:**
```js
        });
      }

      // 401 interceptor — guard prevents double-wrap if two shims are accidentally loaded.
```
**REPLACE WITH:**
```js
        });
      }

      // Settings gear popover toggle + click-outside-to-close.
      window.__xpandaToggleGear = function () {
        const pop = document.getElementById('hdr-gear-popover');
        const btn = document.getElementById('hdr-gear-btn');
        if (!pop || !btn) return;
        const opening = pop.hasAttribute('hidden');
        if (opening) { pop.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); }
        else { pop.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); }
      };
      document.addEventListener('click', function (e) {
        const gear = document.getElementById('hdr-gear');
        const pop = document.getElementById('hdr-gear-popover');
        if (gear && pop && !pop.hasAttribute('hidden') && !gear.contains(e.target)) {
          pop.setAttribute('hidden', '');
          const b = document.getElementById('hdr-gear-btn');
          if (b) b.setAttribute('aria-expanded', 'false');
        }
      });

      // 401 interceptor — guard prevents double-wrap if two shims are accidentally loaded.
```

After all six edits, **the file must still parse** (`node --check shared/shared-header.js`).

---

## Part B — delete dead header CSS from the six module stylesheets

In **each** of these files the new markup no longer emits `class="topbar"`, `class="logo"`, or `class="header-center"`, so those rules are dead. **Delete the complete rule block for every one of these selectors:** `.topbar`, `.logo`, `.header-center`, `.topbar h1`, `.topbar p`, **and** the `.topbar { … }` / `.logo { … }` overrides that live inside the responsive `@media (max-width: …)` block. **Do not** delete `.badge`, `.<module>-badge`, or `.pill`.

The base block is identical in all six files — delete exactly this from each:
```css
.topbar {
    position: relative;
    background: var(--card-bg);
    border-bottom: 1px solid var(--line);
    padding: 18px 16px 14px;
    text-align: center;
}

.logo {
    position: absolute;
    left: 14px;
    top: 16px;
    height: 34px;
}

.header-center {
    max-width: 500px;
    margin: 0 auto;
}
```

`.topbar h1` / `.topbar p` differ slightly per file — delete whichever form is present:
- `logistics/logistics-shared.css`: `.topbar h1 { margin:0 0 4px; font-size:20px; color:var(--text); }` and `.topbar p { margin:0; font-size:13px; color:var(--muted); }`
- `jobs`, `manufacturing`, `production`, `qc`, `reports`: `.topbar h1 { margin:0; font-size:24px; }` and `.topbar p { margin:6px 0 0; font-size:13px; color:var(--muted); }`

Responsive overrides inside the `@media` block — delete whichever form is present:
- `jobs`, `logistics`: `.topbar { padding-top: 60px; }` and `.logo { left: 50%; top: 14px; transform: translateX(-50%); height: 30px; }`
- `manufacturing`, `production`, `qc`, `reports`: the same two rules written multi-line.

**Verify after:** this should return `0` for every file —
```
grep -cE '^\s*\.(topbar|logo|header-center)\s*\{|^\s*\.topbar (h1|p)\s*\{' <file>
```
and `.badge` / `.pill` rules must still be present.

---

## Manual / deploy steps (Steve)
- No D1 migration. Deploy to Cloudflare Pages as usual.
- The header ships from `/shared/shared-header.js`; if `sw.js` caches it, hard-refresh (or bump the SW cache) after deploy so the new header loads.

## Verification checklist
- Header on a shared-header page (e.g. Load Builder, Logistics dashboard, Job board): nav is the top row with the logo at its left and **bell · gear · user** at its right; **title + subtitle sit in a centered band beneath** the nav; the old context pill is gone.
- Gear icon opens a popover containing **Display: Office/Floor** and **Theme: Light/Dark**; both still work and persist; popover closes on outside click and on a second gear click.
- Active module link is still highlighted; module switching works.
- **Dark and light** both look correct; popover surface/border use theme tokens.
- **Mobile (<768px):** links collapse into the hamburger drawer; logo + bell + gear stay in the bar; nothing overflows or wraps awkwardly. On narrow desktop widths the links strip scrolls horizontally rather than wrapping.
- Notification bell dropdown still opens/positions correctly from its new spot.
- **Admin pages still render their own (unchanged) header** — confirm they were not affected.
