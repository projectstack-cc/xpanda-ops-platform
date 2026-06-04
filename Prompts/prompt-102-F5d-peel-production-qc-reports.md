# P102 — F5d: Peel the Production, QC, and Reports groups

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **db-api-agent** (lead) and **production-agent** + **qc-agent** + **reports-agent**. Foundation Roadmap **Phase F5 — step F5d**. **Depends on F5a–F5c.** Same mechanical, behavior-identical peel. No DB, no migration, no frontend change.

Three modules this step, same pattern as before.

## Module 1 — `_worker.js/routes/production.js`
- `handleApiParts`            → `/api/parts`
- `handleApiCombos`           → `/api/combos`
- `handleApiBeadTypes`        → `/api/bead-types`
- `handleApiBeadStock`        → `/api/bead-stock`
- `handleApiBlockInventory`   → `/api/block-inventory`
- `handleApiMoldingLog`       → `/api/molding-log`
- `handleApiBlockConsumption` → `/api/block-consumption`

Note: `handleApiParts` touches the unified `parts` table that other modules read. It stays a parts/production handler — do not split it — but if it shares a parts-matching/normalization helper with the BOL/jobs groups, that helper belongs in `lib/core.js`, imported by both.

## Module 2 — `_worker.js/routes/qc.js`
- `handleApiCompletions` → `/api/completions`
- `handleApiScrapLog`    → `/api/scrap-log`

## Module 3 — `_worker.js/routes/reports.js`
- `handleApiReportsScrapSummary` → `/api/reports/scrap-summary`
- `handleApiReportsScrapTrend`   → `/api/reports/scrap-trend`
- `handleApiReportsScrapReasons` → `/api/reports/scrap-reasons`
- `handleIncidentTrend`          → `/api/reports/incidents-trend`
- `handleIncidentSummary`        → `/api/reports/incidents-summary`
- `handleIncidentList`           → `/api/reports/incidents-list`
- `handleIncidentDetail`         → `/api/reports/incidents-detail`

Note: the incident report handlers hit the Google Sheets gviz endpoint (`env.INCIDENT_TRACKER_JSON_URL`). Any gviz fetch/parse helper used by more than one of them stays in `routes/reports.js` (group-private) unless also used outside reports, in which case it goes to `lib/core.js`.

## Wire
Import all three modules' handlers into `index.js`, delete the moved bodies, leave `API_ROUTES` unchanged:
```js
import { handleApiParts, handleApiCombos, handleApiBeadTypes, handleApiBeadStock,
         handleApiBlockInventory, handleApiMoldingLog, handleApiBlockConsumption } from './routes/production.js';
import { handleApiCompletions, handleApiScrapLog } from './routes/qc.js';
import { handleApiReportsScrapSummary, handleApiReportsScrapTrend, handleApiReportsScrapReasons,
         handleIncidentTrend, handleIncidentSummary, handleIncidentList, handleIncidentDetail } from './routes/reports.js';
```

## Verify before declaring done
Smoke-test: parts list loads (and is visible in load builder/job board), block calculator combos read/write, a scrap-log entry posts, a QC completion records, and each reports endpoint returns data (incidents pull from gviz). Bundle builds clean; `index.js` no longer defines the moved functions.

## What NOT to change
- Handler logic. `API_ROUTES`. Middleware. `STORAGE_KEY`. The density-calc / parts logic. Already-peeled groups (loading, bols, jobs). No `functions/`, no `package.json`, no build step.
