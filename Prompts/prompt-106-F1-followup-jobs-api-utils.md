# P106 — F1 follow-up: Jobs module → `api.*` / `utils.*`

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **job-board-agent**. Foundation Roadmap **Phase F1 open follow-up** (shared-utility adoption). Frontend-only, no DB/API/migration. Behavior-identical consistency refactor — same migration rules as P104/P105.

**Prereq (already true — confirm, don't change):** `jobs/jobs-header.js` chains to `/shared/shared-header.js`, which loads `window.api` (`/shared/shared-api.js`) and `window.utils` (`/shared/shared-utils.js`).

## Scope
- `jobs/index.html` (~11 raw `fetch` calls, 0 `api.*` today)

## Migration rules
1. **`fetch` → `api.*`.** `window.api` exposes `get/post/put/del/raw`, each returning **`{ ok, data, error, status }`** (read `/shared/shared-api.js` for the contract). Replace each raw `fetch` + manual `res.ok`/`res.json()` handling with the helper and rewrite the call site to the `{ ok, data, error }` shape. Endpoints, methods, and bodies stay identical.
2. **Preserve UI.** `api.*` shows no UI — keep every existing toast/inline message/loading state, fed from `error`/`data`.
3. **401** is handled by the shared `window.fetch` wrapper from `shared-header.js`; remove redundant manual 401→`/login` redirects only if confirmed covered.
4. **Inline calcs → `utils.*`.** Read `/shared/shared-utils.js` for the exact surface (date helpers `isoToUS`/`isoToShortDate`/`todayIso`, `escHtml`, `truncate`, density). Replace inline equivalents with the shared call without changing output. If no equivalent exists, leave it.

## Important — leave the recently-shipped work alone
`jobs/index.html` just received the P91 delete-job fix. The **packing-slip parser** (`jobs/packing-slip-parser.js`) is out of scope — this is the page's API/format calls only, not parsing. Migrate the network calls; do not alter the Kanban drag-and-drop logic, line-item handling, or the packing-slip upload/parse flow beyond swapping the `fetch` transport for `api.*`.

## Verify before declaring done
Every job action behaves identically: load board, create/edit/**delete** a job (P91 cleanup intact), drag between columns, upload + view a packing slip, generate BOL / build load handoffs. No raw `fetch(` remains in `jobs/index.html` (outside the parser file, which you don't touch).

## What NOT to change
- Endpoints, bodies, business logic, calculation outputs. The packing-slip parser. The Kanban behavior. `STORAGE_KEY`. The shared `shared-*.js` files. The header chain. Other modules.
