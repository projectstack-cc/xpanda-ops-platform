# Prompt 29 — Platform QC: Dead Code Cleanup & Hygiene

## Goal

Perform a senior-level systems QC pass across the entire xPanda Ops Platform (excluding `/safety/` and `/reports/` modules). Remove dead code, stale references, redundant API calls, orphaned functions, and commented-out blocks left behind from 25+ prompts of iterative development. Tighten hygiene without touching any business logic or algorithms.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

**Scope:** `_worker.js`, `index.html`, `login.html`, `jobs/`, `logistics/`, `production/`, `admin/`, and all shared header JS files. Do NOT touch `safety/`, `reports/`, `qc/`, or `qc-assets/`.

---

## 1. Dead Endpoint: `/api/bols/next-number`

The `handleApiBolsNextNumber` function (line 3282) and its route (line 168) are dead code. Prompt 25 removed the auto-fill from the frontend — no page calls this endpoint anymore.

**Action:**
- Remove the route at line 168: `if (url.pathname === "/api/bols/next-number") { ... }`
- Remove the entire `handleApiBolsNextNumber` function (lines 3282–3294)

---

## 2. Dead Function: `isAdminAuthorized`

The old bearer-token admin check `isAdminAuthorized(request, env)` (line 392) is a pre-auth relic. It's called in one place (line 487 — in `handleApiScrapLog` for PUT). The new session-based auth with role permissions replaces this entirely. The session gate already blocks unauthenticated users, and the permission system handles role checks.

**Action:**
- Remove the `isAdminAuthorized` function (lines 392–399)
- In `handleApiScrapLog`, find the `isAdminAuthorized` check (line 487) and remove the entire block. The session gate and permission system handle access control now. If the PUT needs admin-only access, the API_PERMISSION_MAP already maps `/api/scrap-log` to `qc` which has edit permission configured per role.

---

## 3. BOL Unique Constraint Retry Logic (Stale Error Handling)

The BOL POST handler (line 3408) and PUT handler (line 3463) have catch blocks that check for `UNIQUE constraint failed: bols.bol_number`. The schema only has a regular INDEX (not UNIQUE) on `bol_number` (line 3024). Prompt 28 will drop any stale unique index. This retry logic is dead code and confuses the error handling.

**Action:**
- In the BOL POST catch block (lines 3406–3411), remove the `if (msg.includes("UNIQUE constraint failed")...)` branch. Keep the generic `return json({ ok: false, error: "Server error.", detail: msg }, 500)`.
- In the BOL PUT catch block (around line 3463), do the same — remove the unique constraint specific error message. Keep the generic server error return.

---

## 4. `location_no` Field — Orphaned in BOL Generator

The new BOL template (Prompt 18) doesn't have a "Location No" field. The `bol-shared.js` COORDS don't include it. But the BOL generator form still has the field, the save payload includes it, and the edit mode populates it.

**Action in `logistics/bol-generator.html`:**
- Remove the form field HTML (line 534): `<input type="text" id="f-location-no" ...>` and its label
- Remove from save payload (line 1119): `location_no: ...`
- Remove from the form reset field list (line 1222): `'f-location-no'`
- Remove from edit population (line 1273): `set('f-location-no', ...)`

**Do NOT** remove `location_no` from the `bols` table schema or the worker's INSERT/UPDATE statements — existing records may have data. Just remove the UI field.

---

## 5. Redundant `/api/auth/me` Calls

Every page calls `/api/auth/me` **twice**: once in the shared header JS file (for the user name display + logout button) and once in the page's own script (for permission gating). This doubles the auth API load on every page load.

**Action:** Refactor so the header JS stores the auth response on `window`, and page scripts read from it instead of making a second call.

In each shared header JS file (`logistics/logistics-header.js`, `jobs/jobs-header.js`, `production/production-header.js`):

Find the existing `/api/auth/me` fetch (around line 57). Change it to store the result on window:

```javascript
fetch('/api/auth/me').then(r => r.json()).then(d => {
  window.__xpandaUser = d.ok ? d.user : null;
  if (d.ok && d.user) {
    const el = document.getElementById('hdr-user-name');
    if (el) el.textContent = d.user.displayName || d.user.username;
  }
}).catch(() => { window.__xpandaUser = null; });
```

Then in the page-level scripts that call `/api/auth/me` again (e.g., `jobs/index.html` line 1492, `logistics/index.html` line 991, `production/index.html` line 53), replace the fetch with:

```javascript
// Wait for header's auth check to complete, then use cached result
function getUser() {
  return new Promise(resolve => {
    if (window.__xpandaUser !== undefined) return resolve(window.__xpandaUser);
    // Poll briefly in case header hasn't finished yet
    let attempts = 0;
    const check = setInterval(() => {
      if (window.__xpandaUser !== undefined || ++attempts > 20) {
        clearInterval(check);
        resolve(window.__xpandaUser || null);
      }
    }, 50);
  });
}
```

Then use `const user = await getUser();` instead of fetching `/api/auth/me` again.

For `index.html` (homepage), which has TWO calls to `/api/auth/me` (lines 382 and 399), consolidate into one:

```javascript
async function initHomepage() {
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (!data.ok || !data.user) return;
    const user = data.user;

    // User display
    document.getElementById('user-display').textContent = user.displayName || user.username;

    // Permission gating
    if (!user.isAdministrator) {
      // ... existing card hiding logic
    }

    // Access denied banner
    // ... existing access_denied check
  } catch {}
}
initHomepage();
```

For admin pages (`admin/parts.html`, `admin/activity-log.html`, `admin/users.html`, `admin/roles.html`), they don't use shared headers, so keep their single `/api/auth/me` call as-is.

---

## 6. Commented-Out Schema Blocks

The worker has large commented-out SQL schema blocks that serve as documentation but add clutter. These are:
- Lines 1368–1400: `parts` and `saved_combos` schema
- Lines 1693–1745: `jobs` and `job_line_items` schema
- Lines 2154–2207: bead/block/molding schemas
- Lines 2715–2740: `shipments` schema
- Lines 2955–3027: `bol_customers`, `bol_carriers`, `bols` schemas
- Lines 3491–3496: load_builder_skus deprecation note

**Action:** Consolidate ALL schema comments into a single block at the very top of the file (after the `export default { ... }` block, around line 220). Format as:

```javascript
// ════════════════════════════════════════════════════════════════════
// DATABASE SCHEMA REFERENCE
// Tables are created via SQL migrations run in Cloudflare D1 Console.
// This block is documentation only — not executable.
// ════════════════════════════════════════════════════════════════════
//
// TABLE: users — id, username, display_name, password, role, role_id, ...
// TABLE: sessions — id, user_id, expires_at, ...
// TABLE: roles — id, name, description, permissions (JSON), is_system, ...
// TABLE: parts — id, part_number, name, customer, density_material, L/W/H, weight, color, category, parent_group, ...
// TABLE: saved_combos — id, name, parts_json, ...
// TABLE: jobs — id, customer, status, po_number, invoice_number, line_items (JSON), ship_to_*, ...
// TABLE: job_line_items — id, job_id, part_number, description, quantity, dimensions, ...
// TABLE: bead_types, bead_stock, block_inventory, molding_log, block_consumption_log
// TABLE: shipments — id, direction, customer, origin, destination, status, ...
// TABLE: bol_customers — id, company, street, city, state, zip, ...
// TABLE: bol_carriers — id, name, scac, ...
// TABLE: bols — id, bol_number, date, customer_id, ship_to_*, carrier_*, commodity_description, ...
// TABLE: activity_log — id, timestamp, action, entity_type, entity_id, summary, detail, user_id, ...
// TABLE: saved_loads — id, name, job_id, customer, trailer_type, state_json, expires_at, ...
//
// See individual .sql migration files for full DDL.
// ════════════════════════════════════════════════════════════════════
```

Then **delete** all the scattered commented-out schema blocks throughout the file.

---

## 7. `document.write()` in Header Files

All four module header files use `document.write()` to inject the header HTML. This is a known anti-pattern that blocks parsing and fails in async contexts. While a full refactor to `DOMContentLoaded` + `insertAdjacentHTML` is ideal, it's risky to change in one pass without testing.

**Action for this QC:** Leave the `document.write()` calls as-is for now but add a comment to each header file:

```javascript
// NOTE: document.write() is used here for legacy compatibility.
// Future refactor: switch to DOMContentLoaded + insertAdjacentHTML.
```

---

## 8. Load Builder Packing Slip `document.write()`

In `logistics/load-builder.html`, the `printPackingSlip()` function (line 1104) uses `document.write()` to inject an entire HTML page into a popup window for printing. This is the correct usage pattern for popup print windows — `document.write()` into a new window is fine. **No change needed**, but add a clarifying comment:

```javascript
// document.write() is correct here — writing into a new blank popup window for printing
```

---

## 9. Stale CSS Rules

In `jobs/index.html`, check for CSS rules related to removed features:
- `.jobs-rush-badge` — will be removed by Prompt 27, but if it's still present, remove it
- `.jobs-priority-toggle`, `.jobs-priority-btn`, `.active-normal`, `.active-rush` — same

**Action:** Only remove CSS rules for features confirmed removed in the current codebase. If Prompt 27 hasn't run yet, leave them — they'll be cleaned up there.

---

## 10. Unused Variables and Functions Scan

Perform a grep scan for functions defined but never called:

**In `_worker.js`:**
- `canWrite(request)` (line 384) — defined in Prompt 21 "for future use" but never called anywhere. **Keep it** — it will be used when role-based write checks are added to individual endpoints. But add a comment: `// Reserved: will be used for per-endpoint write checks`
- `isAdmin(request)` (line 388) — same situation. Add comment: `// Reserved: will be used for admin-only endpoint checks`
- `normalizeName(s)` (line 403) — check if it's called anywhere. If not, remove it.
- `hashIp(ip)` (line 409) — check if it's called. If only used by QC/safety (which we're not touching), leave it.

**In frontend files:**
- Check for event listeners attached to elements that no longer exist (e.g., if a button was removed but its listener remains)

**Action:** For each suspected dead function, grep for its name across the entire codebase. If zero references outside its definition, remove it (unless it's explicitly marked as reserved for future use).

<br/>

```bash
# Run this check:
grep -rn "normalizeName" _worker.js jobs/ logistics/ production/ admin/
grep -rn "hashIp" _worker.js jobs/ logistics/ production/ admin/
grep -rn "getWeekNumberMondayStart" _worker.js jobs/ logistics/ production/ admin/
```

---

## 11. Consistent Error Response Shape

Scan all API handlers and verify they return consistent error shapes. The standard should be:
```json
{ "ok": false, "error": "Human-readable message", "detail": "Technical detail (optional)" }
```

Some handlers may return `{ "ok": false, "message": "..." }` instead of `"error"`. Standardize.

**Action:** Grep for `json.*ok.*false` and verify each one uses `error` not `message` for the error field. Fix any that don't match.

---

## 12. Orphaned SQL Migration Files

Check the project root for `.sql` files that have already been run and are no longer needed for reference:

```
auth.sql
bead_inventory.sql
job_board.sql
logistics.sql
roles-permissions.sql
seed-parts.sql
unified-parts.sql
```

**Action:** Do NOT delete these files — they're historical references. But add a header comment to each:
```sql
-- MIGRATION COMPLETE: This file has been run in D1 and is kept for reference only.
```

---

## What NOT to touch

- Do NOT modify `/safety/`, `/reports/`, `/qc/`, `/qc-assets/` (out of scope)
- Do NOT modify any business logic, algorithms, or calculation code
- Do NOT modify database schemas or table structures
- Do NOT rename API endpoints
- Do NOT change the authentication flow
- Do NOT modify `bol-shared.js` COORDS or PDF rendering logic
- Do NOT modify the packing slip parser (Prompt 26 handles that)
- Do NOT remove database columns from INSERT/UPDATE statements even if the UI field is removed
- Do NOT modify `AGENTS.md`

---

## Completion checklist

- [ ] `handleApiBolsNextNumber` function and route removed
- [ ] `isAdminAuthorized` function removed; scrap log PUT check removed
- [ ] BOL unique constraint retry logic removed from POST and PUT handlers
- [ ] `location_no` form field removed from BOL generator UI (keep in API)
- [ ] Redundant `/api/auth/me` calls consolidated (header caches, pages reuse)
- [ ] `index.html` two auth calls merged into one
- [ ] Commented-out schema blocks consolidated into single reference block at top of worker
- [ ] `document.write()` in headers annotated with future-refactor comments
- [ ] Load builder `document.write()` for print popup annotated as correct usage
- [ ] Dead functions removed (after grep verification) or annotated as reserved
- [ ] Error response shapes standardized to `{ ok, error, detail }`
- [ ] Migration SQL files annotated as completed
- [ ] No changes to safety, reports, or QC modules
- [ ] All business logic and algorithms untouched

**Notify Steve:** No migration needed. This is a hygiene-only pass — no functional changes.
