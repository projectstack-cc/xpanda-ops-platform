# Prompt 212 — Cutting v2: `<PlatformHeader>` React port (structural shell + permission-gated nav)

## Agents
**Lead: React Component Agent (§9b)** (the header component + nav UI).
**Coordinate with Next/Cloudflare Platform Agent (§9a)** for the two infra touches: reading the
session permission map in `page.tsx`, and making the logo asset available under `/v2`.

## Required reading (both, before any edit)
- `AGENTS.md`
- `xpanda-ops-agents.md` — §9b, §9a (esp. middleware/session-bridge constraints, asset-path rules).
- `agent-react-component.md` — reusable components, tokens-only, 44px, mobile-first, lucide icons.

## Context — 3 of the 4-prompt theme/header sequence
- P210 (shipped): theme engine. P211 (shipped): `<ThemeToggle>` in `src/components/ThemeToggle.tsx`.
- **P212 (this prompt):** port the legacy `shared/shared-header.js` into a reusable React
  `<PlatformHeader>` that replaces the bare `AppHeader` (`<S>`) in `CuttingBoard.tsx`. This is the
  canonical header the rest of v2 will reuse.
- P213: nav wiring polish / parity / surface `/v2/cutting` as active.

## Scope decisions (LOCKED)
- **Port:** logo + title, the 8-link permission-gated module nav (links out to legacy pages), user
  bar + Sign Out, the existing `<ThemeToggle>`, and the mobile nav drawer (hamburger collapse).
- **DEFER (explicitly out — future prompt):** notifications bell + push subscription, and the gear
  settings popover. The legacy gear held only display-mode + theme; theme already lives in
  `<ThemeToggle>`, and notifications depend on the web-push/notifications backend that does not exist
  on the v2 worker. Do NOT stub a dead bell or gear.

## Scope (files)
Migration surface ONLY: `cutting-pilot/`.
- NEW: `src/components/PlatformHeader.tsx` (the reusable header)
- EDIT: `src/app/cutting/CuttingBoard.tsx` (replace `AppHeader` usage with `<PlatformHeader>`; remove
  the local `AppHeader` definition, or keep it only if still referenced — it should not be)
- EDIT: `src/app/cutting/page.tsx` (§9a) — read the session permission map + admin flag and pass to
  the board/header
- ASSET (§9a): make the logo available under `/v2` (see Task 4)
Do NOT touch: `theme.tsx`, `ThemeToggle.tsx` (consume it), routes/handlers, middleware, build
scripts, globals.css, tailwind.config, or any legacy module.

## Legacy reference (from `shared/shared-header.js`, 444 lines — port the structure, not the vanilla)
- **Module nav** (line ~146): 8 modules with `data-nav-perm` keys:
  | label | href | perm |
  |---|---|---|
  | Job board | `/jobs/` | `jobs` |
  | Logistics | `/logistics/` | `logistics.dashboard` |
  | Manufacturing | `/manufacturing/` | `manufacturing.calculators` |
  | Production | `/production/` | `production.inventory` |
  | QC | `/qc/` | `qc` |
  | Reports | `/reports/` | `reports` |
  | Safety | `/safety/` | `safety` |
  | Admin | `/admin/` | `admin` |
  (Use these exact labels/hrefs/perm keys.)
- Active link = `currentPath.startsWith(href)`. Brand-red active state (`var(--brand)` + soft bg).
- Nav styling tokens (match visually): links `var(--muted)` → hover `var(--text)`/`var(--ghost-bg)`,
  active `var(--brand)`; bar `var(--surface)` + `var(--line)` bottom border; horizontal scroll on
  overflow; collapse to a 44px hamburger + drawer on narrow widths.
- Logo: `xpanda-nav-logo img` ~30px tall.
- User bar: display name + a red "Sign Out" link to the legacy logout (`/api/auth/logout` →
  legacy clears the cookie; the v2 worker never issues/clears cookies). Use the legacy logout URL/flow
  — confirm the exact path from `shared-header.js` (the topbar `#hdr-logout` anchor / logout handler).

## Task 1 — `<PlatformHeader>` component (new, reusable)
`src/components/PlatformHeader.tsx`, `"use client"`. Props (typed):
```ts
interface PlatformHeaderProps {
  title?: string;                 // default "Cutting · v2" for this page
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
  currentPath?: string;           // for active-link; default "/v2/cutting"
}
```
- Renders: logo, title, the permission-gated nav, user bar (name + Sign Out), and `<ThemeToggle/>`.
- **Permission gating:** a link shows if `isAdmin` is true, OR `permissions[permKey]?.view` is truthy.
  (Admin bypasses, mirroring legacy admin-sees-all.) Hide non-permitted links entirely (don't disable).
- **Active link:** `currentPath.startsWith(href)`. Note the cutting page is `/v2/cutting` and these
  links point at legacy roots (`/jobs/` etc.), so none will be active on this page — that's expected;
  P213 handles surfacing a v2-cutting nav entry. Still implement the active logic generically.
- **Mobile:** below a breakpoint, collapse the link row into a hamburger button (44px) that toggles a
  drawer of the same (gated) links, full-width 44px rows. Use local `useState` for the drawer.
- Tokens-only, no hex. lucide for the hamburger (`Menu`) / close (`X`). Reuse `<ThemeToggle>` as-is.
- Keep it dependency-free beyond lucide + the theme hook. No data fetching inside the header — all
  identity/permission data arrives via props (server-resolved in Task 3).

## Task 2 — Swap it into the board
In `src/app/cutting/CuttingBoard.tsx`, replace both `<AppHeader userName={userName} />` render sites
with `<PlatformHeader ... />`, passing `userName`, `isAdmin`, `permissions`, and `title="Cutting · v2"`.
Remove the now-unused local `AppHeader` function. `CuttingBoard` must receive `permissions` as a new
prop (add to its `Props` type) — it currently gets `userId`, `userName`, `isAdmin`.

Anchors (verify unique BEFORE editing):
```bash
cd cutting-pilot
grep -c "function AppHeader" src/app/cutting/CuttingBoard.tsx          # expect 1 (to remove)
grep -c "<AppHeader userName={userName} />" src/app/cutting/CuttingBoard.tsx  # expect 2 (both sites)
```
(2 occurrences is fine — replace BOTH; for the find/replace, include enough surrounding context to
make each unique, or replace the shared `AppHeader` definition + rename call sites consistently.)

## Task 3 (§9a) — provide permissions from the session in page.tsx
`page.tsx` currently reads only `X-User-*` headers (no permission map). Add a server-side
`validateSession()` call to obtain the full `SessionUser.permissions` and pass it down. Pattern:
- Import `validateSession` from `@/lib/session` and the D1 binding accessor used elsewhere
  (`getCloudflareContext()` / the `db.ts`/`getEnv()` helper — match how routes obtain `env.DB`;
  do NOT call `getCloudflareContext()` at module top-level — inside the async page function only).
- Read the `cookie` header, call `validateSession(db, cookieHeader)`, and from the result pass
  `permissions` (and keep `isAdmin` from `isAdministrator`, or continue using the `X-User-Is-Admin`
  header — be consistent). If `validateSession` returns null (shouldn't, middleware already gated),
  fall back to empty permissions + non-admin.
- Pass `permissions` into `<CuttingBoard ... permissions={...} />`.
This keeps gating server-side, no client `/me` fetch, mirroring legacy. Coordinate with §9a
constraints: read-only session use, no cookie writes, no new bindings.

Anchor:
```bash
grep -c "<CuttingBoard userId={userId} userName={userName} isAdmin={isAdmin} />" src/app/cutting/page.tsx  # expect 1
```

## Task 4 (§9a) — logo asset under /v2
The brand logo lives at repo-root `/logo/xpanda.png` (+ `xpanda bw.png`), served by the LEGACY app —
not by the v2 worker. The v2 worker serves its own assets relocated under `/v2/...`. Options, pick the
one that fits the asset pipeline:
- **Preferred:** copy `logo/xpanda.png` into the pilot at `cutting-pilot/public/xpanda.png` so it ships
  with the v2 build and is referenced as `/v2/xpanda.png` (basePath prepends `/v2`; confirm
  public-asset URLs get the prefix like `_next` does — if `fix-asset-prefix.mjs` only moves `_next`,
  verify where `public/` files land and reference them at the correct `/v2/...` URL). Use a Next
  `<Image>` or plain `<img>` with the correct `/v2`-prefixed src.
- If copying an asset is undesirable, reference the legacy-served absolute path the logo is available
  at on `www.xpandaops.com` (same host) — but the self-contained copy is cleaner and avoids a
  cross-app dependency.
Whichever: the logo MUST render at the correct URL on the deployed `/v2/cutting` (verify the path
resolves, given the basePath/asset rules that already bit us in P203/P205). If unsure the public-asset
path resolves under `/v2`, prefer the legacy absolute path and note it for follow-up rather than ship a
broken `<img>`.

## What NOT to change
- No notifications, no gear popover, no push code. No display-mode toggle.
- `theme.tsx` / `ThemeToggle.tsx` internals. Routes, middleware, build scripts, config, legacy files.
- No new deps beyond lucide (present). No reformatting beyond touched regions.

## Verification (MANDATORY — loop until green)
```bash
cd cutting-pilot
npx tsc --noEmit
npx opennextjs-cloudflare build && node scripts/fix-asset-prefix.mjs
```
Both clean. Watch for: SSR-unsafe `getCloudflareContext()` placement (must be inside the request
path), and missing `permissions` prop type. Reason over the result:
- header renders logo + title + gated nav + user/Sign Out + theme toggle, in both board render
  branches;
- admin sees all 8 links; a non-admin session sees only permitted ones;
- hamburger/drawer works on narrow widths; Sign Out points at the legacy logout;
- logo URL resolves under `/v2`.

Note for Steve (not the agent): `npm run deploy`, hard-refresh incognito. Confirm the full header
appears, nav links jump to legacy modules, Sign Out logs out, theme toggle still works, and the logo
loads (watch the Network tab for a 404 on the logo specifically — that's the asset-path risk).

## BACKLOG / CHANGELOG (same commit)
- `CHANGELOG.md` → under **Manufacturing / Cutting (React pilot)**, newest-first:
  `**P212** — Cutting v2 \`<PlatformHeader>\` React port: replaced the bare \`AppHeader\` with a
  reusable platform header (logo, title, 8-link permission-gated module nav linking to legacy pages,
  user bar + Sign Out, embedded P211 \`<ThemeToggle>\`, mobile hamburger drawer). Per-link gating
  uses the session \`permissions\` map (admin bypass); \`page.tsx\` now calls \`validateSession()\`
  server-side to pass \`permissions\` down (read-only, no cookie writes). Logo shipped under \`/v2\`.
  Notifications bell + settings gear intentionally deferred (depend on push backend / redundant with
  ThemeToggle). \`tsc --noEmit\` + \`cf-build\` green.`
- `BACKLOG.md` → remove `P212 PlatformHeader React port` line if tracked; ADD a new line:
  `Cutting v2: port notifications bell + settings gear into PlatformHeader once v2 notification
  backend exists (deferred from P212)`. Leave the `P213 nav wiring + parity` line.

## Deliverable
NEW `src/components/PlatformHeader.tsx`; modified `src/app/cutting/CuttingBoard.tsx` and
`src/app/cutting/page.tsx`; logo asset made available under `/v2`. One commit = P212. Report all files
changed, the `PlatformHeader` prop contract, the gating rule, all `grep -c` anchor counts, and confirm
the logo URL resolves under `/v2`.
