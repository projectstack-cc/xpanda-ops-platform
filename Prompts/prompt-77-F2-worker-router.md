# Prompt 77 — F2: Worker Router Abstraction (same file)

## Agents to assume

**Read BOTH `AGENTS.md` AND `xpanda-ops-agents.md`.** Assume:
- **Lead: db-api-agent** — owns `_worker.js`.

Single-file refactor. No DB. No other files.

## Context

F1 done. F2 replaces the flat `if (url.pathname === ...)` dispatch chain in `_worker.js` with a route-table pattern. **Same file, same deploy, zero behavior change.** Outcome: the giant dispatch block becomes a lookup, every route is one row, the file gets navigable. This makes F5 (per-route file split) mechanical.

## Reconnaissance

Worker is ~5010 lines. The API dispatch block lives roughly between lines 25 and 230. Two kinds of route check:

- **Exact path:** `if (url.pathname === "/api/parts") return handleApiParts(request, env);`
- **Path + prefix:** `if (url.pathname === "/api/jobs" || url.pathname.startsWith("/api/jobs/")) return handleApiJobs(request, env);`

Plus a few method-specific variants for `/api/auth/simulate-role` (POST vs DELETE) and a stray `PUT /api/notifications/read` at line ~4950 that the existing chain misses (it's handled separately inside the notifications handler — leave that intact).

Static asset routes at the very top (`/training`, `/health`, `/login`, `/sw.js`, `/manifest.json`, `/api/push/vapid-public-key`) and the permission gate around line ~95 come BEFORE the API dispatch. Those stay exactly as-is.

## Goal

Replace lines ~25–230 of `_worker.js` with:

1. A single `API_ROUTES` table (const array of route definitions) declared near the top of the file or just above the `fetch` handler.
2. A small `dispatchApiRoute(request, env, url)` helper that walks the table and calls the matching handler.
3. The dispatch block in `fetch` shrinks to one call: `const matched = await dispatchApiRoute(...); if (matched) return matched;`

Every existing handler function (`handleApiParts`, `handleApiJobs`, etc.) is untouched.

---

## Part 1 — Route table

Add near the top of the file (above the `export default { async fetch(...)` block, or at the top of that module — wherever feels natural in the existing structure):

```javascript
// ─────────────────────────────────────────────────────────────────────
// API ROUTE TABLE (F2 — Worker Router Abstraction)
// Replaces the flat if/else dispatch chain. Match order = declaration order.
// Match types:
//   { path: '/api/x', handler: fn }                      — exact path match
//   { prefix: '/api/x', handler: fn }                    — exact OR startsWith(prefix + '/')
//   { path: '/api/x', method: 'POST', handler: fn }      — method-scoped exact match
//
// Adding a new route: add one row. Order matters only for prefix overlaps —
// place more specific paths before more general prefixes.
// ─────────────────────────────────────────────────────────────────────
const API_ROUTES = [
  // Auth
  { path: '/api/auth/login',           handler: (req, env) => handleAuthLogin(req, env) },
  { path: '/api/auth/logout',          handler: (req, env) => handleAuthLogout(req, env) },
  { path: '/api/auth/me',              handler: (req, env) => handleAuthMe(req, env) },
  { path: '/api/auth/change-password', handler: (req, env) => handleAuthChangePassword(req, env) },
  { path: '/api/auth/simulate-role', method: 'POST',   handler: (req, env) => handleSimulateRoleStart(req, env) },
  { path: '/api/auth/simulate-role', method: 'DELETE', handler: (req, env) => handleSimulateRoleStop(req, env) },

  // Push notifications
  { path: '/api/push/vapid-public-key', handler: (req, env) => handleApiPushVapidPublicKey(req, env) },
  { path: '/api/push/subscribe',        handler: (req, env) => handleApiPushSubscribe(req, env) },
  { path: '/api/push/unsubscribe',      handler: (req, env) => handleApiPushUnsubscribe(req, env) },

  // Admin
  { prefix: '/api/users', handler: (req, env) => handleApiUsers(req, env) },
  { prefix: '/api/roles', handler: (req, env) => handleApiRoles(req, env) },

  // QC
  { path: '/api/completions', handler: (req, env) => handleApiCompletions(req, env) },
  { path: '/api/scrap-log',   handler: (req, env) => handleApiScrapLog(req, env) },

  // Reports (scrap)
  { path: '/api/reports/scrap-summary', handler: (req, env) => handleApiReportsScrapSummary(req, env) },
  { path: '/api/reports/scrap-trend',   handler: (req, env) => handleApiReportsScrapTrend(req, env) },
  { path: '/api/reports/scrap-reasons', handler: (req, env) => handleApiReportsScrapReasons(req, env) },

  // Reports (incidents)
  { path: '/api/reports/incidents-trend',   handler: (req, env) => handleIncidentTrend(req, env) },
  { path: '/api/reports/incidents-summary', handler: (req, env) => handleIncidentSummary(req, env) },
  { path: '/api/reports/incidents-list',    handler: (req, env) => handleIncidentList(req, env) },
  { path: '/api/reports/incidents-detail',  handler: (req, env) => handleIncidentDetail(req, env) },

  // Parts / production
  { path: '/api/parts',             handler: (req, env) => handleApiParts(req, env) },
  { path: '/api/combos',            handler: (req, env) => handleApiCombos(req, env) },
  { path: '/api/bead-types',        handler: (req, env) => handleApiBeadTypes(req, env) },
  { path: '/api/bead-stock',        handler: (req, env) => handleApiBeadStock(req, env) },
  { path: '/api/block-inventory',   handler: (req, env) => handleApiBlockInventory(req, env) },
  { path: '/api/molding-log',       handler: (req, env) => handleApiMoldingLog(req, env) },
  { path: '/api/block-consumption', handler: (req, env) => handleApiBlockConsumption(req, env) },

  // Jobs / shipments
  { prefix: '/api/jobs',      handler: (req, env) => handleApiJobs(req, env) },
  { path:   '/api/shipments', handler: (req, env) => handleApiShipments(req, env) },

  // BOL / load builder
  { path:   '/api/bol-customers/seed',     handler: (req, env) => handleApiBolCustomersSeed(req, env) },
  { path:   '/api/bol-customers',          handler: (req, env) => handleApiBolCustomers(req, env) },
  { path:   '/api/bol-carriers',           handler: (req, env) => handleApiBolCarriers(req, env) },
  { prefix: '/api/bols',                   handler: (req, env) => handleApiBols(req, env) },
  { path:   '/api/load-builder-skus/seed', handler: (req, env) => handleApiLoadBuilderSkusSeed(req, env) },
  { path:   '/api/load-builder-skus/all',  handler: (req, env) => handleApiLoadBuilderSkusAll(req, env) },
  { prefix: '/api/load-builder-skus',      handler: (req, env) => handleApiLoadBuilderSkus(req, env) },
  { prefix: '/api/saved-loads',            handler: (req, env) => handleApiSavedLoads(req, env) },
  { prefix: '/api/loading-bays',           handler: (req, env) => handleApiLoadingBays(req, env) },
  { prefix: '/api/loading-assignments',    handler: (req, env) => handleApiLoadingAssignments(req, env) },
  { prefix: '/api/loading-photos',         handler: (req, env) => handleApiLoadingPhotos(req, env) },

  // Platform
  { prefix: '/api/activity-log',  handler: (req, env) => handleApiActivityLog(req, env) },
  { prefix: '/api/notifications', handler: (req, env) => handleApiNotifications(req, env) },
];

async function dispatchApiRoute(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  for (const route of API_ROUTES) {
    if (route.method && route.method !== method) continue;
    if (route.path) {
      if (path === route.path) return await route.handler(request, env);
    } else if (route.prefix) {
      if (path === route.prefix || path.startsWith(route.prefix + '/')) {
        return await route.handler(request, env);
      }
    }
  }
  return null; // no match — caller falls through to static-asset / 404 handling
}
```

**Implementer notes:**
- The handler names above are pulled from the actual existing `if`-chain. If any handler name in the table doesn't match the existing function in the file, use the actual existing name (don't rename anything). Read each existing `if` line for its true handler call.
- The `seed` and `all` routes for `bol-customers` and `load-builder-skus` MUST come before their prefix entries, because they share a prefix. Order in the table above already reflects this.
- The two `/api/auth/simulate-role` entries (POST and DELETE) must come before any catch-all `/api/auth` prefix. There is no such catch-all today, but if you add one later, watch the order.

## Part 2 — Replace the dispatch block

Find the chain of `if (url.pathname === "/api/...")` calls (lines ~25–230). Replace the entire API-route portion of that chain with:

```javascript
// API routes via the F2 router table.
const apiResult = await dispatchApiRoute(request, env, url);
if (apiResult) return apiResult;
```

Place this **after** the static-asset short-circuits at the top (`/training`, `/health`, `/login`, `/sw.js`, `/manifest.json`) and **after** the permission gate (around line ~95). Anything that comes before the `if (url.pathname === '/api/auth/login') return handleAuthLogin(...)` line today stays exactly where it is.

If a route's existing dispatch is conditional on something *other* than path/method (e.g. a permission check happens inline before the handler call), **keep that check exactly where it is** — the router only replaces the path/method check. In practice, the auth gate is centralized above the dispatch block, so this concern shouldn't apply, but verify.

If you find any route in the existing chain that isn't in the table above (e.g. a handler I missed during reconnaissance), add it to the table in the appropriate group. Do NOT silently drop any route.

## Part 3 — Leave everything else alone

- All handler function bodies: untouched.
- `logActivity`, response helpers (`json`, `error`), session/permission gate, static asset serving (`env.ASSETS.fetch(...)`): untouched.
- The standalone `PUT /api/notifications/read` at line ~4950: that's inside the `handleApiNotifications` handler. Untouched.
- Static asset / 404 fall-through at the bottom of `fetch`: untouched.

---

## Scope

- **One file:** `_worker.js`.
- Pure refactor: same routes, same handlers, same behavior, same response bytes.
- No new dependencies. No DB change. No HTML change.
- Add a `// F2 — router table` comment marker so future-you can find it.

## Verify

1. Deploy. Every existing page in every module loads without error.
2. Spot-check 4–5 routes across method types: GET `/api/parts`, GET `/api/jobs`, POST `/api/jobs`, GET `/api/auth/me`, GET `/api/bols/123`. All return the same payload they did before F2.
3. Hit a path that doesn't exist (`/api/nonsense`) — should fall through to static-asset/404 path same as before.
4. The two `/api/auth/simulate-role` methods (POST start, DELETE stop) both work — the method-scoped routes match correctly.
5. Routes that shared a prefix (`/api/bol-customers/seed` vs `/api/bol-customers`) still hit the right handler — `seed` does not get swallowed by the prefix route. Same for `/api/load-builder-skus/seed` and `/all`.
6. `git diff --stat` shows only `_worker.js` changed.

## Next

F3 (permissions audit, read-only doc generation) is the natural next phase, and it's much faster now that the route table makes the surface enumerable. After F3, R2 work (F4) begins.
