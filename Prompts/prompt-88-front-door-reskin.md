# Prompt 88 — UI Overhaul: Front-Door Reskin (`index.html` + `login.html`)

## Agents to assume

**Read BOTH `AGENTS.md` AND `xpanda-ops-agents.md`, plus `agent-frontend-designer.md`.** Assume:
- **Lead: frontend-designer.**
- Honor cross-cutting rules: vanilla HTML/CSS/JS, no frameworks, no build step.

**No DB migration. No `_worker.js` change.** Touches exactly two files: `index.html` and `login.html`.

**Depends on Prompt 85** (`shared/tokens.css` exists with canonical slate palette + auto dark mode).

## Context

The landing page and login are the platform's front door and currently look the least cohesive. `index.html` has a self-contained inline `:root` plus **eight hardcoded module button colors** (`.hp-btn-safety` #2563eb, `.hp-btn-qc` #dc2626, `.hp-btn-reports` #7c3aed, `.hp-btn-jobs` #0891b2, `.hp-btn-logistics`/`.hp-btn-admin` #475569, `.hp-btn-loading` #2563eb, `.hp-btn-production` #d97706) — a "rainbow" that reads as unprofessional. `login.html` already uses the slate `#1e293b` but hardcodes every color, so neither page supports the new dark mode.

Goal: route both pages onto `shared/tokens.css`, **unify every action button to the slate primary**, keep a single colored **icon chip** per module for scannability (colored icon, neutral button — the professional pattern), tighten card alignment, and make both pages dark-mode-correct. **Keep all existing markup IDs, classes, and JavaScript wiring intact** — this is a visual reskin, not a rewire. The notification + push system on `index.html` stays exactly as wired.

Emoji glyphs in the icon chips are **kept** (no new icon dependency). Do not introduce an icon font.

---

## PART 1 — `index.html`: wire tokens + reconcile the inline `:root`

1. In `<head>`, add **before** the existing `<style>` block:
   ```html
   <link rel="stylesheet" href="/shared/tokens.css">
   ```
2. In the inline `:root`, **remove** these (now provided by tokens.css): `--bg`, `--surface`, `--surface-2`, `--text`, `--text-muted`, `--text-hint`, `--radius`. **Keep** `--max-w: 960px;` (page-specific layout width). The inline `:root` should end up containing only `--max-w`.
3. The inline CSS references `var(--border)`, which tokens.css does not define. Replace every `var(--border)` in this file with `var(--line)`.

## PART 2 — `index.html`: kill the rainbow, refine chips, tame the sign-out link

1. **Buttons → slate.** Replace the eight per-module color rules (`.hp-btn-safety`, `.hp-btn-qc`, `.hp-btn-reports`, `.hp-btn-jobs`, `.hp-btn-logistics`, `.hp-btn-loading`, `.hp-btn-production`, `.hp-btn-admin`) with a single grouped rule. Do **not** change the HTML — the class names stay on the elements; only their CSS collapses:
   ```css
   .hp-btn-safety, .hp-btn-qc, .hp-btn-reports, .hp-btn-jobs,
   .hp-btn-logistics, .hp-btn-loading, .hp-btn-production, .hp-btn-admin {
     background: var(--primary-bg);
     color: var(--primary-text);
   }
   ```
   Change `.hp-btn:hover { opacity: 0.85; }` to `.hp-btn:hover { opacity: 0.92; }` (subtler). Leave `.hp-btn-outline` as the secondary style but retokenize it: `background: var(--surface); color: var(--muted); border: 1px solid var(--line);` and its hover `background: var(--surface-2);`.
2. **Icon chips kept, dark-mode added.** Leave the eight `.hp-icon-*` light tints as-is for light mode. Append a dark-mode block so the chips don't glare on the dark surface — soften each chip's background to a low-alpha dark tint and lighten the glyph color. Apply this pattern to all eight (examples show the intent; derive the rest consistently from each chip's existing hue):
   ```css
   @media (prefers-color-scheme: dark) {
     .hp-icon-safety     { background: rgba(37,99,235,.18);  color: #93c5fd; }
     .hp-icon-qc         { background: rgba(220,38,38,.18);  color: #fca5a5; }
     .hp-icon-reports    { background: rgba(124,58,237,.18); color: #c4b5fd; }
     .hp-icon-jobs       { background: rgba(8,145,178,.18);  color: #67e8f9; }
     .hp-icon-logistics  { background: rgba(71,85,105,.30);  color: #cbd5e1; }
     .hp-icon-loading    { background: rgba(37,99,235,.18);  color: #93c5fd; }
     .hp-icon-production { background: rgba(217,119,6,.18);  color: #fcd34d; }
     .hp-icon-admin      { background: rgba(71,85,105,.30);  color: #cbd5e1; }
   }
   ```
3. **Sign-out link.** It is currently `.hp-header-right a { color: #dc2626; … }`. Red is reserved for destructive/critical actions; a sign-out link should be quiet. Change to `color: var(--muted);` and add `.hp-header-right a:hover { color: var(--text); }`.
4. **Card hover.** `.hp-card:hover` hardcodes `border-color: #d1d5db; box-shadow: 0 2px 8px rgba(0,0,0,0.06);`. Replace with `border-color: var(--input-border); box-shadow: var(--shadow-md);`.

## PART 3 — `index.html`: alignment polish

1. Make all cards equal height per row so the action rows align: on `.hp-grid` keep the grid, and ensure `.hp-card` already uses `flex-direction: column` with `.hp-card-actions { margin-top: auto; }` (it does) — no change needed there, but set `.hp-grid { align-items: stretch; }` to guarantee equal heights when descriptions wrap differently.
2. Normalize the icon chip + title baseline: set `.hp-card-head { align-items: center; }` (already) and `.hp-card-title { font-size: 16px; font-weight: 600; }` (down from 17/700 — sleeker, consistent with the component scale).
3. Tighten the grid gutter consistency: `.hp-grid { gap: 14px; }`.

## PART 4 — `index.html`: dark-mode-correct the notification dropdown

The notification dropdown markup is partly CSS and partly injected by `loadNotifications()`/the header JS with hardcoded hex. Replace the hardcoded colors with tokens so the dropdown is legible in dark mode. **Do not change any logic, IDs, or function names** — only color values.

CSS block:
- `.hp-notif-dropdown` → `background: var(--surface); border: 1px solid var(--line);`
- `.hp-notif-badge` and `.hp-notif-bell` keep red badge (`#dc2626`) — that's a true alert indicator, leave it.

Inline-styled markup + JS template literals (swap these exact hex values to tokens where they set text/surface/border — leave the alert/info accent blues as-is):
- Dropdown header border `#e5e7eb` → `var(--line)`
- Push banner: bg `#eff6ff` → `var(--accent-soft)`; secondary text `#6b7280` → `var(--muted)`
- Empty-state text `#9ca3af` → `var(--text-hint)`
- List item bottom border `#f3f4f6` → `var(--line)`
- List item unread bg `#eff6ff` → `var(--accent-soft)`
- Notification title `#111827` → `var(--text)`
- Notification message `#6b7280` → `var(--muted)`
- Timestamp `#9ca3af` → `var(--text-hint)`

(The "Mark all read" link `#3b82f6` and the push-banner heading `#1e40af` are intentional info-blue accents — leave them.)

## PART 5 — `index.html`: floor-mode sizing

The generic floor rules in `tokens.css` (Prompt 86) target `button`/`input`/`a.btn`, but this page's buttons are `a.hp-btn`. Add:
```css
html[data-mode="floor"] .hp-btn { min-height: 44px; padding: 10px 16px; font-size: 14px; }
html[data-mode="floor"] .hp-card { padding: 18px; }
```

---

## PART 6 — `login.html`: tokenize for dark mode + focus polish

`login.html` has no `:root` and hardcodes all colors. Keep all IDs, form structure, and JS untouched. Add the stylesheet and swap hardcoded hex for tokens:

1. In `<head>` add before the `<style>`: `<link rel="stylesheet" href="/shared/tokens.css">`.
2. In the inline CSS, apply these swaps:
   - `body { background: #f0f2f5; }` → `background: var(--bg);` and add `color: var(--text);`
   - `.login-card { background: #ffffff; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }` → `background: var(--card-bg); box-shadow: var(--shadow-md); border: 1px solid var(--line);`
   - `h1 { color: #111827; }` → `color: var(--text);`
   - inputs: `border: 1px solid #d1d5db;` → `var(--input-border)`; `color: #111827;` → `var(--text)`; add `background: var(--input-bg);`
   - `input:focus { border-color: #94a3b8; }` → `border-color: var(--primary-bg); box-shadow: 0 0 0 3px var(--accent-soft);`
   - `button { background: #1e293b; }` → `background: var(--primary-bg);` ; `button:hover { background: #334155; }` → `background: var(--accent);` ; `button:disabled { background: #94a3b8; }` → `background: var(--text-hint);`
   - `.error-msg { color: #dc2626; }` → `color: var(--danger-bg);`
   - `.info-msg { color: #2563eb; }` → leave as info-blue (it's an informational prompt), or set `color: var(--muted);` — use `var(--muted)`.
3. The login button text weight is `700`; set to `600` for consistency with the new scale.

---

## Scope guard — do NOT do any of the following

- Do **not** change any HTML structure, element IDs, `onclick` handlers, or any JavaScript function/logic on either page. Visual/CSS + the listed color-literal swaps only.
- Do **not** rewire `index.html` to use `shared/shared-header.js` — its homepage header and notification system stay self-contained for now.
- Do **not** introduce an icon font, SVG icon set, or any external dependency. Keep the emoji glyphs.
- Do **not** touch any other file, any module page, `shared/*`, or `_worker.js`.
- Do **not** add `shared/components.css` to these pages in this prompt (they keep their own `.hp-*` / element styles; component adoption is a later pass).

## Verify

- `/` (light): all action buttons are slate; module icon chips remain subtly colored; cards are equal height with aligned action rows; sign-out link is muted gray.
- `/` (OS dark mode): page, cards, header, and the notification dropdown are all dark and legible; icon chips are soft, not glaring; the red notification badge still pops.
- Floor mode (`data-mode="floor"`): landing buttons hit ≥44px.
- `/login.html` in both light and dark: card, inputs, and slate button all render correctly; focus ring shows; first-login password flow still works.
- Notification bell, dropdown, mark-all-read, and push-enable banner all still function (no JS changed).

## Manual steps after merge

- Hard-refresh to cache-bust.
- No D1 migration. No console steps.
