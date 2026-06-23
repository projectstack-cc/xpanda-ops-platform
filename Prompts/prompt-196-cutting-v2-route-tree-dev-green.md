# Prompt 196 — Cutting v2 pilot: reconcile route tree + green dev server

## ⚠️ Read first — sanctioned framework exception
Before doing anything, read **both** `AGENTS.md` and `xpanda-ops-agents.md`.

`xpanda-ops-agents.md` (Orchestrator, Cross-Cutting Rules) states "NO frameworks: React, Vue,
Angular, Svelte are forbidden. Vanilla JS only." **That rule is deliberately suspended for the
`cutting-pilot/` directory only.** This is the sanctioned React/Next.js strangler pilot for the
Cutting Dashboard. Do NOT "fix," revert, or warn about React/Next/Tailwind usage inside
`cutting-pilot/`. The vanilla-only rule still fully applies to every other directory in the
platform. Touch nothing outside `cutting-pilot/` except the changelog/backlog updates at the end.

## Assigned agents
- **Frontend Designer** (`agent-frontend-designer.md`) — owns the token/style wiring (tokens.css → Tailwind).
- **Admin & Auth agent** (`xpanda-ops-agents.md` §8) — owns the `validateSession` port correctness.

## Context
`cutting-pilot/` is a Next.js (App Router) + OpenNext-for-Cloudflare project. It was hand-built
during an outage and diverged from the original scaffold, so **inspect actual file contents before
editing** — do not assume the scaffold's layout. `npm run dev` currently 404s the cutting page.
Nothing is deployed. The legacy platform is on `xpanda-ops-platform.pages.dev`.

Current observed tree (verify against reality):
```
cutting-pilot/src/
  app/
    api/cutting/queue/route.ts     ← STRANDED: resolves to /api/cutting, outside /v2, collides with legacy
    v2/cutting/page.tsx            ← serves at /v2/cutting (folder-based prefix)
    globals.css
    layout.tsx
  lib/{db.ts, session.ts, middleware.ts}   ← NOTE: middleware.ts may be in lib/; Next requires it at src/middleware.ts
  next.config.mjs                  ← shows as modified; suspected double basePath
```

## Goal
`npm run dev` boots clean and `http://localhost:3000/v2/cutting` renders the logged-in user's
identity. `/v2/api/cutting/queue` executes and returns `{ ok: true, queue: [...] }`. All v2 surface
is under a single `/v2` prefix so one future zone route captures it with zero legacy collision.

## Tasks — inspect first, then apply. Use exact-anchor edits; verify each anchor is unique (`grep -c` == 1) before editing.

### 1. Resolve the double-prefix 404 (the likely root cause)
- `cat cutting-pilot/next.config.mjs`. If it sets `basePath: "/v2"` **and** the page lives at
  `app/v2/cutting/`, the real route is `/v2/v2/cutting` → 404. **Remove the `basePath` line** and
  let the folder structure own the `/v2` prefix. (If instead there is NO `app/v2/` folder and
  basePath is the only prefix mechanism, keep basePath and skip — but the observed tree shows
  `app/v2/cutting/`, so the folder wins.) Pick exactly ONE prefix mechanism; never both.

### 2. Move the stranded API route under /v2
- Move `src/app/api/cutting/queue/route.ts` → `src/app/v2/api/cutting/queue/route.ts`
  (new URL: `/v2/api/cutting/queue`). Use `git mv` if tracked, else `mkdir -p` + `mv`.
- This puts the endpoint inside the `/v2` boundary so (a) the middleware gate catches it and
  (b) a single `/v2/*` zone route will route it to this Worker, with no collision against the
  legacy app's existing `/api/cutting`.

### 3. Confirm middleware location + matcher
- Next.js requires middleware at **`src/middleware.ts`** (NOT `src/lib/middleware.ts`). If it's in
  `lib/`, move it to `src/middleware.ts`.
- Set the matcher to a single rule: `matcher: ["/v2/:path*"]`. Remove any separate `/api/v2`
  entry — everything is under `/v2` now, including the API.

### 4. Fix any client/page fetch path
- `grep -rn "api/cutting/queue" cutting-pilot/src`. Update any fetch to `/v2/api/cutting/queue`.

### 5. Wire tokens so Tailwind `var(--token)` colors resolve
- The Tailwind config maps colors to `var(--bg)`, `var(--text)`, etc. Those custom properties come
  from the legacy `shared/tokens.css` and are NOT present in the pilot by default → everything
  renders unstyled.
- `cat cutting-pilot/src/app/globals.css`. Ensure the `:root` token block from the platform's
  `shared/tokens.css` is available to the pilot — copy the `:root { … }` custom-property block
  (light theme at minimum; include the `:root[data-theme="dark"]` block too if present) into the
  top of `globals.css`, above the Tailwind directives. (Copy the values; do not import across the
  project boundary.) Keep `--font-sans`/`--font-mono` so the IBM Plex stack matches.

### 6. Verify the validateSession port is faithful
- Diff `cutting-pilot/src/lib/session.ts` `validateSession`/`hasPermission` against the live
  `_worker.js/lib/core.js` versions. Confirm: cookie regex is `xpanda_session=([^;]+)`; multi-role
  permission merge (most-permissive-wins); `role-administrator` admin detection; role-simulation
  override; GET→view / mutate→edit in `hasPermission`. Report any drift; fix to match legacy.

### 7. Confirm the queue route reads jobs correctly
- `cutting-pilot/src/app/v2/api/cutting/queue/route.ts` should select non-archived/non-shipped
  `jobs`, parse `processes` JSON, and keep only the 5 lines
  `['Cross Cutter','Hole Cutter','Main Line','Blue Line','Laminate']` as `requiredLines`, filtering
  to jobs with ≥1 required line. (It must NOT depend on the new `cutting_sessions`/`cutting_lines`
  tables yet — those are a later prompt and a manual migration.)

## Verification gate (must pass before commit)
- `cd cutting-pilot && npx tsc --noEmit` → no type errors.
- `npm run dev`, then:
  - `GET http://localhost:3000/v2/cutting` → 200, renders identity text (no 404).
  - `GET http://localhost:3000/v2/api/cutting/queue` → `{ ok: true, queue: [...] }`.
- NOTE ON LOCAL DATA: `next dev` binds **local** (empty) D1 via Miniflare unless run against
  remote. An empty `queue: []` is a PASS at this stage — it proves the route executes and the
  binding resolves. Real-data and the real auth bridge are validated later, after the domain is
  attached (cookie is host-pinned to `.pages.dev` today and cannot reach a `workers.dev` host).

## Changelog / backlog (required by P195 process)
- Add to `CHANGELOG.md` under a new `## Manufacturing / Cutting (React pilot)` section (newest-first):
  > **P196** — Cutting v2 pilot route-tree reconcile: removed double `/v2` prefix (basePath vs
  > folder) that 404'd the dev server; moved `api/cutting/queue` under `app/v2/api/` so the whole
  > v2 surface lives under one `/v2` prefix (single future zone route, no collision with legacy
  > `/api/cutting`); middleware relocated to `src/middleware.ts` with `matcher: ['/v2/:path*']`;
  > seeded `shared/tokens.css` `:root` vars into pilot `globals.css` so Tailwind `var(--token)`
  > colors resolve; verified `validateSession`/`hasPermission` port matches `_worker.js/lib/core.js`.
  > Local dev green at `/v2/cutting`. No deploy, no migration, no legacy file touched.
- Add to `BACKLOG.md` (if not already present) under Manufacturing: a "Cutting v2 React pilot"
  line noting remaining steps (Worker build = P197; session-model migration manual; queue→clock-in;
  block-calculator BOM wiring).

## Do NOT
- Run `opennextjs-cloudflare build`/`deploy` (that's P197).
- Run the `add-cutting-sessions.sql` migration (manual, Steve, D1 console).
- Touch any file outside `cutting-pilot/` except `CHANGELOG.md` / `BACKLOG.md`.
- Register/attach a domain or add zone routes (Steve, in parallel).
