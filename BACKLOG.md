# xPanda Ops Platform — Backlog

> **Process:** When an item ships, its entry moves to `CHANGELOG.md` (keyed to its prompt #) and is
> deleted from `BACKLOG.md`. BACKLOG is forward-looking only. Drift check: diff `Prompts/` against
> `CHANGELOG.md` — any prompt missing from the changelog is a gap.
>
> Shipped items live in `CHANGELOG.md`.

---

## Manufacturing / Cutting (React pilot)

- [ ] **P272 follow-up — v2 cutting queue's archived filter goes stale.**
  `cutting-pilot/src/app/api/cutting/queue/route.ts:21` excludes jobs via
  `j.status NOT IN ('archived','shipped')`. After P272, a job archived while genuinely finished
  keeps its real `status` (`'done'`/`'shipped'`/whatever it actually was) instead of being
  overwritten to `'archived'`, so this literal-status filter no longer reliably excludes archived
  jobs — same class of bug P272 fixed in the legacy worker, but P272's scope was `_worker.js/**` +
  `jobs/index.html` only (no v2), and P273 only touches `schedule-status.ts`, so nothing in this
  three-prompt arc reaches it. Low real-world harm today (archived jobs are terminal, so the
  incomplete-cutting-lines check mostly still excludes them) but the exact "dangling cutting line on
  a done job" case the P258 backstop exists for is a real edge. Needs the same `archived_at`
  (exposed via the queue's job SELECT — confirm it's already selected/joinable) swap once a v2
  prompt touches this route.
- [ ] Enrich the `already_clocked_in` 409 in `clock-in/route.ts` with `job_id` + `session_id` (P257) so the "already clocked in" resolver still works if the operator's session job has dropped out of the returned queue — §9a follow-on.
- [ ] Hard enforcement on the Work Queue (P259) — block clock-in on lower-priority jobs while higher-priority ones sit incomplete. Deferred by decision; P259 is guide-only (every job stays clickable).
- [ ] Enable OpenNext skew protection on the v2 Worker (durable fix for hashed-asset 404s across deploys) — see https://opennext.js.org/cloudflare/howtos/skew
- [ ] Surface completed_qty in the checklist/reports (progress bars per part, first-pass yield) once qty data accrues
- [ ] Cross Cutter / Hole Cutter chunk checklists (replace the shared parts list) once block-calc BOM feeds chunk counts

---

## Schedule Board (v2)

- [x] P260 — `schedule_rows` D1 migration (schema only)
- [x] P261 — v2 schedule cron poller — imports the Google-Sheet schedule into `schedule_rows`, matching rows to `jobs` on `invoice_number`
- [x] P262 — `GET /v2/api/schedule-board` read endpoint — reads `schedule_rows` (+ matched job data) for the TV board, derives live status
- [x] P263 — `/v2/schedule` TV board UI — two stacked week bands, shrink-to-fit day columns, live status badges
- [x] P264 — `schedule` permission key added to `PERMISSION_LABELS` (`admin/roles.html`) — the board is now grantable; an admin still needs to actually check the box for whichever role(s) should see it
- [x] P261 hotfix — poller switched from Sheets API to Drive API + XLSX parsing (source file is an uploaded Excel doc, not a native Sheet; Sheets API refused it outright). Steve enabled the Drive API and minted a new `drive.readonly`-scoped refresh token (secret updated, validated end-to-end against the real spreadsheet before commit — confirmed working). Also fixed two bugs the real data surfaced: a false-positive PENDING section match on a totals row, and an upsert key too narrow to survive a large order split across multiple delivery days under one base invoice (widened to `invoice_number, ship_week, day_of_week`).
- [x] P261 hotfix #2 — even after the Drive/XLSX fix + working token, `schedule_rows` still stayed empty: `wrangler tail` caught the real cause, the scheduled handler was hitting the Workers CPU time limit parsing all 190+ historical tabs in the workbook by default. Fixed with SheetJS's `sheets` read option (parse only the 2 needed tabs, ~16s → ~5s). Turned out this account was on the Workers **Free** plan, whose Cron Trigger CPU budget is a fixed, non-configurable 10ms — no parse optimization could ever fit under that, so Steve upgraded to Workers Paid ($5/mo) specifically to unblock this. **Confirmed working live 2026-07-22**: 48 rows written on the first successful poll post-upgrade, correct distribution across both ship weeks, cron back to the normal `*/15 * * * *`.
- [x] P265 — archived jobs resolve to `Shipped` on the schedule board (highest precedence in `deriveStatuses`), instead of falling through to a stale mid-production status when the floor data was never fully ticked.
- [x] P266 — truck-type load labels (`FB`/`TL`/`XP` + raw fallback), INV# typography matched to the customer name, collapsible/auto-hiding nav on `/v2/schedule` only, and density retuning so a day column fits 8–9 orders instead of visually clipping around 6.
- [x] P267 — `/v2/schedule` now has an entry point from the home dashboard (`index.html`) — a `schedule`-permission-gated module card between Cutting and Production, matching sibling card markup exactly.
- [x] P268 — Production-status badges suppressed behind `SHOW_STATUS_BADGES` (frontend-only; derivation/API untouched); unmatched-row flagging retained.
- [ ] **P268 follow-up — restore schedule board status badges.** Flip `SHOW_STATUS_BADGES` back to `true` in `src/components/schedule/flags.ts` once the platform-wide status-routing rework lands and the derived statuses are trusted again. Don't let this linger — it was meant to be temporary.
- [ ] **P268 follow-up — reclaimed row space with badges hidden.** With `SHOW_STATUS_BADGES` false, matched rows are visibly narrower/shorter than before; density/shrink-to-fit sizing was deliberately left untouched (badges are coming back). If the board runs with badges suppressed for a while, consider whether the extra room is worth using, but re-tune together with the badge restore, not separately.
- [ ] **P261 follow-up — no `UNIQUE(invoice_number, ship_week, day_of_week)` on `schedule_rows`.** The 1/5 migration didn't add one, so the poller's upsert is done in application code (select-then-insert/update) rather than SQL `ON CONFLICT`. Works fine at 15-min-cron scale, but if `schedule_rows` ever gets a second writer, add the unique index and switch to a real upsert.
- [x] P263 follow-up — verify shrink-to-fit against a real TV. Steve confirmed 2026-07-24: fits the real wall-mounted TV. Unblocks P277 (linked-jobs 3/3 side rail), which required this to have landed first since it touches the same density/DayColumn/ScheduleBoard files.
- [ ] **P263 follow-up — late/at-risk highlighting on the schedule board.** Explicitly out of scope for the first UI pass; would need a definition of "late"/"at-risk" (vs. `ship_date`? vs. status stalling?) before scoping.
- [ ] **P263 follow-up — per-day totals on the schedule board** (load count / bdft sum per `DayColumn`) if useful once the board is in daily use.
- [ ] **P263 follow-up — wire `/v2/schedule` into `PlatformHeader`'s nav list.** The `schedule` permission key now exists (P264) so this is unblocked; still needs its own scoped change to `PlatformHeader.tsx`'s `NAV_MODULES` (§9b).

---

## Logistics

### Standing Logistics Backlog

- [ ] **P271 follow-up — `loading_assignments.archived_at`.** Apply the same orthogonal-archive
  treatment (P271) to `loading_assignments.loading_status = 'archived'` (site L24 in
  `status-write-site-inventory.md`) — same two-facts-one-column defect, but lower-stakes since the
  stage timestamps (`delivered_at`/`in_transit_at`/`loaded_at`) survive the overwrite independently.
- [ ] Customer database (full CRUD) — icebox: revisit once all orders are entered here first, or it becomes a necessity
- [ ] Consider separate dashboards for staff vs. management (TV display)
- [ ] Zoning support for deck systems
- [ ] Load builder: make initial calculated load view larger, include the stacks visually
- [ ] Load builder: fix/clarify customize mode drag-and-drop (move layers between columns)

### BOL Issues

- [ ] **P241 follow-up — manual relink of unrecoverable orphaned BOL job links.** After running `backfill-bol-job-id.sql`, the verification query reported 84 rows still with `job_id IS NULL`: 52 are pre-P170 rows with no `bol_group_id` (can never be auto-relinked — no recovery key exists); the other 32 (13 distinct `bol_group_id` groups) have a group key but *every* row in the group is orphaned — no sibling had a `job_id` to inherit, so the backfill's sibling-inheritance logic couldn't apply. Needs manual investigation per group/job to relink (or accept as permanently orphaned if the source job can't be identified).
- [ ] **BOL print rendering bug** — when printing the BOL directly (without downloading), the "N" from "Bill of Lading No" and the "S" in "Customer Signature" are clipped/hidden. Parked: root cause is the blank-template artwork + browser print scaling (not our drawn text); needs print-preview testing on a real printer.
- [ ] **P253 follow-up — per-load `shipments` rows.** The job-level `shipments` in_transit/delivered flip is gated on *all* non-archived `loading_assignments` for a job reaching that stage. If a multi-load job with staggered trailer departures/arrivals (days apart) proves the coarse job-level gating is confusing on the logistics dashboard (e.g. "delivered" not showing until the last of several trailers arrives), consider splitting `shipments` to one row per load — larger schema change, needs its own scoped prompt.

---

## Job Board

- [x] P275/276/277 sequence — linked jobs (trailer sharing). 1/3 (P275, migration), 2/3 (P276,
  worker + legacy entry UI), 3/3 (P277, `/v2/schedule` side rail) have all shipped. **P277 still
  needs `wrangler deploy` from `cutting-pilot/` before the rail is live** — v2 doesn't auto-deploy.
- [ ] **P276 follow-up — deleting a linked job can leave its groupmates as a group of one.**
  `DELETE /api/jobs` doesn't clear/cascade `trailer_group_id` on the deleted job's former
  groupmates the way link/unlink do (Linking Rule 1: "never leave a group of one"). Deliberately
  left out of P276's locked scope (Tasks A-E didn't mention DELETE). If a job with exactly one
  groupmate gets deleted, that groupmate is left holding a now-meaningless solo
  `trailer_group_id` until someone manually unlinks it. Low real-world odds (deleting a job that's
  actively linked to a trailer group is an edge case) but worth a small follow-up: mirror the
  same "remaining count === 1 → clear" cleanup from the PUT unlink path into the DELETE handler.
- [ ] **P272 follow-up — `reports/orders/index.html` still filters/labels archived by `status`.** The
  Orders Report's Status dropdown ("Archived" option), stats (`stat-active`/`stat-archived`), and
  `statusBadge()` all key off `j.status === 'archived'`, which was explicitly out of P272's locked
  scope (`_worker.js/**` + `jobs/index.html` only). After P272, new archives no longer write
  `status`, so this report will silently stop counting/labeling newly-archived jobs as "Archived" —
  it'll only ever match the shrinking legacy population. Needs the same `archived_at` signal swap.
- [ ] **P272 follow-up — unarchiving a legacy `status='archived'` row leaves it in a limbo state.**
  Manual Unarchive now only clears `archived_at`, never writes `status` (P272, by design — a job's
  real status should be restored exactly as it was). But for the finite legacy population backfilled
  by P271 (real prior status unrecoverable), `status` is still literally the string `'archived'` —
  unarchiving one of these clears `archived_at` but leaves `status='archived'`, which isn't a real
  Kanban/list status (won't render in any Kanban column, shows a raw "archived" label in List view,
  isn't in the editable-status set). Not destructive, and the legacy population shrinks over time as
  new archives stop hitting this path — but if it comes up in practice, the fix is a small one-time
  prompt (e.g. force such rows to a sane default like `'done'` on unarchive, with a toast explaining
  why).
- [ ] Re-run Lob ship-to address verification (P249) at BOL generation time, in case the ship-to was edited after job save without re-triggering verification, or verification wasn't yet available for older jobs.
- [ ] Surface ZIP+4 (`ship_to_standardized.zip4`, captured by P249's Lob verification) onto the printed BOL.
- [ ] **Lob verification: act on diagnostic outcome from P255.** P255 added `key_mode`/`error_detail` observability but changed no verification behavior. After deploy, Steve must save a job with a known-good address and read the browser console: `key_mode: 'test'` → swap the Worker secret to a `live_` key (hypothesis confirmed, no code change needed); `key_mode: 'live'` + `reason: 'lob_error'` → read `error_detail`'s Lob HTTP status (401 bad key / 429 rate limit / 5xx outage) and scope a follow-up fix from there; `key_mode: 'live'` + `no_match` on a verified-correct address → escalate to Lob (data/account issue, not a code bug).
- [ ] **P254 follow-up — real `street2` form input.** P254 stopped the job form from hardcoding a blank `ship_to_street2` on every save (it now only ever writes a Lob-suggested value), but there is still no manual suite/unit-line input on the job form. Add one if the Lob flow shows manual entry needs it (e.g. addresses with a suite # that Lob doesn't split out).
- [ ] **Batch Packing Slip upload for job creation** — allow uploading multiple packing slips at once to create multiple jobs in bulk; likely a first feature of a planned Order Entry dashboard.
- [ ] Fine-tune packing slip PDF parser (edge cases, layout variations, field extraction accuracy — blocked on Quickbase input formatting improvements)
- [ ] Create packet feature with Bill of Materials (BOM)
- [ ] Recurring jobs / job templates — "duplicate as template" or "create from previous" for repeat customers (e.g. DiversiTech, All Florida Weatherproofing)
- [ ] Label printing — DiversiTech and UL labels

---

## QuickBooks Integration — Automated Job Intake · **SCOPED · TABLED (not today)**

> **Status:** Fully scoped 2026-06-05, intentionally deferred. The legacy packing-slip parser (`/jobs/packing-slip-parser.js`) **remains the primary, production intake method** and works great — **do not refactor or replace it.** QB becomes intake only once this pipeline is proven; the parser then becomes the fallback path.

**Goal:** QBO invoice created → webhook → fetch invoice → map → xPanda job auto-created → notify ops. No PDF generated, uploaded, or parsed.

### Locked decisions / constraints

- **All QB code is server-side in the worker** — `_worker.js/lib/quickbooks.js` (API client), `_worker.js/lib/qb-mapper.js` (invoice→job, pure fn), `_worker.js/routes/qb.js` (connect/callback/disconnect/webhook). **Not** in `/shared/*` or `/jobs/*` — those are browser-loaded; OAuth, the client secret, token refresh, and the webhook must never touch the client.
- **Sandbox first, then prod cutover.** Base URL + keys are **env-driven** (`QB_ENV` flips `sandbox-quickbooks.api.intuit.com` ↔ `quickbooks.api.intuit.com`) so cutover is **config-only, never a code change.**
- **Secrets** (Cloudflare secrets, *not* `wrangler.toml [vars]`): `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_WEBHOOK_VERIFIER`, `QB_REDIRECT_URI`, `QB_ENV`. Realm ID + tokens live in a new D1 `qb_tokens` table.
- **OAuth connect is a one-time action by the QBO admin/owner** — not Steve's QBO access level. Sequenced late (QB4) so the whole pipeline is proven before the higher-up is pulled in (their part is a ~2-min click).
- **Webhook is CloudEvents v1.0** (old format retired May 15 2026). Payload is an **array of events** that can span **multiple companies** → iterate. Verify the `intuit-signature` HMAC against `QB_WEBHOOK_VERIFIER`. Endpoint **bypasses the session gate** like `/api/public/*` (Intuit's servers have no session).
- **Tokens:** access ~60 min, refresh ~101 days (5-yr max). Refresh token **rotates on every refresh — persist the new one each time.**
- **API quirks:** `Id` filters only `=`/`IN` and is not sortable (sort by `TxnDate`). Free **Builder tier** = 500k calls/mo, 10 req/s/realm — ample for one company.

### ⚠️ Open risks (the unsolved parts)

1. **Custom-field accessibility — must be probed before anything is built on it.** XPanda's 8 invoice custom fields are the *newer* Custom Fields platform. Standard read path is v3 REST `?minorversion=70&include=enhancedAllCustomFields`; the full Custom Fields **GraphQL** API is a **Gold/Platinum Premium** feature. **Customer-category** fields (Truck Loads, Total Board Foot, etc.) have a long history of returning **empty/unavailable** over the API. Several drive real job data (`load_count`, `total_bdft`) → **QB1 must empirically dump a real invoice and confirm which fields actually return values** before the mapper is designed. Fallbacks: default `load_count = 1`, blank/compute `total_bdft`.
2. **Parts pull / line-item matching (main worry).** Open question whether QB invoice `Line[]` items reliably resolve into the unified `parts` library the way the parser does at parse time. The mapper must **reuse the parser's part-matching**, with on-the-fly part creation + human review for unmatched lines. Not yet validated — treat as unproven.

### Field map (QBO invoice → xPanda job)

| QBO field | Type | → job field |
|---|---|---|
| CustomerRef / BillAddr / ShipAddr | standard | `customer`, `ship_to_*` |
| DocNumber | standard | `invoice_number` |
| Line[] | standard | `line_items[]` (+ part match) |
| TxnDate | standard | order/ship date |
| PURCHASE ORDER | custom (Transaction) | `po_number` |
| Truck Loads | custom (Customer ⚠️) | `load_count` |
| Total Board Foot | custom (Customer ⚠️) | `total_bdft` |
| PICK UP SCRAPS | custom (Customer ⚠️) | scrap-pickup flag (BOL) |
| Shipment Contact | custom (Customer ⚠️) | ship-to contact |
| Order Entry Date | custom (Customer ⚠️) | entry/order date |
| Entry By | custom (Transaction) | created-by metadata |
| PAYMENT METHOD | custom (Customer ⚠️) | metadata (likely unused for jobs) |

⚠️ = at-risk via API per risk #1.

### Build order (sequenced; labels are initiative-internal, not platform prompt numbers)

- [ ] **QB1 — Connectivity + custom-field recon (sandbox).** `lib/quickbooks.js` (env-driven base URL + pasted OAuth-Playground token) + throwaway probe route `GET /api/qb/probe?invoiceId=X` that fetches with `include=enhancedAllCustomFields` and dumps raw JSON. **Gate:** produces the field-availability map that decides everything downstream.
- [ ] **QB2 — Mapper.** `lib/qb-mapper.js`, pure fn built against QB1's real shape, explicit fallbacks for missing custom fields, reuses parser part-matching.
- [ ] **QB3 — Job creation.** Extract `createJobFromPayload()` out of `handleApiJobs` POST so QB jobs route through the **same** path (shipment + loading-card creation identical). Feed mapper output in.
- [ ] **QB4 — OAuth connect + token storage.** `qb_tokens` table (**needs migration**), `/api/qb/connect` `/callback` `/disconnect`, refresh-with-rotation. QBO admin does the one-time connect. Replaces the pasted token.
- [ ] **QB5 — Webhook (CloudEvents).** `/api/qb/webhook` — session-gate bypass, HMAC verify, iterate events (multi-company), filter invoice created/updated, dedupe, fetch → map → create.
- [ ] **QB6 — Notifications.** Reuse `lib/push.js` + notifications route to alert ops on each auto-created job.

### Production-key gate (parallel, non-blocking)

Private single-company use does **not** require App Store publishing/certification. To unlock production keys: app details + **App Assessment Questionnaire** (security Q&A), a production HTTPS **redirect URI**, **host/launch URL**, **disconnect URL**, and publicly hosted **privacy policy** + **EULA** pages (the one genuinely new deliverable — two static `/legal/*.html` pages). Can run in parallel with sandbox dev; cutover stays config-only.

---

## Admin / Platform

- [ ] Remove temporary `pages.dev` → `xpandaops.com` redirect from `_worker.js/index.js` once all internal links/bookmarks confirmed updated.
- [ ] Hide `packing-slip-test.html` from any navigation/discovery surface (tiny housekeeping — can ship anytime, doesn't block anything)
- [ ] Breakdown job board permissions into more granular sub-modules *(easier after F3 audit + F1a shared header — both now done)*
- [ ] Dashboard KPIs / metrics panel — homepage widget showing jobs by status, BOLs generated this week, shipments pending/in-transit/delivered, most-used parts *(adds new endpoints)*
- [ ] Port language / i18n features from Safety portal to platform-wide use *(needs F1c shared utils as its home — now done)*
- [ ] Scrap batch entry tool *(density calc now centralized in shared-utils.js — safe to add)*
- [ ] **Dark mode Bucket A — remaining passes** — P184 audit identified Bucket A hits in Safety (0% token adoption — highest priority), `logistics/load-builder.html` (local token system, separate batch), and `track/index.html` (standalone, no tokens.css). P186 covered all other modules. These three remain for dedicated prompts.

---

## Foundation Roadmap — ✅ All phases complete

All Foundation Roadmap phases (F1–F5) have shipped. See `CHANGELOG.md` (Foundation Roadmap section) for entries.

---

## Production / Manufacturing

*(Cutting Dashboard legacy shipped — see `CHANGELOG.md`.)*

### Cutting v2 React pilot (`cutting-pilot/`)

- [x] P196 — Route-tree reconcile, dev server green at `/v2/cutting`
- [x] P197 — Worker build: `opennextjs-cloudflare` build green + local workerd preview boots
- [x] P198 — Operator loop: queue with per-line state, clock-in/out, handoff notes, complete-line, job-done signal
- [x] P206 — Cutting v2 UI redesign: tablet-first master-detail board (JobRow/LineRow/Sheet/StatusPill primitives, lucide icons, designed states)
- [x] P209 — Queue toolbar: client-side search (customer + invoice #) and This-Week/Show-All filter
- [x] P210 — Theme engine: `ThemeProvider`/`useTheme`, pre-hydration anti-flash script, token-audit fix (`--danger-text`/`--success-text` in dark block)
- [x] P211 — `<ThemeToggle>` control consuming P210 engine, dropped into the v2 header
- [x] P212 — `<PlatformHeader>` React port (replaces bare `AppHeader`)
- [x] P213 — Nav wiring + legacy visual-parity pass
- [x] P214 — `<CompleteLineModal>`: replaced `window.confirm` with tokenized modal (completion note as `handoff_note`; scrap placeholder hidden on Laminate)
- [ ] Block-calc planner: 2D canvas cut diagram (port the legacy Canvas render) — optional polish.
- [ ] Block-calc: optional per-setup secondary/scrap nesting (small parts into a big part's block remnants) — the old single-part secondaries feature, re-expressed per setup, if yield demands it.
- [ ] Block-calc: 2D cut diagram per setup (port the legacy Canvas) — optional polish.
- [ ] Cutting route is tribal knowledge (supervisor decides which line cuts which axis; Main Line can chunk, Blue Line can run standalone). Consider capturing the route on the job so chunk/part targets stop depending on unwritten context.
- [ ] Wire scrap capture into `<CompleteLineModal>` once the native scrap DB lands (reason + cubic-in + shift + density; derive operator/inv/line/date from session+job; no Laminate scrap)
- [ ] Material-consumption capture at line-complete — needs a job→block_inventory link + on-hand block picker (block_consumption_log decrements real stock)
- [ ] Cut-list photo polish if asked: multi-photo per session, lightbox zoom, delete/replace, retention cleanup
- [ ] Wire notifications into v2 cutting (depends on a v2 notification backend; triggers: job-done, andon/flag-for-help)
- [ ] Wire "Blocks / chunks required" in the Parts slide-over once block-calculator BOM feeds cutting_lines.qty_target
- [ ] Units/hour throughput once qty entry is routine (qty_done_delta + qty_target) — pair with first-pass yield
- [ ] Throughput/time-tracking report surface (per-line bottleneck rollups across jobs/date range) if a separate analytics view is wanted beyond the on-board badges
- [ ] Cutting v2: port notifications bell + settings gear into `PlatformHeader` once v2 notification backend exists (deferred from P212)
- [ ] Deploy + domain attach (Steve — requires wrangler auth + real hostname; workers.dev cannot host the cookie-shared `/v2/*` route)
- [x] Auth-bridge + operator loop validation — validated end-to-end on the real host (clock-in→handoff→complete→job-done)
- [x] Nav/cutover surfacing — P234 repointed the Manufacturing tile at `/v2/cutting`; no separate header nav link (P213 deliberately decided against one; that decision stands)
- [ ] Block-calc engine landed as a pure module in P228 (`blockEngine.ts`) + save route + `blocks_needed`. Remaining: the planner screen (P229), non-taper chunk model, per-job block-dimension defaults, regenerate-on-change.
- [ ] Taper blocks-needed (materials pull): compute `ceil(chunks ÷ chunks-per-block)` once a chunks-per-block datum exists.
- [ ] Verify the live `job_line_items.dimensions` taper format matches the P227 regex; widen if needed.
- [ ] Structured taper/chunk geometry capture (chunk L×W×H + kerf) to compute yield instead of manual entry.
- [x] P233 — Per-line throughput raw readout (`qty_done[/qty_target] unit · wall · active`) in v2 job-detail `LineRow`, using existing `qty_target` from P225.
- [ ] v2 cut-plan: units/hr rate and progress bars still open (raw throughput numbers shipped in P233; the rate needs qty-entry to be routine first).
- [ ] First-pass yield (v2) — blocked on native scrap DB (defect denominator)
- [ ] Retire cutting_steps + /api/cutting* + routes/cutting.js + lib/cutting.js (legacy page already archived in P234; the worker/table still drive jobs.processes pill sync — needs its own prompt)

---

## Scrap Database (native — replaces Google Sheets) · SCOPED, SEPARATE PROJECT

> Move scrap off the Google-Sheets mirror (`mirrorScrapLogToSheet`) onto a first-class platform
> database. Becomes the persistence target for the v2 CompleteLineModal scrap section.
- [ ] Design the native scrap schema/UI (own dashboard + entry); decide whether to extend the
      existing `scrap_log` table or supersede it
- [ ] Add "Laminate" to the scrap line/machine options for cutting-floor capture (current QC enum
      omits it)
- [ ] Retire the Google-Sheets mirror; migrate existing scrap_log consumers (QC scrap-log form,
      reports) to the native store
- [ ] Wire v2 cutting CompleteLineModal scrap section to the native API

---

## Manufacturing ERP add-ons (icebox — fold in opportunistically)

- [ ] Throughput / units-per-hour rate (qty_done_delta ÷ tracked time) — per-line/per-job **time** tracking shipped in P216; only the **rate** (units/hour) remains once qty entry is routine
- [ ] Andon / flag-for-help button on a line → notifies supervisor (first real consumer of v2 notifications)
- [ ] Downtime reason codes when a line stalls (material wait / changeover / machine) → OEE foundation
- [ ] First-pass yield: qty_target vs qty_done vs scrap (after scrap DB + BOM wiring)
- [ ] QR/barcode clock-in to a job (glove-friendly floor input)

---

## QC

*(No open items — tracked here for future additions.)*

---

## Safety

- [ ] Finish caption translation (i18n)
- [ ] Link user training completion to user records (depends on auth/user system)

---

## Reports

- [ ] Reports copy cleanup
- [ ] Consistent subtitles across report pages
- [ ] Inspection trends report
- [ ] Customer drill-down report (if needed)
- [ ] Add additional incident fields if Google Sheets / Apps Script evolves
