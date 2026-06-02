# Prompt 74 — F1a: Shared Header Module

## Agents to assume

**Read BOTH agent files before starting: `AGENTS.md` AND `xpanda-ops-agents.md`.** Then assume these agents and follow their scopes and the Orchestrator's cross-cutting rules:

- **Lead: admin-auth-agent** — owns auth bar, 401 interceptor, user display, notification bell. The shared header is fundamentally auth/user UI.
- **Coordinating across:** every domain agent (job-board, logistics, production, qc, reports). Each module's `*-header.js` shrinks; no other module file changes.

This prompt does NOT touch `_worker.js`, any DB migration, any module's HTML files, any module's `*-shared.css`, or any other file outside the five `*-header.js` files and one new shared file.

## Context: Foundation Phase 1, Step A

This is the first step of the Foundation Roadmap (F1a per `BACKLOG.md`). It does ONE thing: consolidate the five module header scripts into one shared module. No new features, no auth changes, no behavior changes the user can see. The goal is a clean preflight that removes ~30KB of duplicated code and eliminates header drift forever.

**Critical constraint:** the user-facing behavior of every module's header must be **byte-identical** to the current behavior, with one exception called out in Part 4. If anything visibly changes (a missing badge, a different page title, the notification bell appearing where it didn't before), the prompt has overreached.

## Inventory (verified)

Five module header files exist, each loaded by every HTML page in its module:

| File | Size | Loaded by |
|------|------|-----------|
| `jobs/jobs-header.js` | 10.6KB | 2 HTML files |
| `logistics/logistics-header.js` | 11.1KB | 4 HTML files |
| `production/production-header.js` | 10.7KB | 5 HTML files |
| `qc/qc-header.js` | 3.4KB | 5 HTML files |
| `reports/reports-header.js` | 2.8KB | 13 HTML files |

**Behavioral drift discovered (these are differences that must be preserved exactly):**

1. **Notification bell**: present in jobs, logistics, production headers. **Absent in qc and reports headers.** This is intentional drift the shared module must reproduce — qc/reports do not show the bell by default.
2. **User bar location**: jobs renders the user name + Sign Out + bell inline in the topbar (top-right). Logistics moved the user bar into the footer instead. Other modules vary. The shared module must let each module choose `'topbar'` or `'footer'` for the user bar mount point.
3. **Helper names**: notification rendering helpers have drifted in name (`escN` vs `escNotif`, `fmtAgo` vs `formatTimeAgo`) but not behavior. Consolidate to one canonical name in the shared module: `notifEsc` and `notifFmtAgo`. These are private to the shared module.
4. **Per-module strings**: badge text (e.g. `XPANDA FOAM • JOBS`), page title, page subtitle, badge CSS class (`jobs-badge`, `logistics-badge`), back-link target, footer class. These vary per module and become config inputs.
5. **`document.write()`** is used in every existing header. The agents file flags this as legacy to be refactored later. **Keep `document.write()` in the shared module for now.** Switching to `DOMContentLoaded` + `insertAdjacentHTML` is a separate future change (call out the TODO comment in the shared file; do NOT make the switch in this prompt).

---

## Part 1 — Create `/shared/shared-header.js`

Create a new directory `/shared/` at the repo root (sibling of `/jobs/`, `/logistics/`, etc.) and inside it create `shared-header.js`. This is the consolidated header module.

### 1a. Public API

The shared module exposes ONE function on the global, called via the per-module header script (which becomes a tiny shim — see Part 2):

```javascript
// window.initXpandaHeader(config)
//   config: {
//     moduleKey:        'jobs' | 'logistics' | 'production' | 'qc' | 'reports'  (required)
//     badgeText:        string                  // e.g. 'XPANDA FOAM • JOBS'
//     badgeClass:       string                  // e.g. 'jobs-badge'
//     dashboardPath:    string                  // e.g. '/jobs/'  (also used to detect isDashboard)
//     backLinkLabel:    string                  // e.g. '← Back to Job Board'  (rendered when !isDashboard)
//     pageTitle:        string                  // e.g. 'Job Board'
//     pageSubtitle:     string                  // e.g. 'Production job tracking and shipping schedule'
//     pageTitleId:      string                  // e.g. 'jobs-page-title'  (kept for any per-page JS that overrides)
//     pageSubtitleId:   string                  // e.g. 'jobs-page-subtitle'
//     footerClass:      string                  // e.g. 'jobs-platform-footer'
//     userBarLocation:  'topbar' | 'footer'     // jobs/production = 'topbar'; logistics = 'footer'; qc/reports = 'topbar' by default
//     showNotifications: boolean                // true for jobs/logistics/production; false for qc/reports
//   }
```

### 1b. Internals

The shared module performs these steps in order, **matching the existing union of all five headers' behavior**:

1. **Render the topbar via `document.write`** using template literals interpolating the config. Reproduce the existing markup exactly — same classes, same inline styles, same IDs (`hdr-user-name`, `hdr-logout`, `hdr-notif-bell`, `hdr-notif-badge`, `hdr-notif-dropdown`, `hdr-notif-list`, `hdr-push-banner`, `sim-role-banner` slot). The bell + dropdown markup is included only when `config.showNotifications === true`. The user bar (name + logout + bell) is included in the topbar only when `config.userBarLocation === 'topbar'`.
2. **On `DOMContentLoaded`**, append the footer to `document.body` using `config.footerClass`. If `config.userBarLocation === 'footer'`, include the user bar markup inside the footer (same name + logout + bell HTML structure, just relocated, matching the current `logistics-header.js` layout). The "← Back to Operations Platform" link is always present in the footer.
3. **Install the 401 fetch interceptor** by wrapping `window.fetch`. Identical to existing implementation: redirects to `/login.html` on 401 except when already at a `/login*` path. Do not double-wrap if the interceptor is already installed (guard with a flag like `window.__xpandaFetchWrapped`).
4. **Fetch `/api/auth/me`**, populate `window.__xpandaUser`, render the user name into `#hdr-user-name`, wire `#hdr-logout` click, render the simulate-role banner when `user.simulatingRole` is set. Identical to existing behavior.
5. **If `config.showNotifications`**, install the notification poll and dropdown handlers (`toggleNotifDropdown`, `markAllRead`, `handleNotifClick`, `enablePushFromBanner`, plus the polling loop). All of these become globals on `window` so the inline `onclick=` handlers in the rendered HTML continue to work (the existing pattern). Helper functions (`notifEsc`, `notifFmtAgo`) stay private inside the IIFE.

### 1c. Implementation rules

- Wrap the whole thing in an IIFE so internal helpers don't leak. Only `window.initXpandaHeader` and the notification dropdown handlers required by inline `onclick=` (those must be globals) escape the IIFE.
- Use a guard: if `window.initXpandaHeader` is already defined, do nothing. Prevents double-init if some HTML page accidentally includes the shim twice during transition.
- The notification poll interval, dropdown HTML, push-banner logic, click handler — copy these verbatim from `jobs/jobs-header.js` (the most complete reference). Where logistics or production has a slight divergence (e.g. helper name), unify on the jobs version.
- Add a comment at the top of the file:
  ```
  // /shared/shared-header.js — unified module header (F1a).
  // Consumed by every module via /<module>/<module>-header.js (thin shims).
  // TODO: replace document.write() with DOMContentLoaded + insertAdjacentHTML (deferred — separate refactor).
  ```

---

## Part 2 — Replace each module's `*-header.js` with a thin shim

Each existing `*-header.js` file becomes a small file that **only**:

1. Loads the shared module (via a synchronous `<script>` tag — but we can't add tags from inside another script easily; simpler: have each HTML keep loading its existing `*-header.js`, and the shim itself loads the shared module first). Use this pattern:

```javascript
// jobs/jobs-header.js — thin shim for F1a.
// All header logic lives in /shared/shared-header.js.
(function loadShared() {
  if (window.initXpandaHeader) {
    initJobsHeader();
    return;
  }
  const s = document.createElement('script');
  s.src = '/shared/shared-header.js';
  s.onload = initJobsHeader;
  s.onerror = () => console.error('Failed to load /shared/shared-header.js');
  document.head.appendChild(s);

  function initJobsHeader() {
    window.initXpandaHeader({
      moduleKey:        'jobs',
      badgeText:        'XPANDA FOAM • JOBS',
      badgeClass:       'jobs-badge',
      dashboardPath:    '/jobs/',
      backLinkLabel:    '← Back to Job Board',
      pageTitle:        'Job Board',
      pageSubtitle:     'Production job tracking and shipping schedule',
      pageTitleId:      'jobs-page-title',
      pageSubtitleId:   'jobs-page-subtitle',
      footerClass:      'jobs-platform-footer',
      userBarLocation:  'topbar',
      showNotifications: true,
    });
  }
})();
```

**Problem with that pattern:** the existing headers use `document.write` during initial page parse, which means they render synchronously into the document where the script tag sits. An async `document.createElement('script')` load defeats `document.write`'s timing — the topbar would render AFTER the page parse completes, which causes flicker or breaks `<header>` placement.

**Solution: use a synchronous `document.write` of the script tag**, which preserves the parse-time timing. The shim becomes:

```javascript
// jobs/jobs-header.js — thin shim for F1a.
// All header logic lives in /shared/shared-header.js.
// Synchronous load of the shared module preserves document.write timing.
if (!window.__xpandaSharedHeaderLoaded) {
  window.__xpandaSharedHeaderLoaded = true;
  document.write('<script src="/shared/shared-header.js"><\/script>');
}
window.initXpandaHeader({
  moduleKey:        'jobs',
  badgeText:        'XPANDA FOAM • JOBS',
  badgeClass:       'jobs-badge',
  dashboardPath:    '/jobs/',
  backLinkLabel:    '← Back to Job Board',
  pageTitle:        'Job Board',
  pageSubtitle:     'Production job tracking and shipping schedule',
  pageTitleId:      'jobs-page-title',
  pageSubtitleId:   'jobs-page-subtitle',
  footerClass:      'jobs-platform-footer',
  userBarLocation:  'topbar',
  showNotifications: true,
});
```

The `document.write('<script src="...">')` pattern synchronously loads and executes the shared module before the next line of the shim runs (this is well-defined browser behavior for inline scripts). The guard prevents double-loading if a page accidentally includes two shims (e.g. during partial transition).

### Per-module config values to use

Read the existing `*-header.js` file for each module to extract the current strings (badge, title, subtitle, etc.) and reproduce them exactly. The values below are what should appear in each shim:

**`jobs/jobs-header.js`:**
- moduleKey `'jobs'`, badgeText `'XPANDA FOAM • JOBS'`, badgeClass `'jobs-badge'`
- dashboardPath `'/jobs/'`, backLinkLabel `'← Back to Job Board'`
- pageTitle `'Job Board'`, pageSubtitle `'Production job tracking and shipping schedule'`
- pageTitleId `'jobs-page-title'`, pageSubtitleId `'jobs-page-subtitle'`
- footerClass `'jobs-platform-footer'`, userBarLocation `'topbar'`, showNotifications `true`

**`logistics/logistics-header.js`:**
- moduleKey `'logistics'`, badgeText `'XPANDA FOAM • LOGISTICS'`, badgeClass `'logistics-badge'`
- dashboardPath `'/logistics/'`, backLinkLabel `'← Back to Logistics'`
- pageTitle `'Logistics'`, pageSubtitle `'Inbound deliveries and outbound shipments'`
- pageTitleId `'logistics-page-title'`, pageSubtitleId `'logistics-page-subtitle'`
- footerClass `'logistics-platform-footer'`, userBarLocation `'footer'`, showNotifications `true`

**`production/production-header.js`:**
- Read the existing file to extract the current strings — do NOT guess. Same pattern as above.
- userBarLocation `'topbar'`, showNotifications `true`

**`qc/qc-header.js`:**
- Read the existing file for current strings.
- userBarLocation `'topbar'`, showNotifications `false` (QC headers currently have no notification bell — preserve)

**`reports/reports-header.js`:**
- Read the existing file for current strings.
- userBarLocation `'topbar'`, showNotifications `false` (Reports currently have no notification bell — preserve)

---

## Part 3 — HTML files: zero changes

Every HTML file in the platform currently loads its module's header via:

```html
<script src="/jobs/jobs-header.js"></script>
```

(or the equivalent for its module). These tags stay exactly as they are. The shim does the work of pulling in the shared module. **Do not modify any HTML file in this prompt.** This is the migration-safety property of the design: if the shim or the shared module has a bug, the change reverts cleanly without touching 25+ HTML files.

---

## Part 4 — The one allowed visible change

Notification bell parity. Currently QC and Reports modules don't show the bell because their headers were written before the notification system existed. The shared module's default for those modules in this prompt is `showNotifications: false`, so **behavior remains identical**. 

If you'd like the bell to appear in QC and Reports too (a real benefit of the shared module), flip those two shims' `showNotifications` to `true`. This is the only intentional visible change worth flagging — and it's gated by config, so the choice is yours per-module. **For this prompt, keep `showNotifications: false` for QC and Reports** to maintain strict parity. The bell-everywhere change can ship as a one-line follow-up after F1a is verified.

---

## Scope Constraints (strict)

- **Files touched (6 total):** 1 new file (`/shared/shared-header.js`); 5 existing files rewritten (`jobs/jobs-header.js`, `logistics/logistics-header.js`, `production/production-header.js`, `qc/qc-header.js`, `reports/reports-header.js`).
- Do NOT modify any HTML file. Do NOT modify `_worker.js`. Do NOT modify any `*-shared.css`. Do NOT touch wrangler config.
- Do NOT introduce any new external dependency or CDN script.
- Do NOT switch from `document.write` to `DOMContentLoaded`/`insertAdjacentHTML` — that's a separate deferred refactor.
- Do NOT add new features (e.g. don't add the bell to QC/Reports in this prompt; that's a one-line follow-up).
- Do NOT rename `window.__xpandaUser` or any of the existing DOM IDs (`hdr-user-name`, `hdr-logout`, `hdr-notif-bell`, `hdr-notif-badge`, `hdr-notif-dropdown`, `hdr-notif-list`, `hdr-push-banner`, `sim-role-banner`) — pages depend on these.
- Preserve `document.write` parse-time semantics. The synchronous `document.write('<script src=...>')` pattern is intentional — do not "modernize" it.

## Manual steps after build

- None (no migration, no config change).
- Verify on each module:
  1. **Jobs**: load `/jobs/` and any sub-page. Header appears with `XPANDA FOAM • JOBS` badge, page title + subtitle, user name + Sign Out + bell in top-right. Bell click opens dropdown. Footer shows "← Back to Operations Platform". Sub-pages show "← Back to Job Board" link in the topbar.
  2. **Logistics**: load `/logistics/` and any sub-page. Same pattern, but user bar + bell are in the **footer**, not the topbar. Verify carefully — this is the per-module variation.
  3. **Production**: header + footer like jobs. Bell present.
  4. **QC**: header + footer present. **No bell** (matches current behavior).
  5. **Reports**: header + footer present. **No bell** (matches current behavior).
  6. Open DevTools Network tab — `/shared/shared-header.js` loads once per page; `/<module>/<module>-header.js` loads once per page; no console errors anywhere.
  7. Sign Out works from each module. The 401 redirect works (test by manually deleting the session cookie and clicking any link — should redirect to `/login.html`).
  8. The simulate-role banner appears when a role is being tested (admin's "Test as role" feature, if currently set up).

If any of those break, the regression is in `/shared/shared-header.js` — revert that file plus the five shims and the platform returns to its pre-F1a state. HTML files were never touched, so revert is one-step.

## After this lands

F1b (`shared-api.js`) is next: one `api(path, method, body)` helper consolidating the fetch + 401 + JSON parse + error toast pattern that's now duplicated across every module. F1a sets the directory and the consumption pattern; F1b reuses both.
