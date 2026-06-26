# Prompt 211 — Cutting v2: `<ThemeToggle>` control (visible dark-mode switch)

## Agent
You are the **React Component Agent (§9b)** for the xPanda Operations Platform.

## Required reading (both, before any edit)
- `AGENTS.md`
- `xpanda-ops-agents.md` — §9b (React Component Agent).
- `agent-react-component.md` — reusable-component discipline, tokens-only, 44px targets, lucide icons.

## Context — 2 of the 4-prompt theme/header sequence
- P210 (shipped): theme engine — `ThemeProvider` + `useTheme()` in `src/components/theme.tsx`,
  pre-hydration script in `layout.tsx`, `xpanda-theme` key, `dark`/`light`, default dark.
- **P211 (this prompt):** the reusable `<ThemeToggle>` control consuming `useTheme()`, dropped into
  the current `AppHeader` in `CuttingBoard.tsx`.
- P212: `<PlatformHeader>` React port (will reuse this toggle).
- P213: nav wiring + parity.
Build the toggle as a **standalone reusable component** so P212 can move it into the platform header
without rework.

## Scope
Migration surface ONLY: `cutting-pilot/`. Files:
- NEW: `src/components/ThemeToggle.tsx`
- EDIT: `src/app/cutting/CuttingBoard.tsx` (render the toggle inside `AppHeader`)
Do NOT touch: `theme.tsx` (engine is done — consume it, don't modify), routes, middleware, config,
build scripts, globals.css, or any legacy module.

## Verified API to consume (from `src/components/theme.tsx`)
```ts
export function useTheme(): { theme: "dark" | "light"; setTheme: (t) => void; toggleTheme: () => void }
```
Use `useTheme()` — call `toggleTheme()` on click, read `theme` to choose the icon. Do NOT
re-implement storage or `data-theme` logic; the engine owns it.

## Task 1 — `<ThemeToggle>` component (new file)
`src/components/ThemeToggle.tsx`, `"use client"`. Requirements:
- Consumes `useTheme()`. Renders a single `<button type="button">`.
- **Icon:** lucide-react (already a dep from P206). Show `Sun` when `theme === "dark"` (the affordance
  to switch TO light) and `Moon` when `theme === "light"` — this matches the legacy convention
  (`/shared/theme.js`: sun visible in dark mode). Icon size ~15–16px.
- **onClick:** `toggleTheme()`.
- **a11y:** `aria-label` reflects the action — `"Switch to light mode"` when dark,
  `"Switch to dark mode"` when light (mirrors legacy `updateToggleUI`).
- **Styling — tokens only, no hex:** border `var(--input-border)`, text `var(--muted)`, transparent
  background, `rounded`, focus-visible ring `var(--accent)`. Match the existing header control idiom
  in the codebase (compact; the header is `h-14`, so keep the button small but ≥44px touch target via
  padding/min-size — reconcile "compact look" with "44px hit area" using min-w/min-h + inline-flex
  centering as the operator-loop buttons already do).
- Accept an optional `className` prop (string, default `""`) appended to the button classes, so P212
  can place it in different header layouts without edits. No other props required.
- SSR-safe: it's a client component under the provider; `theme` comes from context. No direct
  `window`/`localStorage`.

Guard against the brief pre-hydration mismatch: before the provider's `useEffect` reconciles, `theme`
is the default (`dark`). That's fine — the icon will be correct for the default and correct itself on
mount. Do NOT add your own storage read.

## Task 2 — Render it in `AppHeader` (CuttingBoard.tsx)
The header currently (line ~363):
```tsx
function AppHeader({ userName }: { userName: string }) {
  return (
    <header className="bg-surface border-b border-border px-4 h-14 flex items-center justify-between shrink-0">
      <h1 className="text-sm font-semibold text-text tracking-tight">Cutting · v2</h1>
      <span className="font-mono tabular-nums text-xs text-muted">{userName}</span>
    </header>
  );
}
```
Place `<ThemeToggle>` on the right, alongside `{userName}`. Wrap the username + toggle in a flex
container (gap) so they sit together at the right edge; keep the `justify-between` so the title stays
left. Import `ThemeToggle` at the top of `CuttingBoard.tsx`.

Anchors (verify unique BEFORE editing):
```bash
cd cutting-pilot
grep -c "<span className=\"font-mono tabular-nums text-xs text-muted\">{userName}</span>" src/app/cutting/CuttingBoard.tsx   # MUST print 1
grep -c "function AppHeader" src/app/cutting/CuttingBoard.tsx   # expect 1
```
Replace the lone `<span>…{userName}…</span>` with a flex wrapper containing that same span plus
`<ThemeToggle />`. Do NOT alter the `<h1>`, the `<header>` classes, or the `AppHeader` signature.
Add the import next to the other `src/components/*` imports (Modal/Sheet/StatusPill) — verify the
import path matches how those are imported.

## What NOT to change
- `theme.tsx`, `layout.tsx`, globals.css, tailwind.config, routes, middleware, build scripts.
- The two `<AppHeader userName={userName} />` call sites (loading + loaded branches) — the toggle
  lives inside `AppHeader`, so both render it automatically; do not touch the call sites.
- No new deps (lucide-react already present). No reformatting beyond touched regions.

## Verification (MANDATORY — loop until green)
```bash
cd cutting-pilot
npx tsc --noEmit
npx opennextjs-cloudflare build && node scripts/fix-asset-prefix.mjs
```
Both clean. Reason over the result:
- toggle renders in the header in both loading and loaded states (it's inside `AppHeader`);
- clicking flips `data-theme` on `<html>` and persists `xpanda-theme` (via engine) — whole board
  recolors via tokens, no flash;
- icon + aria-label reflect current theme;
- value syncs with the legacy app (same key).

Note for Steve (not the agent): `npm run deploy`, hard-refresh incognito. The sun/moon toggle appears
top-right; clicking it should recolor the whole board and persist across reloads and across to the
main app.

## BACKLOG / CHANGELOG (same commit)
- `CHANGELOG.md` → under **Manufacturing / Cutting (React pilot)**, newest-first:
  `**P211** — Cutting v2 \`<ThemeToggle>\` control: reusable client component (\`src/components/ThemeToggle.tsx\`)
  consuming P210's \`useTheme()\` — lucide Sun/Moon (sun-in-dark, matching legacy), tokens-only,
  focus ring, 44px hit area, action-reflecting \`aria-label\`, optional \`className\` for reuse.
  Rendered in \`AppHeader\` beside the username (flex wrapper; title stays left). Both header render
  branches pick it up automatically. Engine untouched. \`tsc --noEmit\` + \`cf-build\` green.`
- `BACKLOG.md` → remove the `P211 ThemeToggle control` line if it was added under the pilot section;
  leave P212/P213 lines.

## Deliverable
NEW `src/components/ThemeToggle.tsx`, modified `src/app/cutting/CuttingBoard.tsx`. One commit = P211.
Report files changed, the component's props (`className?`), and both `grep -c` anchor counts (== 1).
