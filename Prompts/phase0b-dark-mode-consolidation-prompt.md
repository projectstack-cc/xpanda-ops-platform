# Claude Code Prompt — Phase 0b: Dark-Mode Consolidation (single `[data-theme]` source, dark default)

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. This is primarily a shared-layer change, so assume the **Orchestrator** role for the `tokens.css` / shared-header / module-CSS work. The two QC pages are touched, so also assume the **qc-agent** for `qc/final-inspection.html` and `qc/incident-report.html`. Read `agent-frontend-designer.md` — its `ThemeManager` utility and `[data-theme="dark"]` mechanism are the spec this prompt implements.

## Context
Dark mode is currently a mess: `tokens.css` activates it via `@media (prefers-color-scheme: dark)`, but every module `*-shared.css` ALSO declares a `body.dark { … }` block that redeclares the same core tokens with drifted hex values, and only two QC pages have a working toggle (using a separate `body.dark` class + `localStorage['xpandaTheme']`). The result: "change the dark background" is a six-file edit, and dark mode is dead code on most pages. We are consolidating to a single source of truth using the `[data-theme="dark"]` attribute mechanism the design agent specs, and making dark the default.

## Default behavior (confirm before running)
`ThemeManager` defaults to **dark** when the user has no saved preference, and persists their choice. If you instead want it to follow the device's system setting, change the single default value in step D from `'dark'` to `(prefersDark ? 'dark' : 'light')` — nothing else changes.

## Task

### A. `shared/tokens.css` — make it the single dark source
- Find the `@media (prefers-color-scheme: dark) { :root { … } }` block. Change its activation from the media query to the attribute: convert it to `:root[data-theme="dark"] { … }`, keeping every declaration and **every hex value exactly as-is**. (Light values stay as the base `:root` — they are the no-JS fallback.)
- Do not change any token value. This step changes *how* dark activates, not the colors.

### B. Module CSS files (6) — strip drift, repoint selector
For each of: `jobs/jobs-shared.css`, `logistics/logistics-shared.css`, `manufacturing/manufacturing-shared.css`, `production/production-shared.css`, `qc/qc-shared.css`, `reports/reports-shared.css`:
- Change the `body.dark { … }` selector to `:root[data-theme="dark"] { … }`.
- **Remove** from that block every declaration of a token that `tokens.css` owns (the canonical set: `--bg`, `--surface`, `--card-bg`, `--card-border`, `--line`, `--text`, `--muted`, `--text-muted`, `--text-hint`, `--input-bg`, `--input-border`, `--ghost-bg`, `--ghost-text`, `--pill`, `--primary-bg`, `--primary-text`, `--accent`, `--accent-soft`, `--danger-bg`, `--danger-text`, `--success-bg`, `--success-text`, `--brand`, `--brand-hover`, `--shadow`, `--shadow-md`). These now come from `tokens.css`; the drifted local values (`#0f172a`, `#121212`, etc.) are deleted.
- **Keep** only the module-specific dark tokens that `tokens.css` does NOT define (e.g. `--col-bg`, `--status-*`, `--dir-outbound`, `--dir-inbound`). If a module's dark block contains only canonical tokens, the block becomes empty — delete it entirely.

### C. `index.html` — remove its private dark block
- Remove the inline `@media (prefers-color-scheme: dark) { … }` block from `index.html`'s `<style>`. Any non-core dark overrides it contained should be re-expressed as `:root[data-theme="dark"] { … }`; drop any that merely duplicate canonical tokens. `index.html` loads `tokens.css`, so it inherits the single dark source.

### D. `ThemeManager` — single shared instance
- Implement the `ThemeManager` from `agent-frontend-designer.md` with three deltas: (1) `STORAGE_KEY = 'xpanda-theme'`; (2) it sets the attribute on `document.documentElement` (`setAttribute('data-theme', theme)`); (3) default is **`'dark'`** when no saved value (see "Default behavior" above).
- Place it in the **single consolidated shared header source** (per Prompt 74 this is the extracted shared header — locate it by inspection, likely `/shared/shared-header.js`; confirm before editing). Do NOT duplicate `ThemeManager` into each module's `*-header.js`.

### E. Toggle control — in the shared header
- Add one theme-toggle button to the shared header markup (near the notification bell / user menu), calling `ThemeManager.toggle()`.
- Use an inline SVG sun/moon icon — **no emoji** (emoji-as-icons are a separate cleanup target; do not add new ones). Give the button an `aria-label` ("Toggle dark mode") and a visible focus state.

### F. Reconcile the two QC pages
In `qc/final-inspection.html` and `qc/incident-report.html`:
- Remove their bespoke dark-mode JS (the `document.body.classList` toggle and the `localStorage['xpandaTheme']` read/write).
- Their dark CSS is already handled by `qc-shared.css` after step B; ensure these pages activate dark through the shared `ThemeManager`/header mechanism, not the old `body.dark` class. If these pages do not currently load the shared header, ensure `ThemeManager` still runs on them (load the shared header source, or the minimal bootstrap from step G) and report which you did.

### G. Zero-flash on entry pages (`index.html`, `login.html` only)
These two have no header JS, so add a minimal synchronous bootstrap as the **first element in `<head>`**, before any stylesheet, so the theme is set before first paint:
```html
<script>document.documentElement.setAttribute('data-theme', localStorage.getItem('xpanda-theme') || 'dark');</script>
```
(Module pages get their theme from `ThemeManager` in the shared header; a brief flash there is acceptable for now. Do not add this snippet to the other ~25 pages in this prompt.)

## Output / Verification
- Confirm: changing one value in `tokens.css` `:root[data-theme="dark"]` now changes that color platform-wide (no module file redeclares it).
- Confirm: every module page, plus `index.html` and `login.html`, loads dark by default, the header toggle flips light/dark and persists across reload, and light mode still renders correctly.
- List every file edited and confirm no light-mode colors changed.

## What NOT to Change
- Do **not** edit `admin/*.html`, `safety/*`, or `track/index.html` — they have no external CSS/header and are deferred to Phase 0c.
- Do **not** change any hex value in `tokens.css`; only change the dark-mode *activation selector*. Light-mode appearance must be untouched everywhere.
- Do **not** apply `--font-mono` to numbers, add the nav bar, fix the `load-builder.html` relative CSS path, replace the bell emoji, or touch inline-style/hardcoded-color drift. No "while I'm here" fixes.
- Do **not** touch `_worker.js`, the auto-pack algorithm, `STORAGE_KEY` (`foam_trailer_loader_v31` — unrelated to the theme key), or any DB/migration file. This is CSS + header JS only; no migration needed.
