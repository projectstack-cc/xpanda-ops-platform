# Claude Code Prompt — Phase 0a: Typography Foundation (IBM Plex, platform-wide)

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. This is a cross-module change to the shared layer, so assume the **Orchestrator** role from `xpanda-ops-agents.md` — it is not owned by a single domain agent. Also read `agent-frontend-designer.md`: it is the design authority for typography, and its `--font-sans` / `--font-mono` tokens must match exactly what this prompt sets in `tokens.css`.

## Context
The platform currently has no tokenized typography — every page hardcodes `font-family: Arial, sans-serif` in its CSS `body` rule. This is a primary reason the UI reads as unfinished. We are switching the whole platform to the IBM Plex superfamily in ONE step, defined once in `shared/tokens.css` and referenced everywhere via `var(--font-sans)`. This change touches `font-family` ONLY. No colors, spacing, layout, or dark-mode logic change in this prompt.

## Task

### 1. `shared/tokens.css`
- Add this as the **very first line of the file** (an `@import` must precede all other rules):
  ```css
  @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
  ```
- Inside the canonical `:root { … }` block, add these two tokens:
  ```css
  --font-sans: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  ```
- Add a single base rule so the family cascades by default:
  ```css
  body { font-family: var(--font-sans); }
  ```
  Do **not** add `background`, `color`, or any other property to this `body` rule — font-family only.

### 2. Module CSS files (6 files)
In each of the following, find the `body { … }` rule and replace its `font-family: Arial, sans-serif;` declaration with `font-family: var(--font-sans);`. Change nothing else in the `body` rule (keep margins, background, color, etc. exactly as they are):
- `jobs/jobs-shared.css`
- `logistics/logistics-shared.css`
- `manufacturing/manufacturing-shared.css`
- `production/production-shared.css`
- `qc/qc-shared.css`
- `reports/reports-shared.css`

### 3. Home and login pages (2 files)
These already load `/shared/tokens.css`, so `var(--font-sans)` resolves. In each page's inline `<style>`, set the `body` `font-family` to `var(--font-sans)` (replace `Arial`/system font if present; add the declaration to the `body` rule if absent):
- `index.html`
- `login.html`

## Output / Verification
After the edits, the entire platform (home, login, jobs, logistics, manufacturing, production, qc, reports) should render in IBM Plex Sans instead of Arial, with no other visual change. Briefly confirm each of the 9 files was edited and that no rule other than `body` `font-family` (plus the `tokens.css` additions) was modified.

## What NOT to Change
- Do **not** touch the `body.dark { … }` override blocks in any file — dark-mode consolidation is the next prompt (Phase 0b).
- Do **not** apply `--font-mono` to anything yet (numeric-data monospacing is a later per-module phase). Leave `load-builder.html`'s existing local `--mono` usage alone.
- Do **not** edit the `admin/*.html` or `safety/*` pages this round (they load no external CSS and need a separate, careful step).
- Do **not** fix the `load-builder.html` relative CSS path, the notification-bell emoji, or any inline-style/hardcoded-color drift — those are tracked for later phases. No "while I'm here" fixes.
- Do **not** add spacing, transition, or radius tokens in this prompt — typography only, to avoid introducing a parallel naming scheme before we reconcile it.
- Do **not** touch `_worker.js`, the auto-pack algorithm, `STORAGE_KEY` (`foam_trailer_loader_v31`), or any DB/migration file. No migration is needed — this is CSS only.
