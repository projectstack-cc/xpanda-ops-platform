# P99 — F5a: `_worker.js` → directory form + shared core extraction

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **db-api-agent**. Foundation Roadmap **Phase F5** — step **F5a** (scaffolding only). This is the make-or-break step; keep it **minimal and behavior-identical**. No DB, no migration, no frontend change.

## Why this approach (read before coding)

The platform runs in Pages **Advanced Mode** with a single `_worker.js`. Cloudflare Pages ignores any `functions/` directory while `_worker.js` exists, so a `/functions/` migration can't be incremental — it would force a single big-bang cutover of the entire session/permission/header-injection middleware. Instead, use the **`_worker.js/` directory form**: Pages auto-bundles `_worker.js/index.js` + imported sibling modules into one Worker, preserving single-bundle deploy semantics, Advanced Mode, `env.ASSETS`, and the F2 `API_ROUTES` table — while letting handlers be peeled into modules incrementally (F5b–F5e). This step does the conversion and extracts only the shared core, nothing else.

## Deliverables

1. **Create the `_worker.js/` directory** and move the current `_worker.js` content into **`_worker.js/index.js`** unchanged except for the extraction in step 2. Delete the old single `_worker.js` file. `index.js` keeps:
   - the `export default { fetch }` entry and the **entire middleware chain in its exact current order** (training redirect, health, static passthrough, auth-route bypass, login/sw/manifest passthrough, `/track`, `/api/public/*` bypass, session gate, permission gate, **user-header injection**, then `dispatchApiRoute`, then `env.ASSETS` fallthrough),
   - the `API_ROUTES` table and `dispatchApiRoute`,
   - **all 44 handler functions** (they stay in `index.js` for now — F5b–e move them later).

2. **Create `_worker.js/lib/core.js`** and move into it ONLY the cross-cutting helpers that handlers and middleware share, then `import` them into `index.js`. Identify the exact set from the code; expected members:
   - response helpers: `json`, `error`
   - audit: `logActivity`
   - auth/permission: `validateSession`, `getPermissionKey`, `hasPermission`, and the maps `PATH_PERMISSION_MAP`, `API_PERMISSION_MAP`, `PERMISSION_LABELS`
   - any other small helper called from more than one place (e.g. `safeJsonParse`).
   `export` each; `import { ... } from './lib/core.js';` at the top of `index.js`. Use plain relative ESM imports (Pages bundles them — do **not** add a build tool, bundler config, or `package.json`).

3. **Behavior must be byte-for-byte identical.** This is pure relocation + one extraction. Do not change route order, handler logic, middleware order, header injection, error shapes, or `env.ASSETS` handling.

## Verify before declaring done
Confirm the bundle builds and these smoke paths behave exactly as before: `/login.html` (served), `/api/auth/me` (session), one authenticated GET (e.g. `/api/parts`), one permission-gated 403 case, a static asset (e.g. a `/logo/*` or `.css`), and the `/track/` public surface. Note for Steve: confirm the Pages project picks up the `_worker.js/` directory form on first deploy.

## What NOT to change
- The `API_ROUTES` table contents/order. Middleware order or logic. The permission maps' contents. Handler bodies. `env.ASSETS` fallthrough. Auth/session behavior. Do NOT create a `functions/` directory. Do NOT add `package.json`, bundler config, or any build step. Do NOT move handler groups yet — that's F5b onward.
