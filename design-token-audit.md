# Design Token & Aesthetic Audit
**Date:** 2026-06-03 | **Role:** Orchestrator (read-only, no file edits)

---

## 1. Token Source of Truth

**Status: Partially consolidated — drift exists.**

`shared/tokens.css` is the intended single source, introduced in Prompt 85. Every module CSS file imports it via `@import url('/shared/tokens.css')`. However, `:root` is re-declared in 7 additional locations beyond tokens.css:

| File | Variables declared |
|---|---|
| `shared/tokens.css` | Canonical: `--bg`, `--surface`, `--card-bg`, `--card-border`, `--line`, `--text`, `--muted`, `--text-muted`, `--text-hint`, `--input-bg/border`, `--ghost-bg/text`, `--pill`, `--primary-bg/text`, `--accent`, `--accent-soft`, `--danger-bg/text`, `--success-bg/text`, `--brand`, `--brand-hover`, `--radius`, `--tile-radius`, `--shadow`, `--shadow-md` |
| `jobs/jobs-shared.css` | `--col-bg`, `--status-*` (4 values), `--page-max` |
| `logistics/logistics-shared.css` | `--status-*` (4 values), `--page-max`, `--dir-outbound/inbound` |
| `manufacturing/manufacturing-shared.css` | `--page-max`, `--page-pad`, `--section-gap` |
| `production/production-shared.css` | `--page-max`, `--page-pad`, `--section-gap` |
| `qc/qc-shared.css` | `--page-max`, `--page-pad`, `--section-gap` |
| `reports/reports-shared.css` | `--page-max`, `--page-pad`, `--section-gap`; also re-declares `--page-pad` inside `@media (max-width: 480px)` |

The module-level `:root` blocks are legitimate (layout/status tokens not appropriate for tokens.css). However, **each module CSS also declares a `body.dark { … }` override block** that re-declares the same core tokens from tokens.css with **drifted values**:

| Token | tokens.css dark value | jobs dark (`body.dark`) | production/qc/reports/manufacturing dark (`body.dark`) |
|---|---|---|---|
| `--bg` | `#0f1117` | `#0f172a` | `#121212` |
| `--card-bg` | `#1a1d29` | `#1c2333` | `#1c1c1c` |
| `--text` | `#f3f4f6` | `#f1f5f9` | `#f1f1f1` |
| `--shadow` | `0 1px 3px rgba(0,0,0,.40)` | `0 1px 3px rgba(0,0,0,.3)` | `0 1px 2px rgba(0,0,0,.28)` |
| `--card-border` | `#2d3142` | `#2d3a4f` | `#333` |

**Conclusion:** The same 4–5 core dark-mode tokens are defined 6 times across module CSS files with slightly different hex values. Any dark-mode color change must currently be made in 6 places.

---

## 2. Font Loading

**Status: No platform-wide web font. JetBrains Mono isolated to one file.**

| Method | Where |
|---|---|
| `<link>` Google Fonts | `logistics/load-builder.html` **only** — loads DM Sans (wt 400–900) and JetBrains Mono (wt 600–700) |
| `@font-face` | None found anywhere |
| System stack | All other pages — `font-family: Arial, sans-serif` set in every `*-shared.css` `body {}` rule |

**`shared/tokens.css` defines no `--font-sans` or `--font-mono` variable.** Typography is not tokenized at all — the font family is hardcoded as `Arial, sans-serif` directly in each module's CSS `body` rule.

**JetBrains Mono application:**
- Loaded via Google Fonts only in `logistics/load-builder.html`
- Applied via a local `--mono` variable (defined only in that file's inline `<style>`)
- Used on `.stat-card .stat-value`, dimension cells, and one cargo table column
- Not applied to any numeric data anywhere else on the platform
- `admin/activity-log.html` and `admin/users.html` use generic `font-family: monospace` in inline `<style>` blocks — fallback, not JetBrains Mono

**Gap vs. design agent target:** The design agent specifies JetBrains Mono with `tabular-nums` on ALL numeric data. Currently it applies to ~3 elements on one page.

---

## 3. Hardcoded Values (Drift)

**Status: Significant drift — 140 hardcoded color lines in CSS, 515 inline style instances in HTML.**

**In module CSS files** (hardcoded `#hex` / `rgb()` not wrapped in `var(--)`):

| File | Approx. hardcoded color lines |
|---|---|
| `logistics/logistics-shared.css` | 37 |
| `jobs/jobs-shared.css` | 31 |
| `production/production-shared.css` | 19 |
| `manufacturing/manufacturing-shared.css` | 19 |
| `reports/reports-shared.css` | 18 |
| `qc/qc-shared.css` | 16 |
| **Total** | **140** |

Note: `shared/tokens.css` and `shared/components.css` also contain hardcoded hex values — this is expected, as they *are* the token definitions.

**In HTML inline `style=""` attributes:**

| File | Inline style count |
|---|---|
| `logistics/loading.html` | 68 |
| `logistics/index.html` | 68 |
| `manufacturing/block-calculator.html` | 52 |
| `jobs/index.html` | 47 |
| `production/inventory.html` | 39 |
| `logistics/bol-generator.html` | 26 |
| `admin/roles.html` | 26 |
| `logistics/load-builder.html` | 25 |
| `reports/orders/index.html` | 22 |
| `admin/parts.html` | 19 |
| `admin/activity-log.html` | 16 |
| `index.html` | 14 |
| `admin/users.html` | 14 |
| `production/bead-inventory.html` | 12 |
| `manufacturing/holey-board-calculator.html` | 8 |
| `safety/training/` (multiple files) | 1–7 each |
| **Platform total** | **515** |

Many inline colors duplicate token values (`#dc2626` = `--danger-bg`, `#1e40af` used for notification text, `#d1d5db` = `--input-border`) without using `var()`. The notification bell dropdown header (`color:#1e40af`) appears hardcoded in 4 admin pages and index.html.

---

## 4. Shadow vs. Border

**Status: Borders ahead of shadows in CSS — partially aligned with target. HTML inline styles add uncounted shadows.**

**In CSS files** (structural separation uses):

| Module CSS | `box-shadow` uses | `border` uses |
|---|---|---|
| `jobs/jobs-shared.css` | 11 | 16 |
| `shared/components.css` | 8 | — |
| `reports/reports-shared.css` | 6 | 6 |
| `qc/qc-shared.css` | 5 | 7 |
| `production/production-shared.css` | 5 | 6 |
| `manufacturing/manufacturing-shared.css` | 5 | 6 |
| `logistics/logistics-shared.css` | 5 | 13 |
| **Totals** | **~45** | **~54** |

Borders moderately outpace shadows in the CSS layer — consistent with the "borders over shadows" direction. However, HTML inline styles in `logistics/loading.html` and `logistics/index.html` contain additional `box-shadow` values not captured here. `shared/components.css` `.card` uses both `border` and `box-shadow: var(--shadow)` simultaneously — the `--shadow` token value is intentionally lightweight (`0 1px 3px rgba(0,0,0,.08)`), so this is acceptable per the design agent's "things that genuinely float" rule.

---

## 5. Emoji as Icon

**Status: Widespread — primary anti-AI target. Found across homepage, all admin pages, and jobs module.**

| File | Emoji | Context |
|---|---|---|
| `index.html` | 🛡️ 📋 📊 📦 🚛 🏗️ 🏭 📦 ⚙️ | Module card icons (homepage — all 9 cards) |
| `index.html` | 🔔 | Header notification bell |
| `admin/activity-log.html` | 🔔 | Header notification bell (hardcoded in inline style) |
| `admin/parts.html` | 🔔 | Header notification bell (hardcoded in inline style) |
| `admin/roles.html` | 🔔 🔍 ✓ | Bell, role-simulation banner, save confirmation |
| `admin/users.html` | 🔔 | Header notification bell |
| `jobs/index.html` | 📄 | "Upload Packing Slip" button label (×3 locations) |
| `jobs/index.html` | 📦 | "Show/Hide Archived" button label |
| `jobs/index.html` | 🚚 | Card shipment indicator (dynamically injected) |
| `jobs/index.html` | ⚠ | Part-match warning badge (dynamically injected) |
| `jobs/index.html` | 📦 | Archive action text in toast notification |

The notification bell (🔔) is the most repeated emoji-as-icon: it appears in the header of every admin page plus the homepage and is part of the push notification UI (inline styles + emoji). The homepage module-card icons are the highest-visibility issue — 9 distinct emoji serving as the primary visual identifiers for every platform module.

---

## 6. Inline Styles

**Status: Pervasive — 515 instances across 39 files. Violates no-inline-styles rule.**

See Section 3 table for per-file counts. The worst concentrations are in:

- `logistics/loading.html` and `logistics/index.html` (68 each) — predominantly color values and layout dimensions hardcoded on individual elements
- `manufacturing/block-calculator.html` (52) — mostly canvas/diagram-related positioning
- `jobs/index.html` (47) — calendar view buttons, modal elements, dynamic JS-injected HTML
- `production/inventory.html` (39)

**Admin pages** (`admin/*.html`) warrant special mention: they load **no external CSS file** (only inline `<style>` blocks), meaning all styling is either in the inline block or `style=""` attributes. This was the intended pattern per AGENTS.md but results in per-page style drift and 14–26 inline style attributes per admin page.

---

## 7. Page → CSS/Header Map

| Page | CSS File(s) Loaded | Header JS |
|---|---|---|
| `index.html` | `/shared/tokens.css` + inline `<style>` | None (self-contained) |
| `login.html` | `/shared/tokens.css` + inline `<style>` | None |
| `admin/activity-log.html` | Inline `<style>` **only** | None |
| `admin/parts.html` | Inline `<style>` **only** | None |
| `admin/roles.html` | Inline `<style>` **only** | None |
| `admin/users.html` | Inline `<style>` **only** | None |
| `jobs/index.html` | `/jobs/jobs-shared.css` | `/jobs/jobs-header.js` |
| `jobs/packing-slip-test.html` | `/jobs/jobs-shared.css` | `/jobs/jobs-header.js` |
| `logistics/bol-generator.html` | `/logistics/logistics-shared.css` | `/logistics/logistics-header.js` |
| `logistics/index.html` | `/logistics/logistics-shared.css` | `/logistics/logistics-header.js` |
| `logistics/load-builder.html` | `logistics-shared.css` (**relative path — missing `/`**) | `/logistics/logistics-header.js` |
| `logistics/loading.html` | `/logistics/logistics-shared.css` | `/logistics/logistics-header.js` |
| `manufacturing/block-calculator.html` | `/manufacturing/manufacturing-shared.css` | `/manufacturing/manufacturing-header.js` |
| `manufacturing/cutting-dashboard.html` | `/manufacturing/manufacturing-shared.css` | `/manufacturing/manufacturing-header.js` |
| `manufacturing/holey-board-calculator.html` | `/manufacturing/manufacturing-shared.css` | `/manufacturing/manufacturing-header.js` |
| `manufacturing/index.html` | `/manufacturing/manufacturing-shared.css` | `/manufacturing/manufacturing-header.js` |
| `production/bead-inventory.html` | `/production/production-shared.css` | `/production/production-header.js` |
| `production/index.html` | `/production/production-shared.css` | `/production/production-header.js` |
| `production/inventory.html` | `/production/production-shared.css` | `/production/production-header.js` |
| `qc/density-calculator.html` | `/qc/qc-shared.css` | `/qc/qc-header.js` |
| `qc/final-inspection.html` | `/qc/qc-shared.css` | `/qc/qc-header.js` |
| `qc/incident-report.html` | `/qc/qc-shared.css` | `/qc/qc-header.js` |
| `qc/index.html` | `/qc/qc-shared.css` | `/qc/qc-header.js` |
| `qc/scrap-log.html` | `/qc/qc-shared.css` | `/qc/qc-header.js` |
| `reports/index.html` | `/reports/reports-shared.css` | `/reports/reports-header.js` |
| `reports/incidents/*.html` (6 files) | `/reports/reports-shared.css` | `/reports/reports-header.js` |
| `reports/scrap/*.html` (4 files) | `/reports/reports-shared.css` | `/reports/reports-header.js` |
| `reports/orders/index.html` | `/reports/reports-shared.css` | `/reports/reports-header.js` |
| `safety/index.html` | Inline `<style>` only | None |
| `safety/sds.html` | None found | None |
| `safety/training/*.html` | None / minimal inline | None |
| `track/index.html` | None found | None |

**Key anomalies:**
- `logistics/load-builder.html` uses a relative CSS path (`logistics-shared.css`) — all other pages use absolute paths (`/logistics/logistics-shared.css`). Works when served from `/logistics/` but is inconsistent.
- Admin pages have no external CSS — they are entirely self-contained. Any nav-bar rollout to admin pages will require adding external CSS link tags.
- `safety/sds.html`, `track/index.html` load no CSS at all.

---

## 8. Dark Mode

**Status: Spec implemented in CSS but not wired up on most pages. Two different activation mechanisms exist.**

**CSS layer:**
- `shared/tokens.css` has a `@media (prefers-color-scheme: dark) { :root { … } }` block — this is the only CSS-level auto dark mode. It fires for all pages that load tokens.css.
- All module `*-shared.css` files have `body.dark { … }` override blocks — these require a JS-applied class and do NOT respond to `prefers-color-scheme` automatically.
- `index.html` has an additional inline `@media (prefers-color-scheme: dark)` block in its `<style>` tag.

**JS / activation layer:**
- `qc/final-inspection.html` and `qc/incident-report.html` are the **only two pages** with a dark mode toggle button wired to JS. They toggle `document.body.classList` and persist via `localStorage.setItem('xpandaTheme', …)`.
- No other module pages have a dark mode toggle or `body.dark` class activation.
- Jobs, Logistics, Production, Manufacturing, Reports, and Admin pages all have `body.dark` CSS rules defined but **no mechanism to activate them** — the dark styles are dead code on those pages.

**Summary table:**

| Module | CSS dark rules exist | Auto (prefers-color-scheme) | Toggle UI wired |
|---|---|---|---|
| `index.html` | ✓ (inline `@media`) | ✓ | No |
| `login.html` | Inherits via tokens.css | ✓ | No |
| `jobs/` | `body.dark` block | No | No |
| `logistics/` | `body.dark` block | No | No |
| `manufacturing/` | `body.dark` block | No | No |
| `production/` | `body.dark` block | No | No |
| `qc/final-inspection.html` | `body.dark` block | No | **Yes** |
| `qc/incident-report.html` | `body.dark` block | No | **Yes** |
| `qc/` (other) | `body.dark` block | No | No |
| `reports/` | `body.dark` block | No | No |
| `admin/` | No external CSS | No | No |

The design agent spec calls for `data-theme` attribute activation and `ThemeManager` JS utility. The current implementation uses `body.dark` class (a different mechanism) and is only wired on 2 of ~35 pages.

---

## Consolidation Recommendation

**Yes — a single shared `design-tokens.css` (already partially exists as `shared/tokens.css`) must be completed before any visual changes begin.**

`shared/tokens.css` was the right call in Prompt 85, but it is incomplete: it covers color and geometry tokens only, omitting typography (`--font-sans`, `--font-mono`, `font-display`), spacing scale, and transition timing. More critically, each module CSS file redeclares 4–5 of the same core dark-mode tokens with slightly different values in `body.dark` blocks — meaning there is no single dark-mode truth despite the tokens file existing. The overhaul cannot reliably change "the background color in dark mode" in one place today; it requires 6 edits.

Before visual work begins: (1) add font, spacing, and transition variables to `tokens.css`; (2) consolidate the 6 drifted `body.dark` override blocks back into a single `[data-theme="dark"]` block in `tokens.css` using the design-agent's `data-theme` mechanism; (3) remove the now-redundant `body.dark` sections from each `*-shared.css`. Only then will a single token change propagate platform-wide without re-emerging drift.
