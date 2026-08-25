# QC Report: P405–P408 — Random Signout Fix Batch

**Repo:** xpanda-ops-platform (Zer0Flaw/xpanda-ops-platform, production ERP for a foam
manufacturing operation — factory floor + logistics, used daily)
**Commits:** `7b53d0e`..`1209322` on `main` (5 commits, **not pushed**)
**Scope:** Fixes a random-signout bug reported by floor/office users. No schema change, no
migration, no permission change across the whole batch.

This report is written for an independent QC reviewer with no prior context on this
conversation. It includes the full diff, the reasoning behind each change, explicit deviations
from the source prompts (and why), and a list of things that were found but deliberately **not**
fixed. Treat every claim about "why" as this author's reasoning, not settled fact — that's exactly
what should be checked.

---

## 1. Background — what bug this fixes

A prior read-only investigation (`SIGNOUT-INVESTIGATION-P404.md`, not part of this diff, already
in the repo) found the mechanism:

- `validateSession()` exists in two places — the legacy Cloudflare Pages worker
  (`_worker.js/lib/core.js`) and the new v2 Next.js-on-Workers app
  (`cutting-pilot/src/lib/session.ts`). Both re-implement the same session lookup against the
  same shared D1 database (`sessions` / `users` / `user_roles` / `roles` tables).
- Both wrapped the D1 lookup in `try { ... } catch (e) { console.error(...); return null; }`.
  **`null` is what a genuinely missing or expired session also returns.** A transient D1
  exception (timeout, quota blip, contention) was therefore indistinguishable from "not logged
  in."
- Every consumer of that `null` treated it as a hard unauthenticated state: a 302 redirect to
  `/login.html` for page loads, a 401 JSON response for API calls.
- On the legacy app, ten byte-identical copies of a global `window.fetch` interceptor made this
  worse: **any** 401 response from **any** fetch call — including a 60-second background
  notification poll that runs on every idle tab — triggered an immediate hard navigation to
  `/login.html`. A user doing nothing could get logged out by a single transient blip on a
  request they never knowingly made.
- On the v2 app, three polling board components (schedule TV board, loading-dock TV board,
  carrier driver view) poll every 30–60s; a failed poll could similarly read as "session gone"
  depending on each component's own handling.
- One identified (but *not proven*) contributing factor: a Cloudflare Cron Trigger
  (`cutting-pilot`'s `xpanda-cutting-v2` worker, every 10 minutes) ingests a schedule spreadsheet
  via a fully sequential per-row `SELECT`-then-`INSERT`/`UPDATE` loop against the **same** shared
  D1 that `validateSession()` reads on every request — a multi-second write burst with zero
  coordination with the read path, several times an hour.

Four fix prompts were authored to address this (P405–P408), each with a `## Scope — LOCKED`
section naming exact files, and a `## HARD RULES` section whose central rule is:

> **NEVER fail open.** A transient/unknown lookup outcome must NEVER be treated as a valid
> session. Definitive answer (row found / no row / expired row) → unchanged behavior. Lookup
> **threw** → must surface as a retryable 503, never a 401/redirect, never granting access.

---

## 2. What shipped, per prompt

### P405 — legacy `validateSession()` resilience (commit `7b53d0e`)

**Prompt's own locked scope:** `_worker.js/lib/core.js` (`validateSession()`), `_worker.js/index.js`
(the session-gate call site), `_worker.js/routes/auth.js` (`sessionCookie()` only, for a `Secure`
hardening add-on). "No other files."

**What actually shipped — 4 files, plus 1 outside the prompt's named scope:**

1. **`_worker.js/lib/core.js`**
   - New `withOneRetry(fn)`: calls `fn()`; on throw, logs
     `console.warn('[auth] transient_session_lookup_retry', {...})`, waits ~50ms, calls `fn()`
     once more. (The retry-logging line was added in a *later* follow-up commit — see §4.)
   - `validateSession()`'s primary session+user lookup (`SELECT s.id, ... FROM sessions s JOIN
     users u ...`) is now wrapped in `withOneRetry`.
   - The success paths are byte-identical to before: no row → `null`; expired row → delete +
     `null`. Multi-role merge, admin detection, `simulating_role_id` handling — untouched.
   - The outer `catch` block, which now only fires if the (retried) lookup still throws, or any
     downstream query in the function throws (role lookup, fallback role lookup, simulating-role
     lookup — these were not individually wrapped in retry, only the primary lookup was, per the
     prompt's literal "wrap the D1 lookup" language): instead of `return null`, it now logs
     `console.warn('[auth] transient_session_lookup_failure', { path, message })` and throws a
     new `class SessionLookupError extends Error`.
   - New `sessionUnavailableResponse()` helper: returns a 503 JSON response
     (`{ ok:false, error:'session_unavailable', transient:true }`) with `Retry-After: 2`, via the
     existing `json()` helper (which already sets `Cache-Control: no-store` on every response).

2. **`_worker.js/index.js`** — the main session gate (runs on every non-static, non-public
   request):
   ```js
   let user;
   try {
     user = await validateSession(db, request);
   } catch (e) {
     if (e instanceof SessionLookupError) return sessionUnavailableResponse();
     throw e;
   }
   if (!user) { /* unchanged: 401 JSON for /api/*, 302 redirect otherwise */ }
   ```

3. **`_worker.js/routes/auth.js`**
   - `sessionCookie()` gains `Secure` in the cookie string:
     `HttpOnly; Secure; SameSite=Lax` (was `HttpOnly; SameSite=Lax`). Cookie is now HTTPS-only.
     Prod is HTTPS-only so this is a no-op change in prod; a future `http://` local-dev login
     would not receive the cookie.
   - **This is the part that goes beyond the prompt's named scope.** `/api/auth/login`,
     `/api/auth/logout`, `/api/auth/me`, `/api/auth/change-password`, `/api/auth/simulate-role`
     are dispatched in `index.js` **before** the main session gate (they're in a
     "always accessible" block). Four of those handlers — `handleAuthMe`,
     `handleAuthChangePassword`, `handleSimulateRoleStart`, `handleSimulateRoleStop` — call
     `validateSession()` **directly**, with no surrounding gate. Without a fix here, a transient
     blip on any of these routes would throw an uncaught `SessionLookupError` that propagates to
     `index.js`'s outermost catch-all, which returns a **plain-text 500** body:
     `"Worker crashed:\n\n" + err.stack`. That's a regression (worse than the 401 it replaced)
     and a stack-trace leak. It also would have broken **P407**, which uses `/api/auth/me` as its
     confirmation check for a possibly-spurious 401 — if that confirmation endpoint itself
     crashes under the exact transient condition it exists to detect, P407's whole de-trigger
     logic is unreliable. Added a small `resolveSessionUser(db, request)` helper in `auth.js`
     that catches `SessionLookupError` and returns `{ user: null, transient: true }`; all four
     call sites now check `transient` first and return `sessionUnavailableResponse()`.

4. **`_worker.js/routes/admin.js`** — `handleApiUsers` (reached *after* the main gate, so a
   second, redundant `validateSession()` call) got the same `try/catch → sessionUnavailableResponse()`
   treatment, "for consistency" — lower stakes since the gate already covers the common case, but
   cheap to add.

**Build verification claimed:** `node --check` on all four files (copied to `.mjs` temp files
first, since they use ES `import`/`export`).

---

### P406 — v2 `validateSession()` resilience, 1:1 mirror of P405 (commit `f3a5fe8`)

**Prompt's own locked scope:** `cutting-pilot/src/lib/session.ts` (`validateSession()`),
`cutting-pilot/src/middleware.ts` (the call site), and — "ONLY where they interpret a failed poll
as logged-out" — `ScheduleBoard.tsx`, `LoadingBoard.tsx`, `CarrierBoard.tsx`, "and any sibling
board with the same `setInterval(fetch…, POLL_MS)` pattern. Verify the real list in the tree
before editing."

**What shipped:**

1. **`cutting-pilot/src/lib/session.ts`** — same shape as core.js: `SessionLookupError` class,
   `withOneRetry<T>()` generic helper (with the same retry-logging warn added later, §4), primary
   lookup wrapped, outer catch now throws instead of returning `null`.

2. **`cutting-pilot/src/middleware.ts`** — this is the *only* auth gate for the entire `/v2/*`
   surface. Its `matcher` config is `"/((?!_next/static|_next/image|favicon.ico).*)"` — i.e. every
   page and every `/v2/api/*` route is gated here, no exceptions, no bypass list (unlike legacy,
   which has an "always accessible" auth-routes block that skips the main gate). Catches
   `SessionLookupError`, returns 503 with `Retry-After: 2` and (after the follow-up commit)
   `Cache-Control: no-store` — JSON body for `/v2/api/*`, plain text for pages.

3. **Board-component list was verified, not assumed**, via `grep -r setInterval` across
   `cutting-pilot/src`. Confirmed exactly three components have a `setInterval(fetch, POLL_MS)`
   poll: `ScheduleBoard.tsx`, `LoadingBoard.tsx`, `CarrierBoard.tsx`. (Other `setInterval` hits
   in the tree are UI clock ticks with no server round trip — not in scope.)

4. **Also verified, not assumed**: whether a `/v2/api/auth/me` endpoint exists (the prompt
   hedged: "or the platform's equivalent session endpoint"). It does not — grepped, confirmed
   absent. All three board components instead call the **legacy** `/api/auth/me` for
   confirmation (same host `www.xpandaops.com`, same shared cookie — architecturally this is the
   one real session-identity endpoint per the repo's own docs on the legacy/v2 split).

5. **`ScheduleBoard.tsx` / `LoadingBoard.tsx`** (near-identical pattern in both): the poll
   handler now branches on response status before falling through to the old logic:
   ```tsx
   if (res.status === 503) {
     if (hasGoodDataRef.current) setStale(true);
     else setError("Reconnecting…");
     return;
   }
   if (res.status === 401) {
     let confirmedGone = true;
     try {
       const confirmRes = await fetch("/api/auth/me");
       confirmedGone = !confirmRes.ok;
     } catch { confirmedGone = false; }
     if (!confirmedGone) {
       if (hasGoodDataRef.current) setStale(true);
       else setError("Reconnecting…");
       return;
     }
     setError("Signed out — sign back in to resume.");
     return;
   }
   if (!res.ok) throw new Error(`HTTP ${res.status}`);
   // ...existing success path unchanged
   ```
   **Note for QC:** neither of these two components ever actually force-navigated on any status
   before this change either — they already had a "keep last-good render, show a stale badge"
   pattern for *any* failure. This change doesn't fix a redirect bug in these two (there wasn't
   one); it makes the specific 503-vs-401 distinction explicit and improves the pre-first-load
   messaging ("Reconnecting…" instead of a generic "Couldn't load the schedule.").

6. **`CarrierBoard.tsx`** — **this one had a real, different problem.** Before this change, its
   `load()` function replaced the *entire data view* with a blocking error banner
   (`{error && <ErrorBanner/>}`, and the data grid only rendered under `{data && ...}`, so the
   error banner fully covered the loads list) on **any** non-2xx response, with no
   last-good-data preservation at all. A driver mid-session, on a single transient blip, would
   have seen today's/tomorrow's load list vanish behind "Failed to load." Fixed by adding the
   same `hasGoodDataRef` pattern the two TV boards already had, plus the same 503/401-confirm
   branching:
   ```tsx
   const hasGoodDataRef = useRef(false);
   // ...
   if (res.status === 503) { if (!hasGoodDataRef.current) setError("Reconnecting…"); return; }
   if (res.status === 401) { /* same confirm-then-decide as above */ }
   const json: CarrierResponse = await res.json();
   if (!res.ok || !json.ok) { setError(json.error || "Failed to load."); return; }
   hasGoodDataRef.current = true;
   setData(json);
   setError(null);
   // catch block: only sets error if !hasGoodDataRef.current
   ```

**Deliberately left unfixed, documented as a BACKLOG item, not silently dropped:** nine
`page.tsx` server components (`schedule`, `orders`, `board`, `blocks`, `loading`, `notes`,
`production`, `cutting`, `cutting/crosscutter`) each call `validateSession()` a **second time**,
independently of `middleware.ts`, to read `isAdmin`/`permissions` for their client-component
props (example: `src/app/schedule/page.tsx` calls `await getEnv()` then
`await validateSession(DB, cookieHeader)` directly). Since `middleware.ts`'s matcher covers every
page route, middleware already 503s (and the page never runs) on the common single-failure case;
a page's own second call could still throw only on a rare *independent second* D1 failure within
the same request's lifetime. Left out of scope: not in the prompt's locked file list, and
Next.js's own Server Component error boundary handles an uncaught throw more gracefully than
legacy's crash-dump did. **This is a judgment call worth QC scrutiny** — see §5.

**Build verification claimed:** `npx tsc --noEmit` and `npm run cf-build` (the project's
OpenNext-via-Cloudflare build command) both green, run after every commit touching
`cutting-pilot`.

---

### P407 — consolidate ten legacy 401-interceptor copies (commit `82d6cd5`)

**Prompt's own locked scope:** create ONE new shared vanilla JS module; replace each inline copy
with a load of / call into it. Explicitly said this prompt depends on P405 shipping first (its
de-trigger logic assumes the 503 contract already exists).

**Discovery step (verified live, not assumed):** ran
`grep -rl "window.location.href = '/login.html'" .` across the repo. Found six files containing
the exact interceptor block:
- `shared/shared-header.js` — the ONE implementation, delegated to by all six module header shims
  (`jobs-header.js`, `logistics-header.js`, `manufacturing-header.js`, `production-header.js`,
  `qc-header.js`, `reports-header.js`) via `document.write('<script src="/shared/shared-header.js">...')`.
  Confirmed via grep that none of the six shims has its own separate copy — no drift.
- Four standalone inline copies with **no** delegation to shared-header.js: `index.html`,
  `admin/roles.html`, `admin/parts.html`, `admin/activity-log.html`, `admin/users.html`
  (five files, not four — the investigation doc's prose undercounted by one; not something this
  batch could change, just noting the actual live count).

**New file: `shared/auth-interceptor.js`** (51 lines, vanilla, IIFE-wrapped, no imports/exports):
```js
(function () {
  if (window.__xpandaFetchWrapped) return;
  window.__xpandaFetchWrapped = true;
  var _origFetch = window.fetch;

  function requestPath(args) { /* extracts pathname from fetch's first arg */ }

  window.fetch = async function (...args) {
    var res = await _origFetch.apply(this, args);
    if (window.location.pathname.startsWith('/login')) return res;
    if (requestPath(args) === '/api/auth/me') return res;   // loop guard
    if (res.status === 503) return res;                      // never redirect on transient

    if (res.status === 401) {
      var confirmedGone = true;
      try {
        var confirmRes = await _origFetch('/api/auth/me');   // bypasses the wrapper itself
        confirmedGone = !confirmRes.ok;
      } catch (e) { confirmedGone = false; }
      if (confirmedGone) window.location.href = '/login.html';
      return res;
    }
    return res;
  };
})();
```

**Wiring:**
- `shared/shared-header.js`: added a guarded `document.write('<script src="/shared/auth-interceptor.js">...')`
  call to its existing "auto-load companion shared modules" block (same pattern already used for
  `theme.js`, `shared-api.js`, `shared-utils.js`, `photo-gallery.js`, `pwa-install.js`), placed
  first so it's active before any of shared-header.js's own fetches. Removed the old inline
  interceptor block from further down in the same file.
- The five standalone HTML files: added `<script src="/shared/auth-interceptor.js"></script>`
  immediately after `<meta charset="UTF-8" />` in `<head>` (a synchronous, render-blocking script
  tag — guaranteed to execute before any `<body>` script runs). Removed each file's old inline
  block from wherever it sat in the body.

**Real gap found and fixed incidentally:** in `admin/parts.html` and `admin/activity-log.html`,
the *old* inline interceptor was defined **after** the page's own first data fetch
(`loadParts()` / `reload()` respectively) in the same `<script>` block — meaning that very first
fetch was never actually covered by the old interceptor either, a pre-existing ordering bug.
Moving the load to `<head>` fixes this as a side effect.

**Build verification claimed:** `node --check` on the new module and on `shared-header.js`; each
of the five touched HTML files' inline `<script>` blocks were extracted (a small throwaway Node
script matching `<script>...</script>` minus any `src=` tag) and `node --check`'d individually,
all reported clean.

---

### P408 — batch schedule-ingest writes (commit `7656994`)

**Prompt's own locked scope:** `cutting-pilot/src/lib/schedule-ingest.ts` only (plus optionally
one new shared util file if needed — none was). Explicitly: "Behavior-preserving. The set of rows
in `schedule_rows` after a run must be identical to today's. Only the mechanism changes."

**Before:** `matchAndUpsert()` looped over every parsed row (up to ~90 rows × 2 fetched ship
weeks ≈ 180) doing, per row: one `SELECT id FROM schedule_rows WHERE invoice_number=? AND
ship_week=? AND day_of_week=?` to decide insert-vs-update, then one `INSERT` or `UPDATE` — each
a separate `await ...run()`. Then one `DELETE FROM schedule_rows WHERE ship_week=? AND
last_seen_at<?` per fetched week (mark-and-sweep pruning: every row touched this run gets the
same `last_seen_at` timestamp; anything older for a fetched week is stale). Up to ~362 sequential
D1 round trips per 10-minute cron run.

**After:**
1. `dedupedRows`: parsed rows are first collapsed into a `Map` keyed by
   `${invoice_number}::${ship_week}::${day_of_week}`, last-one-in wins.
2. `lookupExistingRows(db, fetchedShipWeeks)`: **one** query,
   `SELECT id, invoice_number, ship_week, day_of_week FROM schedule_rows WHERE ship_week IN (?, ?)`
   (fetchedShipWeeks is always ≤2 — current + next ship week — well under D1's 100-bound-param
   ceiling, no chunking needed here), building a `Map<key, id>` of what already exists.
3. For each deduped row, build (but do not yet execute) either an `UPDATE ... WHERE id = ?`
   statement (if `existingIdByKey` has the key) or an `INSERT ...` statement, via
   `db.prepare(sql).bind(...)` — a `D1PreparedStatement`, not run.
4. Submit all the built statements via `db.batch([...])`, chunked at `WRITE_BATCH_CHUNK = 90`
   statements per call.
5. **After** all upsert batches have been awaited, build the (≤2) per-week `DELETE` statements
   and submit them in their own `db.batch([...])` call.

```ts
const writeStatements = dedupedRows.map((row) => {
  const matchJobId = jobIdByInvoice.get(row.invoice_number) ?? null;
  const existingId = existingIdByKey.get(scheduleRowKey(row));
  return existingId
    ? buildUpdateStatement(db, row, matchJobId, pollTimestamp, existingId)
    : buildInsertStatement(db, row, matchJobId, pollTimestamp);
});

for (let i = 0; i < writeStatements.length; i += WRITE_BATCH_CHUNK) {
  const chunk = writeStatements.slice(i, i + WRITE_BATCH_CHUNK);
  if (chunk.length) await db.batch(chunk);
}

const deleteStatements = fetchedShipWeeks.map((shipWeek) =>
  db.prepare(`DELETE FROM schedule_rows WHERE ship_week = ? AND last_seen_at < ?`).bind(shipWeek, pollTimestamp)
);
if (deleteStatements.length) await db.batch(deleteStatements);
```

**Reasoning for `WRITE_BATCH_CHUNK = 90`, stated plainly for QC to challenge:** the file already
has a `JOBS_LOOKUP_CHUNK = 90` constant, justified there as "D1 100-bound-param ceiling" for a
different query. That constraint does **not** apply to `db.batch()`'s statement-array length —
this is a different D1 limit (if any). 90 was reused **only** because it's an already-established,
already-documented number in the same file, and because it roughly matches one ship-week's worth
of rows (so a single failed batch's blast radius is at most one week, not the whole run). **No
Cloudflare D1 documentation was consulted this session to confirm what, if any, hard ceiling
`db.batch()` actually has** — this is a reasoned-but-unverified choice. Worth an explicit QC check
if D1's actual batch limits are known.

**Real edge case reasoned through, not verified against live data:** the *old* sequential
select-then-write loop had a side effect this refactor could have silently broken: if two parsed
rows in the *same run* resolved to the same upsert key (e.g. the same invoice number split across
two chunks delivered on the *same* day — the file's own doc comment only describes a cross-day
split, so same-day was not ruled out), the old loop's second occurrence would `SELECT` and find
the row the first occurrence had *just inserted*, then `UPDATE` it — net effect: last one wins,
one row survives. A naive batch rewrite that pre-fetches existing state **once**, before any
writes, would not see either occurrence as "existing" (since neither existed in the DB yet) and
would emit **two separate `INSERT` statements** for the same key — silently duplicating a row.
The `dedupedRows` step (last-one-wins `Map`, built before any DB lookups) exists specifically to
prevent this. **This was not diagnosed from live production data** — there is no direct evidence
this duplicate-key scenario currently occurs; it's a defensive fix based on reading the code's own
stated assumptions, done out of caution for the prompt's explicit "must be identical" requirement.

**Build verification claimed:** `npx tsc --noEmit` and `npm run cf-build` both green.

---

## 3. Follow-up commit — advisor review findings (commit `1209322`)

After all four prompts were committed, a self-review pass (this session's equivalent of a
pre-push code review) was run against the full diff before declaring the batch done. It surfaced
two things the build gates (`tsc`, `node --check`, `cf-build`) could not catch, because they're
about observable *behavior*, not syntax:

1. **The retry path logged nothing on success.** `withOneRetry`'s catch block, as first written,
   went straight to `await new Promise(resolve => setTimeout(...)); return await fn();` with no
   logging. Only the *outer* catch (give-up-after-retry path) logged
   `transient_session_lookup_failure`. Since D1 blips are expected to be single-request in the
   common case, **the retry succeeding on its second attempt — the case this whole batch exists
   to handle gracefully — would leave zero trace in the logs.** Both the original investigation
   doc's own recommended verification step ("leave `wrangler tail` running filtered on `Session
   validation failed:` until it fires once, to confirm the trigger") and this batch's own
   BACKLOG follow-up ("if `wrangler tail` still shows transient hits persisting after P405–P408
   ship...") implicitly assume this channel is complete. It wasn't. **Fix:** added
   `console.warn('[auth] transient_session_lookup_retry', { message })` inside `withOneRetry`'s
   catch, in both `core.js` and `session.ts`, before the delay — a distinctly-named line so a
   recovered blip is visibly different from a given-up one in the logs.

2. **`middleware.ts`'s page-branch 503 had no `Cache-Control` header.** Legacy's equivalent
   response goes through the shared `json()` helper, which already sets `Cache-Control: no-store`
   unconditionally — so that side was fine without any extra work. The v2 **page** branch (for a
   non-API `/v2/*` route) was a bare `new NextResponse("Session temporarily unavailable, please
   retry.", { status: 503, headers: { "Retry-After": "2" } })` — no cache header at all. This
   repo's own architecture doc (`xpanda-ops-agents.md` §9a, constraint #5) documents a real prior
   incident where Cloudflare's edge cache served a stale 404 for `/v2/_next/*` assets after a
   deploy, requiring a manual cache purge — i.e., this specific CDN is known to cache things it
   shouldn't by default in this project's own history. A cached 503 landing on, say, the
   always-on `/v2/schedule` wall-mounted TV board could pin that screen to an error string well
   past the actual blip. **Fix:** added `"Cache-Control": "no-store"` to both the API-branch
   (`NextResponse.json`) and page-branch 503 responses in `middleware.ts`.

Both fixes were re-verified: `node --check` on `core.js`; `npx tsc --noEmit` + `npm run cf-build`
green on `cutting-pilot` afterward.

---

## 4. Full diff (all 5 commits, squashed for review)

```diff
--- a/_worker.js/index.js
+++ b/_worker.js/index.js
@@ -1,4 +1,4 @@
-import { json, logActivity, generateAccessToken, normalizeName, validateSession, PATH_PERMISSION_MAP, API_PERMISSION_MAP, getPermissionKey, hasPermission, safeJsonParse } from './lib/core.js';
+import { json, logActivity, generateAccessToken, normalizeName, validateSession, SessionLookupError, sessionUnavailableResponse, PATH_PERMISSION_MAP, API_PERMISSION_MAP, getPermissionKey, hasPermission, safeJsonParse } from './lib/core.js';
 import { dispatchNotification } from './lib/push.js';
 import { handleApiLoadingBays, handleApiLoadingAssignments, handleApiLoadingPhotos } from './routes/loading.js';
 import { handleApiBolCustomersSeed, handleApiBolCustomers, handleApiBolCarriers, handleApiBols,
@@ -212,7 +212,13 @@ export default {
       if (!isStaticAsset && !isPublicApi) {
         const db = env.DB;
         if (db) {
-          const user = await validateSession(db, request);
+          let user;
+          try {
+            user = await validateSession(db, request);
+          } catch (e) {
+            if (e instanceof SessionLookupError) return sessionUnavailableResponse();
+            throw e;
+          }
           if (!user) {
             if (url.pathname.startsWith('/api/')) {
               return json({ ok: false, error: 'Unauthorized' }, 401);
--- a/_worker.js/lib/core.js
+++ b/_worker.js/lib/core.js
@@ -47,6 +47,27 @@ export function getSessionToken(request) {
   return match ? match[1] : null;
 }
 
+export class SessionLookupError extends Error {
+  constructor(message) {
+    super(message);
+    this.name = 'SessionLookupError';
+  }
+}
+
+export function sessionUnavailableResponse() {
+  return json({ ok: false, error: 'session_unavailable', transient: true }, 503, { 'Retry-After': '2' });
+}
+
+async function withOneRetry(fn) {
+  try {
+    return await fn();
+  } catch (e) {
+    console.warn('[auth] transient_session_lookup_retry', { message: e && e.message });
+    await new Promise(resolve => setTimeout(resolve, 50));
+    return await fn();
+  }
+}
+
 export async function validateSession(db, request) {
   const token = getSessionToken(request);
   if (!token) return null;
@@ -59,13 +80,13 @@ export async function validateSession(db, request) {
 
   try {
     // Get session + user (without role — roles come from junction table)
-    const session = await db.prepare(`
+    const session = await withOneRetry(() => db.prepare(`
       SELECT s.id, s.user_id, s.expires_at, s.simulating_role_id,
              u.id as uid, u.username, u.display_name, u.role, u.role_id, u.is_active, u.first_login
       FROM sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.id = ?
-    `).bind(token).first();
+    `).bind(token).first());
 
     if (!session) return null;
     if (!session.is_active) return null;
@@ -148,7 +169,8 @@ export async function validateSession(db, request) {
     };
   } catch (e) {
     console.error('Session validation failed:', e);
-    return null;
+    console.warn('[auth] transient_session_lookup_failure', { path: new URL(request.url).pathname, message: e && e.message });
+    throw new SessionLookupError('session lookup failed');
   }
 }
 
--- a/_worker.js/routes/admin.js
+++ b/_worker.js/routes/admin.js
@@ -1,4 +1,4 @@
-import { json, logActivity, validateSession } from '../lib/core.js';
+import { json, logActivity, validateSession, SessionLookupError, sessionUnavailableResponse } from '../lib/core.js';
 
 export async function handleApiActivityLog(request, env) {
   const db = env.DB;
@@ -64,7 +64,13 @@ export async function handleApiUsers(request, env) {
   const db = env.DB;
   if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);
 
-  const sessionUser = await validateSession(db, request);
+  let sessionUser;
+  try {
+    sessionUser = await validateSession(db, request);
+  } catch (e) {
+    if (e instanceof SessionLookupError) return sessionUnavailableResponse();
+    throw e;
+  }
   if (!sessionUser) return json({ ok: false, error: 'Unauthorized' }, 401);
   if (!sessionUser.isRealAdmin) return json({ ok: false, error: 'Forbidden' }, 403);
 
--- a/_worker.js/routes/auth.js
+++ b/_worker.js/routes/auth.js
@@ -1,4 +1,13 @@
-import { json, logActivity, validateSession, getSessionToken } from '../lib/core.js';
+import { json, logActivity, validateSession, getSessionToken, SessionLookupError, sessionUnavailableResponse } from '../lib/core.js';
+
+async function resolveSessionUser(db, request) {
+  try {
+    return { user: await validateSession(db, request), transient: false };
+  } catch (e) {
+    if (e instanceof SessionLookupError) return { user: null, transient: true };
+    throw e;
+  }
+}
 
 async function createSession(db, userId) {
   const sessionId = crypto.randomUUID();
@@ -11,7 +20,7 @@ async function createSession(db, userId) {
 
 function sessionCookie(sessionId, expires) {
   const expDate = new Date(expires).toUTCString();
-  return `xpanda_session=${sessionId}; Path=/; Expires=${expDate}; HttpOnly; SameSite=Lax`;
+  return `xpanda_session=${sessionId}; Path=/; Expires=${expDate}; HttpOnly; Secure; SameSite=Lax`;
 }
 
 function clearSessionCookie() {
@@ -78,7 +87,8 @@ export async function handleAuthMe(request, env) {
   const db = env.DB;
   if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);
 
-  const user = await validateSession(db, request);
+  const { user, transient } = await resolveSessionUser(db, request);
+  if (transient) return sessionUnavailableResponse();
   if (!user) return json({ ok: false, error: 'Not authenticated' }, 401);
 
   return json({
@@ -104,7 +114,8 @@ export async function handleAuthChangePassword(request, env) {
   if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);
   if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
 
-  const user = await validateSession(db, request);
+  const { user, transient } = await resolveSessionUser(db, request);
+  if (transient) return sessionUnavailableResponse();
   if (!user) return json({ ok: false, error: 'Not authenticated' }, 401);
 
   let body;
@@ -128,7 +139,8 @@ export async function handleSimulateRoleStart(request, env) {
   const db = env.DB;
   if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);
 
-  const user = await validateSession(db, request);
+  const { user, transient } = await resolveSessionUser(db, request);
+  if (transient) return sessionUnavailableResponse();
   if (!user) return json({ ok: false, error: 'Not authenticated' }, 401);
   if (!user.isRealAdmin) return json({ ok: false, error: 'Only administrators can simulate roles.' }, 403);
 
@@ -160,7 +172,8 @@ export async function handleSimulateRoleStop(request, env) {
   const db = env.DB;
   if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);
 
-  const user = await validateSession(db, request);
+  const { user, transient } = await resolveSessionUser(db, request);
+  if (transient) return sessionUnavailableResponse();
   if (!user) return json({ ok: false, error: 'Not authenticated' }, 401);
   if (!user.isRealAdmin) return json({ ok: false, error: 'Only administrators can manage simulation.' }, 403);
 
--- a/admin/activity-log.html, admin/parts.html, admin/roles.html, admin/users.html, index.html
    (all five: same two changes)
+++
   <meta charset="UTF-8" />
+  <script src="/shared/auth-interceptor.js"></script>
   <title>...</title>
...
-const _origFetch = window.fetch;
-window.fetch = async function(...args) {
-  const res = await _origFetch.apply(this, args);
-  if (res.status === 401 && !window.location.pathname.startsWith('/login')) {
-    window.location.href = '/login.html';
-    return res;
-  }
-  return res;
-};
+// 401/503 interceptor now lives in /shared/auth-interceptor.js (loaded in <head>, P407).

--- /dev/null
+++ b/shared/auth-interceptor.js   (new file, 51 lines — full content in §2 above)

--- a/shared/shared-header.js
+++ b/shared/shared-header.js
@@ -9,6 +9,10 @@ if (!window.__xpandaThemeLoaded) {
 }
 
 // Auto-load companion shared modules.
+if (!window.__xpandaAuthInterceptorLoaded) {
+  window.__xpandaAuthInterceptorLoaded = true;
+  document.write('<script src="/shared/auth-interceptor.js"><\/script>');
+}
 if (!window.__xpandaSharedApiLoaded) {
   window.__xpandaSharedApiLoaded = true;
   document.write('<script src="/shared/shared-api.js"><\/script>');
@@ -259,19 +263,7 @@ if (!window.__xpandaPwaInstallLoaded) {
         }
       });
 
-      // 401 interceptor — guard prevents double-wrap if two shims are accidentally loaded.
-      if (!window.__xpandaFetchWrapped) {
-        window.__xpandaFetchWrapped = true;
-        const _origFetch = window.fetch;
-        window.fetch = async function (...args) {
-          const res = await _origFetch.apply(this, args);
-          if (res.status === 401 && !window.location.pathname.startsWith('/login')) {
-            window.location.href = '/login.html';
-            return res;
-          }
-          return res;
-        };
-      }
+      // 401/503 interceptor now lives in /shared/auth-interceptor.js (loaded above, P407).
 
       // Auth
       fetch('/api/auth/me').then(r => r.json()).then(d => {

--- a/cutting-pilot/src/app/carrier/CarrierBoard.tsx
+++ (see §2.6 above for the full new load() body)

--- a/cutting-pilot/src/components/loading/LoadingBoard.tsx
+++ (see §2.5 above for the full new fetchBoard() body)

--- a/cutting-pilot/src/components/schedule/ScheduleBoard.tsx
+++ (see §2.5 above for the full new fetchBoard() body)

--- a/cutting-pilot/src/lib/schedule-ingest.ts
+++ (see §2 P408 section above for the full new matchAndUpsert()/lookupExistingRows()/
    buildUpdateStatement()/buildInsertStatement() code)

--- a/cutting-pilot/src/lib/session.ts
+++ b/cutting-pilot/src/lib/session.ts
@@ -30,6 +30,25 @@ export function getSessionToken(cookieHeader: string | null): string | null {
   return m ? m[1] : null;
 }
 
+export class SessionLookupError extends Error {
+  constructor(message: string) {
+    super(message);
+    this.name = "SessionLookupError";
+  }
+}
+
+async function withOneRetry<T>(fn: () => Promise<T>): Promise<T> {
+  try {
+    return await fn();
+  } catch (e) {
+    console.warn("[auth] transient_session_lookup_retry", {
+      message: e instanceof Error ? e.message : String(e),
+    });
+    await new Promise((resolve) => setTimeout(resolve, 50));
+    return await fn();
+  }
+}
+
 export async function validateSession(
   db: D1Database,
   cookieHeader: string | null
@@ -38,15 +57,17 @@ export async function validateSession(
   if (!token) return null;
 
   try {
-    const session = await db
-      .prepare(...)
-      .bind(token)
-      .first<any>();
+    const session = await withOneRetry(() =>
+      db.prepare(...).bind(token).first<any>()
+    );
 
     if (!session || !session.is_active) return null;
     ...
   } catch (e) {
     console.error("Session validation failed:", e);
-    return null;
+    console.warn("[auth] transient_session_lookup_failure", {
+      message: e instanceof Error ? e.message : String(e),
+    });
+    throw new SessionLookupError("session lookup failed");
   }
 }

--- a/cutting-pilot/src/middleware.ts
+++ b/cutting-pilot/src/middleware.ts
@@ -15,7 +15,7 @@
 import { NextResponse, type NextRequest } from "next/server";
 import { getCloudflareContext } from "@opennextjs/cloudflare";
-import { validateSession, hasPermission } from "@/lib/session";
+import { validateSession, hasPermission, SessionLookupError } from "@/lib/session";
@@ -74,7 +74,21 @@ export async function middleware(request: NextRequest) {
       : new NextResponse("Missing D1 binding", { status: 500 });
   }
 
-  const user = await validateSession(db, request.headers.get("Cookie"));
+  let user;
+  try {
+    user = await validateSession(db, request.headers.get("Cookie"));
+  } catch (e) {
+    if (e instanceof SessionLookupError) {
+      const body = { ok: false, error: "session_unavailable", transient: true };
+      return isApi
+        ? NextResponse.json(body, { status: 503, headers: { "Retry-After": "2", "Cache-Control": "no-store" } })
+        : new NextResponse("Session temporarily unavailable, please retry.", {
+            status: 503,
+            headers: { "Retry-After": "2", "Cache-Control": "no-store" },
+          });
+    }
+    throw e;
+  }
 
   if (!user) {
     if (isApi) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
```

(The `schedule-ingest.ts` and three board-component diffs are reproduced in full in §2 rather
than repeated here, to keep this section shorter — they're each in the 25–50 line range.)

---

## 5. Specific things worth QC checking hardest

Ranked by how much I'd want a second opinion on each, most first:

1. **`WRITE_BATCH_CHUNK = 90` for `db.batch()` in P408 — unverified against actual D1 limits.**
   I reused an existing constant's *value* without confirming its *reasoning* transfers. If
   Cloudflare D1's `db.batch()` has a documented statement-count or payload-size ceiling, it
   should be checked against 90 real UPDATE/INSERT statements' worth of bound params (14–16
   params each) to make sure this isn't accidentally too large, or unnecessarily conservative.

2. **The intra-run duplicate-key de-dup fix in P408 is defensive, not diagnosed.** I have not
   confirmed live that `parseSchedule()` can actually produce two rows with the same
   `(invoice_number, ship_week, day_of_week)` key in one run. If it provably cannot (e.g. because
   of how the sheet's day-section state machine works), the de-dup step is unnecessary-but-
   harmless. If it can, the fix is necessary and I believe correct — but this is exactly the kind
   of behavior-preservation claim ("must be identical to today's") that deserves independent
   verification against real sheet data, not just code-reading.

3. **The nine `page.tsx` double-`validateSession()`-call gap (P406), left as a BACKLOG item.**
   My reasoning was: `middleware.ts`'s matcher covers every page route, so it 503s before any
   page component runs on the common (single-failure) case; only an independent *second* D1
   failure within the same request would hit the page's own call, and Next.js's Server Component
   error boundary handles that better than legacy's crash-dump did. I did not verify what a
   Next.js Server Component error boundary actually renders in this project's specific
   OpenNext-on-Cloudflare-Workers setup (no `error.tsx` file was checked for existence/content).
   If there's no `error.tsx` at the relevant route level, Next's default behavior may still be
   less graceful than assumed here.

4. **`withOneRetry` in `core.js` is only applied to the *primary* session+user lookup, not to
   the downstream role/simulating-role queries** in the same `validateSession()` function (both
   legacy and v2). A transient failure on those downstream queries still gets caught by the outer
   `catch` and correctly surfaces as a 503 (never fails open) — but without a retry attempt first.
   This was a deliberate scope read of the prompt's literal "wrap the D1 lookup" language
   (singular), not an oversight, but it means a blip on the role-lookup query is *less* likely to
   self-heal within one request than a blip on the primary lookup. Worth confirming this
   asymmetry is acceptable.

5. **The `Secure` cookie attribute (P405) has no test coverage in this session** — it's a one-word
   string change verified only by `node --check` (syntax), not by an actual login-flow test.
   Production is HTTPS-only so this should be inert there, but this wasn't independently
   confirmed by hitting a live login endpoint.

6. **No live Chrome/browser verification was performed anywhere in this batch** — a standing
   convention for this repo (per prior session guidance) is to skip live UI verification unless
   explicitly requested. All "board never blanks" / "reconnecting message shows" claims for
   `ScheduleBoard.tsx`/`LoadingBoard.tsx`/`CarrierBoard.tsx` are verified by reading the code path,
   not by triggering an actual 503/401 against a running instance and watching the UI.

7. **No live D1 / `wrangler tail` verification that a `SessionLookupError` has ever actually
   fired in production**, before or after this batch. Everything here is a fix for a *proven,
   in-code* fail-closed defect (the `catch { return null }` pattern is real and was read
   directly), but whether the D1-transient-exception trigger condition happens often enough to
   matter in practice was never re-confirmed this session — it rests entirely on the prior
   investigation doc's (already-hedged) findings.

---

## 6. Build/verification claims made, and how to independently re-check them

| Claim | How to re-check |
|---|---|
| `node --check` clean on `_worker.js/lib/core.js`, `index.js`, `routes/auth.js`, `routes/admin.js` | `node --check` each file directly (they're ES modules — check with a `.mjs` extension, not `.js`, or Node will reject `import`/`export` syntax) |
| `node --check` clean on `shared/auth-interceptor.js`, `shared/shared-header.js` | Same — these are classic (non-module) scripts, check with `.js` |
| Five HTML files' inline `<script>` blocks parse clean | Extract each `<script>...</script>` block (excluding any with a `src=` attribute) and `node --check` it individually |
| `npx tsc --noEmit` green in `cutting-pilot/` after every commit touching it | Run from `cutting-pilot/` |
| `npm run cf-build` green in `cutting-pilot/` after every commit touching it | Run from `cutting-pilot/` — **note:** the bare CLI (`npx opennextjs-cloudflare build`) throws `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL` on the installed CLI version in this repo; `npm run cf-build` is the correct invocation |
| Ten interceptor copies → exactly six source files, now one | `grep -rl "window.location.href = '/login.html'" .` from repo root should now show zero hits outside `shared/auth-interceptor.js` |
| Exactly three v2 components have the `setInterval(fetch, POLL_MS)` pattern | `grep -rn "setInterval" cutting-pilot/src` and inspect each hit |
| No `/v2/api/auth/me` route exists | `grep -r "auth/me" cutting-pilot/src` |

---

## 7. What was NOT touched (explicitly out of scope, per each prompt's LOCKED scope)

- No `DB_Migrations/*.sql` file created — no schema change anywhere in this batch.
- No `PATH_PERMISSION_MAP`/`API_PERMISSION_MAP`/`PERMISSION_MAP` entries added or changed — no
  new permission key.
- Legacy routing, matcher config, `basePath`, and asset-prefix handling — untouched.
- The actual sheet-parsing/normalization logic in `schedule-ingest.ts` (`parseSchedule`,
  `sectionHeader`, `cell`, etc.) — untouched; only the persistence step changed.
- Cron cadence (`*/10 * * * *`) — untouched.
- `CHANGELOG.md` and `BACKLOG.md` were updated as part of each commit per this repo's own
  documentation convention (every code-change prompt updates both) — not reproduced in this
  report, but present in the actual commits if useful for cross-checking the stated reasoning
  against what was recorded at the time.

---

*End of report.*
