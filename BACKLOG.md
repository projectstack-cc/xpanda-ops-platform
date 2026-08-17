# xPanda Ops Platform — Backlog

> **Process:** When an item ships, its entry moves to `CHANGELOG.md` (keyed to its prompt #) and is
> deleted from `BACKLOG.md`. BACKLOG is forward-looking only. Drift check: diff `Prompts/` against
> `CHANGELOG.md` — any prompt missing from the changelog is a gap.
>
> Shipped items live in `CHANGELOG.md`.

---

## Carrier View (v2)

- [ ] **P368 follow-up — appointment/ETA time column + per-bay dock instructions (deferred).**
  `/v2/carrier` ships invoice/customer/city-state/bay/trailer/status only. Revisit if the carrier
  needs scheduling detail beyond the day-level view.

## Shift Notes (v2)

- [ ] **P359 follow-up — v2 activity-log parity for notes.** `logActivity()` is legacy-worker-only;
  v2's `/v2/api/notes` POST/mark-viewed don't write to the shared `activity_log` table. Revisit if
  Steve wants an audit trail for shift notes.

---

## Manufacturing / Cutting (React pilot)

- [ ] **P370 follow-up — bottom cut-list dock: optional per-line tabs for multi-line jobs.**
  Currently shows the operator's clocked-in line, else the job's first required line
  (`dockLine` in `CuttingBoard.tsx`) — no way to view/check a different line's parts without
  clocking into it.
- [ ] **P356 follow-up — v2 cutting queue: label/filter by shift.** P356 added `job_shifts`
  (job → 1st/2nd/3rd assignment) and `users.shift` on the legacy job board only — it does not yet
  make `/v2/cutting`'s queue route or UI aware of shift (no filter, no label). Deliberate split
  per Steve's decision flag 2; needs its own prompt (queue route + `WorkQueue.tsx`/`JobRow.tsx`).
- [ ] **P327 follow-up — homepage card for Taper Block Calculator.** P327 only linked `/v2/blocks`
  into the Manufacturing dashboard tile grid (`manufacturing/index.html`); the platform homepage
  (`index.html`) still has no direct entry point (per-prompt scope: Manufacturing section only).
  Mirror the existing pattern used for the Cutting card (P235/P298) — a dedicated `data-permission`
  gated card/button — once Steve wants a home-page shortcut.
- [ ] **P324 follow-up — width-strip and length-end offcut are not re-pooled.** `blockNester.ts`'s
  Greedy tier only re-harvests each chunk's own height-leftover void (global width-sorted pass
  with width-trim admission) — this matches the real PO#1 baseline exactly as-is (10/3/3 molds,
  confirmed 2026-08-04), so this is a genuine yield improvement opportunity, not a correctness
  gap. The block-level width strip (`block.width - chunk.width`, running that chunk's whole
  length) and the per-band length-end (`chunkLength - partLength` for a band shorter than its
  chunk) are computed/displayed (`NestChunkLine.partWidth/partLength`, `ChunkElevation`'s
  "→ pool" shading) but never fed back into the packer as additional capacity. Closing this gap
  would need full 2D/3D guillotine bin-packing across the block's width×length plane — the
  reference spreadsheet's own "Method & Assumptions" sheet calls this same gap out explicitly
  ("the true offcut-recursive optimum sits between [floor and greedy]"), so it's unbuilt by the
  domain expert too, not just this engine.
- [ ] **Block-nesting width step-down end-cap view** (deferred unless testing requires) — P324's
  `ChunkElevation.tsx` surfaces width step-downs only in the table's `Part W×L` column; a true
  end-cap (front-face) diagram is a follow-on, not built in P322-324.
- [ ] **P282 follow-up — elapsed-time readout on `ClockedInBar`.** Deferred: `formatDuration` lives
  in `src/lib/time.ts` (shared, in scope), but the UTC-timestamp parser it depends on
  (`parseUtc`) is a module-private function in that same file, and `src/lib/time.ts` was out of
  scope for P282. Export `parseUtc` (or an elapsed-seconds wrapper) from `src/lib/time.ts`, then
  wire each session's `started_at` through it per stacked bar in `ClockedInBar.tsx` (P309 made
  `CuttingBoard.tsx`'s state an array, `mySessions`, one bar per open session) — no new duration
  logic needed.
- [ ] **P309 follow-up — "clock out all" convenience.** With multiple concurrent open sessions now
  possible, an operator wrapping up for the day has to stop each stacked `ClockedInBar` one at a
  time. Consider a single action that opens the handoff flow for each open session in turn (or a
  bulk-stop with per-line notes) once the multi-job pattern sees real floor use.
- [ ] Hard enforcement on the Work Queue (P259) — block clock-in on lower-priority jobs while higher-priority ones sit incomplete. Deferred by decision; P259 is guide-only (every job stays clickable).
- [ ] Enable OpenNext skew protection on the v2 Worker (durable fix for hashed-asset 404s across deploys) — see https://opennext.js.org/cloudflare/howtos/skew
- [ ] Surface completed_qty in the checklist/reports (progress bars per part, first-pass yield) once qty data accrues
- [ ] Cross Cutter / Hole Cutter chunk checklists (replace the shared parts list) once block-calc BOM feeds chunk counts
- [ ] **Cleanup: remove dormant chunk branches + dead endpoints** (`chunk-target`, `taper-yield`,
  `cut-plan`, `CHUNK_LINES`, taper Cross Cutter derivation) from `/v2/cutting` once the standalone
  board (P292–P294) is proven.
- [ ] Taper Cross Cutter chunk auto-derivation (`taper_yield`) no longer feeds any board — Cross
  Cutter tasks are now assigned manually on `/v2/cutting/crosscutter`. Revisit if auto-derivation is
  wanted there.

---

## Orders (v2)

> **Status:** Orders/Production-board rework built — Phase 1 (P337–P340, order entry) and
> Phase 2 (P341–P344, production board) are all coded, deployed, and reachable by direct URL.
> **The P344 cutover was reverted same-day** — home page and both nav bars (legacy
> `shared-header.js` and v2 `PlatformHeader.tsx`) point at `/jobs/` again; `/v2/board` is
> unlinked pending Steve's testing. Reuses the existing `jobs` + `job_line_items` tables
> throughout — no new schema.

- [ ] **Re-link `/v2/board` (re-run the P344 cutover)** — home-page Job Board card, v2
  `PlatformHeader.tsx` nav, `shared/shared-header.js` legacy nav, and `OrderEntryForm.tsx`'s
  post-save link all need to be repointed from `/jobs/` back to `/v2/board` once Steve has
  tested it on the floor and confirms it's ready. Do not do this speculatively — see the new v2
  visibility-gate HARD RULE in `xpanda-ops-agents.md`.
- [ ] **Retire legacy `jobs/index.html` board** (+ `jobs-header.js`, `jobs-shared.css` if unused)
  once `/v2/board` is re-linked and confirmed at parity on the floor — post-cutover cleanup.
  Pairs with the already-noted `_worker.js/routes/quickbooks.js` removal for the same cleanup pass.
- [ ] Board: manager-flag header for assign gating (avoid the 403 round-trip) — `BoardRowEdit.tsx`
  currently discovers manager status by attempting the legacy assign/unassign call and reading a
  403, same as the P333 job-board UI. A dedicated header (mirroring
  `X-User-Can-Manage-Cutting`) would let the UI hide the add-picker/remove buttons up front.
- [ ] Order entry: load-existing-order-for-edit deep link — `/v2/orders` only creates new orders
  (P339 scope). The board's "Open in order entry" link (P343) goes to the module, not a specific
  order; once order entry supports loading an existing job for edit, deep-link to it directly.
- [ ] Wire v2 ship-to address verification (Lob) into order entry — the `/v2/orders` form's Verify
  button is stubbed disabled (P339) since no v2 Lob endpoint exists yet.
- [ ] Packing-slip parser rewrite (anchor-relative extraction + per-vendor template registry) —
  P340 ported the existing y-coordinate/x-gap heuristic parser as-is into v2; the more robust
  rewrite is still a separate, future effort (applies to both legacy and v2 copies).
- [ ] Tag orders created via packing-slip prefill with `source='packing_slip'` in
  `/v2/api/orders` — deferred out of P338/P340 to keep those prompts single-purpose; currently
  every v2-created order is hardcoded `source: "manual"` regardless of how it was filled in.
- [ ] Port packing-slip line-item → parts-library matching (`matchLineItemToPart`/
  `getPartsLibrary` in `jobs/index.html`) into `/v2/orders` — P340 only ported raw extraction;
  prefilled line items currently carry a blank `part_number` for manual entry.
- [ ] Persist the order-entry packing slip to R2 on save (mirror legacy `jobs.js` R2 upload) —
  `cutting-pilot/src/app/api/orders/route.ts` currently inserts `null` for
  `packing_slip_key`/`packing_slip_pdf`, so v2-entered orders don't carry their uploaded slip into
  the board's order-detail modal (P345) — only legacy/imported jobs show one there today.

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
- [x] P268 follow-up — restore schedule board status badges. Done in P278: audited `deriveStatuses()` against the real `loading_assignments`/`cutting_lines`/`cutting_sessions` write sites, found and fixed three defects (assignment-row-existence misread as dock activity, `in_transit`/`delivered` missing from the ladder, confirmed v2-only cutting rungs by design), then flipped `SHOW_STATUS_BADGES` to `true`. Flag itself kept in place as a kill switch. Not live until `wrangler deploy` from `cutting-pilot/`.
- [x] P268 follow-up — reclaimed row space with badges hidden. No longer applicable — badges are restored (P278), so the "hidden" premise this item was tracking is gone. `density.ts` was untouched by P278 (out of scope); no retune was needed since rows are back to their pre-P268 content.
- [x] P300 — `source_updated_at` (real sheet-pull time, `max(last_seen_at)`) added to `GET /v2/api/schedule-board`, alongside the unchanged `generated_at`.
- [x] P301 — Honest freshness clock (relative + absolute, ticks on its own, amber past 20 min, explicit "no data") sourced from `source_updated_at`, replacing the old render-time stamp; plus 24/7-TV burn-in mitigation (continuous pixel-shift + 5-min branded logo sweep).

## Loading Board (v2)

- [x] P304 — Board-wide notes (view→text, edit→textbox, gated on `logistics.loading.tv`'s `edit` action) on `/v2/loading`; bays reversed to high→low (30…20) to match the physical dock; pixel-shift removed from both TV boards (motion discomfort) — logo sweep + freshness clock kept on both.
- [x] P303 — View-only Loading TV board at `/v2/loading` (new `logistics.loading.tv` permission, all active bays on one screen, bay tint from dominant active load status, self-contained freshness/pixel-shift/logo-sweep hardening); home page Loading card gained a "TV Board" button.
- [ ] Extract a shared `components/tv/` (freshness-clock) used by both `/v2/schedule` and `/v2/loading` — currently each board is self-contained. (The pixel-shift half of this item was moot as of P304; the logo-sweep half is moot as of P306 — both removed from both boards entirely. Only the freshness clock remains a duplication candidate.)
- [ ] **P261 follow-up — no `UNIQUE(invoice_number, ship_week, day_of_week)` on `schedule_rows`.** The 1/5 migration didn't add one, so the poller's upsert is done in application code (select-then-insert/update) rather than SQL `ON CONFLICT`. Works fine at 15-min-cron scale, but if `schedule_rows` ever gets a second writer, add the unique index and switch to a real upsert.
- [x] P263 follow-up — verify shrink-to-fit against a real TV. Steve confirmed 2026-07-24: fits the real wall-mounted TV. Unblocks P277 (linked-jobs 3/3 side rail), which required this to have landed first since it touches the same density/DayColumn/ScheduleBoard files.
- [ ] **P263 follow-up — late/at-risk highlighting on the schedule board.** Explicitly out of scope for the first UI pass; would need a definition of "late"/"at-risk" (vs. `ship_date`? vs. status stalling?) before scoping.
- [ ] **P263 follow-up — per-day totals on the schedule board** (load count / bdft sum per `DayColumn`) if useful once the board is in daily use.

---

## Logistics

### Standing Logistics Backlog

- [ ] **P332 follow-up — periodic reconcile/health-check for orphaned loading cards.** Consider a
  lightweight periodic job that flags any job whose non-archived `loading_assignments` count exceeds
  its `load_count`, so future regressions in the reconcile/backfill/adopt paths surface proactively
  instead of silently accumulating orphan `awaiting` cards again.
- [ ] **P320 follow-up — ship-day label parity on loading bay-view and shipping-info renders.**
  P320 only added the ship-day pill to `renderAssignmentCard`; the bay-view card render
  (`loading.html` ~line 1001) and shipping-info render (~line 1236) don't show it yet.
- [ ] **P325 follow-up — harden `/api/loading-assignments/load-days`** to return matched-row count
  and warn on 0-row saves.
- [ ] **P326 follow-up — outbound calendar view: mirror the per-load day split.** Only the outbound
  table splits by per-load ship date; the calendar view still groups by the order's `ship_date`.
- [ ] **P326 follow-up — optional: suppress order-total "Load count" badge on split day-rows.** Split
  day-rows currently repeat the order's Trailer/BOL/Status/Bay columns (acceptable v1); consider
  whether the Loads-column count itself should be de-emphasized once a row shows a day's suffixes.
- [ ] **P271 follow-up — `loading_assignments.archived_at`.** Apply the same orthogonal-archive
  treatment (P271) to `loading_assignments.loading_status = 'archived'` (site L24 in
  `status-write-site-inventory.md`) — same two-facts-one-column defect, but lower-stakes since the
  stage timestamps (`delivered_at`/`in_transit_at`/`loaded_at`) survive the overwrite independently.
- [ ] Customer database (full CRUD) — icebox: revisit once all orders are entered here first, or it becomes a necessity
- [ ] Consider separate dashboards for staff vs. management (TV display)
- [ ] Zoning support for deck systems
- [ ] Load builder: make initial calculated load view larger, include the stacks visually
- [ ] Load builder: fix/clarify customize mode drag-and-drop (move layers between columns)
- [ ] Load builder DISSOLVE: optional per-piece (sub-line) granularity within a move-group — current P378 checkbox toggles a whole skuCode|height|dest group at once.

### BOL Issues

- [ ] **P316 follow-up — editable Scrap Pickup toggle in the BOL compose form.** Currently derived
  from the job's `scrap_pickup` only (`'YES' → is_scrap_pickup: 1`); no manual override at compose
  time.
- [ ] **P241 follow-up — manual relink of unrecoverable orphaned BOL job links.** After running `backfill-bol-job-id.sql`, the verification query reported 84 rows still with `job_id IS NULL`: 52 are pre-P170 rows with no `bol_group_id` (can never be auto-relinked — no recovery key exists); the other 32 (13 distinct `bol_group_id` groups) have a group key but *every* row in the group is orphaned — no sibling had a `job_id` to inherit, so the backfill's sibling-inheritance logic couldn't apply. Needs manual investigation per group/job to relink (or accept as permanently orphaned if the source job can't be identified).
- [ ] **BOL print rendering bug** — when printing the BOL directly (without downloading), the "N" from "Bill of Lading No" and the "S" in "Customer Signature" are clipped/hidden. Parked: root cause is the blank-template artwork + browser print scaling (not our drawn text); needs print-preview testing on a real printer.
- [ ] **P253 follow-up — per-load `shipments` rows.** The job-level `shipments` in_transit/delivered flip is gated on *all* non-archived `loading_assignments` for a job reaching that stage. If a multi-load job with staggered trailer departures/arrivals (days apart) proves the coarse job-level gating is confusing on the logistics dashboard (e.g. "delivered" not showing until the last of several trailers arrives), consider splitting `shipments` to one row per load — larger schema change, needs its own scoped prompt.

---

## Job Board

- [ ] **P364 follow-up — legacy BOL viewer modal (`jobs-bol-view-modal`) has no explicit Print
  button.** It only has Download (relies on the browser's native in-frame PDF toolbar for print).
  P364 gave the v2 shared `PdfViewer` explicit Download + Print controls instead of relying on that
  native toolbar (unreliable on tablets); the legacy BOL modal is now the odd one out. Low priority
  — add an explicit Print button (`iframe.contentWindow.print()`, same pattern as v2) if it comes up
  on the floor.
- [ ] **P331 follow-up — cut-list PDF measured-fill pagination.** P331 paginates with fixed,
  unmeasured row-capacity constants (`ROWS_PAGE_1 = 14`, `ROWS_PAGE_CONT = 20`) chosen
  conservatively for worst-case header height. If a real job's continuation pages look noticeably
  empty or cramped, switch to measured text-height row placement instead of nudging the constants.
- [ ] **P319 follow-up — split badge parity on jobs list/table view and calendar day-detail
  modal.** P319 only added the split-day-groups badge + Partially-shipped indicator to the Kanban
  card render; the list/table view (`jobs/index.html` ~line 823) and the calendar day-detail modal
  (~line 991) don't show it yet.
- [x] P275/276/277 sequence — linked jobs (trailer sharing). 1/3 (P275, migration), 2/3 (P276,
  worker + legacy entry UI), 3/3 (P277, `/v2/schedule` side rail) have all shipped. **P277 still
  needs `wrangler deploy` from `cutting-pilot/` before the rail is live** — v2 doesn't auto-deploy.
- [ ] **`DELETE /api/jobs` does not cascade the v2 cutting tables.** The child-delete list covers
  legacy `cutting_steps` but not `cutting_lines` or `cutting_sessions`, so deleting a job that was
  tracked in v2 orphans those rows. Impact is currently contained: P282's `my-session` route uses a
  `LEFT JOIN` specifically so an operator whose job row was hard-deleted can still see and close
  the session, and P258's backstop only ever runs from live delivery/loading write-points. Worth
  adding both tables to the cascade in a scoped prompt — coordinate with §9a, since the cascade
  lives in the legacy worker but the tables belong to v2.
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

**Holey Board chunk engine follow-ons (P379 shipped the backend foundation only):**
- [ ] **Order-entry chunk UI (next legacy prompt):** live preview call to
  `/api/holey-chunks/preview` + chunks-required display + per-chunk cut-list breakdown into the
  P366 cut-list viewer in `jobs/index.html`. **Mockup-first.**
- [ ] **v2 chunk consumption (§9a/§9b):** TS port of the nester (or read
  `jobs.hb_chunks_required`); seed `cut_plan_lines.qty_target` via `COALESCE(manual override,
  jobs.hb_chunks_required)` with manual override winning; flip HB Main/Blue Line to `unit='chunk'`
  on `/v2/cutting`; surface the effective chunk count on the `/v2/schedule` order card.
- [ ] Optional: map `/api/holey-chunks` → `jobs` in `API_PERMISSION_MAP` (currently unmapped ⇒
  authenticated-allowed; fine for compute-only, tidy later).
- [ ] Optional: surface the 51" chunk-height selection at order entry (nester already
  parameterized).
- [ ] Optional: converge `holey-board-calculator.html` onto the shared endpoint (kill the last
  client-side copy of the packing math).

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
- [ ] Breakdown job board permissions into more granular sub-modules *(easier after F3 audit + F1a shared header — both now done)*
- [ ] Dashboard KPIs / metrics panel — homepage widget showing jobs by status, BOLs generated this week, shipments pending/in-transit/delivered, most-used parts *(adds new endpoints)*
- [ ] Port language / i18n features from Safety portal to platform-wide use *(needs F1c shared utils as its home — now done)*
- [ ] Scrap batch entry tool *(density calc now centralized in shared-utils.js — safe to add)*
- [ ] **Dark mode Bucket A — remaining passes** — P184 audit identified Bucket A hits in Safety (0% token adoption — highest priority), `logistics/load-builder.html` (local token system, separate batch), and `track/index.html` (standalone, no tokens.css). P186 covered all other modules. These three remain for dedicated prompts.
- [ ] Remove dead `_worker.js/routes/quickbooks.js` intake route (QBO abandoned — no domain API access); post-launch backlog cleanup.

---

## Infra / CI-CD

- [x] P302 — GitHub Actions CI/CD for the v2 Worker (`.github/workflows/deploy-v2-worker.yml`): auto build+typecheck on `cutting-pilot/**` pushes.
- [x] Dropped the deploy approval gate — full auto-deploy on green build, no required reviewer. Steve is enforcing "never push code that depends on a migration before running that migration in the D1 console" as a human rule (updating `AGENTS.md`/`xpanda-ops-agents.md` himself) rather than a CI checkpoint.
- [ ] Optional: evaluate Cloudflare Workers Builds as the native alternative to this Action.

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
