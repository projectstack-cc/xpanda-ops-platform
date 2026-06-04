# P107 — F1 follow-up: Logistics dashboards → `api.*` / `utils.*`

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **logistics-agent**. Foundation Roadmap **Phase F1 open follow-up**. Frontend-only, behavior-identical. Same migration rules as P104/P106. (Load Builder + BOL Generator are handled separately in P108 — do **not** touch them here.)

**Prereq (already true — confirm, don't change):** `logistics/logistics-header.js` chains to `/shared/shared-header.js` → `window.api` + `window.utils` available.

## Scope
- `logistics/index.html` (~14 raw `fetch`, 1 `api.*` already — finish the migration started by F1b)
- `logistics/loading.html` (~13 raw `fetch`, 1 `api.*` already)

## Migration rules (same as prior F1 follow-ups)
1. **`fetch` → `api.*`** (`get/post/put/del/raw` → `{ ok, data, error, status }`; read `/shared/shared-api.js`). Rewrite each call site's response handling to the new shape; endpoints/methods/bodies unchanged. The one or two existing `api.*` calls in each file are your in-file reference for the target pattern.
2. **Preserve all UI** (toasts/inline/loading) — feed from `error`/`data`.
3. **401** handled by the shared wrapper — drop redundant manual redirects only if confirmed.
4. **Inline calcs → `utils.*`** where an exact equivalent exists in `/shared/shared-utils.js` (notably `truncate` — both dashboards now use the INV#/customer card treatment from P90; `isoToUS`/`isoToShortDate`/`todayIso`, `escHtml`). Do not change outputs. Note: P90 already uses `truncate` in the card headers — leave those; just convert remaining inline duplicates elsewhere on the page.

## Important — leave the recently-shipped work alone
These two files just received P90 (card header parity + INV# sort), P92 (status write-through is backend, but the dashboards trigger it), P93 (The Yard), and the P91 pickup-exclusion behavior. Migrate the **transport only** — do not alter the status-change handlers' behavior, the sort logic, the Yard rendering, or the bay-assignment flows. Just swap their `fetch` calls for `api.*` and keep identical behavior.

## Verify before declaring done
Both dashboards behave identically: shipment rows + loading cards render with the P90 headers/sort, status changes still propagate (P92), Move-to-Yard works (P93), bay assignment works, customer-pickup rows behave per P91. No raw `fetch(` remains in either file.

## What NOT to change
- Endpoints, bodies, business logic, outputs. The P90 sort/header, P92 status behavior, P93 Yard, P91 pickup handling. `STORAGE_KEY`. Auto-pack. `load-builder.html` / `bol-generator.html` (that's P108). The shared `shared-*.js` files. The header chain.
