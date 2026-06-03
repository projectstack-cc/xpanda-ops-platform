# Claude Code Prompt — Homepage Redesign + Theme Toggle (overhaul wrap-up)

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. Assume the **Orchestrator** role — `index.html` is a root-level platform page, not a single domain. Read `agent-frontend-designer.md`: it is the design authority for the card system, icon discipline (one SVG set, never emoji), and the borders-over-shadows direction. If the homepage shows authenticated user info / sign-out, consult the **admin-auth-agent** conventions, but do not change any auth logic.

## Context
`index.html` is the first screen anyone sees and the last page still on the old aesthetic: a grid of nine emoji module cards, a 🔔 emoji bell, and hardcoded colors. It also has no theme toggle. This prompt brings it in line with the foundation shipped in Phase 0a/0b (IBM Plex, single-source dark via `[data-theme="dark"]`) and the icon discipline in the design agent. The homepage stays a **card launcher** — the cards are its navigation, so it does NOT get the Phase 2 module nav bar; its top bar stays minimal (wordmark + theme toggle, plus user/sign-out if already present).

## Task

1. **Foundation consistency.** Verify `index.html` renders dark by default (the pre-paint bootstrap from Phase 0b should already be the first element in `<head>`; add it if missing). Confirm body uses `var(--font-sans)` (IBM Plex, from Phase 0a). Replace hardcoded `#hex`/`rgb()` values in its inline `<style>` and `style=""` attributes with the corresponding `var(--…)` tokens from `tokens.css`, so both themes render correctly. The hardcoded notification-bell text color (`#1e40af`) and any card colors should become tokens.

2. **Theme toggle (the key requirement).** Add a dark/light toggle to the homepage top bar. It MUST use the identical contract as the platform `ThemeManager`: set `data-theme` on `document.documentElement` and persist to `localStorage['xpanda-theme']`, so toggling on the homepage carries to every module page and vice versa.
   - If `ThemeManager` can be loaded as a standalone script WITHOUT pulling in the authenticated header/nav chrome, load and reuse it. If `ThemeManager` is bundled inside the shared header such that loading it would inject the full header onto this card-launcher page, instead extract the theme logic to `/shared/theme.js` and have BOTH the shared header and this page load it — one mechanism, no duplication. State which path you took.
   - Use an inline SVG sun/moon icon, `aria-label="Toggle dark mode"`, visible focus state. No emoji.

3. **Icons — replace all emoji.** Replace the nine module-card emoji and the 🔔 bell with **inline SVG icons from a single set** (Lucide or Heroicons — paste the SVG markup directly; no icon-font or runtime-JS dependency, no `@latest` CDN). Use one consistent stroke weight and size. Map each existing card to the most apt icon (e.g. Logistics → truck, Job board → kanban/clipboard-list, Reports → bar-chart, Safety → shield/hard-hat, Admin → settings) and **list your final mapping** in the summary. Do not change card titles, descriptions, links, or destinations.

4. **Card restyle** per `agent-frontend-designer.md`: hairline borders for structure (not heavy drop shadows), a consistent `var(--radius)` / `var(--tile-radius)`, a subtle hover lift, layout = icon + title + existing one-line description, touch targets ≥44px. Use the brand red (`var(--accent)`/`var(--brand)`) sparingly — a hover accent or active state, not on every card. Give the page one clear hierarchy: a heading/wordmark area, then the grid. Polished and intentional, not experimental.

5. **Bell.** Swap the 🔔 emoji for the inline SVG bell — **visual only**. Do not change the notification dropdown markup behavior or any push-notification logic.

## Output / Verification
- The homepage matches the module pages' look: IBM Plex, dark by default, hairline-bordered cards, zero emoji.
- The toggle works and **syncs**: flip it on the homepage, navigate to a module page → same theme; flip it there, return home → same theme. Persists across reload.
- Both themes render correctly; verified at 1440 / 1024 / 768 / 375px.
- Report: which theme-toggle path you took (step 2), the icon mapping (step 3), and every file edited.

## What NOT to Change
- Do **not** change card links, titles, or destinations, and do **not** touch any auth/permission logic.
- Do **not** alter notification/push **logic** — the bell change is icon-only.
- Do **not** add the Phase 2 module nav bar to the homepage — keep its top bar minimal (wordmark + toggle + existing user/sign-out only).
- Do **not** restyle any other page, and do **not** edit `admin/*`, `safety/*`, or `track/*` (still parked for a later pass).
- Do **not** introduce a second theme mechanism or storage key — reuse `data-theme` + `localStorage['xpanda-theme']` exactly.
- Do **not** touch `_worker.js`, the auto-pack algorithm, `STORAGE_KEY` (`foam_trailer_loader_v31` — unrelated to the theme key), or any DB/migration file. No migration needed.
