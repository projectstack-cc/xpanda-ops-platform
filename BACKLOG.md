# xPanda Ops Platform — Backlog

> **Process:** When an item ships, its entry moves to `CHANGELOG.md` (keyed to its prompt #) and is
> deleted from `BACKLOG.md`. BACKLOG is forward-looking only. Drift check: diff `Prompts/` against
> `CHANGELOG.md` — any prompt missing from the changelog is a gap.
>
> Shipped items live in `CHANGELOG.md`.

---

## Auth / Session

- [ ] **QC Cleanup-10 — confirm `MIN_PASSWORD_LENGTH` = 8.** `_worker.js/routes/auth.js`
  top-of-file constant implements the prompt's own recommended value since Steve wasn't
  available to confirm synchronously. Needs an explicit yes/no (or a different number) from
  Steve, weighing floor-tablet UX vs. brute-force resistance. One-line change once decided
  (`login.html`'s client-side check + placeholder would need the matching number too).
- [ ] **QC Cleanup-10 — KV namespace prerequisite (hard blocker on pushing).** Run
  `wrangler kv namespace create xpanda-rate-limit`, then paste the returned id into both
  placeholder `id = "REPLACE_WITH_NAMESPACE_ID"` lines in `wrangler.toml`
  (`[[kv_namespaces]]` and `[[env.production.kv_namespaces]]`, binding `RATE_LIMIT`) before
  the commit can be pushed.
- [ ] **(Optional) Consider a self-service "change my password" settings page.** Discovered
  during QC Cleanup-10: `login.html`'s first-login forced form is currently the *only* caller
  of `/api/auth/change-password` anywhere in the platform — no way for a user to voluntarily
  change their own password later without an admin reset via `/api/users`. Not a bug (admin
  recovery is the documented design), just an absence worth a deliberate yes/no.
- [ ] **P408 follow-up — audit other unbatched hot-path writes against the shared D1.**
  `schedule-ingest.ts`'s cron writes were the one identified structural contention hazard against
  the same D1 `validateSession` reads on every request (P404 investigation, batched in P408). If
  `wrangler tail` (both workers, filtered on `Session validation failed:`/`transient_session_lookup_failure`)
  still shows transient hits persisting after P405–P408 all ship, look for other sequential
  per-row write loops against the shared D1 (legacy `_worker.js` bulk-insert/import paths,
  the QBO sync path) as the next contention source to batch.
- [ ] **P406 follow-up — nine v2 `page.tsx` server components re-call `validateSession()`
  independently of `middleware.ts`.** `schedule`, `orders`, `board`, `blocks`, `loading`, `notes`,
  `production`, `cutting`, `cutting/crosscutter` each call `validateSession()` a second time (to
  read `isAdmin`/`permissions` for client props) after the middleware already validated the same
  request. Low risk (middleware's matcher covers every page route and already 503s on the common
  transient case before the page runs; Next.js's Server Component error boundary handles an
  uncaught throw more gracefully than a raw crash), but if `wrangler tail` ever shows
  `SessionLookupError` surfacing from a page component specifically, wrap these the same way
  `auth.js`'s `resolveSessionUser()` does.

## Production Log (v2)

- [ ] **P402 follow-up — Density readout (expansion).** Display-only pcf per batch =
  `bucket_weight_g / (V_liters × 16.0185)` once the bucket's rated volume constant is supplied;
  ship as a toggle.

- [ ] Retire `production/bead-inventory.html` + the `production.inventory` permission key once
  `/v2/production` (or a successor) covers bead stock / silo tracking, not before. (Narrowed from
  the old P403 item, which incorrectly assumed the v2 Production Log's Molding/Expansion-only
  scope already covered bead-stock/silo tracking — it doesn't. QC Cleanup-6 archived the actually-
  dead `production/inventory.html` v1 page and its four dead handlers; `bead-inventory.html` is
  the live tool and was deliberately left in place.)
- [ ] `production/index.html` (the legacy Production dashboard tile page) now has zero tiles after
  QC Cleanup-6 archived its only tile (`inventory.html`). It's already unreachable from primary
  nav (home page's Production card points to `/v2/production`), but the module nav bar's
  "Production" link still points at `/production/` generically. Add a tile pointing to
  `bead-inventory.html`, or retire `production/index.html` itself if it's not meant to be a live
  entry point.
- [ ] Pre-existing gap (found during QC Cleanup-6, not introduced by it): `bead-inventory.html`
  calls `/api/silos` and `/api/bead-transactions`, but neither has an `API_ROUTES` entry anywhere
  in `_worker.js` — confirmed absent even before this session's changes. Worth checking whether
  the Silos/Transactions tabs on the live page actually work in production.

---

## Carrier View (v2)

- [ ] **P368 follow-up — appointment/ETA time column + per-bay dock instructions (deferred).**
  `/v2/carrier` ships invoice/customer/city-state/bay/trailer/status only. Revisit if the carrier
  needs scheduling detail beyond the day-level view.

- [ ] **P399 follow-up — client-side image downscale in `CarrierUploadModal`.** Currently only a
  hard ~3MB base64 size cap with an inline "please retake" error; a canvas-based downscale before
  encoding would avoid the retake step entirely for oversized phone photos.

## Shift Notes (v2)

- [ ] **P359 follow-up — v2 activity-log parity for notes.** `logActivity()` is legacy-worker-only;
  v2's `/v2/api/notes` POST/mark-viewed don't write to the shared `activity_log` table. Revisit if
  Steve wants an audit trail for shift notes.

---

## Manufacturing / Cutting (React pilot)

- [ ] **P413 follow-up — PO→job creation from the block-calculator spreadsheet.** The Block
  Calculator's loaded PO spreadsheet carries only parts (no customer/job info), so bag labels are
  generated straight from `skuLines` with no job created. Wiring PO→job creation is a separate,
  deliberately deferred step.
- [ ] **P413 follow-up — multi-density / customer-configurable label header.** `Core Covers` is
  currently a constant string in `bagLabels.ts` (`DEFAULT_CUSTOMER`); generalize to a per-customer
  configurable header once a second labelled customer appears.
- [ ] **P386 follow-up — inline grouped chunk breakdown in `/v2/cutting`'s `PartsPanel`/
  `OrderDetailModal`.** Currently the grouped recipe breakdown only exists in the cut-list PDF
  (both surfaces, per P386). Surfacing it inline on the board would need `hb_chunk_breakdown` on
  the `/v2/cutting` queue payload (`queue/route.ts`), which doesn't select it today.
- [ ] **P385 follow-up — fully decouple loading/delivery from cutting completion (option B).**
  P385 fixed `completeCuttingLinesForJob`'s backstop to only fire when truly no
  `loading_assignment` is pre-loaded, but the backstop itself (loading/delivery → completing
  dangling cutting lines) is still in place. Option B: loading and driver-QR events should not
  force cutting-line completion at all; cutting completes solely via the v2 cutting board's own
  one-directional signal. Removes the loading→cutting backstop entirely once v2 clock-out
  coverage is trusted on the floor.
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
- [ ] **P411 follow-up — offcut regions are classified (carried-forward/scrap BF) but not
  re-nested for additional finished parts.** `blockNester.ts` now correctly counts leftover face
  height, block-width strips, length ends, and lone-wedge complements into `carriedForwardBF`/
  `scrapBF` (reconciliation identity holds exactly against every mold's physical volume), and the
  offcut-recursion tier does get fewer-or-equal molds than plain greedy via a best-fit-decreasing
  mold repack — but no additional SKU pieces are ever cut FROM those offcut regions; the pool is
  an accounting/inventory concept only. Actually placing more parts into offcuts needs full 2D/3D
  guillotine bin-packing across the block's width×length plane — same scope boundary P324 already
  drew, still unbuilt, now with the honest BF accounting on top of it instead of a bare count.
- [ ] **P411 follow-up — carried-forward inventory has no routing to future jobs.** `blockNester.ts`
  reports `carriedForwardBF` per density/total but nothing persists it or offers it against a
  later order's SKU needs (ephemeral module, no DB by design). Would need a
  `block_inventory`-style table plus a matching step in this same nester once Steve wants it.
- [ ] **Block-nesting width step-down end-cap view** (deferred unless testing requires) — P411's
  `ChunkElevation.tsx` surfaces width step-downs only in the table's `Part W×L` column; a true
  end-cap (front-face) diagram is a follow-on, not built here either.
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
- [ ] **Cleanup: remove remaining dormant chunk logic** (`cut-plan/save`'s Cross Cutter chunk
  write, the P227 taper Cross Cutter derivation section in `queue/route.ts`) once the standalone
  board (P292–P294) is proven. QC Cleanup-7 already removed the `chunk-target`/`taper-yield`
  routes and the `CHUNK_LINES`-gated branches in `queue/route.ts` + the matching dead UI branches
  in `PartsPanel.tsx`/`CuttingBoard.tsx` (AUDIT-302).
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
- [ ] Density no-keyword default is blanket RC (Holey Board/Insulperm, Laminate). Physically Holey Board/Insulperm is usually virgin — revisit if a product proves virgin (one-line flip in deriveDensity).
- [ ] Board: manager-flag header for assign gating (avoid the 403 round-trip) — `BoardRowEdit.tsx`
  currently discovers manager status by attempting the legacy assign/unassign call and reading a
  403, same as the P333 job-board UI. A dedicated header (mirroring
  `X-User-Can-Manage-Cutting`) would let the UI hide the add-picker/remove buttons up front.
- [ ] Order entry: load-existing-order-for-edit deep link — `/v2/orders` only creates new orders
  (P339 scope). The board's "Open in order entry" link (P343) goes to the module, not a specific
  order; once order entry supports loading an existing job for edit, deep-link to it directly.
- [ ] Packing-slip parser rewrite (anchor-relative extraction + per-vendor template registry) —
  P340 ported the existing y-coordinate/x-gap heuristic parser as-is into v2; the more robust
  rewrite is still a separate, future effort (applies to both legacy and v2 copies).
- [ ] Tag orders created via packing-slip prefill with `source='packing_slip'` in
  `/v2/api/orders` — deferred out of P338/P340 to keep those prompts single-purpose; currently
  every v2-created order is hardcoded `source: "manual"` regardless of how it was filled in.
- [ ] Dedup the parts-library fetch cache — PartsPicker (P429) and partMatch.ts (P432) each hold
  their own /api/parts cache; centralize into one loader.
- [x] Persist the order-entry packing slip to R2 on save (mirror legacy `jobs.js` R2 upload) —
  `cutting-pilot/src/app/api/orders/route.ts` currently inserts `null` for
  `packing_slip_key`/`packing_slip_pdf`, so v2-entered orders don't carry their uploaded slip into
  the board's order-detail modal (P345) — only legacy/imported jobs show one there today.
- [ ] **v2 per-surface i18n extraction** (P442 shipped the `src/lib/i18n.ts` + `LangProvider`/
  `useLang` spine and a bounded 6-string proof-slice on `OrderEntryForm.tsx` only) — the rest of
  `OrderEntryForm.tsx` (dropzone, ship-to, process toggles, line items), plus `/v2/board`, `/v2/
  schedule`, `/v2/loading`, `/v2/carrier`, `cutting-pilot`'s blocks/notes/production surfaces each
  need their own `catalog` entries registered and their strings wired through `t()`.
- [ ] **Decide whether v2 needs its own language selector** — P442 deliberately shipped no
  `<select>` in v2 (`PlatformHeader` or elsewhere); today `xpanda_lang` is only ever set from the
  P440 selector on the legacy home page before a user navigates into `/v2/*`. If floor tablets
  start deep-linking directly into a `/v2/*` page (bypassing the home page), those sessions would
  have no in-page way to change language — revisit then.

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
- [x] P420 — shift assignment badges on `/v2/schedule` order rows — `job_shifts` data surfaced via a new `fetchShiftsByJob` enrichment query on the schedule-board API, rendered as compact slate badges next to the status pill on each order row's second line.

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

- [ ] **`load-builder.html` Results tab: `state.trailers` referenced but never declared.** Found
  2026-09-04 while reviewing the file for the i18n sweep (unrelated to that work, not fixed here).
  The INV# auto-fill input handler in `renderResultsTab` (near the trailer-numbering loop) reads
  `state.trailers.length`, but `state` only ever declares `cart`/`skus`/`forcedTrailers`/
  `manualRowsByTrailer`/`committedTrailers`/`trailerInvNumbers`/`trailerType` — no `trailers`. If
  reachable, this throws on every keystroke in trailer 0's INV field. Needs its own investigation
  (confirm the loop is actually reachable, find whether a rename left this stale) rather than a
  blind fix.
- [ ] **P392 follow-up — emit `loading_assignment` entity_type from `public.js`'s in_transit/delivered
  dispatch instead of `shipment`.** Would let future shipment-status notifications skip the
  `/api/shipments?id=` → `job_id` → assignment resolve hop entirely. Existing ~850 historical
  `shipment`-typed notification rows still need the resolve path either way, so this is a nicety,
  not a requirement. Also consider routing shipment notifications to a dedicated shipment-tracking
  dashboard instead of the Loading Dashboard, if that becomes the more natural landing page.
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

- [ ] **P390 follow-up — HB chunk backfill doesn't clear `hb_chunks_required` on jobs that lost
  all HB line items.** The recompute endpoint only touches jobs that still have HB items; a job
  edited to remove its last HB line keeps its stale persisted chunk count until resaved.
- [ ] **P387 follow-up — alias table for made-to-order / customer-worded parts.** Packing-slip
  match audit corpus still has unresolved lines needing a dedicated alias table (Spa Cover `ITEM#`
  keys, block variants, laminate) — separate prompt, not touched by P387/P389.
- [ ] **P387 follow-up — HB base lines with no stated thickness (21 in corpus).** Left unmatched
  by design in P387; decide handling (default thickness? flag for manual review?).
- [ ] **P387 follow-up — "remainder of block" / "pallet foam" note lines.** Ambiguous whether
  these should ship as line items or be filtered like the credit-card/processing-fee lines P387
  excluded; Steve's call.
- [ ] **P364 follow-up — legacy BOL viewer modal (`jobs-bol-view-modal`) has no explicit Print
  button.** It only has Download (relies on the browser's native in-frame PDF toolbar for print).
  P364 gave the v2 shared `PdfViewer` explicit Download + Print controls instead of relying on that
  native toolbar (unreliable on tablets); the legacy BOL modal is now the odd one out. Low priority
  — add an explicit Print button (`iframe.contentWindow.print()`, same pattern as v2) if it comes up
  on the floor.
- [ ] **P319 follow-up — split badge parity on jobs list/table view and calendar day-detail
  modal.** P319 only added the split-day-groups badge + Partially-shipped indicator to the Kanban
  card render; the list/table view (`jobs/index.html` ~line 823) and the calendar day-detail modal
  (~line 991) don't show it yet.
- [x] P275/276/277 sequence — linked jobs (trailer sharing). 1/3 (P275, migration), 2/3 (P276,
  worker + legacy entry UI), 3/3 (P277, `/v2/schedule` side rail) have all shipped. **P277 still
  needs `wrangler deploy` from `cutting-pilot/` before the rail is live** — v2 doesn't auto-deploy.
- [ ] **`DELETE /api/jobs` does not cascade the v2 cutting tables.** The child-delete list covers
  neither `cutting_lines` nor `cutting_sessions` (QC Cleanup-13 removed the old legacy
  `cutting_steps` cascade line, which never covered these v2 tables either), so deleting a job that was
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
- [ ] Label printing — UL labels (DiversiTech labels shipped in P421)
- [ ] P421 follow-up — real BATCH numbers on DiversiTech labels once production batch tracking exists (currently the constant `42E36164Z` placeholder)
- [ ] P421 follow-up — licensed CG Triumvirate Condensed Bold TTF + fontkit embed for DiversiTech labels, to exactly match the Labelife source (currently `StandardFonts.HelveticaBold`)
- [ ] P421 follow-up — wire DiversiTech label generation into job creation (currently print-on-demand from the job card only)

**Holey Board chunk engine follow-ons (P379 shipped the backend foundation; P381 closed the
order-entry chunk UI; P382–P384 closed v2 chunk consumption — unit flip, manager override,
schedule badge):**
- [ ] Explicit clear-to-geometry control on the HB override input (`PartsPanel.tsx`'s guillotine
  chunk-target field has no empty/clear affordance yet; the backend already supports
  `qty_target: null` via `hb-chunk-override`).
- [ ] Optional: map `/api/holey-chunks/preview` → a permission key in `API_PERMISSION_MAP`
  instead of relying on its QC Cleanup-11 entry in `UNMAPPED_API_MUTATION_ALLOWLIST`
  (`lib/core.js`). No longer an accidental fail-open (the route is now explicitly allowlisted
  with a documented reason and unmapped mutations are denied by default elsewhere), just still
  not tied to a module permission — tidy later if desired.
- [ ] Optional: `/api/notifications` (PUT .../read), `/api/push/subscribe`, and
  `/api/push/unsubscribe` are self-scoped-to-caller mutations with no `API_PERMISSION_MAP`
  entry — QC Cleanup-11 added them to `UNMAPPED_API_MUTATION_ALLOWLIST` in `lib/core.js` rather
  than a module permission key, since none of the existing module keys (jobs/logistics/qc/etc.)
  fit a cross-module personal-notification feature. Revisit only if a dedicated "notifications"
  module permission is ever wanted; today any authenticated user can use these three, which
  matches current UI behavior (notification bell + push opt-in are shown to everyone).
- [ ] Optional: surface the 51" chunk-height selection at order entry (nester already
  parameterized).
- [ ] Optional: converge `holey-board-calculator.html` onto the shared endpoint (kill the last
  client-side copy of the packing math).
- [ ] When the hole-cutter dashboard reaches the floor, switch `/v2/schedule`'s chunk display from
  required to on-hand vs cut (`hc_slots`).

---

## Admin / Platform

- [ ] Remove temporary `pages.dev` → `xpandaops.com` redirect from `_worker.js/index.js` once all internal links/bookmarks confirmed updated.
- [ ] Breakdown job board permissions into more granular sub-modules *(easier after F3 audit + F1a shared header — both now done)*
- [ ] Dashboard KPIs / metrics panel — homepage widget showing jobs by status, BOLs generated this week, shipments pending/in-transit/delivered, most-used parts *(adds new endpoints)*
- [ ] Scrap batch entry tool *(density calc now centralized in shared-utils.js — safe to add)*
- [ ] **Per-module i18n extraction waves** — sweep in progress (2026-09-03). Phase 1 done: `shared/shared-header.js` (nav/notifications/sign-out/settings chrome on every module page) auto-loads the engine and is fully translated (load-order bug found + fixed same day). Phase 2 (Logistics) DONE (2026-09-04): `logistics/index.html`, `loading.html`, `bol-email.html` fully tagged; `load-builder.html` got a narrower labels/buttons/forms/toasts pass (`logistics/logistics-i18n.js`, 487 keys × en/es/ht) — deliberately excluding the SKU orientation-suffix labels baked into `sku.name` (flow into printed BOL/diagram exports), the `TRAILER_TYPES`/category keys (used as data lookup values elsewhere in the file), and the row/column/layer trailer-customize editor + dissolve-preview modal's algorithmic descriptions (power-user tools, revisit only if flagged). `bol-test.html` (456 lines, dev tool, no header shim) intentionally out of scope. Phase 3 (Job Board) DONE (2026-09-04): `jobs/index.html` fully tagged (new `jobs/jobs-i18n.js`, 276 keys × en/es/ht, wired into `jobs/jobs-header.js`) — deliberately excluding `PROCESSES[].name`/`.abbr` (matched against API data, only the checkbox labels are tagged), the `f-method`/`f-scrap-pickup`/carrier-list option `value` attributes (persisted data), `job.ship_day` itself (persisted English weekday name — display uses a new `getShipDayLabel()`, `getShipDay()` stays untouched), and the Cut List PDF generator (`buildCutListPdf`, printed shipping-floor document, same category as Logistics's excluded BOL/diagram export text). `jobs/packing-slip-test.html` (dev tool) intentionally out of scope. Phase 4 (Manufacturing) DONE (2026-09-04): all three pages tagged (new `manufacturing/manufacturing-i18n.js`, 213 keys × en/es/ht, shared across `index.html`/`block-calculator.html`/`holey-board-calculator.html`, wired into `manufacturing/manufacturing-header.js` which — like `jobs-header.js` before its fix — had no module-catalog `document.write` at all) — deliberately excluding `DIM_NAMES`/`partNameL`/`W`/`H`/`axis`/`zoneName` identifiers (used for `===` comparisons and object-key lookups, stay English; only display copies route through new `axisLabel()`/`machineLabel()` helpers), `buildCutListRows()` and the XLSX export it feeds (exported spreadsheet content, same category as the Cut List PDF and `load-builder.html`'s BOL/diagram exports), and the `"Manual Entry"` sentinel string (persisted marker compared via `!==`, same rationale as `DIM_NAMES`). Phase 5 (Production) DONE (2026-09-04): both pages tagged (new `production/production-i18n.js`, 108 keys × en/es/ht, shared across `index.html`/`bead-inventory.html`, wired into `production/production-header.js` which had the same missing-catalog-wiring gap as every prior module before its fix) — deliberately fixed two dynamic/static `data-i18n`-vs-JS-writer collisions found before commit (the transaction modal's `<h2>` title, and the silo/bead-type "+ Add …" ⇄ "− Cancel" toggle buttons — see `CHANGELOG.md` for the fix approach). Phase 6 (QC) DONE (2026-09-04): all five pages tagged (new `qc/qc-i18n.js`, 188 keys × en/es/ht, shared across `index.html`/`density-calculator.html`/`scrap-log.html`/`incident-report.html`/`final-inspection.html`, wired into `qc/qc-header.js` which had the same missing-catalog-wiring gap as every prior module) — deliberately fixed three dynamic/static collisions found before commit: the `statusPill` status indicator on three pages (static tag dropped, JS seeds it once on init instead — same pattern as Final Inspection's pre-existing `sampleTitle`/`sampleProgress`, which carry interpolated numbers and were never tag-based), `sampleHelp`'s two-state help text (tag kept in lockstep via `setAttribute`), and Scrap Log's submit button (same lockstep-attribute fix as Production's toggle buttons). Deliberately excluded: persisted option `value` attributes (`tolerance`/`productDelivered`/`incidentCategory`/`riskLevel`/`lineMachine`/`scrapReason`/department checkboxes — only visible text tagged), the `"Stephen Cook"` default-value fields (employee name, not UI text), API-loaded customer names (data, per the sweep's standing exception), and Final Inspection's Pass/Fail `Y`/`N` toggle labels (matching the physical approved paper form's notation). No client-side PDF generator was found in Final Inspection — its "controlled PDF record" is built server-side by the Google Apps Script backend. Phase 7 (Reports) DONE (2026-09-04): all 13 pages tagged (new `reports/reports-i18n.js`, 170 keys × en/es/ht, shared across `index.html` and all 12 sub-pages under `scrap/`, `incidents/`, `orders/`, `cutting/`, wired into `reports/reports-header.js` which had the same missing-catalog-wiring gap as every prior module) — this module's fork stalled after 7/13 files (it had front-loaded the full catalog and all 14 new `layout` keys first, so the remaining 6 files + one JS body were finished by hand rather than re-forked). Deliberately excluded as persisted data: incident `type`/`risk_level` (round-trip through URL filter params — only display labels translated), Orders' job `status` enum and Cutting's `board`/`line` values (both `===`-compared against API data and used in `<option value>` — new `labelKeys`/`BOARD_LABEL_KEY` lookups translate only the displayed text), and operator/customer names and handoff/work-item free text. Fixed the same hardcoded-month-array trap found in Job Board, this time in `reports/incidents/trend.html` (replaced with `monthName()` against new `month01`-`month12` keys). Fixed two collision points advisor caught before commit: `incidents/list.html`'s and `cutting/index.html`'s "All Months"/"All Operators" placeholder `<option>` was losing its `data-i18n` tag on rebuild (`innerHTML` regenerated without the attribute) — fixed by setting `data-i18n` in the rebuild template itself, same lockstep-attribute approach as QC/Production's toggle controls. Phase 8 (Admin) DONE (2026-09-04): all 4 pages tagged (new `admin/admin-i18n.js`, 173 keys × en/es/ht) — no `<module>-header.js` shim exists for this module, so the engine was wired via three plain `<script src>` tags added directly to each page's `<head>` (not `document.write` — genuine sequential `<script>` tags block correctly on their own); no language switcher exists on these pages, a deliberate decision (admin renders in whatever language was last selected on a real module page, via `localStorage`). `roles.html` got a `PERM_GROUP_LABEL_KEY`/`PERM_ITEM_LABEL_KEY`/`NOTIF_TYPE_LABEL_KEY` triple translating permission/notification labels while permission dot-path strings stay English (persisted in `role.permissions`/`role.notification_types` JSON), reusing 11 existing module-name keys. `activity-log.html` deliberately excludes `e.summary` (server-composed log text) and `formatDetail()`'s raw JSON, but translates `e.action`/`formatEntityLabel()` via new `ACTION_LABEL_KEY`/`ENTITY_LABEL_KEY` maps (enum values stay untouched). This phase's fork stalled a second time (after Reports), on `activity-log.html` — completed by hand; two catalog gaps (missing `entityJobs`/`entityParts` plurals, missing `actionDelete`) and a `parts.html` category-filter rebuild collision (same class as Reports' option-rebuild bug) were caught during verification and fixed before commit. Next: `legal/eula.html`, `legal/privacy.html`, `login.html`, `track/index.html` (no header shim at all). Fast pass, no need for perfection — fix mistranslations later if flagged (2026-09-04 direction, supersedes any per-module native-speaker-review-item expectation). Only customer names are meant to stay untranslated — everything else, including dynamic/JS-generated content, is in scope.
- [ ] **Title/subtitle dead-code override bug on non-Logistics/non-Jobs module pages** — found 2026-09-04 while surveying for the i18n sweep. Fixed on all of Logistics (`index.html` deleted, duplicate of module default; `bol-email.html`/`load-builder.html` load-bearing — added `layout.bolEmailTitle`/`Subtitle` and `layout.loadBuilderTitle`/`Subtitle` keys) and on Job Board (`jobs/index.html`: title line deleted — `layout.jobsTitle` already matches the module default exactly; subtitle load-bearing — added `layout.jobsBoardSubtitle`). Every legacy module index/sub-page sets its own `document.getElementById('<module>-page-title').textContent = '<hardcoded English>'` (and `-subtitle`) *after* `shared-header.js` already sets those elements correctly (and translated) from the `layout.*` catalog — silently overwriting the translation back to English. Fixed on Manufacturing too (2026-09-04): `manufacturing/index.html`'s override duplicated the module default exactly (`layout.manufacturingTitle`/`Subtitle`) — deleted outright; `block-calculator.html` and `holey-board-calculator.html` each had distinct page-specific text — load-bearing, so each got a new `layout.blockCalculatorTitle`/`Subtitle` and `layout.holeyBoardCalculatorTitle`/`Subtitle` key pair and the inline script switched to the guarded `tt()` IIFE pattern. Fixed on Production too (2026-09-04): `production/index.html`'s override duplicated the module default exactly (`layout.productionTitle`/`Subtitle`) — deleted outright; `bead-inventory.html` had distinct page-specific text — load-bearing, so it got a new `layout.beadInventoryTitle`/`Subtitle` key pair and the inline script switched to the guarded `tt()` IIFE pattern. Fixed on QC too (2026-09-04): `qc/index.html`'s title duplicated the module default exactly (`layout.qcTitle`) — deleted outright — but its subtitle didn't match, so it got a new `layout.qcIndexSubtitle` key; `density-calculator.html`, `scrap-log.html` (title only — no subtitle override on that page), `incident-report.html`, and `final-inspection.html` each had distinct page-specific text — load-bearing, so each got its own `layout.densityCalculatorTitle`/`Subtitle`, `layout.scrapLogTitle`, `layout.incidentReportTitle`/`Subtitle`, and `layout.finalInspectionTitle`/`Subtitle` key pair, all converted to the guarded `tt()` IIFE pattern. Fixed on Reports too (2026-09-04), with a twist: `reports-header.js` deliberately passes `pageTitle: ''`/`backLinkLabel: ''` (each sub-page renders its own title/back-link — this is NOT the dead-code bug, it's load-bearing by design, confirmed via matching comments in both `reports-header.js` and `shared-header.js` before touching anything), so all 13 per-page overrides got a new dedicated `layout.*Title` key (14 total, including `incidentDetail`'s subtitle) rather than any being deleted. Still open (all outside Logistics/Job Board/Manufacturing/Production/QC/Reports, which are now fully fixed): none — every module with a `shared-header.js`-based title/subtitle override has been swept. Remaining work is admin's bespoke topbar and the header-shim-less pages (`legal/*`/`login.html`/`track/index.html`), which don't use this override pattern at all and will need their own investigation when reached.
- [ ] **JS-built table/card content doesn't re-render on language switch (`xpanda:langchange`)** — found 2026-09-04 during the Reports i18n phase (advisor-flagged), but present across every module this sweep has touched so far. `shared/i18n.js`'s `apply(root)` walks `[data-i18n]`/`[data-i18n-attr]`/`[data-i18n-placeholder]` and re-runs on `xpanda:langchange`, but rows/cells built by JS via `innerHTML`/template literals at data-load time (Job Board's `renderList`/`buildCard`, Manufacturing's cut-list rows, QC's dynamically-built rows, Reports' `renderTable`/`sessionsTable`/`cutItemsTable`/invoice groups, etc.) carry no `data-i18n` nodes at all — a language switch after data has loaded leaves that content frozen in whichever language was active at render time until the next reload/refetch. Two narrower instances of the same root cause (a rebuilt placeholder `<option>` losing its tag) were fixed directly in Reports (`incidents/list.html`, `cutting/index.html` — see the i18n sweep bullet above), but the general case — full tables/cards — needs a platform-wide fix, not a per-page patch: likely a shared `xpanda:langchange` listener convention that re-invokes each page's own render function. Revisit once the sweep reaches full-module coverage; not blocking since content is correct on load and after any refetch.
- [ ] **Native-speaker review pass on the Safety i18n catalog** (es/ht) — the SDS/training strings are machine-translated; given liability exposure on a safety portal this should get verified by a native speaker before being treated as authoritative. Non-blocking.
- [ ] **Dark mode Bucket A — remaining passes** — P184 audit identified Bucket A hits in Safety (0% token adoption — highest priority), `logistics/load-builder.html` (local token system, separate batch), and `track/index.html` (standalone, no tokens.css). P186 covered all other modules. These three remain for dedicated prompts.
- [ ] Backfill historical `activity_log`/`parts` timestamp rows to SQLite-native space format (QC Cleanup-5 was forward-only — new writes use `nowSqlite()`, but ~5,835 existing `activity_log` rows and historical `parts.created_at`/`updated_at` rows still carry the old ISO-Z format). Same TEXT column, no schema change — a one-off UPDATE/backfill script (`REPLACE(col, 'T', ' ')` truncated to 19 chars, guarded to only touch rows matching the ISO-Z shape) would fully resolve the `admin/activity-log.html` `ORDER BY timestamp DESC` misordering for old rows too, not just new ones.
- [ ] (Optional, not required for correctness) Refactor the 12+ v2 inline `.replace("T"," ").slice(0,19)` timestamp inserts to a shared `nowSqlite()`-equivalent helper in a v2 lib, for mechanism consistency with the legacy side (QC Cleanup-5 left these as-is per the prompt's explicit optionality — they already emit the correct space format, so this is DRY/consistency only, not a bug fix).

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

- [ ] **P391 follow-up — Cutting report: qty per cut** (`cutting_line_progress.completed_qty` /
  `cutting_sessions.qty_done_delta` currently unpopulated) for true throughput totals.
- [ ] Reports copy cleanup
- [ ] Consistent subtitles across report pages
- [ ] Inspection trends report
- [ ] Customer drill-down report (if needed)
- [ ] Add additional incident fields if Google Sheets / Apps Script evolves
