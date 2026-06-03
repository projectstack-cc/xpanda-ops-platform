# Claude Code Prompt — Phase 2: Persistent Module Navigation Bar

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. Assume the **Orchestrator** role (this is a shared-header, cross-module change). Also assume the **admin-auth-agent** for the permission-aware visibility — reuse the existing `/api/auth/me` permission data the header already consumes; do not invent new permission logic. Read `agent-frontend-designer.md` for the `.app-header` / `.nav-link` styling and the required navigation pattern (a top bar listing modules; the back-to-dashboard pill is deprecated).

## Context
Today, switching modules requires returning to the home page via a "back to dashboard" pill. Replace that with a persistent top navigation bar listing all modules, with an active-state indicator, built ONCE in the consolidated shared header so it appears on every operational page at once. This is the most visible structural upgrade in the overhaul.

## Scope
Applies to pages that load the consolidated shared header located in Phase 0b — the operational module pages: jobs, logistics, manufacturing, production, qc, reports. Confirm by inspection. The home page (`index.html`), `admin/*`, `safety/*`, and `track/*` are **out of scope** for this prompt; they will receive the shared header (and thus the nav) in a later pass.

## Task

1. **Build the module nav in the shared header markup.** Horizontal links for: Job board (`/jobs`), Logistics (`/logistics`), Manufacturing (`/manufacturing`), Production (`/production`), QC (`/qc`), Reports (`/reports`), Safety (`/safety`), Admin (`/admin`). The logo/wordmark links to `/` (home). **Confirm the exact module set and paths against the repo's actual routes / the homepage module cards and match those** — do not assume.
   - Text labels only, sentence case. **No emoji and no per-module icons this pass** (icons are a later polish tied to replacing the homepage emoji).

2. **Active state.** Highlight the current module by matching `location.pathname` prefix (e.g. `/logistics/...` → Logistics active) via a `.nav-link.active` class. Use the same path→module mapping the platform already uses — mirror the `PATH_PERMISSION_MAP` keys so it stays consistent.

3. **Permission-aware visibility.** The header already fetches `/api/auth/me` and holds permission data. Hide nav items the current user lacks `view` permission for; the admin bypass shows all. Do **not** add new endpoints or permission keys — consume what the header already has.

4. **Remove the deprecated back-to-dashboard pill** from the shared header. If any individual page has its own duplicate back/home control, **list them and leave them in place** for a follow-up — do not delete page-level controls blindly.

5. **Responsive.** At ≥768px, show the full horizontal nav. Below 768px, collapse the module links into a menu toggle — a button with an inline SVG "menu" icon and `aria-label="Open menu"` — that opens a vertical list. Touch targets ≥44px. No emoji.

6. **Style** per `agent-frontend-designer.md`: use the `.app-header` / `.nav-link` tokens, borders over shadows (a hairline bottom border on the bar, no drop shadow), IBM Plex via `var(--font-sans)`, and the brand red (`var(--accent)` / `var(--brand)`) used only on the active indicator. Must render correctly in both dark (default) and light.

## Output / Verification
- The nav appears identically on all six operational modules, from a single shared source (no per-module duplication).
- The current module is highlighted; clicking any item navigates directly, without routing through home.
- Items the user lacks `view` permission for are hidden; admin sees all.
- The back-to-dashboard pill is gone from the shared header.
- Verified at 1440 / 1024 / 768 / 375px and in both themes.
- List every file edited; confirm the nav lives in exactly one shared file.

## What NOT to Change
- Do **not** duplicate the nav into the module `*-header.js` files — single shared source only.
- Do **not** modify `_worker.js` permission logic, `PATH_PERMISSION_MAP`, or any API/endpoint. Consume existing `/api/auth/me` data only. No migration is needed.
- Do **not** add the nav to `index.html`, `admin/*`, `safety/*`, or `track/*` this pass.
- Do **not** add emoji or a new module-icon set (the single menu/hamburger SVG is the only allowed icon). Per-module icons are a later polish bundled with the homepage emoji replacement.
- Do **not** restyle module page bodies or content — the header/nav only.
- Do **not** touch the auto-pack algorithm, `STORAGE_KEY` (`foam_trailer_loader_v31`), or any DB/migration file.
