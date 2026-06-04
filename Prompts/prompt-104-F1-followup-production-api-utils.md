# P104 — F1 follow-up: Production module → `api.*` / `utils.*`

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **production-agent**. Foundation Roadmap **Phase F1 open follow-up** (shared-utility adoption). Frontend-only, no DB/API/migration. Behavior-identical — this is a consistency refactor, not a feature change.

**Prereq (already true — confirm, don't change):** `production/production-header.js` chains to `/shared/shared-header.js`, which loads `/shared/shared-api.js` (`window.api`) and `/shared/shared-utils.js` (`window.utils`). So `api.*` and `utils.*` are available on these pages. If a page in scope does NOT chain to the shared header, stop and report rather than migrating it.

## Scope
- `production/inventory.html` (~11 raw `fetch` calls)
- `production/bead-inventory.html` (~8 raw `fetch` calls)

## Migration rules

1. **`fetch` → `api.*`.** `window.api` exposes `get(path)`, `post(path, body)`, `put(path, body)`, `del(path)`, `raw(path, opts)`, each returning **`{ ok, data, error, status }`** (read `/shared/shared-api.js` for the exact contract). Replace each raw `fetch` + manual `res.ok`/`res.json()` handling with the helper and **adapt the call site to the `{ ok, data, error }` shape** — this is a rewrite of each call site's response handling, not a string swap. Endpoints, methods, and request bodies stay identical.
2. **Preserve UI behavior.** `api.*` deliberately shows no UI (no toasts/alerts). Keep every existing success/error toast, inline message, and loading state — just feed them `error`/`data` from the helper instead of the old parsed response.
3. **401 handling.** Per `shared-api.js`, the 401 redirect is handled by the `window.fetch` wrapper installed by `shared-header.js`. Remove any now-redundant manual 401 → `/login` redirect in these two files **only after confirming** the wrapper covers that path; if unsure, leave it.
4. **Inline calcs → `utils.*`.** Read `/shared/shared-utils.js` for the exact `window.utils` surface (the F1c set includes density calc, date helpers `isoToUS`/`isoToShortDate`/`todayIso`, and `escHtml`/`truncate`). Where these files inline an equivalent (date formatting, HTML escaping, truncation, density), replace the inline version with the `utils.*` call. **Do not change any formula or its output** — only route through the shared helper where an exact equivalent already exists. If a production-specific calculation has no `utils` equivalent, leave it in place.

## Verify before declaring done
Both pages load and every migrated action behaves identically: inventory list reads/writes, bead-inventory stock reads/writes, dates render the same, error toasts still fire on failure. No raw `fetch(` should remain in these two files (except inside `shared-*.js`, which you don't touch).

## What NOT to change
- Endpoints, request bodies, business logic, or any calculation's output. The three-layer inventory model. `STORAGE_KEY`. The shared `shared-*.js` files themselves. Other modules. Do not add or alter the header chain.
