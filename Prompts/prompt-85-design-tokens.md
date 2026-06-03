# Prompt 85 — UI Overhaul (Foundation 1 of 3): Shared Design-Token Layer

## Agents to assume

**Read BOTH `AGENTS.md` AND `xpanda-ops-agents.md`, plus `agent-frontend-designer.md`.** Assume:
- **Lead: frontend-designer** — this is a cross-cutting visual-foundation change.
- Honor the Orchestrator cross-cutting rules: vanilla CSS only, no build step, no frameworks.

**No DB migration. No `_worker.js` change. No JavaScript change.** This prompt is CSS only.

## Context

Today there is **no shared design layer**. Each module's `*-shared.css` declares its own `:root`, and the values have drifted — most badly `--primary-bg`, which is four different colors across modules (jobs `#0891b2` cyan, logistics `#334155` slate, manufacturing/production `#d97706` amber, qc/reports `#1a73e8` blue), none of them the xPanda brand. There is also no dark mode anywhere on the platform.

We are **keeping every existing variable name** and only **unifying the values** into one canonical palette, defined once. Decision (already made): canonical primary is slate (`#1e293b`); brand red `#E31837` is reserved for the logo and true destructive/critical CTAs only (exposed as a new additive `--brand` token). Dark mode is **auto via `prefers-color-scheme` only** — no toggle, no persistence (the floor/office toggle is a separate concern in Prompt 86).

This prompt does three things and nothing else:
1. Create `shared/tokens.css` — canonical light values for every shared variable name, plus a `@media (prefers-color-scheme: dark)` block overriding those same names.
2. `@import` it at the top of the six module `*-shared.css` files.
3. Strip the now-duplicated color/surface/text/border/radius/shadow declarations out of those six module `:root` blocks, keeping only the module-specific tokens.

Standalone pages that do **not** link a module CSS (`index.html`, `login.html`, `admin/*.html`, `safety/*`, `track/index.html`) and pages with their own inline `:root` (`load-builder.html`, `block-calculator.html`, etc.) are **out of scope here** — they are reconciled in their own module reskin prompts (Prompt 88+). Do not touch them.

---

## Part 1 — Create `shared/tokens.css`

Create the file `shared/tokens.css` with exactly this content:

```css
/* shared/tokens.css — canonical platform design tokens (UI overhaul, Prompt 85).
   Single source of truth for color/surface/text/border/radius/shadow values.
   Keep existing variable names; values unified here. Light defaults + auto dark mode.
   Module-specific tokens (status colors, --page-max, --page-pad, --section-gap, --col-bg)
   stay in each module's own *-shared.css. */

:root {
  /* Surfaces */
  --bg: #f4f6f9;
  --surface: #ffffff;
  --surface-2: #f8f9fb;
  --card-bg: #ffffff;
  --card-border: #e5e7eb;
  --line: #e5e7eb;

  /* Text */
  --text: #111827;
  --muted: #4b5563;
  --text-muted: #6b7280;
  --text-hint: #9ca3af;

  /* Inputs / ghost / pill */
  --input-bg: #ffffff;
  --input-border: #d1d5db;
  --ghost-bg: #f3f4f6;
  --ghost-text: #111827;
  --pill: #475569;

  /* Primary (slate) + accent */
  --primary-bg: #1e293b;
  --primary-text: #ffffff;
  --accent: #0f172a;
  --accent-soft: #f1f5f9;

  /* Semantic */
  --danger-bg: #dc2626;
  --danger-text: #ffffff;
  --success-bg: #16a34a;
  --success-text: #ffffff;

  /* Brand red — reserved for logo + true destructive/critical CTAs ONLY (use sparingly) */
  --brand: #e31837;
  --brand-hover: #b31229;

  /* Geometry / elevation */
  --radius: 12px;
  --tile-radius: 14px;
  --shadow: 0 1px 3px rgba(0, 0, 0, .08);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, .10), 0 2px 4px -1px rgba(0, 0, 0, .06);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1117;
    --surface: #1a1d29;
    --surface-2: #232634;
    --card-bg: #1a1d29;
    --card-border: #2d3142;
    --line: #2d3142;

    --text: #f3f4f6;
    --muted: #9ca3af;
    --text-muted: #9ca3af;
    --text-hint: #6b7280;

    --input-bg: #232634;
    --input-border: #3d4256;
    --ghost-bg: #232634;
    --ghost-text: #f3f4f6;
    --pill: #64748b;

    --primary-bg: #334155;
    --primary-text: #ffffff;
    --accent: #cbd5e1;
    --accent-soft: #232634;

    --danger-bg: #ef4444;
    --success-bg: #22c55e;

    --brand: #ef4356;
    --brand-hover: #e31837;

    --shadow: 0 1px 3px rgba(0, 0, 0, .40);
    --shadow-md: 0 4px 8px -1px rgba(0, 0, 0, .50), 0 2px 4px -1px rgba(0, 0, 0, .40);
  }
}
```

---

## Part 2 — `@import` tokens.css into each module CSS

For **each** of these six files, insert as the **very first line** of the file (before the `:root` block; if a file begins with an `@charset` rule, the import goes immediately after it — `@import` must precede all rules except `@charset`):

```css
@import url('/shared/tokens.css');
```

Files:
- `jobs/jobs-shared.css`
- `logistics/logistics-shared.css`
- `manufacturing/manufacturing-shared.css`
- `production/production-shared.css`
- `qc/qc-shared.css`
- `reports/reports-shared.css`

---

## Part 3 — Strip duplicated declarations from each module `:root`

In the **same six files**, delete the following variable declarations from the `:root` block (they are now canonical in tokens.css). Leave the `:root` block in place — it will still hold module-specific tokens.

**Remove these names wherever present in the module `:root`:**
`--bg`, `--surface`, `--surface-2`, `--card-bg`, `--card-border`, `--line`, `--text`, `--muted`, `--text-muted`, `--text-hint`, `--input-bg`, `--input-border`, `--ghost-bg`, `--ghost-text`, `--pill`, `--primary-bg`, `--primary-text`, `--accent`, `--accent-soft`, `--danger-bg`, `--danger-text`, `--success-bg`, `--success-text`, `--radius`, `--tile-radius`, `--shadow`

**KEEP these names in the module `:root` (module-specific — do NOT remove):**
- `jobs`: `--col-bg`, `--status-not-started`, `--status-in-production`, `--status-done`, `--status-shipped`, `--page-max`
- `logistics`: `--status-awaiting`, `--status-in-transit`, `--status-delivered`, `--status-cancelled`, `--page-max`
- `manufacturing`: `--page-max`, `--page-pad`, `--section-gap`
- `production`: `--page-max`, `--page-pad`, `--section-gap`
- `qc`: `--page-max`, `--page-pad`, `--section-gap`
- `reports`: `--page-max`, `--page-pad`, `--section-gap`

**Bug to fix while you're in there:** `manufacturing-shared.css`, `production-shared.css`, and `qc-shared.css` each declare `--page-pad` **twice** (`16px` then `12px`). Collapse to a single `--page-pad: 12px;` (the later, effective value).

Do not change any value of a kept token. Do not touch any selector other than `:root`. Do not touch any rule that *uses* `var(--…)` — those keep working unchanged, now resolving to the canonical values.

---

## Scope guard — do NOT do any of the following

- Do **not** create or modify `shared/components.css` (that is Prompt 87).
- Do **not** add any JavaScript, theme toggle, or `data-mode` logic (that is Prompt 86).
- Do **not** touch standalone pages (`index.html`, `login.html`, `admin/*.html`, `safety/*`, `track/index.html`) or any page's inline `<style>`/inline `:root`.
- Do **not** edit `_worker.js`, any `*-header.js`, or any HTML file.
- Do **not** rename any variable. Do **not** restyle any component, change layout, or add responsive rules.

## Verify

- The six module CSS files each start with the `@import` line and have a slimmed `:root` containing only the kept module-specific tokens.
- `shared/tokens.css` exists with the light `:root` and the `prefers-color-scheme: dark` block.
- Open a module page (e.g. `/logistics/`, `/jobs/`) — primary buttons/accents are now slate, identical across modules; nothing is broken or unstyled.
- Toggle OS dark mode — module pages flip to the dark palette; text stays legible.

## Manual steps after merge

- Hard-refresh (cache-bust) on the deployed site — `tokens.css` is a new asset.
- No D1 migration. No console steps.
