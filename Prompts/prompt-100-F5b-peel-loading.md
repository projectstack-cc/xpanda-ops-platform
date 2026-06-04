# P100 — F5b: Peel the Loading route group into `_worker.js/routes/loading.js`

**Read BOTH `AGENTS.md` and `xpanda-ops-agents.md` first.** Assume the **db-api-agent** (lead) and **logistics-agent**. Foundation Roadmap **Phase F5 — step F5b**. **Depends on F5a (P99)** being live (`_worker.js/` directory form with `_worker.js/lib/core.js`). First real handler peel — mechanical, behavior-identical. No DB, no migration, no frontend change.

## Move

Create **`_worker.js/routes/loading.js`** and move these three handlers (currently in `_worker.js/index.js`) into it, unchanged:
- `handleApiLoadingBays`        → route `/api/loading-bays`
- `handleApiLoadingAssignments` → route `/api/loading-assignments`
- `handleApiLoadingPhotos`      → route `/api/loading-photos`

`export` each from `routes/loading.js`.

## Wire

1. In `routes/loading.js`, import every shared helper these handlers use from core: `import { json, error, logActivity, /* ...whatever they call */ } from '../lib/core.js';`. Inspect the three handlers and import exactly what they reference — do not guess.
2. Any helper used **only** by these loading handlers (a loading-private helper) moves into `routes/loading.js` alongside them. Any helper used by these **and** other groups stays in `lib/core.js` (move it there now if it's still sitting in `index.js`) and gets imported. If you find a shared cross-cutting helper (e.g. a push/notification sender used by loading and other flows), put it in `lib/core.js` (or a small `lib/push.js`) and import it — do **not** duplicate it.
3. In `index.js`, add `import { handleApiLoadingBays, handleApiLoadingAssignments, handleApiLoadingPhotos } from './routes/loading.js';` and **delete the now-moved function bodies** from `index.js`. The `API_ROUTES` table entries stay exactly as-is — they already call these by name, now resolved via the import.

## Verify before declaring done
Behavior must be identical. Smoke-test: the loading dashboard loads, a bay assignment reads/writes, and a loading photo serves. Confirm `index.js` no longer defines the three functions and the bundle builds with no unresolved references.

## What NOT to change
- Handler logic. The `API_ROUTES` table order/contents. Middleware. `STORAGE_KEY`. Auto-pack. Any other route group (those are F5c–e). Do not introduce a `functions/` directory, `package.json`, or a build step.
