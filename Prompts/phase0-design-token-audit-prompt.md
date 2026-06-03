# Claude Code Prompt — Phase 0: Design Token & Aesthetic Audit (READ-ONLY)

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. This is a cross-module, platform-wide task, so assume the **Orchestrator** role from `xpanda-ops-agents.md` — do not act as a single domain agent. Also read `agent-frontend-designer.md`: it is the design source of truth this audit measures the codebase against.

## Context
We are starting a platform-wide visual overhaul. The biggest complaint after the presentation was aesthetics — the platform reads as machine-generated. Before changing anything, we need an accurate map of the current CSS / design-token reality, so the overhaul can change the foundation in ONE place instead of drifting across per-module files. This prompt is **audit only**. It produces a report and changes nothing else.

## Task
Produce a single report at `/design-token-audit.md`. Read-only — do not modify any other file. The report must answer these eight questions, each with concrete file paths and counts:

1. **Token source of truth.** Is there a single shared CSS file defining `:root` custom properties, or is `:root` redeclared in each `*-shared.css`? List every file that declares CSS custom properties. Where the same variable is defined in multiple files, note whether the values agree or have drifted.
2. **Font loading.** How are fonts loaded (Google Fonts `<link>`, `@font-face`, system stack)? Which families, in which files? Is the monospace face (JetBrains Mono per the design agent) actually applied to numeric data anywhere, or declared but unused?
3. **Hardcoded values (drift).** Find color values (`#hex`, `rgb(...)`) used directly instead of via `var(--…)`. List file + approximate count per file. This is the drift the overhaul must eliminate.
4. **Shadow vs. border.** Rough counts of `box-shadow` vs. `border` used for structural separation, per module. Tells us how far the current UI is from the "borders over shadows" target.
5. **Emoji-as-icon.** Find every emoji used as a UI icon (in buttons, nav, status indicators, headers). List file + context. This is a primary anti-AI cleanup target.
6. **Inline styles.** Count `style="…"` attributes per file (violates the no-inline-styles rule).
7. **Page → CSS/header map.** List every `.html` page, which CSS file(s) it loads, and which `*-header.js` it uses. This is needed to plan the nav-bar rollout across all pages.
8. **Dark mode.** Is dark mode actually implemented (`data-theme` / `prefers-color-scheme`) and on which pages — or is it spec-only in the design agent?

## Output
The report at `/design-token-audit.md` only. Group findings under the eight headings above. End with a short **"Consolidation recommendation"**: does the platform need a single shared `design-tokens.css` extracted before any visual changes begin? Yes/No + one paragraph why.

## What NOT to Change
- Do **not** edit any HTML, CSS, or JS file.
- Do **not** create `design-tokens.css` yet — this is audit only.
- Do **not** touch `_worker.js`, the auto-pack algorithm, `STORAGE_KEY` (`foam_trailer_loader_v31`), or any DB/migration file.
- No reformatting, no linting, no "while I'm here" fixes. The only file you write is `/design-token-audit.md`.
