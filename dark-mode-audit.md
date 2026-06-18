# xPanda Ops Platform — Dark-Mode Legibility Audit

> **Type:** Report-only. No code changes. Follow-on fix prompts will use this as their map.  
> **Date:** 2026-06-18  
> **Dark mode is the default** — the shared-header boot script falls back to `'dark'` when no saved preference exists.

---

## 1. Summary

| Module | Bucket A (real bugs) | Notes |
|---|---|---|
| Safety (`safety/`) | ~15 | **Worst offender — zero token adoption.** Both pages are entirely hardcoded light CSS with no dark overrides whatsoever. |
| Loading Dashboard (`logistics/loading.html`) | ~15 | Large inline `<style>` block predates token system; most card/modal surfaces are hardcoded white. |
| Logistics Dashboard (`logistics/index.html`, `bol-compose.js`) | ~12 | Modal surfaces, review panel, info banners, job-picker rows all hardcoded. |
| Load Builder (`logistics/load-builder.html`) | ~10 | Own token system + dark overrides exist but several modal overlays / UI panels use hardcoded `#fff`. |
| Job Board (`jobs/index.html`) | ~10 | New List view (P182/P183) introduced most of the issues — table, headers, search box all hardcoded. |
| Shared header / components (`shared/`) | ~8 | Notification dropdown, push banner, mode-toggle button, badge-warning/info colours. |
| `track/index.html` | ~8 | Standalone driver page with its own self-contained light styles; never loads tokens.css. |
| Production (`production/`) | ~5 | Badge and back-link colours; bead-inventory muted-state text. |
| QC (`qc/`) | ~3 | Back-link colour; pass/fail `.ok/.warn/.err` are semantic (Bucket B). |
| Homepage (`index.html`) | ~2 | Error banner only (icon bg/text have dark overrides). |
| Reports (`reports/`) | ~3 | Back-link, badge-hover, error text. |

**Total Bucket A: ~91 actionable hits across the platform.**

**State of adoption in one line:** The CSS layer (shared + module `-shared.css` files) is mostly tokenized; the problem is the thousands of hardcoded hex values in inline `style="…"` attributes and `<style>` blocks inside HTML files that were built or grown before the token system was fully adopted.

---

## 2. Per-module sections

### 2a. Safety (`safety/index.html`, `safety/sds.html`)

**Status: 0% token adoption — both files are fully broken in dark mode.**

Neither page loads `tokens.css` or uses any CSS custom properties. Every surface, border, text and link colour is a raw hex. This is the highest-priority fix batch.

#### Bucket A

| File | Line | Value | Property / Context | Recommended token |
|---|---|---|---|---|
| safety/index.html | 26 | `#f9f9f9` | `body background-color` | `var(--bg)` |
| safety/index.html | 59 | `#555` | body text `color` | `var(--text)` |
| safety/index.html | 66 | `#cfd8e3` | search input border | `var(--input-border)` |
| safety/index.html | 69 | `#fff` | search input background | `var(--input-bg)` |
| safety/index.html | 71 | `#111` | search input text color | `var(--text)` |
| safety/index.html | 82 | `#555` | result card text | `var(--muted)` |
| safety/index.html | 88 | `#ddd` | result card border | `var(--card-border)` |
| safety/index.html | 95 | `#0074cc` | active/focus border | no token fits — needs `--interactive` or `--focus-ring` |
| safety/index.html | 109–110 | `#cfd8e3` / `#fff` | SDS card border / background | `var(--card-border)` / `var(--card-bg)` |
| safety/index.html | 113 | `#111` | SDS card text | `var(--text)` |
| safety/index.html | 130 | `#555` | category label | `var(--muted)` |
| safety/index.html | 155–158 | `#ddd` / `#0074cc` | table border / link | `var(--line)` / no token for interactive link |
| safety/index.html | 162 | `#666` | table text | `var(--muted)` |
| safety/index.html | 169–170 | `#f3f7ff` / `#cfe0ff` | info banner background/border | no token — propose `var(--info-bg)` / `var(--info-border)` |
| safety/index.html | 174–175 | `#fff7e6` / `#ffd59e` | warning banner background/border | no token — propose `var(--warn-bg)` / `var(--warn-border)` |
| safety/sds.html | 30 | `#f9f9f9` | page background | `var(--bg)` |
| safety/sds.html | 62 | `#555` | body text | `var(--text)` |
| safety/sds.html | 69–74 | `#cfd8e3` / `#fff` / `#111` | search input border / bg / text | `var(--input-border)` / `var(--input-bg)` / `var(--text)` |
| safety/sds.html | 85, 93, 141 | `#ccc` / `#ddd` | table/card borders | `var(--card-border)` / `var(--line)` |
| safety/sds.html | 118–120 | `#f9f9f9` / `#ddd` | section header bg / border | `var(--surface-2)` / `var(--line)` |
| safety/sds.html | 157–158 | `#aaa` / `#f1f1f1` | empty-state text / background | `var(--text-hint)` / `var(--ghost-bg)` |

#### Bucket B
None — no semantic/status colours found in safety pages (they don't use status pills or charts).

#### No-token-fits notes
- A general interactive link colour token (`--link`) would unify `#0074cc` and related blues across Safety, Reports, QC back-links, and header.
- An info-banner token pair (`--info-bg`, `--info-border`) would cover the `#f3f7ff/#cfe0ff` pattern in Safety, which also appears in Logistics (job-linked-note) and Load Builder banners.
- A warn-banner token pair (`--warn-bg`, `--warn-border`) for `#fff7e6/#ffd59e` patterns.

---

### 2b. Loading Dashboard (`logistics/loading.html`)

**Status: Partial adoption.** The file uses `var(--line)`, `var(--surface-2)`, `var(--card-bg)`, `var(--ghost-bg)`, `var(--muted)` correctly, but a large inline `<style>` block still hardcodes most card/modal surfaces to light values.

#### Bucket A

| File | Line | Value | Property / Context | Recommended token |
|---|---|---|---|---|
| loading.html | 16 | `#111827` | `.ld-toolbar h2` text color | `var(--text)` |
| loading.html | 17 | `#d1d5db` | `.ld-view-toggle` border | `var(--input-border)` |
| loading.html | 21 | `#d1d5db` | `#bay-selector` border | `var(--input-border)` |
| loading.html | 22–23 | `#1e293b` / `#334155` | `.ld-btn-pull` bg / hover | `var(--primary-bg)` |
| loading.html | 25 | `#6b7280` | `.ld-section-title` color | `var(--text-muted)` |
| loading.html | 30 | `#111827` | `.ld-bay-number` color | `var(--text)` |
| loading.html | 31 | `#d1d5db` | `.ld-trailer-input` border | `var(--input-border)` |
| loading.html | 37–38 | `#1e40af` / `#1e3a8a` | `.ld-inv-link` color/hover | no token — needs `--link` |
| loading.html | 40–41 | `#6b7280` / `#d1d5db` | card meta / trailer input | `var(--text-muted)` / `var(--input-border)` |
| loading.html | 44 | `#6b7280` | chevron icon color | `var(--text-hint)` |
| loading.html | 45–46 | `#1e293b` / `#334155` | `.ld-btn-advance` bg/hover | `var(--primary-bg)` |
| loading.html | 48 | `#fff` / `#d1d5db` | `.ld-btn-archive` bg/border | `var(--card-bg)` / `var(--card-border)` |
| loading.html | 51–52 | `#fef3c7` / `#92400e` / `#f59e0b` | `.ld-btn-yard` bg/text/border | no token — proposal below |
| loading.html | 57–58 | `#9ca3af` | `.ld-empty / .ld-empty-bay` | `var(--text-hint)` |
| loading.html | 67 | `#6b7280` | `.ld-bay-group-title` | `var(--text-muted)` |
| loading.html | 71 | `#fff` | `.ld-modal-card` background | `var(--card-bg)` |
| loading.html | 74 | `#6b7280` | `.ld-modal-close` | `var(--muted)` |
| loading.html | 76 | `#374151` | modal body label text | `var(--text)` |
| loading.html | 77 | `#d1d5db` | modal inputs border | `var(--input-border)` |
| loading.html | 79 | `#fff` / `#d1d5db` | `.ld-btn-cancel` bg/border | `var(--card-bg)` / `var(--card-border)` |
| loading.html | 80 | `#1e293b` | `.ld-btn-confirm` background | `var(--primary-bg)` |
| loading.html | 84 | `#eff6ff` / `#3b82f6` | selected job result bg/border | no token (info-bg / focus-ring) |
| loading.html | 243 | `#111827` | shipping info modal heading | `var(--text)` |
| loading.html | 244 | `#6b7280` | modal close button | `var(--muted)` |
| loading.html | 246 | `#374151` | shipping info body text | `var(--text)` |
| loading.html | 255 | `#111827` | BOL modal heading | `var(--text)` |
| loading.html | 258 | `#6b7280` | BOL modal close | `var(--muted)` |
| loading.html | 1308 | `#d1d5db` | checklist textarea border | `var(--input-border)` |

#### Bucket B
- Lines 329–334: Loading status colour map (`awaiting`, `not_started`, `loading`, `loaded`, `in_transit`, `delivered`) — semantic status colours, theme-independent by design.
- Line 104: Overlay photo thumbnail: `background: rgba(0,0,0,0.6); color: #fff` — dark overlay, intentional.
- Line 680–681: Toast `background:#1e293b; color:#fff` — already dark by intent (same pattern as jobs-toast which also hardcodes dark).
- Lines 456, 582, 1085: Load-count badge `color:#6366f1` (indigo = in_transit semantic), `color:#3b82f6` link — semantic.

#### No-token-fits notes
- `.ld-btn-yard`: amber warning action button (`#fef3c7` bg, `#92400e` text). A `--btn-warn-bg` / `--btn-warn-text` token pair would cover this and the load-builder runner warning consistently.
- Selected state `#eff6ff`/`#3b82f6` needs `--selected-bg` / `--selected-border` (or reuse the proposed `--info-bg`).

---

### 2c. Logistics Dashboard (`logistics/index.html`, `logistics/bol-compose.js`)

**Status: Partial adoption.** `logistics-shared.css` is reasonably well-tokenized (status classes have dark overrides). The main issues are inline style attributes and the injected review-modal markup in `bol-compose.js`.

#### Bucket A

**`logistics/index.html` inline styles:**

| File | Line | Value | Property / Context | Recommended token |
|---|---|---|---|---|
| index.html | 27–29 | `#fff` / `#e5e7eb` / `#111827` | BOL viewer modal bg / border / heading | `var(--card-bg)` / `var(--line)` / `var(--text)` |
| index.html | 31–32 | `#f3f4f6` / `#4b5563` / `#d1d5db` | Download btn bg/text/border | `var(--ghost-bg)` / `var(--muted)` / `var(--input-border)` |
| index.html | 32 | `#6b7280` | Close button color | `var(--muted)` |
| index.html | 114–117 | `#d1d5db` | Calendar nav button borders | `var(--input-border)` |
| index.html | 185 | `#eff6ff` / `#bfdbfe` / `#1e40af` | `#job-linked-note` info banner | no token (info-bg / info-border / info-text) |
| index.html | 418–420 | `#374151` / `#d1d5db` / `#f3f4f6` / `#6b7280` | Signed BOL section heading/thumb/meta | `var(--text)` / `var(--card-border)` / `var(--surface-2)` / `var(--text-muted)` |
| index.html | 424 | `#374151` | Loading Photos section heading | `var(--text)` |
| index.html | 1496–1499 | `#f8fafc` / `#e2e8f0` / `#64748b` | Job picker list item bg/border/sub-text | `var(--surface-2)` / `var(--card-border)` / `var(--text-muted)` |
| index.html | 1243–1247 | `#f3f4f6` / `#6b7280` | Line-items table row border / dim text | `var(--line)` / `var(--text-muted)` |

**`logistics/logistics-shared.css`:**

| File | Lines | Value | Property / Context | Recommended token |
|---|---|---|---|---|
| logistics-shared.css | 284–293 | Various light bg/text | Status pills (`.status-awaiting` etc.) — **no dark overrides for awaiting/not_started/in_production/ready_to_ship** | These 4 need dark overrides added (pattern: `rgba` tint like the existing dark overrides for delivered/loaded etc.) |
| logistics-shared.css | 306–309 | `#fef3c7`/`#92400e` / `#f0f9ff`/`#0369a1` | `.action-load` / `.action-bol` — **has dark overrides below**, so Bucket B | already handled |
| logistics-shared.css | 535–536 | `#fef2f2` / `#fca5a5` | `.logistics-error` background/border — **has dark override (line 688)** | already handled |
| logistics-shared.css | 637 | `#1e40af` | `.cal-more:hover` text color | no token — needs `--link` |

**`logistics/bol-compose.js` review modal injected markup:**

| File | Lines | Value | Property / Context | Recommended token |
|---|---|---|---|---|
| bol-compose.js | 125–126 | `#fff` | Review modal background | `var(--card-bg)` |
| bol-compose.js | 130 | `#e5e7eb` | Review modal header border | `var(--line)` |
| bol-compose.js | 132 | `#111827` | "Review BOL" heading | `var(--text)` |
| bol-compose.js | 136–138 | `#ffffff` / `#374151` / `#d1d5db` | Cancel button bg/text/border | `var(--card-bg)` / `var(--text)` / `var(--input-border)` |
| bol-compose.js | 145–146 | `#fff` / `#d1d5db` | Cancel (2nd) bg/border | `var(--card-bg)` / `var(--input-border)` |
| bol-compose.js | 150 | `#1e293b` | Approve button background | `var(--primary-bg)` |
| bol-compose.js | 157–158 | `#e5e7eb` / `#ffffff` | Editor host border/bg | `var(--line)` / `var(--card-bg)` |
| bol-compose.js | 164 | `#374151` | "Editing BOL" label | `var(--text)` |
| bol-compose.js | 167 | `#d1d5db` | BOL number select border | `var(--input-border)` |
| bol-compose.js | 175 | `#f9fafb` | Editor iframe host bg | `var(--surface-2)` |
| bol-compose.js | 296, 307 | `#6b7280` | hide-dims / siplast label | `var(--text-muted)` |

#### Bucket B
- `logistics-shared.css` lines 284–293 have dark overrides for `delivered`, `loaded`, `loading`, `in_transit`, `cancelled`, `scheduled`. **The four without dark overrides (`awaiting`, `not_started`, `in_production`, `ready_to_ship`) are Bucket A**, not B.
- Lines 306–309 (action-load/action-bol) + lines 341–347 (inbound card border-left status colors): intentional semantic status colours.
- BOL/PDF paths in `bol-shared.js` and `bols.js`: entirely Bucket B (draw on white paper).

---

### 2d. Load Builder (`logistics/load-builder.html`)

**Status: Has its own local token system** (lines 18–74 with dark overrides). Most of the diagram/SVG/canvas code adapts via local vars. Main issues are modal overlays and certain UI panels that use raw `#fff`.

#### Bucket A (UI surfaces only — SVG/canvas drawing excluded)

| File | Line | Value | Property / Context | Recommended token |
|---|---|---|---|---|
| load-builder.html | 211 | `#fff` | Canvas tab panel background | `var(--card-bg)` (global) or `var(--surface)` |
| load-builder.html | 355 | `#fff` | Print preview panel background | `var(--card-bg)` |
| load-builder.html | 1628 | `#92400E`/`#FDE68A`/`#FFFBEB` | SKU-error warning panel | local `var(--warn-text)`/`var(--warn-border)`/`var(--warn-bg)` |
| load-builder.html | 1842 | `#FEF3C7`/`#92400E` | AUTO-DOWNSIZED tag | local `var(--warn-bg)`/`var(--warn-text)` |
| load-builder.html | 1843 | `#EDE9FE`/`#5B21B6` | FORCED type tag | local `var(--purple-bg)` — **no such token exists; propose `--purple-bg`** |
| load-builder.html | 1857–1858 | `#92400E`/`#D97706` | Runners / remaining text spans | local `var(--warn-text-dark)`/`var(--accent)` |
| load-builder.html | 2042 | `#3b82f6` | Drag drop column outline | local `var(--blue)` |
| load-builder.html | 2112 | `#fff3cd`/`#ffc107`/`#856404` | Force-size warning div | local warn vars |
| load-builder.html | 2406 | `#eff6ff`/`#bfdbfe`/`#1e40af` | Pull-from-job info banner | local `var(--blue-bg)`/`var(--blue-border)`/`var(--blue)` |
| load-builder.html | 2411, 2418 | `#1e40af` | Links in job banner | local `var(--blue)` |
| load-builder.html | 2482 | `#fff` | Saved loads modal background | `var(--card-bg)` |
| load-builder.html | 2494 | `#f9fafb`/`#e5e7eb` | Load record row bg/border | `var(--surface-2)`/`var(--card-border)` |
| load-builder.html | 2556, 2562 | `#6b7280` | Loading/empty state text | `var(--text-muted)` or local `var(--text-faint)` |
| load-builder.html | 2568–2569 | `#f3f4f6`/`#f9fafb` | Pull-job list item bg/hover | local `var(--border-light)` |
| load-builder.html | 2580 | `#ef4444` | Error text in pull job list | local `var(--red)` |
| load-builder.html | 2669 | `#fff` | Pull-job picker modal bg | `var(--card-bg)` |
| load-builder.html | 2673 | `#e5e7eb` | Picker header border | local `var(--border-light)` |
| load-builder.html | 2674–2677 | `#111827`/`#6b7280` | Picker heading/close color | `var(--text)` / `var(--muted)` (global) |

#### Bucket B
- Lines 458–480: Block/SKU product-identity colours (the visual load diagram) — theme-independent by design.
- Lines 1049–1140 (all SVG draw calls) and lines 1167–1172 (html2canvas print capture) — canvas/diagram rendering on virtual white paper.
- Lines 1149–1153: Print view pack-list HTML (renders to PDF page) — same Bucket B.
- Lines 1344–1345: `error` / `success` alert colours — semantic.

#### No-token-fits notes
- `--purple-bg`: needed for the "FORCED" tag (`#EDE9FE`/`#5B21B6`). No existing global or local var covers this.

---

### 2e. Job Board (`jobs/index.html`, `jobs/jobs-shared.css`)

**Status: `jobs-shared.css` is well-tokenized.** The main dark-mode issues come from the new List view HTML markup (P182/P183) which hardcoded all its inline styles, and a handful of pre-existing hardcoded values in older parts of the HTML.

#### Bucket A

**`jobs/jobs-shared.css`:**

| File | Line | Value | Property / Context | Recommended token |
|---|---|---|---|---|
| jobs-shared.css | 70 | `#0891b2` | `.jobs-back-link` color | no token — needs `--link` |

**`jobs/index.html` (new List view, lines 148–167, 690, 719, 728, 731):**

| File | Line | Value | Property / Context | Recommended token |
|---|---|---|---|---|
| index.html | 125 | `#d1d5db` | View-toggle wrapper border | `var(--input-border)` |
| index.html | 148–149 | `#d1d5db` | List search input border / week-btn border | `var(--input-border)` |
| index.html | 151 | `#fff` / `#e5e7eb` | Table wrapper background / border | `var(--card-bg)` / `var(--card-border)` |
| index.html | 154 | `#f9fafb` | `<thead>` row background | `var(--surface-2)` |
| index.html | 155–160 | `#6b7280` | Column header text colour | `var(--text-muted)` |
| index.html | 165, 167 | `#9ca3af` | Empty-state text / footer text | `var(--text-hint)` |
| index.html | 204–207 | `#d1d5db` | Calendar nav button borders | `var(--input-border)` |
| index.html | 237–241 | `#d1d5db` / `#6b7280` / `#9ca3af` | Upload dropzone border/text/hint | `var(--input-border)` / `var(--text-muted)` / `var(--text-hint)` |
| index.html | 252 | `#1e40af` | "View Packing Slip" link | no token — needs `--link` |
| index.html | 255 | `#d1d5db` | Packing slip iframe border | `var(--input-border)` |
| index.html | 690 | `#9ca3af`/`#f3f4f6`/`#111827`/`#6b7280` | List tab button colours (active/inactive) | `var(--text-hint)` / `var(--ghost-bg)` / `var(--text)` / `var(--text-muted)` |
| index.html | 719 | `#2563eb` | Load-count badge colour | no token — Bucket B adjacent (count indicator, close to semantic) |
| index.html | 728 | `#6b7280` | Ship date column text | `var(--text-muted)` |
| index.html | 731 | `#d1d5db` | Loading cell dash (no badge) | `var(--text-hint)` |
| index.html | 2090 | `#6b7280` | BOL view modal close button | `var(--muted)` |

**`jobs/index.html` (misc / older sections):**

| File | Line | Value | Property / Context | Recommended token |
|---|---|---|---|---|
| index.html | 1684 | `#fef3c7`/`#92400e`/`#fcd34d` | BDFT process badge in card | no token — proposal: `--badge-warn-*` |

#### Bucket B
- Lines 1221–1228: Bead-prompt modal — intentionally dark-themed (`#dc2626`, `rgba(255,255,255,0.1)`, `#fff`) — bespoke dark prompt, leave alone.
- Line 2093: BOL viewer iframe `background:#525659` — intentional dark PDF surround.
- Line 1011: Toast `color:#34d399` — success-green semantic colour (same pattern across all toasts).
- Lines 768–770: Trailer badge and loading badge — semantic status colours.

---

### 2f. Shared Header + Components (`shared/`)

**Status: Partial.** `shared-header.js` has several hardcoded inline values for notification dropdown UI.

#### Bucket A

| File | Line | Value | Property / Context | Recommended token |
|---|---|---|---|---|
| shared-header.js | 98 | `#3b82f6` | "Mark all read" button text | no token — needs `--link` |
| shared-header.js | 100–102 | `#eff6ff`/`#1e40af`/`#6b7280` | Push-notification enable banner bg/text/sub | no token (`--info-bg`) / no token (`--info-text`) / `var(--muted)` |
| shared-header.js | 113 | `#d1d5db`/`#5b6472` | Mode-toggle button border/text | `var(--input-border)` / `var(--muted)` |
| shared-header.js | 219 | `#6b7280` | Footer user-bar text | `var(--text-muted)` |
| shared-header.js | 372 | `#f3f4f6` | Notif item border-bottom | `var(--line)` |
| shared-header.js | 372 | `#eff6ff` | Unread notif background | no token (`--info-bg`) |
| shared-header.js | 374–375 | `#6b7280`/`#9ca3af` | Notif message/timestamp text | `var(--text-muted)` / `var(--text-hint)` |
| shared/components.css | 56–57 | `#b45309`/`#2563eb` | `.badge-warning` text / `.badge-info` text | no token — both need dark-adapted variants |
| shared/photo-gallery.js | 41 | `#d1d5db`/`#f3f4f6` | Thumbnail border/background | `var(--card-border)` / `var(--surface-2)` |
| shared/photo-gallery.js | 53 | `#b91c1c` | Thumbnail error text | `var(--danger-bg)` |

#### Bucket B
- `shared-header.js` line 94: Notif badge `background:#dc2626` — danger-red semantic colour.
- `shared-header.js` line 110: Sign-out link `color:#dc2626` — danger semantic.
- Photo gallery lightbox (`rgba(0,0,0,0.92)`, `color:#fff`) — intentionally dark overlay.
- `.btn-brand { color: #fff }` — always white on brand-red; intentional.

---

### 2g. `track/index.html` (Driver delivery page)

**Status: Standalone, self-contained, never loads tokens.css.** The page intentionally has its own minimal style block. However it is a public-facing page used on mobile outdoors, and currently renders entirely light with hardcoded backgrounds.

> **Decision needed:** Is `track/index.html` in scope for dark-mode? It does not load the shared token system. The fix would either (a) add `tokens.css` and `shared-header.js` imports (larger change) or (b) add local dark vars + `@media (prefers-color-scheme: dark)` to the page's own style block. Recommend option (b) as a standalone pass.

#### Bucket A (assuming the page should adapt)

| File | Line | Value | Property / Context | Recommended token / action |
|---|---|---|---|---|
| track/index.html | 9 | `--bg: #f0f2f5` / `--card: #ffffff` | Page background / card surface | Add local dark vars: `--bg: #0f1117`; `--card: #1a1d29` |
| track/index.html | 11 | `#111827` | Body text color | Add local `--text` dark override |
| track/index.html | 24 | `#fef2f2`/`#fecaca` | Error panel bg/border | Add local `--error-bg` / `--error-border` |
| track/index.html | 25 | `#f0fdf4`/`#bbf7d0` | Success panel bg/border | Add local `--ok-bg` / `--ok-border` |
| track/index.html | 29 | `#eff6ff` | Radio group checked bg | dark override needed |
| track/index.html | 36 | `#fafafa` | Photo upload button bg | `#232634` in dark |
| track/index.html | 38–39 | `#fff`/`#fafafa` | Sig pad bg / clear btn bg | white `#fff` is intentional for the canvas drawing surface — see Bucket B |
| track/index.html | 40 | `#f9fafb` | Line items background | dark surface |

#### Bucket B
- Line 153: `ctx.strokeStyle = '#111'` — signature pad canvas stroke, must remain dark ink on white pad.
- Line 181: `rgb(0, 0, 0)` in pdf-lib draw call — BOL PDF stamp text colour, must stay black on white paper.
- Line 38: `.sig-pad { background: #fff }` — signature pad background must remain white so the ink shows.

---

### 2h. Production (`production/`, `production-shared.css`)

**Status: Mostly tokenized.** The shared CSS has a few light-only accent colours. The main HTML (`production/index.html`) appears clean.

#### Bucket A

| File | Line | Value | Property / Context | Recommended token |
|---|---|---|---|---|
| production-shared.css | 65–67 | `#92400e`/`#fffbeb`/`#fde68a` | `.prod-badge` amber badge | no token — needs `--badge-warn-*`; or propose `--warn-bg`/`--warn-text` |
| production-shared.css | 93 | `#b45309` | `.prod-back-link` color | no token — needs `--link` (amber variant) |
| production/inventory.html | 232 | `#cbd5e1` | `#molding-days` select border | `var(--input-border)` |
| production/inventory.html | 351 | `#fffbeb`/`#fcd34d`/`#92400e` | `#cm-job-label` warning banner | `var(--ghost-bg)` / `var(--card-border)` / `var(--text)` — or better: proposed `--warn-bg` |
| production/bead-inventory.html | 512, 787, 1003, 1105 | `#94a3b8` | Empty/loading state muted text | `var(--text-hint)` |

#### Bucket B
None.

---

### 2i. QC (`qc/`)

**Status: Mostly tokenized.** The shared CSS is thin; most QC pages use the shared token system. Pass/fail indicators are semantic.

#### Bucket A

| File | Line | Value | Property / Context | Recommended token |
|---|---|---|---|---|
| qc/qc-shared.css | 88 | `#0074cc` | `.qc-back-link` color | no token — needs `--link` |

#### Bucket B
- `qc/final-inspection.html` lines 151–153, `qc/density-calculator.html` lines 128–130, `qc/incident-report.html` lines 144–146: `.ok { color: #0b7a28 }`, `.warn { color: #b35c00 }`, `.err { color: #b00020 }` — pass/fail semantic colours; theme-independent by design.

---

### 2j. Reports (`reports/`)

**Status: Partially tokenized.** The `reports-shared.css` has a few raw values; `reports/index.html` itself is clean (uses only CSS classes).

#### Bucket A

| File | Line | Value | Property / Context | Recommended token |
|---|---|---|---|---|
| reports-shared.css | 70 | `#0074cc` | `.reports-back-link` color | no token — needs `--link` |
| reports-shared.css | 356 | `#e2e8f0` | `.reports-badge:hover` background | `var(--ghost-bg)` |

#### Bucket B
- `reports-shared.css` line 238: `.report-status.error { color: #b00020 }` — semantic error; Bucket B.
- Any Chart.js dataset palettes in report JS files — not found in `reports/index.html` (no inline chart data).

---

### 2k. Homepage (`index.html`)

**Status: Well-handled for icons.** Module icon colours all have dark overrides. One error banner is missing a dark override.

#### Bucket A

| File | Lines | Value | Property / Context | Recommended token |
|---|---|---|---|---|
| index.html | 219–220 | `#fef2f2`/`#fecaca`/`#991b1b` | Error banner bg/border/text | `var(--danger-bg)` with opacity / no token for bg — propose `--error-banner-*` |

#### Bucket B
- Lines 176–192: Module icon background/text pairs — all have matching `[data-theme="dark"]` overrides immediately below. Intentional.
- Line 199: Notification badge `background: var(--danger-bg); color: #fff` — uses token for bg; `#fff` is always correct on danger-red.

---

## 3. Excluded

### Admin pages (deliberate deferral)
`admin/roles.html`, `admin/users.html`, `admin/parts.html`, `admin/activity-log.html` are **excluded from this audit and all follow-on fix batches** by design. These pages were deliberately kept outside the shared-header migration and use legacy hand-rolled CSS. They are known to be illegible in dark mode. Decision on record: fix deferred indefinitely; revisit only if admin pages get a broader rewrite.

### Bucket C artifacts
`.wrangler/tmp/` and any build/dist output — not inventoried.

---

## 4. Recommended fix batching order

### Pre-fix: Shared tokens first
Before any module batch, consider adding three new token pairs to `shared/tokens.css` that would unify patterns across multiple modules:

```
--link (light: #0074cc or #0891b2; dark: #60a5fa or similar)
    → Used in: Safety, QC, Reports, Production back-links, Jobs back-link, Logistics cal-more hover

--info-bg / --info-border / --info-text
    → Used in: Logistics job-linked-note, Load Builder banners, Loading Dashboard job-result.selected,
      shared-header push banner, Job Board loading modal

--warn-bg / --warn-border / --warn-text
    → Used in: Loading Dashboard .ld-btn-yard, Production prod-badge/cm-job-label, Load Builder warnings,
      inventory.html job-label banner, safety warning banners
```
Adding these three token triplets (~9 lines in tokens.css) before the fix batches eliminates the majority of "no token fits" notes above and avoids multiple modules each independently hardcoding the same pattern.

### Batch order

| Batch | Module | Rationale |
|---|---|---|
| **1** | **Safety** (`safety/index.html`, `safety/sds.html`) | Worst offender: 0% token adoption, entirely broken. Both pages are self-contained (own `<style>` block); the fix is straightforward search-and-replace of ~20 hardcoded values. **Fix first to show the biggest single improvement.** |
| **2** | **Loading Dashboard** (`logistics/loading.html`) | 63 hardcoded hex hits, mostly in one inline `<style>` block. High user-visible impact (loading team uses this daily in dark mode). Can be done as one prompt with a clear scope. |
| **3** | **`bol-compose.js` review modal** (`logistics/bol-compose.js`) | The BOL review modal is injected as a JS string — a single block of hardcoded HTML. ~10 values, isolated. Fix before the broader logistics sweep. |
| **4** | **Logistics Dashboard** (`logistics/index.html`) | Inline style sweep. ~10–12 values but spread across many lines. Also includes adding the missing dark overrides for `.status-awaiting`, `.status-not_started`, `.status-in_production`, `.status-ready_to_ship` in `logistics-shared.css`. |
| **5** | **Job Board** (`jobs/index.html`) | The new List view (P182/P183) introduced the bulk of the issues — all inline styles that can be converted to CSS class rules in `jobs-shared.css`. Also the `.jobs-view-toggle` border, calendar nav buttons, dropzone. |
| **6** | **Load Builder** (`logistics/load-builder.html`) | Most complex fix: the file already has a local token system, so corrections mostly mean using local vars (`var(--warn-bg)` etc.) rather than global tokens. Keep the SVG/canvas drawing code strictly untouched. |
| **7** | **Shared** (`shared/shared-header.js`, `shared/components.css`, `shared/photo-gallery.js`) | Notification dropdown, push banner, mode toggle, badge colours. Small number of values but they affect every page. |
| **8** | **Production** (`production-shared.css`, `inventory.html`, `bead-inventory.html`) | Small, clean fix. Badge and back-link colours plus a couple of inline styles. |
| **9** | **QC + Reports** | Tiny batch — both are mostly tokenized. Main fix: back-link `--link` token; Reports badge hover; QC `.ok/.warn/.err` deliberate Bucket B (no change needed). |
| **10** | **`track/index.html`** | Standalone page: either add a local `@media (prefers-color-scheme: dark)` block or import tokens.css. Recommend keeping standalone (option b) to avoid changing the page's deployment footprint. |
| **11** | **Homepage** | One error banner. Tiny, can be combined with Batch 8 or 9 if convenient. |

> **Note:** `admin/*` pages remain excluded from all batches above. `logistics/bol-shared.js`, `logistics/bol-compose.js` (PDF paths), `_worker.js/routes/bols.js`, and all SVG/canvas drawing code in `load-builder.html` and `production/block-calculator.html` remain Bucket B throughout.
