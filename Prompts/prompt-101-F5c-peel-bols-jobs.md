# P101 — F5c: Peel the BOL/Load-Builder and Jobs/Shipments groups

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **db-api-agent** (lead) and **logistics-agent** + **job-board-agent**. Foundation Roadmap **Phase F5 — step F5c**. **Depends on F5a (P99) and F5b (P100).** Same mechanical, behavior-identical peel as F5b. No DB, no migration, no frontend change.

Two modules this step. Follow the exact pattern established in F5b (move handlers, import shared helpers from `../lib/core.js`, group-private helpers travel with the group, cross-group helpers go to `lib/core.js`, delete moved bodies from `index.js`, leave `API_ROUTES` entries as-is).

## Module 1 — `_worker.js/routes/bols.js`
Move these handlers:
- `handleApiBolCustomersSeed`        → `/api/bol-customers/seed`
- `handleApiBolCustomers`            → `/api/bol-customers`
- `handleApiBolCarriers`             → `/api/bol-carriers`
- `handleApiBols`                    → `/api/bols`
- `handleApiPartsSeed`               → `/api/load-builder-skus/seed`
- `handleApiLoadBuilderSkusDeleteAll`→ `/api/load-builder-skus/all`
- `handleApiLoadBuilderSkus`         → `/api/load-builder-skus`
- `handleApiSavedLoads`              → `/api/saved-loads`

Note: `handleApiBols` also drives the public driver flow's signed-photo serve and BOL lookups — if it shares BOL helpers with the public handlers (F5e's `routes/public.js`), put those shared BOL helpers in `lib/core.js` (or a `lib/bol.js`) and import from both. `handleApiPartsSeed` is named for parts but is only referenced by the load-builder-skus seed route; if you find it (or another handler) referenced by more than one group, leave it importable rather than duplicating.

## Module 2 — `_worker.js/routes/jobs.js`
Move these handlers:
- `handleApiJobs`      → `/api/jobs`
- `handleApiShipments` → `/api/shipments`

These two are where the P91/P92 sync work lives (job→shipment + reverse write-through). Keep all that logic intact — this is relocation only.

## Wire (both modules)
Add the imports to `index.js`:
```js
import { handleApiBolCustomersSeed, handleApiBolCustomers, handleApiBolCarriers, handleApiBols,
         handleApiPartsSeed, handleApiLoadBuilderSkusDeleteAll, handleApiLoadBuilderSkus,
         handleApiSavedLoads } from './routes/bols.js';
import { handleApiJobs, handleApiShipments } from './routes/jobs.js';
```
Delete the moved bodies from `index.js`. `API_ROUTES` order/contents unchanged.

## Verify before declaring done
Smoke-test: generate/load a BOL, list/save a load in Load Builder, create/edit/delete a job (P91 cleanup still works), and confirm a logistics-dashboard status change still propagates to the job/kanban (P92). Bundle builds clean; `index.js` no longer defines the moved functions.

## What NOT to change
- Handler logic (especially the P91/P92 sync and the auto-pack-adjacent load-builder code). `API_ROUTES`. Middleware. `STORAGE_KEY`. The loading group (already peeled). No `functions/`, no `package.json`, no build step.
