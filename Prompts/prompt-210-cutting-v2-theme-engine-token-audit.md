# Prompt 210 — Cutting v2: theme engine + token audit (dark mode foundation, no visible toggle)

## Agent
You are the **React Component Agent (§9b)** for the xPanda Operations Platform.

## Required reading (both, before any edit)
- `AGENTS.md`
- `xpanda-ops-agents.md` — §9b (React Component Agent), §9a (platform).
- `agent-react-component.md` — Tailwind-from-tokens, token discipline, no hardcoded hex.

## Context — this is 1 of a 4-prompt theme/header sequence
To avoid drift, the theme + shared-header work is split:
- **P210 (this prompt):** theme ENGINE only — the mechanism that applies/persists `data-theme` and
  matches the legacy app exactly, plus a pre-hydration anti-flash script, plus a token-audit fix. NO
  visible toggle control (that's P211).
- P211: reusable `<ThemeToggle>` control consuming this engine, dropped into the current v2 header.
- P212: `<PlatformHeader>` React port (replaces the bare `<S>` header).
- P213: nav wiring + legacy visual-parity pass.
Build standalone — do NOT wire to the legacy `/shared/theme.js` or `/shared/shared-header.js` script
(those are vanilla browser-globals, out of bounds on the Next surface). Reimplement the *same
contract* in React/TS so both surfaces share the localStorage key and converge.

## Scope
Migration surface ONLY: `cutting-pilot/`. Expected files:
- `src/app/layout.tsx` (add pre-hydration script + ensure no flash)
- a new client theme module, e.g. `src/components/theme.tsx` (provider/hook) OR
  `src/lib/theme.ts` + a tiny client component — your call, keep it minimal and reusable
- `src/app/globals.css` (token-audit fix: 2 tokens into the dark block)
Do NOT touch: route handlers, middleware, `wrangler.toml`, `next.config`, `tailwind.config.ts`
(audit confirmed no config change needed), build scripts, components other than wiring the provider,
or any legacy module.

## Legacy contract to match EXACTLY (verified from `/shared/theme.js` on main)
- **localStorage key:** `xpanda-theme` (literal string — must match so v2 ↔ legacy sync).
- **Values:** `'dark'` | `'light'`, applied as `document.documentElement.setAttribute('data-theme', value)`.
- **Default:** saved value wins; if nothing saved → **`'dark'`**. Do NOT consult
  `prefers-color-scheme` (legacy hardcodes dark and ignoring OS is the locked decision — diverging
  would make v2 behave differently from every other page on first paint).
- **Toggle semantics:** `dark ↔ light` flip (relevant to P211; expose the primitive here).

## Tasks

### Task 1 — Theme engine (the mechanism)
Implement a small client-side theme module that:
- On mount (client): reads `localStorage['xpanda-theme']`; if absent, treats theme as `'dark'`.
  (The attribute is already set pre-hydration by Task 2; this provides the React-state mirror +
  setter, and reconciles state to the attribute already on `<html>`.)
- Exposes `theme: 'dark' | 'light'`, `setTheme(t)`, and `toggleTheme()`.
- `setTheme`/`toggleTheme` BOTH: set `data-theme` on `documentElement` AND write
  `localStorage['xpanda-theme']`, wrapped in try/catch (match legacy resilience).
- Is SSR-safe: no `window`/`localStorage`/`document` access at module top-level or during render on
  the server — guard with `typeof window !== 'undefined'` and/or `useEffect`. (OpenNext/Workers will
  execute this; a top-level `localStorage` reference will crash the build per §9a notes.)
- Provide it as a React context provider (`<ThemeProvider>`) wrapping `{children}` so P211's
  `<ThemeToggle>` and future components can `useTheme()`. Keep it dependency-free (no next-themes).

### Task 2 — Pre-hydration anti-flash script (in layout.tsx)
Before React hydrates, `data-theme` must already be on `<html>`, or the page flashes the wrong theme
on every load. Add a tiny **blocking inline script** in `layout.tsx` that runs before paint and sets
the attribute from storage-or-dark. Standard Next App-Router approach:
- Add `suppressHydrationWarning` to the `<html>` tag (the attribute set by the script would otherwise
  trip hydration mismatch warnings).
- Inject a `<script>` (via `dangerouslySetInnerHTML`) in the `<head>` or top of `<body>` that runs:
  read `localStorage['xpanda-theme']`, fallback `'dark'`, `document.documentElement.setAttribute('data-theme', t)`.
  Keep it inline and synchronous (no external file) so it executes before first paint.
- Wrap `{children}` in `<ThemeProvider>` from Task 1.

Anchor for layout edit (verify unique):
```bash
cd cutting-pilot
grep -c "<html lang=\"en\">" src/app/layout.tsx          # MUST print 1
grep -c "{children}" src/app/layout.tsx                  # MUST print 1
```
Preserve the existing `import "./globals.css";` first line and the `metadata` block. Keep the
existing `<body className="bg-bg text-text font-sans antialiased">`.

### Task 3 — Token audit fix (globals.css dark block)
Audit finding (verified): the component layer references `var(--success-text)` and
`var(--danger-text)`, but the `:root[data-theme="dark"]` block does NOT override them — they only
exist in `:root` (`#ffffff`). They happen to stay legible, but per token discipline they must be
explicit in the dark block (especially `--danger-text`, whose paired `--danger-bg` IS overridden in
dark). Add both to the dark block. No other token is missing; `tailwind.config.ts` needs no change.

Anchor (verify unique) — the dark block already contains these two lines adjacent:
```bash
grep -c "  --danger-bg: #ef4444;" src/app/globals.css    # expect 1
grep -c "  --success-bg: #22c55e;" src/app/globals.css   # expect 1
```
Add `--danger-text` next to `--danger-bg` and `--success-text` next to `--success-bg` inside the
DARK block (values `#ffffff`, matching `:root`, unless a more legible dark value is clearly needed —
white on `--danger-bg`/`--success-bg` is fine, keep `#ffffff`). Make the find/replace target the
dark-block occurrence specifically (the `grep -c` on the bg lines is 1 because the dark block uses
the `#ef4444`/`#22c55e` values, distinct from `:root`'s `--danger-bg:#dc2626`/`--success-bg:#16a34a`)
— so anchoring on `  --danger-bg: #ef4444;` / `  --success-bg: #22c55e;` uniquely hits the dark block.

## What NOT to change
- No `prefers-color-scheme` logic. No external theme library. No `tailwind.config.ts` edit.
- No visible toggle UI (P211). Do not modify the `<S>` header in `CuttingBoard.tsx`.
- No route/middleware/config/build-script/legacy changes. No reformatting beyond touched regions.

## Verification (MANDATORY — loop until green)
```bash
cd cutting-pilot
npx tsc --noEmit
npx opennextjs-cloudflare build && node scripts/fix-asset-prefix.mjs
```
Both must exit clean (watch specifically for SSR crashes from `localStorage`/`window` at
module/render time — guard them). Reason over the result to confirm:
- `data-theme` is present on `<html>` before hydration (inline script), defaulting to `dark` when
  storage empty;
- toggling via the engine flips `data-theme` and writes `xpanda-theme`;
- a value written by the legacy app (or vice-versa) is read on next load (same key) — cross-surface
  sync intact;
- no flash-of-wrong-theme on reload.

Note for Steve (not the agent): `npm run deploy`, hard-refresh incognito. With no toggle yet, the
board should now honor a pre-existing `xpanda-theme` value (e.g. if you've used dark on the main app)
and default to dark. Visible switching arrives in P211.

## BACKLOG / CHANGELOG (same commit)
- `CHANGELOG.md` → under **Manufacturing / Cutting (React pilot)**, newest-first:
  `**P210** — Cutting v2 theme engine + token audit (dark-mode foundation, no visible control yet).
  React \`ThemeProvider\`/\`useTheme\` reimplementing the legacy \`/shared/theme.js\` contract
  one-to-one: \`localStorage['xpanda-theme']\`, \`data-theme\` on \`documentElement\`, values
  \`dark\`/\`light\`, default \`dark\` (OS ignored, matching legacy) — so v2 and the main app share
  the key and stay in sync. Added a pre-hydration inline script in \`layout.tsx\`
  (+\`suppressHydrationWarning\`) to set \`data-theme\` before first paint (no flash); wrapped
  children in the provider; SSR-guarded all \`window\`/\`localStorage\` access for the Workers
  runtime. Token-audit fix: added \`--success-text\` and \`--danger-text\` to the
  \`[data-theme="dark"]\` block (referenced by components, previously only defined in \`:root\`).
  No \`tailwind.config\` change needed. \`tsc --noEmit\` + \`cf-build\` green.`
- `BACKLOG.md` → under the cutting pilot section, this is part of the dark-mode/header sequence; do
  not remove the broader platform dark-mode Bucket A item (that's legacy-surface). Add follow-on
  lines if useful: `P211 ThemeToggle control`, `P212 PlatformHeader React port`, `P213 nav wiring +
  parity` (if not already tracked).

## Deliverable
Modified `src/app/layout.tsx`, new theme module under `src/components/` (or `src/lib/`), modified
`src/app/globals.css`. One commit = P210. Report files changed, the theme module's public API
(`theme`/`setTheme`/`toggleTheme`), all `grep -c` anchor counts (== 1), and confirm the dark block
now contains `--success-text` and `--danger-text`.
