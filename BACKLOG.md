# xPanda Ops Platform — Backlog

> **Process:** When an item ships, its entry moves to `CHANGELOG.md` (keyed to its prompt #) and is
> deleted from `BACKLOG.md`. BACKLOG is forward-looking only. Drift check: diff `Prompts/` against
> `CHANGELOG.md` — any prompt missing from the changelog is a gap.
>
> Shipped items live in `CHANGELOG.md`.

---

## Auth / Session

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
- [ ] **P406 follow-up — ten v2 `page.tsx` server components re-call `validateSession()`
  independently of `middleware.ts`.** `schedule`, `schedule/desk` (added by P425, after this item
  was first written), `orders`, `board`, `blocks`, `loading`, `notes`, `production`, `cutting`,
  `cutting/crosscutter` each call `validateSession()` a second time (to
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
- [ ] **P309 follow-up — "clock out all" convenience (partially addressed by cutting-signout-01).**
  With multiple concurrent open sessions now possible, an operator wrapping up for the day has to
  stop each stacked `ClockedInBar` one at a time *while still on the board*. `cutting-signout-01`
  added a bulk-stop-all for the **sign-out** trigger specifically (`SignOutSessionModal.tsx` closes
  every open session in one action when the operator chooses to stop before signing out) — this
  item stays open for the separate case of stopping all sessions without signing out, e.g. a
  dedicated "Stop All" action directly on the board/`ClockedInBar` stack.
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

*(All shipped items moved to `CHANGELOG.md` — 2026-09-04 backlog cleanup.)*

## Loading Board (v2)

- [ ] Extract a shared `components/tv/` (freshness-clock) used by both `/v2/schedule` and `/v2/loading` — currently each board is self-contained. (The pixel-shift half of this item was moot as of P304; the logo-sweep half is moot as of P306 — both removed from both boards entirely. Only the freshness clock remains a duplication candidate.)
- [ ] **P261 follow-up — no `UNIQUE(invoice_number, ship_week, day_of_week)` on `schedule_rows`.** The 1/5 migration didn't add one, so the poller's upsert is done in application code (select-then-insert/update) rather than SQL `ON CONFLICT`. Works fine at 15-min-cron scale, but if `schedule_rows` ever gets a second writer, add the unique index and switch to a real upsert.
- [ ] **P263 follow-up — late/at-risk highlighting on the schedule board.** Explicitly out of scope for the first UI pass; would need a definition of "late"/"at-risk" (vs. `ship_date`? vs. status stalling?) before scoping.
- [ ] **P263 follow-up — per-day totals on the schedule board** (load count / bdft sum per `DayColumn`) if useful once the board is in daily use.

---

## Logistics (v2)

- [ ] **v2 zone-column editing follow-up.** `bolEditorEngine.ts`'s editor has no zone-column boxes
  at all yet (legacy's `zoneCol0…N` per-column editing has no v2 equivalent) — noted again while
  scoping `bol-style-03`, which deliberately did not add zone-column styling to v2 for this reason.
- [ ] **Shipment Dashboard Distance/ETA — extract shared geocode-cache orchestration if a 4th
  consumer appears.** `resolveOrigin`/`resolveDestRoute`-style cache read/write logic is now
  duplicated three times (`invoice/route.ts`, `invoice/resolve-line/route.ts`,
  `shipments/distances/route.ts`), each a deliberate self-contained copy to avoid risking the
  live invoice-ingest path. Fine at 3; revisit if a 4th consumer needs the same pattern.
- [ ] **Shipment Dashboard Distance/ETA — `driving-hgv` truck-profile lane.** Today's
  miles/duration use ORS's `driving-car` profile (free-flow, no traffic) for both Invoice
  Analytics and the Distance/ETA field, labeled accordingly in the UI. A truck-accurate
  profile would need its own cache columns/keys (can't reuse `miles_from_origin`/
  `duration_sec_from_origin`, which are car-profile) — deferred until Steve wants it.
- [ ] **Shipment Dashboard Distance/ETA — optional Calendar-view warm pass.** Calendar view
  and List's "Show All" deliberately never trigger ORS resolution (cache-only display) to
  avoid an unbounded cold-cache loop; they'll only show real values once the default List +
  This-Week view has warmed those addresses. Revisit if Steve wants Calendar to populate
  independently (would need its own bounded/paginated warm strategy, not a blanket unlock).
- [x] P435 — unit 1: BOL core port (`logistics/bol-shared.js` → `cutting-pilot/src/lib/bolShared.ts`) + structural self-check + visual parity harness. Isolated `v2-logistics` worktree/branch, not merged/deployed. See `CHANGELOG.md` for full detail.
- [x] PXXX (Steve to assign) — unit 2: shipment dashboard port (`/v2/logistics`) + `bol-compose`/`bol-editor` rebuilt as real React components (`BolViewerModal`/`BolGenerateModal`/`BolEditorModal`), both dashboard bugs fixed structurally (live trailer enrichment, always-refetch after generate). Isolated `v2-logistics` worktree/branch, not merged/deployed; write routes authored but fenced (`V2_LOGISTICS_WRITES_ENABLED = false`). See `CHANGELOG.md` for full detail.
- [x] PXXX (Steve to assign) — unit 3a: preview D1 + R2 bootstrap (dev write-safety) — `wrangler.toml` preview bindings, scratch schema/seed scripts, dev-auth cookie doc. See `CHANGELOG.md` for full detail.
- [x] PXXX (Steve to assign) — unit 3b: dock loading dashboard port (`/v2/logistics/loading`), writes LIVE. See `CHANGELOG.md` for full detail (closes the former "Unit 4 — loading dashboard port" backlog line, removed below).
- [x] PXXX (Steve to assign) — Invoice Analytics, unit C + unit D: schema, BOL-token resolver, ORS mileage/price-per-mile, cross-history flags API, and the upload/parse/results page (`/v2/logistics/invoice-analytics`). Migrations authored not run, held on `ORS_API_KEY` secret + Steve running both migrations. See `CHANGELOG.md` for full detail.
- [ ] **Invoice Analytics — unit F: legacy bridge card.** Surface a link/summary card into the legacy LISMA-spreadsheet-adjacent pages so staff still on the old workflow can find the new tool.
- [ ] **Invoice Analytics history date-range filter** (needs `/v2/api/logistics/flags` to accept `?from/&to`) — deferred.
- [ ] **Invoice Analytics — manual "Resolve unmatched" is single-destination only.** The Resolve
  popup (Upload + History) collapses a multi-destination line to one BOL # + one address, which
  discards the originally extracted BOL tokens (`bol_numbers` becomes a single-entry array). Fine
  for a genuinely single-stop line that failed to auto-match; a manually "resolved" multi-stop
  line loses its other stops. Revisit if this turns out to matter for a real multi-destination
  unmatched line.
- [ ] **History: multi-invoice month header polish.** `/v2/api/logistics/month`'s fallback invoice
  header for a month with >1 distinct invoice (`vendor: "Multiple"`, `invoiceNumber: "<n> invoices"`,
  `invoiceDate: <month>`) is untested against a real multi-invoice month — today there's exactly 1
  invoice/month. Revisit `MatchRateBanner`'s rendering of that fallback once a month actually holds
  several invoices.
- [ ] **Financials tab: vendor breakdown widget** — deferred until multi-vendor data exists (currently 1 vendor).
- [ ] **Invoice dedup residual edge** — same-month invoice under a different/blank `invoice_number`
  is not flagged (relies on stable parsed invoice numbers); revisit if parser numbering proves
  unstable.
- [ ] **Invoice dedup Replace isn't atomic.** `POST /v2/api/logistics/invoice`'s clean-replace
  (resolve → `DELETE FROM freight_invoice_lines` → persist) is 3 separate D1 calls, not one
  transaction — if a `persistLine` INSERT fails partway through the persist loop, the old rows are
  already gone and only partial new rows exist. `DB.batch([...])` would make it atomic but needs
  `persistLine` restructured to return a statement instead of executing it.
- [ ] **Invoice export: PDF export option / branded print header** — deferred. PXXX-k shipped
  browser print (`window.print()`) + XLSX export for both the per-invoice/per-month view and an
  annual rollup; a true PDF export and a branded (logo/letterhead) print header were named in the
  prompt as future-nice but out of this pass's scope.
- [ ] **Invoice Analytics — native driving-distance for multi-stop lines.** v1 excludes `multi_destination` lines (multiple BOL tokens resolving to different ZIPs on one invoice line) from stats entirely rather than computing a real multi-stop route distance.
- [ ] **Invoice Analytics — no Seal Express sample invoice was available to validate unit D's PDF parser.** Only one real vendor sample (`26.03 Lisma Invoice Details 4611.pdf`) exists in the repo; the column-detection logic is written to the same vendor-agnostic rule the prompt specifies for both vendors, but Seal's actual layout was never exercised. Get a real Seal invoice and re-run the same end-to-end validation (parse → `extractBolTokens` → token count) before trusting it blind.
- [ ] **v2 logistics rollout**: remove the two `logistics.v2` rules from `middleware.ts` (granular `logistics.*` rules resume); grant `logistics.v2` to the appropriate roles or retire the key + label. Wire nav links only at cutover (still unlinked until then).
- [ ] **Enable `/v2/logistics` writes** — flip `V2_LOGISTICS_WRITES_ENABLED` (now hoisted to `cutting-pilot/src/lib/logistics/writeFence.ts`, shared by `bols/route.ts`, `bols/[id]/route.ts`, and `shipments/[id]/route.ts`) to `true` once Steve has reviewed the fenced POST/PUT logic live (dedicated write-enable phase, not bundled with any read-side rollout).
- [ ] **v2 logistics live-launch plan** — consolidates the remaining dark-gated items before this
  board can go live and get linked into nav: (1) flip the write fence above; (2) ~~build the
  Status-field cascade~~ **built** — `ShipmentEditModal.tsx`'s Status field is now a live `<select>`
  wired to a ported job/`loading_assignments`/cutting-lines sync chain in `shipments/[id]/route.ts`
  (mirrors `_worker.js/routes/jobs.js`'s shipment PUT handler), still behind the closed write fence;
  (3) ~~add shipment delete + BOL-history-delete actions~~ **built** — both actions now exist
  (`shipments/[id]/route.ts` DELETE, `bols/[id]/route.ts` DELETE, wired into `ShipmentEditModal.tsx`
  and `BolViewerModal.tsx`'s new BOL-history panel), also still fenced; (4) the nav cutover itself.
  (1) and (4) remain gated on Steve's explicit go-ahead per the v2 visibility gate hard rule; (2) and
  (3) still need a live `wrangler dev --remote` smoke pass once the fence flips (see the unit 2
  follow-up below) since nothing behind a 501 fence has touched real D1 yet.
- [ ] **Unit 2 follow-up — Generate BOL modal dropped "Include packing slip"/"Include Loading Diagram".** Neither had a v2 endpoint in unit 2's scope (packing-slip bytes live in the Job Board; the Loading Diagram comes from Load Builder, unit 3). Revisit once those units exist, if Steve wants parity restored.
- [ ] **Unit 2 follow-up — BOL delete doesn't clean up `bol_documents`/R2 objects.** `bols/[id]/route.ts`'s new single-BOL `DELETE` matches legacy's own single-delete route exactly, including this gap: only legacy's separate bulk per-job delete branch (`bols.js:567-595`) cleans up `bol_documents` rows and their R2 objects. Deleting a BOL through the new UI (`BolViewerModal.tsx`'s BOL History panel) leaves orphaned document rows/R2 objects behind, same as legacy's single-delete always has. Not a regression, but worth fixing in both places if Steve wants it addressed.
- [ ] **Unit 2 follow-up — no v2 `bol-customers` address-book search.** Legacy's Generate BOL flow has a customer search panel (`GET /api/bol-customers`) that autofills ship-to fields and sets `customer_id`; v2's `BolGenerateModal` has no equivalent endpoint yet, so `customer_id` is always sent `null`. Build `/v2/api/bol-customers` (read-only) and wire the search panel back in if Steve wants this restored.
- [ ] **Unit 2 follow-up — verify local `wrangler dev --remote` smoke before flipping the write fence.** This unit's `tsc`/`cf-build` gates are green, but a bare `next dev` in this sandbox can't reach D1 (`getEnv()` hangs indefinitely rather than erroring) and can't route legacy-served `/logistics/assets/*` (the BOL template/font files), so the dashboard's real data load, the Generate modal's fenced-write banner, and the Viewer/Editor's PDF paths were never smoke-tested against live data. Run a real `wrangler dev --remote` (or deploy to a preview) pass first.
- [ ] **Unit 3 — load builder port + packing-logic rework.** Ports `logistics/load-builder.html` (trailer load planning, auto-pack algorithm, saved loads, BOL generation via the unit-1/2 engine). Broken into task-grouped `lb-engine-NN`/`lb-ui-NN` prompts (see below) rather than sequential `PNNN`s.
- [ ] **Unit 3 follow-up (lbz-bol-02) — v2 zone-column editing UI.** `bolShared.ts`'s
  `zonecolumns` field type, `buildZoneColumns` layout algorithm, and `ZoneColumnsOverride`
  hydration were ported 1:1 (lbz-bol-02, rendering parity only) — but legacy's `bol-editor.js`
  zone-box drag/edit/"Reset columns"/stale-guard UI (lbz-bol-01 §3/§4) was NOT ported. Fold this
  into the v2 load builder port (Unit 3) once its BOL generation/edit surface exists: N
  draggable/editable zone-column boxes (skip the generic per-field FIELD_MAP loop for
  `type:"zonecolumns"` and `commodity` on a zoned bol, same as legacy), a "Reset columns" action
  that regenerates from `ZoneColumnsOverride.zoneData` via `buildZoneColumns`, and a stale-guard
  banner comparing a fresh `hashJobZoneData` recompute against the stored `sourceHash`.
- [x] lb-engine-01 — packing engine contracts + 13-rule invariant harness (`packEngine.ts` + `packEngine.selfcheck.ts`), `pack()` stubbed. See `CHANGELOG.md` for full detail.
- [x] lb-engine-03 — column fill (K top-off against `topOffMinInchesPerPiece`), rear->front ordering, running balance, rationale strings (completes `pack()`). See `CHANGELOG.md` for full detail.
- [x] **lb-engine-03 open question (B3) — does the floor crew load nose-first or rear-first?** Resolved 2026-09-16 (row-order-nose-first): the floor crew loads nose-first, biggest sizes go in first. `pack()` previously ordered rows thickest-base at `posFromFront: 0` (the rear/doors) on the wrong assumption that the thickest freight was loaded last; flipped so the thickest sits at the nose (loaded first) and the thinnest at the rear (loaded last, unloaded first). See `CHANGELOG.md` for full detail.
- [x] lb-engine-04 — rationale honesty (three-way short-column split: below-K / demand-exhausted / no-footprint-mate, plus equal-thickness wording), exported `planMetrics()`, and a pinned metrics ratchet in the selfcheck. Closes out the engine. The originally-scoped legacy `calcLoading` comparison harness was **dropped by decision** — a faithful port is hundreds of lines where a subtle mis-port yields a wrong baseline and false confidence in either direction, and the comparison's answer is already demonstrated by `FIXTURE_BLOCKS_PAIRING`; the absolute ratchet replaces it as the objective bar. See `CHANGELOG.md` for full detail.
- [x] lb-engine-05 — runner height threaded into the effective column budget (`effectiveHeight = dims.height - runnerHeight`, closing a blind spot shared by both `pack()` and `validatePlan`'s `column-height` rule) and the legacy near-weight-limit advisory dropped (was never ported to v2; `validatePlan`'s `weight` rule kept as a data-canary, not a load warning). Reopens the engine briefly after lb-engine-04's close-out for a correctness fix found before UI work started. See `CHANGELOG.md` for full detail.
- [x] lb-ui-01 — read-only plan view for the v2 load builder at `/v2/logistics/load-builder` (admin-only, dark-launched): top-down trailer diagram (not legacy's side elevation), metrics strip, rationale detail panel, warnings/balance sections, three real-order fixtures. Also wires `packEngine.selfcheck.ts` into a dev-only rendered pass/fail table on the page itself. See `CHANGELOG.md` for full detail.
- [x] lb-ui-02 — customize editor for the v2 load builder (`CustomizeEditor.tsx`, `HoldingArea.tsx`, `EditorGuards.tsx`, headless `loadEditor.ts`): whole-column drag/pull/place/compact/undo, `validatePlan()` as the sole apply gate, persistent guard banners (row-width + trailer-length blocking, holding-columns advisory, column-height invariant), full keyboard equivalent for every drag interaction. See `CHANGELOG.md` for full detail.
- [x] lb-ui-03 — dissolve: automatic piece-level proposal + apply for redistributing a trailer's headroom onto other trailers (`dissolve.ts`, `DissolvePreview.tsx`), eligibility mirroring `validatePlan`'s own `maxSkusPerColumn`/K rules rather than legacy's height-and-weight-only check; plus a carry-over `canDrop` depth-check fix from `lb-ui-02`. See `CHANGELOG.md` for full detail.
- [x] lb-ui-04 — saved loads: new `savedLoad.ts` (`SavedLoadSnapshot` — `source`/`trailerTypeKey`/`runnerHeight`/`editedPlan`, a purpose-built shape correcting the prompt's own premise that `loadEditor.ts`'s transient `EditorState` was what needed serializing), fenced API routes (`app/api/saved-loads/route.ts`, `[id]/route.ts`, mirroring `bols/route.ts`'s fence-check-first pattern) over the ALREADY-EXISTING `saved_loads` D1 table (no new migration needed — legacy's own `handleApiSavedLoads` already reads/writes it), `SaveLoadModal.tsx`/`LoadPickerModal.tsx` (real modals, not `window.prompt`/`confirm`), new Save/Update/Load-saved entry points in `LoadPlanView.tsx`. `deserializeSnapshot()` rejects legacy-authored rows in the shared picker list with a reason instead of throwing. `middleware.ts` gains `{prefix: "/v2/api/saved-loads", keys: ["logistics.v2"]}`. **This is the sprint's last item — all 7 `lb-ui-NN` boxes are now checked.** See `CHANGELOG.md` for full detail (Step 0 findings, the GET-sweep fence-gating correction, live 501 curl verification, and the local-dev-D1 finding).
- [ ] **`lb-ui-04` follow-up — confirm whether `bols/route.ts`'s "wrangler dev writes hit production" header comment is still accurate.** This prompt found local `next dev` (via `getCloudflareContext()`'s `getPlatformProxy`) uses a fully local, isolated Miniflare SQLite D1 emulation (`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`), not a live connection to prod or the declared `preview_database_id`. This may not actually conflict with that comment (`wrangler dev --remote` does hit prod; the comment may predate the current toolchain/describe a different invocation) — flagged as needing confirmation rather than asserted wrong, and not edited (`bols/route.ts` is out of this prompt's fence).
- [ ] **`lb-ui-04` follow-up — the fenced GET-sweep could instead filter expired rows in the `SELECT` (`WHERE expires_at >= ?`) rather than gating the `DELETE` on the write flag.** Same zero-divergence outcome (v2 never shows expired rows) at zero write risk, since it never touches the fence question at all. Not made — the gated-`DELETE` approach was already reviewed and is correct as shipped — but worth considering if Steve would rather v2 never show stale rows even pre-Phase-3.
- [ ] **`lb-ui-04` follow-up — legacy-authored rows in the shared `saved_loads` list are an existing, expected condition, not a bug.** `LoadPickerModal.tsx`'s `deserializeSnapshot()` reject path already handles it (shows "not compatible" inline per row instead of crashing "Load"), proven by a selfcheck case built from legacy's own real `state_json` shape. Named here only so it isn't mistaken for a defect during Phase 2 testing.
- [x] lb-ui-05 — job pull-in → cart: `jobPull.ts` (headless match against `GET /api/load-builder-skus`, ported `prefillFromJob` match order), `JobPullModal.tsx` (search + review/confirm preview, per-SKU color swatches, `?job_id=` deep link), wired into `LoadPlanView.tsx` as an additional `pulledSource` alongside the three fixtures. On-the-fly part creation for an unmatched line deliberately deferred (see follow-up below). Sprint step 1 of 7, `Prompts/sprint-load-builder-parity.md`. See `CHANGELOG.md` for full detail.
- [ ] **Sprint Phase 3 — enable `lb-ui-05`'s deferred on-the-fly part-creation write path.** Legacy's `prefillFromJob` creates a new part via `POST /api/parts` when a line item matches nothing; this sprint's port surfaces the unmatched line as a warning instead and does not write. Re-enable once Steve has reviewed the sprint's Phase 2 integration testing and the unfenced-`/api/parts` risk (see the sprint charter's "one sprint-wide exception").
- [ ] **`lb-ui-05` follow-up — export `packEngine.ts`'s `colorForSku` instead of duplicating it.** `jobPull.ts`'s `colorForSkuId` is a byte-for-byte copy of `packEngine.ts`'s private, unexported `colorForSku` (same palette, same hash) so the job-pull preview's swatches match the eventual trailer-diagram colors. `packEngine.ts` is closed/ratchet-guarded so this prompt couldn't export it directly — worth doing in a future dedicated engine prompt to remove the duplicate. (2026-09-16: `TrailerDiagram.tsx` now renders the per-SKU colors that were already being computed — column border stripes + a per-trailer legend — so the on-screen gap this item worried about is closed; this item itself stays open, since it's about the `colorForSku`/`colorForSkuId` duplication, which is unchanged.)
- [ ] **`lb-ui-05` follow-up — `GET /api/load-builder-skus` needs its own permission grant at Phase 3 rollout.** That legacy route is gated by the `logistics.load-builder` key (`_worker.js/lib/core.js:213`); it works today only because `/v2/logistics*` is admin-only and admins bypass permission checks (`middleware.ts`'s dark-launch gate). When Phase 3 grants `logistics.v2` to a non-admin role, that role also needs `logistics.load-builder` (view) or `JobPullModal` dead-ends on "Couldn't load the SKU library." Not currently named in the sprint charter's Phase 3 checklist — add it there when Phase 3 is scoped.
- [x] lb-ui-06 — trailer type / runner height UI: `LoadPlanView.tsx` exposes all 5 `TRAILER_TYPES` presets (was hardcoded to "53ft Standard") and `PackOptions.runnerHeight` (0/3/4in, confirmed against legacy's own dropdown) as inline `<select>`s, wired into the existing `pack()`/`planMetrics()`/`CustomizeEditor`/`ColumnDetailPanel` calls alongside `lb-ui-05`'s job-pull source. Sprint step 2 of 7, `Prompts/sprint-load-builder-parity.md`. See `CHANGELOG.md` for full detail.
- [ ] **`lb-ui-06` follow-up — Force Sizes still needs new engine work before a UI can wire it.** (Auto-downsize, the other half of this item as originally written, shipped via `lb-ui-12` — see `CHANGELOG.md`.) Step 0 re-grepped `packEngine.ts` for `forceSize`/`variant` — zero real matches (`variant` only appears as a substring of "invariant"). Legacy's remaining trailer-option toggle has no engine-side concept to bind to; scoping a `lb-engine-NN` prompt for forced-size logic is a prerequisite, not a UI task.
- [ ] **`lb-ui-06` follow-up — `PackOptions.isFlatbed` is declared but never read anywhere in `packEngine.ts`.** Reserved, not implemented — confirmed by grep before this prompt wired anything. If flatbed strap-orientation logic (legacy: `load-builder.html:1444-1516`) turns out to matter, it needs engine work first; do not add a UI toggle for it until the engine reads the field.
- [ ] **`TrailerDiagram.tsx` has no runner visualization** — `lb-ui-06`'s runner-height control is real (it changes `packOptions.runnerHeight` and the header text notes `· N" runners`), but the diagram itself draws nothing for it. Legacy draws a brown runner strip under every stack plus a "▬ N″ runners" legend, both on-screen (`load-builder.html:1083`/`1108`) and in print (`:1149`/`1158`). Out of `lb-ui-06`'s fence (`TrailerDiagram.tsx` isn't in it), but matters for `lb-ui-08` (print/export parity) — name it now, build it there.
- [x] lb-ui-07 — manual/custom load building: `loadEditor.ts` gains `addRow`/`addColumn`/`addLayer`/`setLayerCount`/`removeRow`, reached via a new "Edit…" button on `TrailerDiagram`'s existing `headerAction` slot opening a new local `TrailerEditModal` inside `CustomizeEditor.tsx` (both `TrailerDiagram.tsx`/`ColumnDetailPanel.tsx` stayed out of the file fence). New unassigned-pieces tracker is `planForApply(state).balance`, not a fourth bucket. `validatePlan` proven to already cover legacy's bespoke BDFT Apply-guard (no bespoke guard added). Sprint step 3 of 7, `Prompts/sprint-load-builder-parity.md`. See `CHANGELOG.md` for full detail.
- [x] lb-ui-08 — print / export loading diagrams: new `loadingDiagramPdf.ts` builds a standalone per-trailer PDF natively via `pdf-lib` (vector, not legacy's `html2canvas` raster) — top-down diagram (ported from `TrailerDiagram.tsx`'s own percentage math), pieces table, stack breakdown, runner/stability notes. New `LoadingDiagramPrintButton.tsx` wired into both `CustomizeEditor.tsx` and `LoadPlanView.tsx` via `TrailerDiagram`'s `headerAction` slot. Sprint step 4 of 7, `Prompts/sprint-load-builder-parity.md`. See `CHANGELOG.md` for full detail.
- [ ] **`lb-ui-08` follow-up — the empty-diagram-area "remaining floor" region has no visual fill/label inside the diagram itself.** Legacy's SVG shades the unused-length region and centers a "N remaining" label inside it; this prompt's PDF only captions the same fact below the diagram (`"636"L × 98"W — 10' 8" remaining"`), a deliberate simplification to keep the diagram box's layout math simple. Revisit if Steve wants closer visual parity.
- [ ] **`lb-ui-08` follow-up — `CustomizeEditor.tsx`'s Print/Export button never gets an invoice number**, unlike `LoadPlanView.tsx`'s (which has `fixture.invoiceNumber` free in scope). Threading a per-trailer invoice number into edit mode would need a new prop through `CustomizeEditorProps` for one cosmetic PDF-subtitle field — skipped as out of proportion to this prompt's scope; not a functional gap (the PDF still generates correctly, just without the INV# line in edit mode).
- [ ] **`lb-ui-08` follow-up — the pieces/stack-breakdown tables clip instead of scaling or paginating when a trailer has many distinct SKUs or stack patterns.** Fixed page height budget below the diagram is ~258pt at a 14pt row height, so roughly 17 rows before content runs off the bottom of the page — a mixed load with many distinct SKUs or stack patterns can reach that. Legacy's `html2canvas`-rasterized path scaled the whole print HTML to fit one page instead of clipping; this prompt's vector approach has no equivalent fit-to-page step. Neither of this session's two bundled fixtures reached the limit (4 and 2 pieces-table rows respectively), so it wasn't hit in practice, but it's a real gap worth a fix (auto-shrink row height, or a second page) if Steve's Phase 2 pass turns up a load that clips.
- [x] lb-ui-10 — Parts / SKU library CRUD: new `PartsLibraryPanel.tsx` against `/api/parts` (`handleApiParts`, full CRUD confirmed — `GET`/`POST`/`PUT`/`DELETE` all exist). Legacy's own SKU-tab UI (`load-builder.html:1629-1807`) actually calls a different endpoint, `/api/load-builder-skus` — a camelCase wrapper over the SAME `parts` table — but this prompt is scoped to `/api/parts` per its own locked instruction and that endpoint already covers everything needed. Edit form only exposes fields `PUT` actually persists (`part_number`/`customer`/`density_material`/dims/`notes`/`bundle_qty`) — see follow-up below for the fields it silently ignores. Delete is a two-step arm/confirm inline control naming what shared surfaces it affects (not `window.confirm()` — this session's system prompt disallows triggering browser dialogs). CSV paste-import and legacy's whole-table "Reset" button both deliberately excluded (see `CHANGELOG.md`). New "Parts library" entry point in `LoadPlanView.tsx`, not mode-gated. This writes to LIVE, unfenced production data (`/api/parts` has no `V2_LOGISTICS_WRITES_ENABLED` gate) — Phase 2 live create/edit/delete testing against clearly-marked test SKUs is Steve's, not exercised by this prompt's own verification. Sprint step 6 of 7, `Prompts/sprint-load-builder-parity.md`. See `CHANGELOG.md` for full detail.
- [ ] **`lb-ui-10` follow-up — `handleApiParts`'s `PUT` (`_worker.js/routes/production.js:94-99`) never updates `name`, `color`, `allow_rotation`, `sort_order`, `category`, or `parent_group`**, no matter what the payload contains — only `part_number`/`customer`/`density_material`/dims/`notes`/`bundle_qty` are in its `UPDATE` statement. Concretely: a part's `name` can currently only ever be fixed by deleting and recreating it, since `POST` is the only path that sets it. `PartsLibraryPanel.tsx`'s edit form shows the untouchable fields read-only rather than as broken controls, but the real fix is widening `PUT`'s `UPDATE SET` list — a `_worker.js/` change, out of this prompt's fence, Steve's call on priority.
- [ ] **`lb-ui-10` follow-up — CSV paste-import deferred.** Legacy's SKU tab has a real copy/paste-import feature (`toCSV`/`fromCSV`, `load-builder.html:548-571`, wired to N sequential `/api/load-builder-skus` POSTs via `importSkus`). Not ported: N sequential writes to production with no dry-run and no undo is exactly the class of action the sprint charter's "one sprint-wide exception" section says needs Steve directly involved, not something to ship unsupervised. `partsLibrary.ts`'s Part C spec allowed deferring this explicitly.
- [ ] **`lb-ui-10` follow-up — cross-page stale-parts-cache risk between the new Parts library panel and Orders.** `PartsPicker.tsx:28` (`partsCache`) and `partMatch.ts:159` (`loadPartsLibrary`'s cache) are both module-level and both out of this prompt's file fence. Sequence: create/edit/delete a part in `PartsLibraryPanel.tsx`, then navigate to `/v2/orders` in the same browser tab without a hard reload — Next.js client-side routing can keep those modules' caches alive across the navigation, so Orders' "add from parts library" picker and `OrderEntryForm.tsx`'s part-matching would show pre-edit data until a real page load. Load Builder's OWN job-pull matching (`JobPullModal.tsx`'s `fetchLoadBuilderSkus`) is unaffected — confirmed it has no cache of its own and always fetches fresh. Fixing this cleanly needs an invalidation hook added to one or both of those out-of-fence files — future work, not a `lb-ui-10` regression.
- [x] lb-ui-09 — BOL generation wired to a `PackPlan` + per-trailer numbering: `BolGenerateModal.tsx` gains an additive `packPlanSource` trigger alongside its original `jobId` (dock-assignment, `ShipmentDashboard.tsx`, unchanged) path — one `TrailerForm` per `plan.trailers[]`, commodity description computed per-trailer from `lb-ui-08`'s `buildPiecesTable` (matches legacy's own load-builder BOL flow, which uses `trailer.skuBreakdown`, not job line items). Numbering logic (`invNumber`/`invAutoFilled` auto-increment) is untouched — this prompt is the wiring, not new logic. "Include Loading Diagram" restored as a per-trailer checkbox; `bolShared.ts` gains a `loadingDiagramPdfBytes` merge option (mirrors `packingSlipPdfBytes` exactly, both proven by a new async selfcheck) but the live UI wiring opens the diagram in its own tab per checked trailer instead — see `CHANGELOG.md` for why (the merge option's only sibling, `packingSlipPdfBytes`, is itself dead/unwired code; `bolDomGlue.ts`/`BolViewerModal.tsx`, the actual live render path, are out of this prompt's fence). New "Generate BOLs" entry point in `LoadPlanView.tsx`, view mode only. `V2_LOGISTICS_WRITES_ENABLED` confirmed untouched. Sprint step 5 of 7, `Prompts/sprint-load-builder-parity.md`. See `CHANGELOG.md` for full detail.
- [ ] **`lb-ui-09` follow-up — `bolShared.ts`'s new `loadingDiagramPdfBytes` merge option has no live combined-PDF caller.** Same status as its sibling `packingSlipPdfBytes`, which was ALSO found to be dead code this session (`bolDomGlue.ts`'s `buildCombinedBolPdf` does its own separate packing-slip merge and never threads either option through `generatePdf`). Both are proven correct by `bolShared.selfcheck.ts`'s `runBolSharedPdfMergeSelfCheck` and ready for a future prompt that brings `bolDomGlue.ts`/`BolViewerModal.tsx` into scope to actually wire them into the live "View BOL" combined-packet render.
- [ ] **`lb-ui-09` follow-up — a load-builder-sourced BOL's trailers all start with IDENTICAL ship-to/carrier/contact/PO/date prefill**, with no per-trailer override UI beyond hand-editing each page. This matches the existing dock-assignment path's own behavior exactly (not a regression introduced by this prompt — that path has always prefilled every trailer identically too), but is worth naming as a shared limitation if Steve wants a "carry from trailer 1, override trailer 2+" UI later.
- [ ] **`lb-ui-09` follow-up — no dock assignment exists yet for a load-builder-sourced BOL, so `trailerNo` starts blank on every trailer** (the planner fills it in by hand during the BOL form). Once a load is dock-assigned (loading dashboard, a separate v2 unit), there's no automatic link-back to pre-fill a BOL generated from Load Builder before that assignment happens — expected given the two flows aren't sequenced together yet, named here in case Steve wants that connected later.
- [ ] **`lb-ui-09` follow-up — checking "Include Loading Diagram" on multiple trailers opens one `window.open` per trailer across a loop with an `await` between each**, which can lose the click's original user-gesture context after the first round-trip; browsers are more likely to pop-up-block tab 2+ than the single-tab case `LoadingDiagramPrintButton.tsx` already handles cleanly. The existing `!opened` form-error message covers it per-trailer (tells the planner to allow pop-ups) but doesn't prevent the block. Worth a batched/sequential-with-confirmation UI later if this proves annoying in Phase 2 testing.
- [x] lb-ui-11 — parts library in custom builds: `CustomizeEditor`'s Edit modal can add rows/columns/layers from the full parts library (`/api/load-builder-skus`), not just the job's own pulled SKUs (`loadEditor.ts`'s new `addRowFromLibrary`/`addColumnFromLibrary`/`addLayerFromLibrary`, tracking `originalSkuIds` to tell job-known demand from library-introduced demand). Also fixes a conservation-violation-on-reopen bug this surfaced — `editedCart`/`editedSkus` now round-trip through `LoadPlanView.tsx` and `savedLoad.ts`. See `CHANGELOG.md` for full detail.
- [x] lb-ui-12 — auto-downsize the last trailer to a 26ft Box Truck: three-step prompt (`validatePlan`/`recomputePlan`/`planMetrics` read per-trailer `dims`; per-trailer `dims` plumbed through the editor UI + BOL export; `pack()` gains an opt-in `autoDownsize` that only accepts a downsize when it recursively repacks to exactly one box truck with nothing left unplaced). `LoadPlanView.tsx` gets the toggle (on by default) and a `typeBadge` pill on the diagram; `savedLoad.ts` persists it. Closes the auto-downsize half of the `lb-ui-06` follow-up above (Force Sizes, the other half, is unchanged/still open). See `CHANGELOG.md` for full detail.
- [ ] **CRLF-verification methodology correction (2026-09-15, `lb-ui-08` session) — the sprint charter's rule had the repo's line-ending convention backwards.** The real convention is **LF** (confirmed via `git show HEAD:<file>` across every `lb-ui-05`–`08` touched file, including a follow-up pass closing a gap over `JobPullModal.tsx` and `LoadPlanView.tsx` specifically, and `packEngine.ts`, which is closed/untouched and so a clean baseline) — the repo has never been CRLF. Separately, `grep -cU $'\r' "$f"` run inside a bash `$(...)` command substitution gave false-positive "100% CRLF" results on this Windows box for files independently confirmed LF-only. No actual file drift occurred in any prior `lb-ui-NN` commit (re-verified after the fact via `git show`, gap included), but the "CRLF: OK" claims in the `lb-ui-05`/`06`/`07` reports were checking the wrong thing. Corrected in `memory/edit-tool-crlf-changelog.md` (repo convention + the broken bash check both flagged); `lb-ui-08` onward uses a Python byte-count check instead. No code change needed — this is a process-only finding.
- [ ] **`lb-ui-07` follow-up — no "add a trailer from nothing" entry point.** `pack()` never emits a zero-row trailer, `TrailerDiagram`'s "Edit…" button has nothing to render against when `plan.trailers.length === 0`, and this prompt's locked operation list has no "add trailer" op. Matches legacy's own manual-editor limitation (it only ever opens against an existing trailer) but is worth naming since `lb-ui-06` made small/zero-fit presets more reachable. The from-scratch build path (`addRow`/`addColumn` from an empty shell) is verified headlessly and works — only the UI entry point is missing.
- [ ] **`lb-ui-07` follow-up — cross-row layer drag not ported.** Legacy's manual editor lets a layer be dragged from one column directly into another, including across rows, with auto-cleanup of the emptied source column/row (`load-builder.html:2412-2438`). Not in this prompt's locked operation list (`addRow`/`addColumn`/`addLayer`/`setLayerCount`/`removeRow` only) — today the equivalent requires zeroing the layer in its source column (returns it to unplaced balance) and re-adding it via `addLayer` on the target, which is not a true relocation (it round-trips through the balance bucket instead of moving directly). Revisit if Steve's floor testing flags this as a real workflow gap.
- [ ] **`lb-ui-07` follow-up — row reorder and row-level base-SKU swap not ported.** Legacy's manual editor also has row reorder ↑/↓ (`load-builder.html:2390-2397`) and a row-level base-SKU selector that rewrites every column's width in that row at once (`:2381-2388`). Neither is in this prompt's locked scope; `moveColumn` covers column-level repositioning but not whole-row reordering or a bulk per-row SKU swap.
- [ ] `AGENTS.md:235` still says "entry keyed to the prompt number" — same stale phrasing `lb-ui-03` fixed in `CHANGELOG.md` and `xpanda-ops-agents.md`, left untouched there since it wasn't in that prompt's file fence.
- [ ] `CustomizeEditor.tsx`'s keyboard target-picker (`handleChooseTarget`) commits a move with no `canDrop` pre-check at all (width or depth) — only the drag-hover path gets live feedback today. A keyboard-driven move can still trigger `row-width`/`trailer-length` guards after the fact, same as any move, but the picker never warns before confirming the way dragging does.
- [ ] Dissolve's holding→trailer depth risk is not covered by the `lb-ui-03` `canDrop` fix (`from` is optional and omitted for that path) — a held column dropped into a shallow row can still overflow a downstream row with no pre-drop warning, only the post-apply guard banner.
- [ ] Dissolve doesn't recompute `packEngine.ts`'s tall/narrow `"[stability: ...]"` rationale note for a receiver column it newly makes tall/narrow — that logic lives inside closed `packEngine.ts` (`applyStabilityWarnings`) and dissolve only preserves an existing note, it doesn't add a new one.
- [ ] **Floor-test `/v2/logistics/loading` before retiring legacy `logistics/loading.html`.** Unit 3b's dock dashboard is writes-LIVE but unlinked (v2 visibility gate) and its `wrangler dev` smoke against scratch bindings is still owed (unit 3a's `preview_database_id` was a placeholder when 3b was built — see its `CHANGELOG.md` entry). Run the scratch smoke pass, then floor-test against real data before wiring it into nav or retiring the legacy page.
- [ ] **Unit 3b follow-up — i18n for the new dock dashboard labels.** `DockAssignmentCard.tsx`/`AssignBayModal.tsx`/`LoadedChecklistModal.tsx`/`DockBoard.tsx`/`TeamView.tsx`/`BayListItem.tsx`/`ShippingInfoModal.tsx`/`PullJobModal.tsx`/`PhotoGalleryModal.tsx` ship English-only strings (v2 has no i18n spine wired yet, matching every other v2 UI unit so far) — needs a pass once v2 gains one.
- [ ] **PXXX-c finding — confirm the "always not_started" Pull-Job bay behavior with Steve.**
  Ported byte-for-byte from legacy's `confirmPullJob`: pulling a specific load onto a bay always
  sets `loading_status: 'not_started'`, even when "Awaiting Queue (no bay)" is chosen (`bay_id:
  null`). A `not_started` row with no `bay_id` doesn't render in any Overview section (Awaiting
  filters on `loading_status === 'awaiting'`, bay columns filter on `bay_id === bay.id`) or in
  Team View's bay list/drill-in — it becomes invisible until someone assigns it a bay or edits
  its status directly. This looks like a pre-existing legacy quirk (not introduced here), not
  touched per AGENTS.md's "don't redesign around a bug you found" rule — flag to Steve next
  contact; a fix (job-level `POST`'s bay-presence-gated status logic already handles the null-bay
  case correctly) would need his sign-off since it changes legacy behavior too.
- [ ] **PXXX-b follow-up — `?shipment=` notification deep link can't resolve.** Legacy's
  `openFromNotificationDeepLink` resolves a shipment id to its job/load via
  `GET /api/shipments?id=<shipmentId>` (single-record lookup). v2's `/v2/api/shipments` route
  only supports `?job_id=` (a list filter), not a single-shipment-by-id mode, so `?assignment=`
  deep-linking was ported but `?shipment=` was not (adding the lookup mode would be an API
  change PXXX-b's own scope excluded). Add an `id=` branch to `GET /v2/api/shipments` (mirroring
  legacy's shape) to close this.
- [ ] **PXXX-c finding — `?assignment=` deep link can't reach an `archived` row.** The
  `include_archived=1`/`showAll=true` fetch-and-filter widening the deep-link resolver applies
  covers every Overview/Team View grouping except `loading_status === "archived"`, which matches
  no section filter in either view, so an archived target still renders nothing to scroll to or
  highlight. Legacy dodges this because it opens the Shipping Info modal directly (no DOM
  membership needed); this port's scroll+highlight approach (a deliberate -b deviation, see
  above) can't. Not fixed here — flagged for Steve alongside the `?shipment=` gap.
- [ ] **Standing parity rule while legacy and v2 coexist**: any change to BOL rendering must be mirrored across BOTH `logistics/bol-shared.js` and `cutting-pilot/src/lib/bolShared.ts` until legacy is archived.
- [ ] **P435 finding — adopt `patch-package` (or equivalent) for `cutting-pilot`.** The local `main` `node_modules` carries an uncommitted, undocumented hand patch to `@opennextjs/aws`'s `dist/plugins/edge.js` (`file.replace(/\\/g, '/')` before embedding an absolute path into a generated `require(...)` string) that fixes a real upstream bug: any Windows build path containing `\x` followed by a non-hex letter (e.g. this repo's own `...\xpanda-...` directory name) is an invalid hex-escape and hard-fails `npm run cf-build`'s "Bundling middleware function" step. Because `node_modules/` is gitignored, this patch isn't captured anywhere and silently vanishes on a fresh `npm install`/clean clone — confirmed by reproducing the failure in a brand-new `v2-logistics` worktree after a clean `npm install`. Not a CI risk today (GitHub Actions builds on Linux, where `path.join` never produces a backslash), but it will bite the next fresh Windows dev checkout the same way it just did here. `patch-package` (generate a `patches/@opennextjs+aws+3.4.0.patch`, add a `postinstall` script) would make the fix survive `npm install`.

### Standing Logistics Backlog

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
- [x] lbz-db-01 — Offload zone schema + API passthrough
- [x] lbz-parse-01 — Parser: offload-zone detection, BDFT checksums, density-conflict flag
- [x] lbz-parse-02 — Offload-zones toggle + manual zone editor, existing-job side
- [x] lbz-pack-01 — Zone/truck sequencing wrapper around the untouched auto-pack algorithm
- [x] lbz-bol-01 — Zoned BOL commodity columns, legacy side (bol-shared.js/bol-editor.js/bol-compose.js)
- [x] lbz-bol-02 — Zoned BOL commodity columns, v2 port (cutting-pilot/src/lib/bolShared.ts, rendering parity only)
- [x] lbz-pack-02 — Boundary gap-fill (shared rows) + column-level zone identity + per-zone edge-cancellation outline + zone-band label clipping
- [ ] Load builder: make initial calculated load view larger, include the stacks visually
- [ ] Load builder DISSOLVE: optional per-piece (sub-line) granularity within a move-group — current P378 checkbox toggles a whole skuCode|height|dest group at once.
- [ ] **P443 follow-up — consider removing the now-vestigial COMPACT LOAD button.** Compaction is
  automatic on move (P443) and on APPLY; the manual button is largely redundant now.
- [ ] **lbz-pack-02 follow-up — a zone whose entire cart gets absorbed by `fillBoundaryGap` (zero
  dedicated rows, pure gap-fill sliver inside another zone's row) can have its zone-strip band and
  label silently dropped.** Found via harness while root-causing the lbz-pack-01 follow-up #3 label
  regression (CHANGELOG) — reproduces on the ORIGINAL pre-lbz-pack-01 packing logic too, so it's not
  new, just newly noticed. `buildTopViewSVG`'s zoned-strip clamp (`drawStartX = Math.max(seg.startX,
  prevEndX)`) assumes each zone's `zoneSegments` extent is roughly its own contiguous territory; a
  zone with no dedicated rows has an extent that's a strict subset of its host row's zone, so once
  the host zone (sorted first by `startX`) claims the full range, the sliver zone's clamped width is
  zero and `svgZoneLabel` never renders. Would need `buildZoneSegmentsFromRows`/the band-clamp to
  treat a gap-filled sliver as belonging to its own zone's band even when it shares a row, not a
  "just change zone order" fix — deliberately not attempted alongside follow-up #3.
- [x] **lbz-pack-01 follow-up — side-by-side zone sharing (density optimization, needs the fence
  lifted).** RESOLVED by lbz-pack-02's boundary gap-fill: a zone segment's partial last row is now
  topped off with the next zone(s)' stacks (chained, delivery order) when there's enough leftover
  width, so a row CAN hold stacks from more than one zone — without lifting the fence.
  `buildRow`/`buildColumn` stayed untouched throughout (confirmed byte-identical); the sharing is
  composed at the wrapper level (`calcZonedLoading`'s `fillBoundaryGap`, calling the untouched
  `calcLoading` against a sub-dims scoped to the leftover gap) rather than by editing the packer
  itself. A stack (column) is still always single-zone by construction — only the ROW can now be
  mixed.
- [ ] **lbz-pack-01 follow-up — Load tab SKU-quantity picker isn't zone-aware.** The Load tab's
  SKU picker (+/−/qty input, ~load-builder.html `buildSkuCard`) assumes one `state.cart` entry per
  SKU (`state.cart.find(c => c.skuId === s.id)` and the +/−/qty handlers all `.map` over every
  entry matching that `skuId`). A zoned job can produce multiple cart entries for the same SKU
  (one per zone, keyed `skuId|offloadSeq|zoneLabel`), so adjusting quantity for that SKU via the
  picker touches every matching zone entry at once instead of just one. Needs a zone-aware picker
  (group by zone, or disable direct qty edits for multi-zone SKUs) — out of scope for lbz-pack-01,
  which only had to wire prefill/wrapper/rendering/customize/save/BOL-handoff.

### BOL Issues

- [ ] **P316 follow-up — editable Scrap Pickup toggle in the BOL compose form.** Currently derived
  from the job's `scrap_pickup` only (`'YES' → is_scrap_pickup: 1`); no manual override at compose
  time.
- [ ] **P241 follow-up — manual relink of unrecoverable orphaned BOL job links.** After running `backfill-bol-job-id.sql`, the verification query reported 84 rows still with `job_id IS NULL`: 52 are pre-P170 rows with no `bol_group_id` (can never be auto-relinked — no recovery key exists); the other 32 (13 distinct `bol_group_id` groups) have a group key but *every* row in the group is orphaned — no sibling had a `job_id` to inherit, so the backfill's sibling-inheritance logic couldn't apply. Needs manual investigation per group/job to relink (or accept as permanently orphaned if the source job can't be identified).
- [ ] **BOL print rendering bug** — when printing the BOL directly (without downloading), the "N" from "Bill of Lading No" and the "S" in "Customer Signature" are clipped/hidden. Parked: root cause is the blank-template artwork + browser print scaling (not our drawn text); needs print-preview testing on a real printer.
- [ ] **P253 follow-up — per-load `shipments` rows.** The job-level `shipments` in_transit/delivered flip is gated on *all* non-archived `loading_assignments` for a job reaching that stage. If a multi-load job with staggered trailer departures/arrivals (days apart) proves the coarse job-level gating is confusing on the logistics dashboard (e.g. "delivered" not showing until the last of several trailers arrives), consider splitting `shipments` to one row per load — larger schema change, needs its own scoped prompt.

---

## Job Board

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
- [ ] **Per-module i18n extraction waves** — sweep in progress (2026-09-03). Phase 1 done: `shared/shared-header.js` (nav/notifications/sign-out/settings chrome on every module page) auto-loads the engine and is fully translated (load-order bug found + fixed same day). Phase 2 (Logistics) DONE (2026-09-04): `logistics/index.html`, `loading.html`, `bol-email.html` fully tagged; `load-builder.html` got a narrower labels/buttons/forms/toasts pass (`logistics/logistics-i18n.js`, 487 keys × en/es/ht) — deliberately excluding the SKU orientation-suffix labels baked into `sku.name` (flow into printed BOL/diagram exports), the `TRAILER_TYPES`/category keys (used as data lookup values elsewhere in the file), and the row/column/layer trailer-customize editor + dissolve-preview modal's algorithmic descriptions (power-user tools, revisit only if flagged). `bol-test.html` (456 lines, dev tool, no header shim) intentionally out of scope. Phase 3 (Job Board) DONE (2026-09-04): `jobs/index.html` fully tagged (new `jobs/jobs-i18n.js`, 276 keys × en/es/ht, wired into `jobs/jobs-header.js`) — deliberately excluding `PROCESSES[].name`/`.abbr` (matched against API data, only the checkbox labels are tagged), the `f-method`/`f-scrap-pickup`/carrier-list option `value` attributes (persisted data), `job.ship_day` itself (persisted English weekday name — display uses a new `getShipDayLabel()`, `getShipDay()` stays untouched), and the Cut List PDF generator (`buildCutListPdf`, printed shipping-floor document, same category as Logistics's excluded BOL/diagram export text). `jobs/packing-slip-test.html` (dev tool) intentionally out of scope. Phase 4 (Manufacturing) DONE (2026-09-04): all three pages tagged (new `manufacturing/manufacturing-i18n.js`, 213 keys × en/es/ht, shared across `index.html`/`block-calculator.html`/`holey-board-calculator.html`, wired into `manufacturing/manufacturing-header.js` which — like `jobs-header.js` before its fix — had no module-catalog `document.write` at all) — deliberately excluding `DIM_NAMES`/`partNameL`/`W`/`H`/`axis`/`zoneName` identifiers (used for `===` comparisons and object-key lookups, stay English; only display copies route through new `axisLabel()`/`machineLabel()` helpers), `buildCutListRows()` and the XLSX export it feeds (exported spreadsheet content, same category as the Cut List PDF and `load-builder.html`'s BOL/diagram exports), and the `"Manual Entry"` sentinel string (persisted marker compared via `!==`, same rationale as `DIM_NAMES`). Phase 5 (Production) DONE (2026-09-04): both pages tagged (new `production/production-i18n.js`, 108 keys × en/es/ht, shared across `index.html`/`bead-inventory.html`, wired into `production/production-header.js` which had the same missing-catalog-wiring gap as every prior module before its fix) — deliberately fixed two dynamic/static `data-i18n`-vs-JS-writer collisions found before commit (the transaction modal's `<h2>` title, and the silo/bead-type "+ Add …" ⇄ "− Cancel" toggle buttons — see `CHANGELOG.md` for the fix approach). Phase 6 (QC) DONE (2026-09-04): all five pages tagged (new `qc/qc-i18n.js`, 188 keys × en/es/ht, shared across `index.html`/`density-calculator.html`/`scrap-log.html`/`incident-report.html`/`final-inspection.html`, wired into `qc/qc-header.js` which had the same missing-catalog-wiring gap as every prior module) — deliberately fixed three dynamic/static collisions found before commit: the `statusPill` status indicator on three pages (static tag dropped, JS seeds it once on init instead — same pattern as Final Inspection's pre-existing `sampleTitle`/`sampleProgress`, which carry interpolated numbers and were never tag-based), `sampleHelp`'s two-state help text (tag kept in lockstep via `setAttribute`), and Scrap Log's submit button (same lockstep-attribute fix as Production's toggle buttons). Deliberately excluded: persisted option `value` attributes (`tolerance`/`productDelivered`/`incidentCategory`/`riskLevel`/`lineMachine`/`scrapReason`/department checkboxes — only visible text tagged), the `"Stephen Cook"` default-value fields (employee name, not UI text), API-loaded customer names (data, per the sweep's standing exception), and Final Inspection's Pass/Fail `Y`/`N` toggle labels (matching the physical approved paper form's notation). No client-side PDF generator was found in Final Inspection — its "controlled PDF record" is built server-side by the Google Apps Script backend. Phase 7 (Reports) DONE (2026-09-04): all 13 pages tagged (new `reports/reports-i18n.js`, 170 keys × en/es/ht, shared across `index.html` and all 12 sub-pages under `scrap/`, `incidents/`, `orders/`, `cutting/`, wired into `reports/reports-header.js` which had the same missing-catalog-wiring gap as every prior module) — this module's fork stalled after 7/13 files (it had front-loaded the full catalog and all 14 new `layout` keys first, so the remaining 6 files + one JS body were finished by hand rather than re-forked). Deliberately excluded as persisted data: incident `type`/`risk_level` (round-trip through URL filter params — only display labels translated), Orders' job `status` enum and Cutting's `board`/`line` values (both `===`-compared against API data and used in `<option value>` — new `labelKeys`/`BOARD_LABEL_KEY` lookups translate only the displayed text), and operator/customer names and handoff/work-item free text. Fixed the same hardcoded-month-array trap found in Job Board, this time in `reports/incidents/trend.html` (replaced with `monthName()` against new `month01`-`month12` keys). Fixed two collision points advisor caught before commit: `incidents/list.html`'s and `cutting/index.html`'s "All Months"/"All Operators" placeholder `<option>` was losing its `data-i18n` tag on rebuild (`innerHTML` regenerated without the attribute) — fixed by setting `data-i18n` in the rebuild template itself, same lockstep-attribute approach as QC/Production's toggle controls. Phase 8 (Admin) DONE (2026-09-04): all 4 pages tagged (new `admin/admin-i18n.js`, 173 keys × en/es/ht) — no `<module>-header.js` shim exists for this module, so the engine was wired via three plain `<script src>` tags added directly to each page's `<head>` (not `document.write` — genuine sequential `<script>` tags block correctly on their own); no language switcher exists on these pages, a deliberate decision (admin renders in whatever language was last selected on a real module page, via `localStorage`). `roles.html` got a `PERM_GROUP_LABEL_KEY`/`PERM_ITEM_LABEL_KEY`/`NOTIF_TYPE_LABEL_KEY` triple translating permission/notification labels while permission dot-path strings stay English (persisted in `role.permissions`/`role.notification_types` JSON), reusing 11 existing module-name keys. `activity-log.html` deliberately excludes `e.summary` (server-composed log text) and `formatDetail()`'s raw JSON, but translates `e.action`/`formatEntityLabel()` via new `ACTION_LABEL_KEY`/`ENTITY_LABEL_KEY` maps (enum values stay untouched). This phase's fork stalled a second time (after Reports), on `activity-log.html` — completed by hand; two catalog gaps (missing `entityJobs`/`entityParts` plurals, missing `actionDelete`) and a `parts.html` category-filter rebuild collision (same class as Reports' option-rebuild bug) were caught during verification and fixed before commit. **Sweep concluded (2026-09-04).** `legal/eula.html`/`legal/privacy.html` (EULA, Privacy Policy) deliberately left English-only — formal contract text, a different risk category from UI copy; Steve's call, not revisited unless requested. `login.html`/`track/index.html` deliberately skipped too: both are a user's first-ever page load (no session yet), so there's no persisted `localStorage['xpanda_lang']` to fall back on the way every other page in this sweep does, and building an actual language picker for them is a separate design decision Steve chose not to take on right now — per his testing, a visitor's browser/device language already gets picked up on these pages regardless. Every module with an internal shared-header or admin-style shim (Logistics, Job Board, Manufacturing, Production, QC, Reports, Admin) is now fully translated. Fast pass, no need for perfection — fix mistranslations later if flagged (2026-09-04 direction, supersedes any per-module native-speaker-review-item expectation). Only customer names are meant to stay untranslated — everything else, including dynamic/JS-generated content, is in scope.
- [ ] **Title/subtitle dead-code override bug on non-Logistics/non-Jobs module pages** — found 2026-09-04 while surveying for the i18n sweep. Fixed on all of Logistics (`index.html` deleted, duplicate of module default; `bol-email.html`/`load-builder.html` load-bearing — added `layout.bolEmailTitle`/`Subtitle` and `layout.loadBuilderTitle`/`Subtitle` keys) and on Job Board (`jobs/index.html`: title line deleted — `layout.jobsTitle` already matches the module default exactly; subtitle load-bearing — added `layout.jobsBoardSubtitle`). Every legacy module index/sub-page sets its own `document.getElementById('<module>-page-title').textContent = '<hardcoded English>'` (and `-subtitle`) *after* `shared-header.js` already sets those elements correctly (and translated) from the `layout.*` catalog — silently overwriting the translation back to English. Fixed on Manufacturing too (2026-09-04): `manufacturing/index.html`'s override duplicated the module default exactly (`layout.manufacturingTitle`/`Subtitle`) — deleted outright; `block-calculator.html` and `holey-board-calculator.html` each had distinct page-specific text — load-bearing, so each got a new `layout.blockCalculatorTitle`/`Subtitle` and `layout.holeyBoardCalculatorTitle`/`Subtitle` key pair and the inline script switched to the guarded `tt()` IIFE pattern. Fixed on Production too (2026-09-04): `production/index.html`'s override duplicated the module default exactly (`layout.productionTitle`/`Subtitle`) — deleted outright; `bead-inventory.html` had distinct page-specific text — load-bearing, so it got a new `layout.beadInventoryTitle`/`Subtitle` key pair and the inline script switched to the guarded `tt()` IIFE pattern. Fixed on QC too (2026-09-04): `qc/index.html`'s title duplicated the module default exactly (`layout.qcTitle`) — deleted outright — but its subtitle didn't match, so it got a new `layout.qcIndexSubtitle` key; `density-calculator.html`, `scrap-log.html` (title only — no subtitle override on that page), `incident-report.html`, and `final-inspection.html` each had distinct page-specific text — load-bearing, so each got its own `layout.densityCalculatorTitle`/`Subtitle`, `layout.scrapLogTitle`, `layout.incidentReportTitle`/`Subtitle`, and `layout.finalInspectionTitle`/`Subtitle` key pair, all converted to the guarded `tt()` IIFE pattern. Fixed on Reports too (2026-09-04), with a twist: `reports-header.js` deliberately passes `pageTitle: ''`/`backLinkLabel: ''` (each sub-page renders its own title/back-link — this is NOT the dead-code bug, it's load-bearing by design, confirmed via matching comments in both `reports-header.js` and `shared-header.js` before touching anything), so all 13 per-page overrides got a new dedicated `layout.*Title` key (14 total, including `incidentDetail`'s subtitle) rather than any being deleted. Still open (all outside Logistics/Job Board/Manufacturing/Production/QC/Reports, which are now fully fixed): none — every module with a `shared-header.js`-based title/subtitle override has been swept. Remaining work is admin's bespoke topbar and the header-shim-less pages (`legal/*`/`login.html`/`track/index.html`), which don't use this override pattern at all and will need their own investigation when reached.
- [ ] **JS-built table/card content doesn't re-render on language switch (`xpanda:langchange`)** — found 2026-09-04 during the Reports i18n phase (advisor-flagged), but present across every module this sweep has touched so far. `shared/i18n.js`'s `apply(root)` walks `[data-i18n]`/`[data-i18n-attr]`/`[data-i18n-placeholder]` and re-runs on `xpanda:langchange`, but rows/cells built by JS via `innerHTML`/template literals at data-load time (Job Board's `renderList`/`buildCard`, Manufacturing's cut-list rows, QC's dynamically-built rows, Reports' `renderTable`/`sessionsTable`/`cutItemsTable`/invoice groups, etc.) carry no `data-i18n` nodes at all — a language switch after data has loaded leaves that content frozen in whichever language was active at render time until the next reload/refetch. Two narrower instances of the same root cause (a rebuilt placeholder `<option>` losing its tag) were fixed directly in Reports (`incidents/list.html`, `cutting/index.html` — see the i18n sweep bullet above), but the general case — full tables/cards — needs a platform-wide fix, not a per-page patch: likely a shared `xpanda:langchange` listener convention that re-invokes each page's own render function. Revisit once the sweep reaches full-module coverage; not blocking since content is correct on load and after any refetch.
- [ ] **Native-speaker review pass on the Safety i18n catalog** (es/ht) — the SDS/training strings are machine-translated; given liability exposure on a safety portal this should get verified by a native speaker before being treated as authoritative. Non-blocking.
- [ ] **Dark mode Bucket A — remaining passes** — P184 audit identified Bucket A hits in Safety (0% token adoption — highest priority), `logistics/load-builder.html` (local token system, separate batch), and `track/index.html` (standalone, no tokens.css). P186 covered all other modules. These three remain for dedicated prompts.
- [ ] (Optional, not required for correctness) Refactor the 29 v2 inline `.replace("T"," ").slice(0,19)` timestamp inserts (across 29 route files, re-counted 2026-09-04) to a shared `nowSqlite()`-equivalent helper in a v2 lib, for mechanism consistency with the legacy side (QC Cleanup-5 left these as-is per the prompt's explicit optionality — they already emit the correct space format, so this is DRY/consistency only, not a bug fix).

---

## Infra / CI-CD

- [ ] Optional: evaluate Cloudflare Workers Builds as the native alternative to this Action.
- [ ] **P446 follow-up — repo-wide CRLF/LF working-tree drift, masked by a stale git index
  stat-cache.** While fixing P446, found ~13 files (`_worker.js/lib/core.js`, `push.js`,
  `routes/{admin,auth,bols,loading,notifications,qc,reports}.js`, `jobs/jobs-header.js`,
  `jobs/packing-slip-parser.js`, `logistics/logistics-header.js` — likely more, this list came
  from a partial scan) whose on-disk content is CRLF-terminated while the committed `HEAD` blob is
  LF-only. Confirmed content is otherwise byte-identical (no hidden uncommitted edits) via
  `git hash-object <file>` vs `git rev-parse HEAD:<file>`, then diffing with CRLF stripped from
  both sides. `git status`/`git diff` report these files clean because the index's cached stat
  entry (size/mtime) happens to match the current CRLF-on-disk size, so git skips re-hashing —
  it's "racily clean," not actually clean. The trap: any edit that changes a file's byte size
  busts that stale cache and makes git suddenly diff the *entire* file (every line touched),
  burying the real change. Low priority (cosmetic, no functional risk — JS doesn't care about line
  endings) but worth a deliberate one-time normalization pass (pick LF, since that's what `HEAD`
  already stores) so future edits to these files produce clean diffs. Do this as its own prompt,
  not bundled with a feature change, so the normalization commit is easy to skip over in `git
  blame`.

---

## Foundation Roadmap — ✅ All phases complete

All Foundation Roadmap phases (F1–F5) have shipped. See `CHANGELOG.md` (Foundation Roadmap section) for entries.

---

## Production / Manufacturing

*(Cutting Dashboard legacy shipped — see `CHANGELOG.md`.)*

### Cutting v2 React pilot (`cutting-pilot/`)

- [ ] Block-calc: per-setup 2D cut diagram (port the legacy Canvas render) — optional polish.
- [ ] Block-calc: optional per-setup secondary/scrap nesting (small parts into a big part's block remnants) — the old single-part secondaries feature, re-expressed per setup, if yield demands it.
- [ ] Cutting route is tribal knowledge (supervisor decides which line cuts which axis; Main Line can chunk, Blue Line can run standalone). Consider capturing the route on the job so chunk/part targets stop depending on unwritten context.
- [ ] Wire scrap capture into `<CompleteLineModal>` once the native scrap DB lands (reason + cubic-in + shift + density; derive operator/inv/line/date from session+job; no Laminate scrap)
- [ ] Material-consumption capture at line-complete — needs a job→block_inventory link + on-hand block picker (block_consumption_log decrements real stock)
- [ ] Cut-list photo polish if asked: multi-photo per session, lightbox zoom, delete/replace, retention cleanup
- [ ] Wire notifications into v2 cutting (depends on a v2 notification backend; triggers: job-done, andon/flag-for-help)
- [ ] Wire "Blocks / chunks required" in the Parts slide-over once block-calculator BOM feeds cutting_lines.qty_target
- [ ] Units/hour throughput once qty entry is routine (qty_done_delta + qty_target) — pair with first-pass yield
- [ ] Throughput/time-tracking report surface (per-line bottleneck rollups across jobs/date range) if a separate analytics view is wanted beyond the on-board badges
- [ ] Cutting v2: port notifications bell + settings gear into `PlatformHeader` once v2 notification backend exists (deferred from P212)
- [ ] Block-calc engine landed as a pure module in P228 (`blockEngine.ts`) + save route + `blocks_needed`. Remaining: the planner screen (P229), non-taper chunk model, per-job block-dimension defaults, regenerate-on-change.
- [ ] Taper blocks-needed (materials pull): compute `ceil(chunks ÷ chunks-per-block)` once a chunks-per-block datum exists.
- [ ] Verify the live `job_line_items.dimensions` taper format matches the P227 regex; widen if needed.
- [ ] Structured taper/chunk geometry capture (chunk L×W×H + kerf) to compute yield instead of manual entry.
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
