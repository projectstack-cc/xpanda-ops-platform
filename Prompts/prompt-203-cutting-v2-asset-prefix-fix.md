# Prompt 203 — Cutting v2 pilot: serve Next assets under /v2 (fix MIME/infinite-load)

## ⚠️ Read first — sanctioned framework exception
Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. The "vanilla JS only / no frameworks" rule is
**deliberately suspended for `cutting-pilot/` only** — sanctioned React/Next.js pilot. Do not revert
or warn about it. Touch nothing outside `cutting-pilot/` except `CHANGELOG.md` / `BACKLOG.md`.

## Assigned agent
- **Database & API agent** (`xpanda-ops-agents.md` §9) — worker/routing/asset-serving layer.

## Symptom (diagnosed — do not re-diagnose, just fix)
On `https://www.xpandaops.com/v2/cutting`, every `/_next/static/chunks/*.js` request returns
`text/html` ("Refused to execute script … MIME type ('text/html')"), so nothing hydrates and the
queue spins forever.

## Root cause
The only Cloudflare Worker Route on the zone is `www.xpandaops.com/v2/*`. Next serves its JS from
`/_next/static/...`, which is **outside** `/v2/`. Those asset requests therefore miss the Next
Worker, fall through to the legacy Pages app, and come back as its HTML 404 — served as `text/html`.
The page shell loads (it's under `/v2`), but its scripts do not.

## Fix — keep everything under the single `/v2/*` route (no second route)
Do NOT add a `/_next/*` route. Instead make Next emit and request its assets under `/v2` so the one
existing route covers pages AND assets. (`/_next/` is a global zone path; carving a route for it
risks future collisions. One prefix, one route — the principle the route tree was built on.)

### 1. `cutting-pilot/next.config.mjs`
- Confirm the prefix strategy is consistent. The page lives at `app/v2/cutting` (folder-based
  `/v2`). Add an `assetPrefix` so chunk URLs become `/v2/_next/...`:
  - If using folder-based routing (no `basePath`): set `assetPrefix: "/v2"`.
  - If `basePath: "/v2"` is set instead: assets already emit under `/v2/_next` automatically — in
    that case do NOT also add `assetPrefix` (double prefix → `/v2/v2/_next`). Pick ONE mechanism;
    verify which is currently in effect before editing (this was the P196 reconciliation point).
- Net required outcome: built HTML references scripts at `https://www.xpandaops.com/v2/_next/...`.

### 2. Middleware matcher — exclude static assets from the auth gate
- Now that assets resolve under `/v2`, the matcher `/v2/:path*` will also intercept
  `/v2/_next/static/*` and `/v2/_next/*` and try to auth them — which would 401/redirect your
  JavaScript (trading the MIME error for a gate error).
- Update `src/middleware.ts` matcher to exclude Next internals and static files, e.g.:
  ```ts
  export const config = {
    matcher: ["/v2/((?!_next/static|_next/image|favicon.ico).*)"],
  };
  ```
  Keep gating real pages and `/v2/api/*`; let `/v2/_next/static`, `/v2/_next/image`, and static
  files through ungated. Verify the API routes are still matched (they must stay gated).

### 3. Rebuild + redeploy
- `cd cutting-pilot && npx opennextjs-cloudflare build`.
- Deploy is Steve's step if auth isn't present (`wrangler login` is interactive). If credentials
  exist (`CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`), `npm run deploy`; otherwise STOP after
  build and print "ready to deploy" for Steve.

## Verification gate
- After deploy, on `https://www.xpandaops.com/v2/cutting`:
  - DevTools Network: `*/v2/_next/static/chunks/*.js` return `200` with
    `Content-Type: application/javascript` (NOT `text/html`).
  - No "Refused to execute script" console errors.
  - The page hydrates and `/v2/api/cutting/queue` resolves (queue renders, no infinite spinner).
  - `/v2/api/cutting/queue` is still auth-gated (hitting it logged-out → 401, not open).

## Note for Steve (canonical host)
Every failing chunk URL was `www.xpandaops.com` → the canonical host is **`www`**. When you run the
`.pages.dev` redirect (blurb), target `https://www.xpandaops.com`, and ensure login sets
`xpanda_session` on `www` so redirected users land logged in.

## Changelog / backlog
- `CHANGELOG.md` under `## Manufacturing / Cutting (React pilot)` (newest-first):
  > **P203** — Cutting v2 asset routing fix: Next was serving `/_next/static/*` outside the single
  > `/v2/*` Worker Route, so chunks fell through to the legacy app and returned `text/html`
  > (MIME-blocked, infinite queue spinner). Added `assetPrefix` so assets emit under `/v2/_next/...`
  > (one route covers pages + assets, no global `/_next/*` route); middleware matcher updated to
  > exclude `_next/static`/`_next/image` from the auth gate. Page hydrates; queue loads.
- `BACKLOG.md`: no new item (bugfix).

## Do NOT
- Add a second Worker Route (`/_next/*` or otherwise) — consolidate under `/v2` instead.
- Set both `basePath` and `assetPrefix` to `/v2` (double-prefix).
- Gate `_next/static` assets behind auth.
- Touch anything outside `cutting-pilot/` except changelog/backlog.
