# P105 — F1 follow-up: QC + Reports pages → `api.*` / `utils.*`

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **qc-agent** and **reports-agent**. Foundation Roadmap **Phase F1 open follow-up** (shared-utility adoption). Frontend-only, behavior-identical. Two small modules grouped into one prompt because each has only a handful of call sites — clearly separated below.

**Prereq (already true — confirm, don't change):** all pages in scope chain to `/shared/shared-header.js` via their module header (`qc-header.js`, `reports-header.js`), so `window.api` and `window.utils` are available. If any page does not chain, stop and report rather than migrating it.

Follow the same migration rules as P104:
- **`fetch` → `api.*`** (`get/post/put/del`, returning `{ ok, data, error, status }` — read `/shared/shared-api.js`). Rewrite each call site's response handling to the new shape; keep endpoints, methods, bodies identical.
- **Preserve all existing UI** (toasts/alerts/inline messages/loading states) — `api.*` shows no UI; feed it `error`/`data`.
- **401** is handled by the shared `window.fetch` wrapper — remove redundant manual 401 redirects only if confirmed covered.
- **Inline calcs → `utils.*`** where an exact equivalent exists in `/shared/shared-utils.js` (dates `isoToUS`/`isoToShortDate`/`todayIso`, `escHtml`, `truncate`, density). Do not change any formula's output.

## QC scope (`qc-agent`)
- `qc/incident-report.html` (~2 fetch)
- `qc/final-inspection.html` (~2 fetch)
- `qc/scrap-log.html` (~1 fetch)

Note: `qc/density-calculator.html` is standalone with no backend/persistence — **leave it untouched** (no fetch to migrate; its density math is the canonical floor tool). For scrap-log's density auto-calc, only route through `utils` if it matches the shared density helper exactly; otherwise leave it.

## Reports scope (`reports-agent`)
The report leaf pages each make ~1 `fetch` to a `/api/reports/*` endpoint and render a Chart.js view:
- `reports/incidents/detail.html`, `list.html`, `summary.html`, `trend.html`, `type.html`
- `reports/scrap/reasons.html`, `summary.html`, `trend.html`
- `reports/orders/index.html`

Migrate each single fetch to `api.get(...)` and adapt the render to read `data`. These are read-only GETs — no bodies, no mutations. `reports/incidents/index.html` and `reports/scrap/index.html` have no fetch — skip them.

## Verify before declaring done
Each QC form still submits and shows its toast; each report page still loads its chart with identical data. No raw `fetch(` remains in the migrated files (outside `shared-*.js`).

## What NOT to change
- Endpoints, bodies, business logic, formula outputs. The density-calculator floor tool. Chart.js usage/config. `STORAGE_KEY`. The shared `shared-*.js` files. Other modules.
