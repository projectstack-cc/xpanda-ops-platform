# Prompt 89 — UI Overhaul: Logistics Shared CSS + Dashboard (Logistics reskin 1 of 4)

## Agents to assume

**Read BOTH `AGENTS.md` AND `xpanda-ops-agents.md`, plus `agent-frontend-designer.md`.** Assume:
- **Lead: frontend-designer**, with **logistics-agent** as domain owner of the files.
- Honor cross-cutting rules: vanilla CSS only, no frameworks, no build step.

**No DB migration. No `_worker.js` change. No JavaScript change. Do NOT touch `bol-shared.js` (critical shared coordinate file) or any auto-pack / load-builder logic.** Touches two files: `logistics/logistics-shared.css` and `logistics/index.html`.

**Depends on Prompts 85–87** (tokens + components + module imports merged). Note: after P85, `logistics-shared.css`'s `:root` retains only the module-specific tokens (`--status-awaiting`, `--status-in-transit`, `--status-delivered`, `--status-cancelled`, `--page-max`) — all color/surface/text/border/radius/shadow names now come from `shared/tokens.css`. This prompt works against that post-P85 state.

## Context

`logistics-shared.css` is the shared chrome for the logistics dashboard (`index.html`) and the loading page (`loading.html`), so polishing it lifts both. After P85 it's largely tokenized, but residual hardcoded colors remain — most importantly the **status pills** and **action chips**, which are pastel-on-light and will glare on the new dark mode. There are also two semantic "direction" colors (outbound cyan `#0891b2`, inbound green `#16a34a`) scattered across several rules, and the dashboard's inline `<style>` redundantly re-declares four rules that already live in the shared file.

Goal: tokenize the residual chrome, give the status pills + action chips + error/danger surfaces proper dark-mode variants, centralize the two direction colors into module-local tokens, and remove the duplicated inline block from the dashboard. **No markup, IDs, or JS change.**

---

## PART 1 — Add module-local direction tokens

The outbound (cyan) and inbound (green) colors appear in multiple rules. Centralize them into the logistics `:root` (these are legitimately module-specific tokens). Add to the `:root` in `logistics-shared.css`:

```css
  /* Direction accents (module-specific) */
  --dir-outbound: #0e7490;   /* teal-cyan, outbound */
  --dir-inbound:  var(--success-bg);  /* green, inbound */
```

And in the dark-mode section you add in Part 3, override:
```css
    --dir-outbound: #22d3ee;
    /* --dir-inbound inherits the dark --success-bg from tokens.css */
```

Then replace the hardcoded direction colors with these tokens:
- `.logistics-btn-outbound { background: #0891b2; … }` → `background: var(--dir-outbound);`
- `.logistics-btn-inbound { background: #16a34a; … }` → `background: var(--dir-inbound);`
- `.logistics-dir-btn.active-outbound { background: #0891b2; … }` → `background: var(--dir-outbound);`
- `.logistics-dir-btn.active-inbound { background: #16a34a; … }` → `background: var(--dir-inbound);`
- `.logistics-job-link { color: #0891b2; }` → `color: var(--dir-outbound);`
- `.logistics-inbound-card { border-left: 4px solid #16a34a; }` → `border-left: 4px solid var(--dir-inbound);`

## PART 2 — Tokenize residual chrome colors

Apply these exact swaps in `logistics-shared.css` (light values; dark handled in Part 3 via the tokens they now reference):

| Current | Replace with |
|---|---|
| topbar badge `color:#1e3a5f; background:#e8eef7; border-color:#b6cce8;` | `color: var(--accent); background: var(--accent-soft); border-color: var(--card-border);` |
| `.logistics-stat-label color:#64748b` | `var(--muted)` |
| `.logistics-table th color:#64748b` | `var(--muted)` |
| `.logistics-table th` bottom border / `td` border `#f1f5f9` | `var(--line)` |
| `.logistics-table tr:hover td background:#f8fafc` and any `#f8fafc` cell bg | `var(--ghost-bg)` |
| `.logistics-empty-row` / empty text `#94a3b8` | `var(--text-hint)` |
| `.logistics-bay-select border:#d1d5db; background:#fff;` | `border-color: var(--input-border); background: var(--input-bg);` |
| any standalone muted text `#64748b` / `#475569` (lines ~397, ~449, ~506, ~549) | `var(--muted)` |
| prompt banner `background:#0f172a; color:#fff;` | `background: var(--accent); color: var(--primary-text);` |
| `.logistics-prompt-banner-msg color:#94a3b8` | `var(--text-hint)` |
| `.logistics-inbound-card:hover box-shadow: 0 4px 16px rgba(15,23,42,.1)` | `box-shadow: var(--shadow-md);` |

**Calendar block (lines ~643–660):** swap `#e5e7eb` borders → `var(--line)`; cell `background:#fff` → `var(--card-bg)`; `.cal-cell-empty`/`.cal-weekend` `#fafafa` → `var(--surface-2)`; `.cal-today #eff6ff` → `var(--accent-soft)`; `.cal-day-num`/`.cal-header-cell`/`.cal-more` `#6b7280` → `var(--muted)`; `.cal-day-today` and `.logistics-view-btn.active` `background:#1e293b; color:#fff` → `var(--primary-bg)` / `var(--primary-text)`; `.logistics-view-toggle`/`.logistics-view-btn` border `#d1d5db` → `var(--input-border)`, bg `#fff` → `var(--card-bg)`, text `#6b7280` → `var(--muted)`; `.cal-more:hover`/`#1e40af` may stay as info-blue accent.

Leave the modal overlay scrim (`rgba(15,23,42,.55)`) and modal shadows as-is.

## PART 3 — Dark-mode variants for pills, chips, and danger surfaces

Append one `@media (prefers-color-scheme: dark)` block to `logistics-shared.css`. Pastel pills/chips must become low-alpha tints with lighter text so they read on the dark surface (same approach used on the landing page in P88). Include the `--dir-outbound` dark override from Part 1.

```css
@media (prefers-color-scheme: dark) {
  :root { --dir-outbound: #22d3ee; }

  /* Status pills */
  .status-awaiting,
  .status-cancelled     { background: rgba(148,163,184,.18); color: #cbd5e1; }
  .status-not_started,
  .status-in_production,
  .status-in_transit    { background: rgba(217,119,6,.20);  color: #fcd34d; }
  .status-ready_to_ship,
  .status-delivered     { background: rgba(22,163,74,.20);  color: #86efac; }
  .status-loading        { background: rgba(59,130,246,.20); color: #93c5fd; }
  .status-loaded         { background: rgba(16,185,129,.20); color: #6ee7b7; }
  .status-scheduled      { background: rgba(71,85,105,.30);  color: #cbd5e1; }

  /* Action chips */
  .action-load { background: rgba(217,119,6,.20); color: #fcd34d; border-color: rgba(217,119,6,.40); }
  .action-load:hover { background: rgba(217,119,6,.30); }
  .action-bol  { background: rgba(59,130,246,.18); color: #93c5fd; border-color: rgba(59,130,246,.40); }
  .action-bol:hover  { background: rgba(59,130,246,.28); }

  /* Danger/error banner */
  .logistics-error,
  .logistics-error-banner { background: rgba(220,38,38,.14); border-color: rgba(220,38,38,.40); }
}
```
(If the error-banner selector name differs, target the rule currently using `background:#fef2f2; border:1px solid #fca5a5; color:#dc2626;` — keep the `color` as `var(--danger-bg)` in light, and the dark tint above for dark.)

## PART 4 — De-duplicate the dashboard inline `<style>`

`logistics/index.html` contains an inline `<style>` block that re-declares `.logistics-action-btn`, `.action-load`, `.action-load:hover`, `.action-bol`, `.action-bol:hover`, and `.logistics-bay-select` — all already defined in `logistics-shared.css`. **Delete these duplicated rules from the inline block** so the shared file is the single source (the dashboard already links `logistics-shared.css`). If, after removal, the inline `<style>` is empty, remove the empty `<style></style>` tags too. Do not remove any other inline style the page may have.

## PART 5 — Floor-mode sizing

The generic floor rules (P86) cover `button` / `a.btn`, but logistics uses `.logistics-btn`, `.logistics-action-btn`, and a dense table. Add to `logistics-shared.css`:
```css
html[data-mode="floor"] .logistics-btn,
html[data-mode="floor"] .logistics-action-btn,
html[data-mode="floor"] .logistics-bay-select { min-height: 44px; }
html[data-mode="floor"] .logistics-action-btn { padding: 8px 12px; font-size: 13px; }
html[data-mode="floor"] .logistics-table td { padding: 14px 12px; }
```

---

## Scope guard — do NOT do any of the following

- Do **not** touch `bol-shared.js`, `bol-editor.js`, `load-builder.html`, `bol-generator.html`, or `loading.html` (each handled in its own later prompt). Those pages benefit automatically from the shared-CSS changes; do not open them here.
- Do **not** change any HTML structure, IDs, `onclick`s, JS, or the `--status-*` token values.
- Do **not** alter auto-pack logic, saved-loads behavior, or any BOL coordinate/rendering code.
- Do **not** rename any class or token. Do **not** restructure the `:root` beyond adding the two `--dir-*` tokens.

## Verify

- `/logistics/` (light) is unchanged in feel but cleaner; outbound elements teal-cyan, inbound green, primary buttons slate.
- `/logistics/` (OS dark): table, stat cards, calendar, status pills, and action chips are all dark-legible — no glaring pastels; text readable.
- `/logistics/loading.html` (shares the CSS) also renders correctly in light and dark.
- Floor mode: action buttons and bay selects hit ≥44px; table rows are roomier.
- The dashboard's action buttons and bay dropdown look identical to before in light mode (proving the inline-style removal didn't regress — shared CSS covers them).

## Manual steps after merge

- Hard-refresh to cache-bust.
- No D1 migration. No console steps.
