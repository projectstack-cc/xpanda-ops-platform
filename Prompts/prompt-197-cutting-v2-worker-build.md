# Prompt 197 — Cutting v2 pilot: build the OpenNext Worker + local shakeout

## ⚠️ Read first — sanctioned framework exception
Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. The "vanilla JS only / no frameworks" rule
in `xpanda-ops-agents.md` is **deliberately suspended for `cutting-pilot/` only** — this is the
sanctioned React/Next.js + OpenNext-on-Cloudflare-Workers pilot. Do not revert or warn about it.

## Assigned agent
- **Database & API agent** (`xpanda-ops-agents.md` §9) — owns the worker/infra layer. The OpenNext
  Worker is the v2 analog of `_worker.js`; treat its bindings (D1, R2) with the same care.

## Prerequisite
P196 is committed and `npm run dev` is green at `/v2/cutting`. If not, stop and run P196 first.

## Context & boundaries
- The deploy target on Cloudflare is `@opennextjs/cloudflare` → Cloudflare **Workers** (NOT Pages;
  `next-on-pages` is deprecated). `opennextjs-cloudflare build` compiles `next build` output into a
  Workers bundle at `.open-next/`.
- **This prompt does the LOCAL build + local workerd preview only.** The remote `deploy`, the real
  auth-bridge validation, and the D1 migration are explicitly Steve's steps (see "Handoff" below) —
  they require Cloudflare account auth and a real domain, which aren't ready.
- Account auth: `wrangler login` is interactive (browser OAuth) and cannot be completed headless.
  If any command here requires auth and credentials aren't present (`CLOUDFLARE_API_TOKEN` +
  `CLOUDFLARE_ACCOUNT_ID` env vars, or an existing `wrangler` session), STOP and report — do not
  attempt to authenticate.

## Goal
`npx opennextjs-cloudflare build` succeeds, and `npx opennextjs-cloudflare preview` boots the
Worker locally in workerd with the D1/R2 bindings resolving. No remote deploy.

## Tasks

### 1. Verify deps + config
- `cd cutting-pilot && cat package.json`. Ensure present: `next`, `react`, `react-dom`,
  `@opennextjs/cloudflare`, `wrangler`. Ensure scripts: `build`, `preview`, `deploy`
  (`opennextjs-cloudflare build|preview|deploy`). Run `npm install` if `node_modules` is stale.
- `cat open-next.config.ts` — must export `defineCloudflareConfig()`.
- `cat wrangler.toml` — verify:
  - `main = ".open-next/worker.js"`, `[assets] directory = ".open-next/assets"`, `binding = "ASSETS"`.
  - `compatibility_flags = ["nodejs_compat"]` present (OpenNext requires the Node runtime).
  - D1 binding `DB` with `database_id = "21d6f47b-0be9-4006-8014-d154e41f91e8"` (SAME as legacy
    `wrangler.toml` — do not create a new database).
  - R2 binding `BOL_PHOTOS` → `xpanda-bol-photos` (same as legacy).
- Confirm `next.config.mjs` calls `initOpenNextCloudflareForDev()` in the non-production branch so
  `next dev` and the built Worker see the same bindings.

### 2. Build
- `npx opennextjs-cloudflare build`.
- Fix build failures. Likely culprits and fixes:
  - Missing `nodejs_compat` flag → add to `wrangler.toml` (see above).
  - A route/page pinned to `export const runtime = 'edge'` → remove it; OpenNext uses the Node
    runtime. `grep -rn "runtime = 'edge'" src` and strip any found.
  - `getCloudflareContext()` called at module top-level / build time → it must be called **inside**
    request handlers (route handlers, middleware, server components at request time), never at
    import scope. Fix any such call.
  - Type errors → resolve; `npx tsc --noEmit` should already be clean from P196.
- Confirm `.open-next/worker.js` and `.open-next/assets/` are produced.

### 3. Local preview (workerd boot)
- `npx opennextjs-cloudflare preview`. Confirm the Worker boots without runtime errors.
- Hit the preview URL: `/v2/cutting` should render; `/v2/api/cutting/queue` should return JSON.
- BINDINGS NOTE: local preview uses local (empty) D1 unless explicitly run against remote. An empty
  `queue: []` and an unauthenticated redirect are EXPECTED here and count as PASS — they prove the
  Worker boots and the binding/middleware wiring is intact. The auth bridge cannot truly resolve
  locally/on workers.dev because `xpanda_session` is host-pinned to the legacy host (see Handoff).

### 4. Add a `.gitignore` guard
- Ensure `cutting-pilot/.gitignore` ignores `.open-next/`, `.next/`, `node_modules/`,
  `.wrangler/`, `.dev.vars`. Do not commit build output.

## Verification gate (must pass before commit)
- `npx opennextjs-cloudflare build` exits 0; `.open-next/worker.js` exists.
- `npx opennextjs-cloudflare preview` boots; `/v2/cutting` renders and `/v2/api/cutting/queue`
  returns valid JSON (empty queue / auth redirect both acceptable).

## Handoff — Steve's steps (do NOT attempt; just print this checklist at the end)
1. Run `DB_Migrations/add-cutting-sessions.sql` in the Cloudflare D1 Console (manual, per usual).
2. Authenticate wrangler (`wrangler login` or set `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`).
3. `npm run deploy` to push the Worker (lands on `xpanda-cutting-v2.workers.dev` for now).
4. Register a domain + attach it to the EXISTING Pages project (no migration — same app gains a
   real hostname), then add Worker Routes `app.<domain>/v2/*` → `xpanda-cutting-v2`.
5. Only after step 4 can the real auth bridge be validated: log in on the legacy app at the real
   host, navigate to `/v2/cutting`, confirm identity renders via the shared `xpanda_session`.

## Changelog / backlog
- Add to `CHANGELOG.md` under `## Manufacturing / Cutting (React pilot)` (newest-first):
  > **P197** — Cutting v2 pilot Worker build: `opennextjs-cloudflare build` green, local workerd
  > preview boots with shared D1 (`DB`, same database_id as legacy) + R2 (`BOL_PHOTOS`) bindings
  > resolving; `nodejs_compat` confirmed; `.open-next/` gitignored. No remote deploy — deploy +
  > domain attach + auth-bridge validation handed off (require account auth + real host; `.pages.dev`
  > cannot host the cookie-shared `/v2/*` route).
- Update the `BACKLOG.md` Cutting v2 line: mark Worker-build done; next = deploy + domain (Steve),
  then queue→clock-in/handoff feature build.

## Do NOT
- Run remote `deploy`, `wrangler login`, or any command requiring Cloudflare auth.
- Run the D1 migration.
- Touch any file outside `cutting-pilot/` except `CHANGELOG.md` / `BACKLOG.md`.
