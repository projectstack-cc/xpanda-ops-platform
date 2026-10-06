# xPanda Ops Platform — Backlog

> **Process:** When an item ships, its entry moves to `CHANGELOG.md` (keyed to its prompt #) and is
> deleted from `BACKLOG.md`. BACKLOG is forward-looking only. Drift check: diff `Prompts/` against
> `CHANGELOG.md` — any prompt missing from the changelog is a gap.
>
> Shipped items live in `CHANGELOG.md`.

---

## Auth / Session

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

- [ ] Restore UI for soft-deleted production sheets (currently DB-only — `deleted_at` set via
  prod-a-02's manage/sheets delete, no admin view to browse/undelete them).
- [ ] Options admin: rename/reorder dropdown values (retire/restore exists via prod-a-02's
  manage/options PATCH; renaming and manual sort-order changes do not).
- [ ] Expansion sheet supplier/bead type can still be edited after batches (only density is
  locked). The silo's supplier/type come from the lot, so progress is unaffected, but the header
  can disagree with its batches. (found in prod-d-02)
- [ ] Revisit block-weight spec bands after Steve reviews prod-c-04 control limits across
  a real run; consider a per-recipe target + tolerance as recipe v2.
- [ ] Report: consider moving stats server-side if filtered ranges regularly hit the
  5,000-row cap.
- [ ] Consider a tolerance band on recipes once the report's control limits have been
  reviewed (prod-c-04) — Steve declined spec bands for v1.

- [ ] **prod-b follow-up — drop legacy v1 tables** (`silos`, `bead_types`,
  `bead_transactions`) via a separate, held migration once prod-b-04 has shipped and nothing
  references them. Irreversible — own prompt.
- [ ] Silo aging: display-only "time since full" ships in prod-b-03; enforce a minimum age
  before molding once the plant has a confirmed aging target (see eps-engineer-agent §6.6).

---

## Carrier View (v2)

- [ ] **carrier-06 follow-up — linked groups on load-level views assume single-load linked jobs
  (true today).** If a linked job with `load_count > 1` appears, refine the key: group only its
  rows whose trailer matches a groupmate's.

- [ ] **carrier-06 follow-up — Steve eyeball `/v2/schedule` + `/v2/schedule/desk` linked rails**
  after the `linkedGroups.ts` extraction. They should render identically; the selfcheck passes,
  but no browser check was run.

- [ ] **carrier-04 follow-up — refactor the `loading-assignments` v2 route to use
  `src/lib/push.ts`.** It currently skips notifications (deliberately not ported before the push
  port existed).

- [ ] **carrier-04 follow-up — carrier charges: logistics approve/dispute workflow.** Currently
  informational only (append-only rows, read-only on the v2 board).

- [ ] **carrier-03 follow-up — normalize `jobs.delivery_time` to a structured field at entry**
  (v2 orders form) so appointment parsing stops being best-effort.

- [ ] **carrier-02 follow-up — Logistics v2 board: surface carrier-uploaded physical BOL copies**
  (`bol_documents.doc_type='carrier_upload'`) in the shipment detail.

## Shift Notes (v2)

*(No open items — see Icebox.)*

---

## Manufacturing / Cutting (React pilot)

- [ ] **cutting-decouple-01 follow-up — orphaned open sessions after ship.** With the backstop gone, watch for sessions left open on shipped jobs. If it happens in practice, add a manager-facing "close stale sessions" action on the v2 cutting board rather than restoring the backstop.
- [ ] **shift-alert follow-up — pace-based "may not finish".** Once the block-calc BOM populates
  `cutting_lines.qty_target`, gate or annotate the T-2h alert on projected completion (rate from
  `cutting_sessions.qty_done_delta`) instead of "not finished yet".
- [ ] **shift-alert follow-up — notification deep-link for `entity_type='job'`.** `shared/notif-bell.js`
  `DEEPLINKS` has no `job` entry, so these alerts don't click through. Add one to the v2 Job Board order once
  `/v2/board` supports opening a job by id.
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
- [ ] **P309 follow-up — "clock out all" convenience (partially addressed by cutting-signout-01).**
  With multiple concurrent open sessions now possible, an operator wrapping up for the day has to
  stop each stacked `ClockedInBar` one at a time *while still on the board*. `cutting-signout-01`
  added a bulk-stop-all for the **sign-out** trigger specifically (`SignOutSessionModal.tsx` closes
  every open session in one action when the operator chooses to stop before signing out) — this
  item stays open for the separate case of stopping all sessions without signing out, e.g. a
  dedicated "Stop All" action directly on the board/`ClockedInBar` stack.
- [ ] **OpenNext 1.x upgrade (unlocks skew protection).** Steve wants skew protection (2026-10-05),
  but `cutting-pilot` is on `@opennextjs/cloudflare` ^0.3.0 (Next 14.2.5, wrangler 3) and skew
  protection (experimental) only exists in the 1.x line. Scope as its own project: (1) upgrade
  OpenNext 0.3 → 1.x and re-validate the `@opennextjs/aws` patch-package fix and
  `scripts/fix-asset-prefix.mjs`; (2) skew protection needs `run_worker_first = true` (every asset
  request then counts as a Worker invocation — weigh against invocation quota), Workers preview URLs
  enabled, env `CF_WORKER_NAME`/`CF_PREVIEW_DOMAIN`/`CF_WORKERS_SCRIPTS_API_TOKEN`/`CF_ACCOUNT_ID`,
  and a unique `deploymentId` per deploy (`getDeploymentId()`); (3) CI currently runs plain
  `wrangler deploy` — confirm it's compatible. See https://opennext.js.org/cloudflare/howtos/skew
- [ ] Surface completed_qty in the checklist/reports (progress bars per part, first-pass yield) once qty data accrues
- [ ] Cross Cutter / Hole Cutter chunk checklists (replace the shared parts list) once block-calc BOM feeds chunk counts
- [ ] **Cleanup: remove remaining dormant chunk logic** (`cut-plan/save`'s Cross Cutter chunk
  write, the P227 taper Cross Cutter derivation section in `queue/route.ts`) once the standalone
  board (P292–P294) is proven. QC Cleanup-7 already removed the `chunk-target`/`taper-yield`
  routes and the `CHUNK_LINES`-gated branches in `queue/route.ts` + the matching dead UI branches
  in `PartsPanel.tsx`/`CuttingBoard.tsx` (AUDIT-302).

---

## QuickBooks Intake (v2)

> qb-01 shipped (shared `createJob`, QBO client/mapper, admin sandbox import). Remaining milestones:

- [ ] **qb-03 — review queue UI on legacy `jobs/index.html`.** Build against `/v2/api/qb/pending*`:
  - a diff view (header fields + added, removed and changed lines)
  - apply, including the `confirm_overwrite` flow for 409 `platform_edits`, plus clear messaging for
    409 `floor_records` (list the reasons) and 409 `stale` (re-open to refresh)
  - dismiss, and resolve-manual (note required)
  - Notifications are already sent by the qb-02 backend (`qb.review` / `qb.error`).
- [ ] **qb-04 — OAuth connect + callback.** Callback must HTML-escape all reflected values (the old
  one had reflected XSS). State cookie. Production cutover config: redirect URI
  `https://www.xpandaops.com/v2/api/qb/callback`, launch/disconnect URLs, Invoice entity subscription.
  - **Webhook cutover checklist** (Steve + Orchestrator, in Chrome), on the Intuit Webhooks page:
    - [ ] Set the endpoint to `https://www.xpandaops.com/v2/api/qb/webhook`.
    - [ ] Enable the CloudEvents toggle.
    - [ ] Subscribe Invoice Create, Update, Void and Delete.
- [ ] **qb-05 — CDC reconciliation sweep.** The webhook returns 200 before processing, so Intuit never
  retries a processing failure. Add a periodic sweep using QBO `ChangeDataCapture` for Invoice since the
  last sweep, feeding the same `processEvents` path. Needs a cron trigger on the v2 Worker. This is
  the safety net against silent drift.

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
- [ ] OrderEditModal opens falsely dirty when any line has no part: the load mapping uses `part_id ?? undefined`
  (dropped by JSON.stringify) but `buildCurrentSnapshot` uses `part_id || null` (`"part_id":null`). Pre-existing;
  noticed while verifying slip-parse-03 — make both sides `?? null`.
- [ ] v2 offload-zone editor for existing jobs (legacy PUT /api/jobs/:id/zones + zone editor) — v2 can create/preserve zones but not edit them.
- [ ] packingSlip.ts parity gap: v2 has no `reassemblePageBreaks` (legacy lbz-parse-01) — a row whose
  QTY re-flows onto the next PDF page parses differently in v2. Real zoned slips (4404) hit this. Port
  verbatim + add a two-page fixture to `scripts/packing-slip-parity.mjs` (found during slip-parse-05).
- [ ] Packing-slip parser rewrite (anchor-relative extraction + per-vendor template registry) —
  P340 ported the existing y-coordinate/x-gap heuristic parser as-is into v2; the more robust
  rewrite is still a separate, future effort (applies to both legacy and v2 copies).
- [ ] **v2 per-surface i18n extraction** (P442 shipped the `src/lib/i18n.ts` + `LangProvider`/
  `useLang` spine and a bounded 6-string proof-slice on `OrderEntryForm.tsx` only; prod-a-03 fully
  wired the Production Log board) — the rest of `OrderEntryForm.tsx` (dropzone, ship-to, process
  toggles, line items), plus `/v2/board`, `/v2/schedule`, `/v2/loading`, `/v2/carrier`,
  `cutting-pilot`'s blocks/notes surfaces each still need their own `catalog` entries registered
  and their strings wired through `t()`.
- [ ] **Expose `LangSelect` in `PlatformHeader` for all v2 pages** — prod-a-03 shipped
  `components/LangSelect.tsx` and rendered it only in the Production board's own top bar (not
  `PlatformHeader`, per that prompt's scope). Folds in the older "decide whether v2 needs its own
  language selector" question (P442 deliberately shipped none): a `PlatformHeader`-level selector
  would cover every v2 page, including ones reached by a direct deep link that skips the legacy
  home page's language selector.
- [ ] Extract the shared dashboard title block and the empty / error / loading state cards into
  `components/dashboard/` — board-ui-01 copied the logistics markup into `ProductionBoard.tsx` rather
  than extracting them (only the toolbar, day header and StatTile were shared).
- [ ] **sched-shifts-02 follow-up — `/v2/board` Job Board redesign: if shift chips are added to the list/cards, hide them via `isCuttingComplete()` (lib/schedule-status.ts) for parity with schedule + legacy board.**
- [ ] Decide whether v2 should ever set `processes[].completed` (currently only legacy pills do; unused
  in live data). board-lines-01 preserves the flag server-side but never sets it.

---

## Schedule Board (v2)

*(All shipped items moved to `CHANGELOG.md` — 2026-09-04 backlog cleanup.)*

- [ ] **sched-dual-01 follow-up — Steve/production supervisor eyeball: dual pills on TV + desk (narrow column, multi-load "Loading X of Y" + Cutting).**
- [ ] **Pre-existing ladder gap (not changed by sched-dual-01):** a job with some lines complete and the rest not_started (none in_progress, no session) reads "Not Started". Decide whether that should be "In Production – x%".
- [ ] **sched-mobile-01 follow-up — StatusBadge + detail modal on phones.** `StatusBadge` was left at TV sizing on mobile (out of scope); bump it if it reads small on a real phone. Eyeball `OrderDetailModal` at 390px.
- [ ] **sched-mobile-01 follow-up — Steve phone eyeball of /v2/schedule/desk.**

## Loading Board (v2)

- [ ] Extract a shared `components/tv/` (freshness-clock) used by `/v2/schedule`, `/v2/loading` and (prod-d-04) `/v2/production/tv` — a third board with its own LoadingBoard-style freshness logic (2-min stale) plus a copy of ScheduleBoard's cursor hide — currently each board is self-contained. (The pixel-shift half of this item was moot as of P304; the logo-sweep half is moot as of P306 — both removed from both boards entirely. Only the freshness clock remains a duplication candidate.)
- [ ] **P263 follow-up — late/at-risk highlighting on the schedule board.** Explicitly out of scope for the first UI pass; would need a definition of "late"/"at-risk" (vs. `ship_date`? vs. status stalling?) before scoping.

---

## Logistics (v2)

- [ ] **split-days-01 follow-up — legacy `/api/loading-assignments/load-days` still returns success on 0 matched rows** (left per v2-only rule; legacy Job Board split modal is the remaining caller).
- [ ] **split-days-01 follow-up — per-load ship days don't move when the order's ship date changes.** Moving an order's date leaves any `loading_assignments.ship_date` overrides behind. Today this is harmless for unsplit orders (ignored), but a split order would keep its old days. Decide: clear overrides on order-date change, or shift them by the same delta.
- [ ] **INV 4386 — shipment status stuck `ready_to_ship` while its only load is `delivered`** (after the 9/29 delivered→not_started revert and the 9/30 re-delivery). Investigate the revert/redeliver path's shipment status sync.
- [ ] **archived-hide-01 follow-up — legacy Classic shipment dashboard still shows archived pre-departure shipments.** Left as-is per the v2-only logistics rule; goes away when legacy `logistics/index.html` retires.
- [ ] **quickwin-01 follow-up — v2 Parts Library edit form can now expose name/weight/color/category/parent_group.** `PartsLibraryPanel.tsx` still renders these read-only (its header comment cites the old PUT limitation); `PUT /api/parts` now persists them when sent. Widen `buildUpdatePayload` + the edit form, and update that comment.
- [ ] **tls-01: `nextShipDay` is Mon–Fri only.** Plant holidays aren't modeled, and an occasional Saturday ship
  date never appears on the Load Verification sheets.
- [ ] **tls-01: Load Verification sheet pickup can print `—` on a cold cache** when an address is beyond the
  per-request ORS warm cap (3). A reprint fills it in.
- [ ] **tls-02: Marina Foam is matched by name** (customer / ship_to_company contains "marina foam"). If the TV
  loading board or the per-order loading sheets should also hide sister-company deliveries, reuse
  `isSisterCompanyDelivery()`.
- [ ] **`shipments.trailer_number` is dead for job-linked shipments** (trailer # lives on
  `loading_assignments` since lgx-rows-01). Drop the column once legacy `logistics/index.html` is retired.
- [ ] **logi-rollout-02: give Invoice Analytics (and Load Builder) their own middleware lines
  before removing the `/v2/logistics` dark-launch rule.** Otherwise the pages fall through to
  `logistics.dashboard` while their APIs stay on `logistics.v2`.
- [ ] **v2 zone-column editing follow-up.** `bolEditorEngine.ts`'s editor has no zone-column boxes
  at all yet (legacy's `zoneCol0…N` per-column editing has no v2 equivalent) — noted again while
  scoping `bol-style-03`, which deliberately did not add zone-column styling to v2 for this reason.
  Also noted while scoping bol-wysiwyg-03: v2 has no `zcZoneData` concept at all, so unlike legacy
  (which skips the `commodity` box when a BOL is zoned), v2's `positionAll` always draws an
  editable commodity box — on a zoned BOL that box sits over columns the operator can't coherently
  edit through it. Same root cause, same fix (this follow-up), not a separate bug.
- [ ] **Invoice Analytics — unit F: legacy bridge card.** Surface a link/summary card into the legacy LISMA-spreadsheet-adjacent pages so staff still on the old workflow can find the new tool.
- [ ] **Invoice Analytics history date-range filter** (needs `/v2/api/logistics/flags` to accept `?from/&to`) — deferred.
- [ ] **Invoice dedup Replace isn't atomic.** `POST /v2/api/logistics/invoice`'s clean-replace
  (resolve → `DELETE FROM freight_invoice_lines` → persist) is 3 separate D1 calls, not one
  transaction — if a `persistLine` INSERT fails partway through the persist loop, the old rows are
  already gone and only partial new rows exist. `DB.batch([...])` would make it atomic but needs
  `persistLine` restructured to return a statement instead of executing it.
- [ ] **Invoice Analytics — native driving-distance for multi-stop lines.** v1 excludes `multi_destination` lines (multiple BOL tokens resolving to different ZIPs on one invoice line) from stats entirely rather than computing a real multi-stop route distance.
- [ ] **Invoice Analytics — no Seal Express sample invoice was available to validate unit D's PDF parser.** Only one real vendor sample (`26.03 Lisma Invoice Details 4611.pdf`) exists in the repo; the column-detection logic is written to the same vendor-agnostic rule the prompt specifies for both vendors, but Seal's actual layout was never exercised. Get a real Seal invoice and re-run the same end-to-end validation (parse → `extractBolTokens` → token count) before trusting it blind.
- [ ] **Unit 2 follow-up — BOL delete doesn't clean up `bol_documents`/R2 objects.** `bols/[id]/route.ts`'s new single-BOL `DELETE` matches legacy's own single-delete route exactly, including this gap: only legacy's separate bulk per-job delete branch (`bols.js:567-595`) cleans up `bol_documents` rows and their R2 objects. Deleting a BOL through the new UI (`BolViewerModal.tsx`'s BOL History panel) leaves orphaned document rows/R2 objects behind, same as legacy's single-delete always has. Not a regression, but worth fixing in both places if Steve wants it addressed.
- [ ] **Fuel surcharge uses the BOL's primary ship-to only.** Multi-stop / zoned trucks would need per-stop mileage if the carrier bills that way. (Follow-on from lgx-fuel-02.)
- [ ] **Hoist shared pdf-lib helpers** (`wrapText`, `drawRight`, `hr`, logo embed) out of `cutList.ts` / `loadingSheet.ts` into one lib. Must stay pixel-parity for the cut list. (Follow-on from lgx-loadsheet-01.)
- [ ] **Loading sheet per-trailer split:** only possible once line items carry a load assignment (load builder plan persisted per job). Revisit with v2 load builder rollout. (Follow-on from lgx-loadsheet-01.)
- [ ] **Load builder v2 (`/v2/logistics/load-builder`) still dark after lgx-roll-01.** Un-dark by deleting its `logistics.v2` middleware line, then repoint Build Load / Load Builder links.
- [ ] **Legacy `logistics/index.html` edit form still shows Method and still can't edit job-owned fields.** Retire with the legacy dashboard rather than patching. (Follow-on from lgx-editmodal-01.)
- [ ] **Retire legacy `logistics/index.html`** once v2 has run a few weeks without fallback use. At retirement also remove the home Logistics card's "Classic Dashboard" button (`index.html`) and its `common.classicDashboard` i18n key, and repoint `logistics/logistics-header.js` `dashboardPath`.
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
- [ ] **`lb-ui-04` follow-up — confirm whether `bols/route.ts`'s "wrangler dev writes hit production" header comment is still accurate.** This prompt found local `next dev` (via `getCloudflareContext()`'s `getPlatformProxy`) uses a fully local, isolated Miniflare SQLite D1 emulation (`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`), not a live connection to prod or the declared `preview_database_id`. This may not actually conflict with that comment (`wrangler dev --remote` does hit prod; the comment may predate the current toolchain/describe a different invocation) — flagged as needing confirmation rather than asserted wrong, and not edited (`bols/route.ts` is out of this prompt's fence).
- [ ] **Sprint Phase 3 — enable `lb-ui-05`'s deferred on-the-fly part-creation write path.** Legacy's `prefillFromJob` creates a new part via `POST /api/parts` when a line item matches nothing; this sprint's port surfaces the unmatched line as a warning instead and does not write. Re-enable once Steve has reviewed the sprint's Phase 2 integration testing and the unfenced-`/api/parts` risk (see the sprint charter's "one sprint-wide exception").
- [ ] **`lb-ui-05` follow-up — export `packEngine.ts`'s `colorForSku` instead of duplicating it.** `jobPull.ts`'s `colorForSkuId` is a byte-for-byte copy of `packEngine.ts`'s private, unexported `colorForSku` (same palette, same hash) so the job-pull preview's swatches match the eventual trailer-diagram colors. `packEngine.ts` is closed/ratchet-guarded so this prompt couldn't export it directly — worth doing in a future dedicated engine prompt to remove the duplicate. (2026-09-16: `TrailerDiagram.tsx` now renders the per-SKU colors that were already being computed — column border stripes + a per-trailer legend — so the on-screen gap this item worried about is closed; this item itself stays open, since it's about the `colorForSku`/`colorForSkuId` duplication, which is unchanged.)
- [ ] **`lb-ui-05` follow-up — `GET /api/load-builder-skus` needs its own permission grant at Phase 3 rollout.** That legacy route is gated by the `logistics.load-builder` key (`_worker.js/lib/core.js:213`); it works today only because `/v2/logistics*` is admin-only and admins bypass permission checks (`middleware.ts`'s dark-launch gate). When Phase 3 grants `logistics.v2` to a non-admin role, that role also needs `logistics.load-builder` (view) or `JobPullModal` dead-ends on "Couldn't load the SKU library." Not currently named in the sprint charter's Phase 3 checklist — add it there when Phase 3 is scoped.
- [ ] **`lb-ui-06` follow-up — Force Sizes still needs new engine work before a UI can wire it.** (Auto-downsize, the other half of this item as originally written, shipped via `lb-ui-12` — see `CHANGELOG.md`.) Step 0 re-grepped `packEngine.ts` for `forceSize`/`variant` — zero real matches (`variant` only appears as a substring of "invariant"). Legacy's remaining trailer-option toggle has no engine-side concept to bind to; scoping a `lb-engine-NN` prompt for forced-size logic is a prerequisite, not a UI task.
- [ ] **`lb-ui-06` follow-up — `PackOptions.isFlatbed` is declared but never read anywhere in `packEngine.ts`.** Reserved, not implemented — confirmed by grep before this prompt wired anything. If flatbed strap-orientation logic (legacy: `load-builder.html:1444-1516`) turns out to matter, it needs engine work first; do not add a UI toggle for it until the engine reads the field.
- [ ] **`TrailerDiagram.tsx` has no runner visualization** — `lb-ui-06`'s runner-height control is real (it changes `packOptions.runnerHeight` and the header text notes `· N" runners`), but the diagram itself draws nothing for it. Legacy draws a brown runner strip under every stack plus a "▬ N″ runners" legend, both on-screen (`load-builder.html:1083`/`1108`) and in print (`:1149`/`1158`). Out of `lb-ui-06`'s fence (`TrailerDiagram.tsx` isn't in it), but matters for `lb-ui-08` (print/export parity) — name it now, build it there.
- [ ] **`lb-ui-08` follow-up — `CustomizeEditor.tsx`'s Print/Export button never gets an invoice number**, unlike `LoadPlanView.tsx`'s (which has `fixture.invoiceNumber` free in scope). Threading a per-trailer invoice number into edit mode would need a new prop through `CustomizeEditorProps` for one cosmetic PDF-subtitle field — skipped as out of proportion to this prompt's scope; not a functional gap (the PDF still generates correctly, just without the INV# line in edit mode).
- [ ] **`lb-ui-10` follow-up — CSV paste-import deferred.** Legacy's SKU tab has a real copy/paste-import feature (`toCSV`/`fromCSV`, `load-builder.html:548-571`, wired to N sequential `/api/load-builder-skus` POSTs via `importSkus`). Not ported: N sequential writes to production with no dry-run and no undo is exactly the class of action the sprint charter's "one sprint-wide exception" section says needs Steve directly involved, not something to ship unsupervised. `partsLibrary.ts`'s Part C spec allowed deferring this explicitly.
- [ ] **`lb-ui-09` follow-up — `bolShared.ts`'s new `loadingDiagramPdfBytes` merge option has no live combined-PDF caller.** Same status as its sibling `packingSlipPdfBytes`, which was ALSO found to be dead code this session (`bolDomGlue.ts`'s `buildCombinedBolPdf` does its own separate packing-slip merge and never threads either option through `generatePdf`). Both are proven correct by `bolShared.selfcheck.ts`'s `runBolSharedPdfMergeSelfCheck` and ready for a future prompt that brings `bolDomGlue.ts`/`BolViewerModal.tsx` into scope to actually wire them into the live "View BOL" combined-packet render.
- [ ] **`lb-ui-09` follow-up — no dock assignment exists yet for a load-builder-sourced BOL, so `trailerNo` starts blank on every trailer** (the planner fills it in by hand during the BOL form). Once a load is dock-assigned (loading dashboard, a separate v2 unit), there's no automatic link-back to pre-fill a BOL generated from Load Builder before that assignment happens — expected given the two flows aren't sequenced together yet, named here in case Steve wants that connected later.
- [ ] **`lb-ui-07` follow-up — no "add a trailer from nothing" entry point.** `pack()` never emits a zero-row trailer, `TrailerDiagram`'s "Edit…" button has nothing to render against when `plan.trailers.length === 0`, and this prompt's locked operation list has no "add trailer" op. Matches legacy's own manual-editor limitation (it only ever opens against an existing trailer) but is worth naming since `lb-ui-06` made small/zero-fit presets more reachable. The from-scratch build path (`addRow`/`addColumn` from an empty shell) is verified headlessly and works — only the UI entry point is missing.
- [ ] **`lb-ui-07` follow-up — row reorder and row-level base-SKU swap not ported.** Legacy's manual editor also has row reorder ↑/↓ (`load-builder.html:2390-2397`) and a row-level base-SKU selector that rewrites every column's width in that row at once (`:2381-2388`). Neither is in this prompt's locked scope; `moveColumn` covers column-level repositioning but not whole-row reordering or a bulk per-row SKU swap.
- [ ] `CustomizeEditor.tsx`'s keyboard target-picker (`handleChooseTarget`) commits a move with no `canDrop` pre-check at all (width or depth) — only the drag-hover path gets live feedback today. A keyboard-driven move can still trigger `row-width`/`trailer-length` guards after the fact, same as any move, but the picker never warns before confirming the way dragging does.
- [ ] Dissolve's holding→trailer depth risk is not covered by the `lb-ui-03` `canDrop` fix (`from` is optional and omitted for that path) — a held column dropped into a shallow row can still overflow a downstream row with no pre-drop warning, only the post-apply guard banner.
- [ ] Dissolve doesn't recompute `packEngine.ts`'s tall/narrow `"[stability: ...]"` rationale note for a receiver column it newly makes tall/narrow — that logic lives inside closed `packEngine.ts` (`applyStabilityWarnings`) and dissolve only preserves an existing note, it doesn't add a new one.
- [ ] **Floor-test `/v2/logistics/loading` before retiring legacy `logistics/loading.html`.** Unit 3b's dock dashboard is writes-LIVE but unlinked (v2 visibility gate) and its `wrangler dev` smoke against scratch bindings is still owed (unit 3a's `preview_database_id` was a placeholder when 3b was built — see its `CHANGELOG.md` entry). Run the scratch smoke pass, then floor-test against real data before wiring it into nav or retiring the legacy page. Still dark after lgx-roll-01 (`logistics.v2`); dashboard's Dock Loading button points to legacy.
- [ ] **Unit 3b follow-up — i18n for the new dock dashboard labels.** `DockAssignmentCard.tsx`/`AssignBayModal.tsx`/`LoadedChecklistModal.tsx`/`DockBoard.tsx`/`TeamView.tsx`/`BayListItem.tsx`/`ShippingInfoModal.tsx`/`PullJobModal.tsx`/`PhotoGalleryModal.tsx` ship English-only strings (v2 has no i18n spine wired yet, matching every other v2 UI unit so far) — needs a pass once v2 gains one.
- [ ] **PXXX-c finding — `?assignment=` deep link can't reach an `archived` row.** The
  `include_archived=1`/`showAll=true` fetch-and-filter widening the deep-link resolver applies
  covers every Overview/Team View grouping except `loading_status === "archived"`, which matches
  no section filter in either view, so an archived target still renders nothing to scroll to or
  highlight. Legacy dodges this because it opens the Shipping Info modal directly (no DOM
  membership needed); this port's scroll+highlight approach (a deliberate -b deviation, see
  above) can't. Not fixed here — flagged for Steve alongside the `?shipment=` gap.

### Standing Logistics Backlog

- [ ] **P332 follow-up — periodic reconcile/health-check for orphaned loading cards.** Consider a
  lightweight periodic job that flags any job whose non-archived `loading_assignments` count exceeds
  its `load_count`, so future regressions in the reconcile/backfill/adopt paths surface proactively
  instead of silently accumulating orphan `awaiting` cards again.
- [ ] **P325 follow-up — harden `/api/loading-assignments/load-days`** to return matched-row count
  and warn on 0-row saves.
- [ ] **P271 follow-up — `loading_assignments.archived_at`.** Apply the same orthogonal-archive
  treatment (P271) to `loading_assignments.loading_status = 'archived'` (site L24 in
  `status-write-site-inventory.md`) — same two-facts-one-column defect, but lower-stakes since the
  stage timestamps (`delivered_at`/`in_transit_at`/`loaded_at`) survive the overwrite independently.
- [ ] Load builder: make initial calculated load view larger, include the stacks visually
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
- [ ] **lbz-pack-01 follow-up — Load tab SKU-quantity picker isn't zone-aware.** The Load tab's
  SKU picker (+/−/qty input, ~load-builder.html `buildSkuCard`) assumes one `state.cart` entry per
  SKU (`state.cart.find(c => c.skuId === s.id)` and the +/−/qty handlers all `.map` over every
  entry matching that `skuId`). A zoned job can produce multiple cart entries for the same SKU
  (one per zone, keyed `skuId|offloadSeq|zoneLabel`), so adjusting quantity for that SKU via the
  picker touches every matching zone entry at once instead of just one. Needs a zone-aware picker
  (group by zone, or disable direct qty edits for multi-zone SKUs) — out of scope for lbz-pack-01,
  which only had to wire prefill/wrapper/rendering/customize/save/BOL-handoff.

### BOL Issues

- [ ] **bol-lock-01 follow-ups — viewer/server lock divergence edges.** (a) Both viewers read loading
  assignments behind `logistics.loading` view; a user with BOL access but not loading access falls back to the
  job-level lock in the viewer (stricter than the server, so never unsafe, but in-transit jobs hide Edit for
  them). (b) Legacy `/api/loading-assignments` hides customer-pickup jobs, while the server lock and v2
  `?job_id=` don't filter by method; a stale assignment row on a customer-pickup job could make legacy show the
  fallback lock where the server applies the per-load rule. Consider a dedicated per-BOL `locked` flag on the
  `/api/bols?job_id=` response so viewers use the server's answer directly.
- [ ] **Trailer override shadowing (bolc-01 follow-up).** A `render_overrides.trailerNo` set in the BOL editor shadows trailer back-writes (see `_worker.js/routes/loading.js` comment near the trailer back-write). Same class as bolc-01/02; evaluate promoting it the same way.
- [ ] **P316 follow-up — editable Scrap Pickup toggle in the BOL compose form.** Currently derived
  from the job's `scrap_pickup` only (`'YES' → is_scrap_pickup: 1`); no manual override at compose
  time.
- [ ] **P241 follow-up — manual relink of unrecoverable orphaned BOL job links.** After running `backfill-bol-job-id.sql`, the verification query reported 84 rows still with `job_id IS NULL`: 52 are pre-P170 rows with no `bol_group_id` (can never be auto-relinked — no recovery key exists); the other 32 (13 distinct `bol_group_id` groups) have a group key but *every* row in the group is orphaned — no sibling had a `job_id` to inherit, so the backfill's sibling-inheritance logic couldn't apply. Needs manual investigation per group/job to relink (or accept as permanently orphaned if the source job can't be identified).
- [ ] **BOL print rendering bug** — when printing the BOL directly (without downloading), the "N" from "Bill of Lading No" and the "S" in "Customer Signature" are clipped/hidden. Likely the same unembedded-template-font substitution bol-print-01 fixed (templates re-saved with fonts embedded) — re-check during the bol-print-01 normal-print acceptance test and close if gone.
- [ ] **bol-print-02 — draw BOL QR as a single path (merged runs) instead of per-module rectangles; latent print-seam risk.** Both `bol-shared.js` and `bolShared.ts` (bilateral parity).
- [ ] **bol-print-01 follow-up — fontkit missing on two legacy BOL pages.** `jobs/index.html` and `logistics/loading.html` call `BolShared.generatePdf` but don't load `@pdf-lib/fontkit`, so their BOLs take the unembedded-Helvetica fallback (and have never drawn the cursive signature). Add the same fontkit `<script>` the other logistics pages use.
- [ ] **bol-print-01 follow-up — BOL PDF size.** Template fonts are still duplicated per page (one `copyPages` per record), and v2 `buildCombinedBolPdf` copies three `generatePdf` outputs into one packet, so Liberation Sans lands 3× (3-copy, 2-record packet ≈ 2.76 MB). If size matters (email attachments), render all three copy passes into one document, or load each template once.
- [ ] **bol-print-01 follow-up — BOL Email size cap.** A single embedded-font driver BOL is ~1.2 MB (was ~292 KB), ~1.6 MB base64 in `logistics/bol-email.html`'s attachments, so one Resend send (40 MB cap) now fits ~25 BOLs (was ~100). If a day exceeds that, chunk the send or share one font-embedded document across attachments.
- [ ] **bol-print-01 follow-up — layout-font cache pins the fallback.** `getLayoutFonts()` (both sides) caches its result, so one failed body-font fetch keeps editor measurement on Helvetica for the session even though the byte loader retries. Low impact (metrics differ only by kerning).

---

## Job Board

- [ ] v2 edit surface for HB floor stock (hb_on_hand) — OrderEditModal/OrderDetailModal have no
  way to set it; needs a `/v2/api/orders/:id/hb-on-hand` route mirroring legacy
  `PUT /api/jobs/:id/hb-on-hand`.
- [ ] HB nester is hole-pattern-agnostic and floor-stock uncut chunks are job-level (not per
  8/10-hole) — confirm with the floor whether chunks are holed before slicing; if so, nest + net
  per hole pattern.
- [ ] **P387 follow-up — alias table for made-to-order / customer-worded parts.** Packing-slip
  match audit corpus still has unresolved lines needing a dedicated alias table (Spa Cover `ITEM#`
  keys, block variants, laminate) — separate prompt, not touched by P387/P389.
- [ ] **P387 follow-up — HB base lines with no stated thickness (21 in corpus).** Left unmatched
  by design in P387; decide handling (default thickness? flag for manual review?).
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
- [ ] When the hole-cutter dashboard reaches the floor, switch `/v2/schedule`'s chunk display from
  required to on-hand vs cut (`hc_slots`).

---

## Admin / Platform

- [ ] Remove temporary `pages.dev` → `xpandaops.com` redirect from `_worker.js/index.js` once all internal links/bookmarks confirmed updated.
  Decision 2026-10-05: hold until access logs confirm no traffic on the pages.dev
  host (Pages analytics filtered to that host, or a temporary log line + wrangler tail).
- [ ] Breakdown job board permissions into more granular sub-modules *(easier after F3 audit + F1a shared header — both now done)*
- [ ] Dashboard KPIs / metrics panel — homepage widget showing jobs by status, BOLs generated this week, shipments pending/in-transit/delivered, most-used parts *(adds new endpoints)*
- [ ] Scrap batch entry tool *(density calc now centralized in shared-utils.js — safe to add)*
- [ ] **JS-built table/card content doesn't re-render on language switch (`xpanda:langchange`)** — found 2026-09-04 during the Reports i18n phase (advisor-flagged), but present across every module this sweep has touched so far. `shared/i18n.js`'s `apply(root)` walks `[data-i18n]`/`[data-i18n-attr]`/`[data-i18n-placeholder]` and re-runs on `xpanda:langchange`, but rows/cells built by JS via `innerHTML`/template literals at data-load time (Job Board's `renderList`/`buildCard`, Manufacturing's cut-list rows, QC's dynamically-built rows, Reports' `renderTable`/`sessionsTable`/`cutItemsTable`/invoice groups, etc.) carry no `data-i18n` nodes at all — a language switch after data has loaded leaves that content frozen in whichever language was active at render time until the next reload/refetch. Two narrower instances of the same root cause (a rebuilt placeholder `<option>` losing its tag) were fixed directly in Reports (`incidents/list.html`, `cutting/index.html` — see the i18n sweep bullet above), but the general case — full tables/cards — needs a platform-wide fix, not a per-page patch: likely a shared `xpanda:langchange` listener convention that re-invokes each page's own render function. Revisit once the sweep reaches full-module coverage; not blocking since content is correct on load and after any refetch.
- [ ] **Native-speaker review pass on the Safety i18n catalog** (es/ht) — the SDS/training strings are machine-translated; given liability exposure on a safety portal this should get verified by a native speaker before being treated as authoritative. Non-blocking.
- [ ] **Dark mode Bucket A — remaining passes** — P184 audit identified Bucket A hits in Safety (0% token adoption — highest priority), `logistics/load-builder.html` (local token system, separate batch), and `track/index.html` (standalone, no tokens.css). P186 covered all other modules. These three remain for dedicated prompts.

---

## Infra / CI-CD

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
- [ ] Wire notifications into v2 cutting (v2 dispatch now exists: `src/lib/push.ts`, carrier-04; triggers: job-done, andon/flag-for-help)
- [ ] Wire "Blocks / chunks required" in the Parts slide-over once block-calculator BOM feeds cutting_lines.qty_target
- [ ] Units/hour throughput once qty entry is routine (qty_done_delta + qty_target) — pair with first-pass yield
- [ ] Throughput/time-tracking report surface (per-line bottleneck rollups across jobs/date range) if a separate analytics view is wanted beyond the on-board badges
- [ ] Cutting v2: port the settings gear into `PlatformHeader` (deferred from P212). The notifications-bell half shipped in notif-bell-01 (`NotificationBell.tsx` mounts the shared `/shared/notif-bell.js`).
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

---

## Icebox — revisit only if triggered

> Items here are recorded, not scheduled. Each one is conditional ("if the carrier asks",
> "if it comes up on the floor", "optional"). Pull an item back into its module section only when
> its trigger actually happens. Tags show the section each item came from.

- [ ] [Production Log (v2)] Manual silo correction to a new lot sets `density` NULL, so that fill's `full` event doesn't
  count toward expansion schedule progress. Revisit if managers correct fills in practice.
  (found in prod-d-02)
- [ ] [Production Log (v2)] History date filter is on sheet log_date; a sheet spanning midnight files all its
  rows under its start date. Revisit only if it matters in practice.
- [ ] [Production Log (v2)] Deleting an expansion/molding row does not roll back silo state (e.g. deleting the batch
  that started a fill leaves the silo `filling`). Currently fixed via manager silo correction;
  revisit if it happens in practice.
- [ ] [Carrier View (v2)] **carrier-05 follow-up — Schedule tab: add a Next-week view if Seal asks.** The data is
  already available (the second tab from `currentAndNextShipWeekTabs`).
- [ ] [Carrier View (v2)] **P368 follow-up — per-bay dock instructions (deferred).** The appointment/ETA half shipped
  in carrier-03 (appointment, drive time, suggested pickup on each tile). Revisit dock
  instructions if the carrier asks.
- [ ] [Shift Notes (v2)] **P359 follow-up — v2 activity-log parity for notes.** `logActivity()` is legacy-worker-only;
  v2's `/v2/api/notes` POST/mark-viewed don't write to the shared `activity_log` table. Revisit if
  Steve wants an audit trail for shift notes.
- [ ] [Manufacturing / Cutting (React pilot)] **Block-nesting width step-down end-cap view** (deferred unless testing requires) — P411's
  `ChunkElevation.tsx` surfaces width step-downs only in the table's `Part W×L` column; a true
  end-cap (front-face) diagram is a follow-on, not built here either.
- [ ] [Manufacturing / Cutting (React pilot)] Taper Cross Cutter chunk auto-derivation (`taper_yield`) no longer feeds any board — Cross
  Cutter tasks are now assigned manually on `/v2/cutting/crosscutter`. Revisit if auto-derivation is
  wanted there.
- [ ] [Orders (v2)] Cut list sign-off block is English-only (PDF excluded from i18n by design) — add
  Español/Kreyòl labels if floor feedback asks for it. (Follow-on from cutlist-01.)
- [ ] [Orders (v2)] Promote the Job Board's `StatusModal` to `StatBreakdownModal`-style breakdown parity with the
  logistics KPI tiles, if wanted (board-ui-01 kept `StatusModal` as-is).
- [ ] [Loading Board (v2)] **late-pickup-02 follow-up — edited `delivery_time` doesn't re-alert.** `late_pickup_notified_at` is never reset, so if an order's `delivery_time` is edited after it already alerted, a re-slipped pickup won't notify again. Revisit only if needed.
- [ ] [Loading Board (v2)] **late-pickup-01 follow-up — no pickup when drive time isn't cached.** The TV board reads `geocode_cache` only (never ORS); a bay load whose address the Carrier View never warmed shows no pickup and can't go late. Revisit only if that turns out to happen on the floor.
- [ ] [Loading Board (v2)] **P263 follow-up — per-day totals on the schedule board** (load count / bdft sum per `DayColumn`) if useful once the board is in daily use.
- [ ] [Loading Board (v2)] **P261 follow-up — no `UNIQUE(invoice_number, ship_week, day_of_week)` on `schedule_rows`.** The 1/5 migration didn't add one, so the poller's upsert is done in application code (select-then-insert/update) rather than SQL `ON CONFLICT`. Works fine at 15-min-cron scale, but if `schedule_rows` ever gets a second writer, add the unique index and switch to a real upsert.
- [ ] [Carrier View (v2)] **carrier-03 follow-up — ORS driving time is car-profile.** Revisit an HGV profile or tune the
  1-hr buffer after a few weeks of real pickups.
- [ ] [Logistics (v2)] **Shipment Dashboard Distance/ETA — extract shared geocode-cache orchestration if a 4th
  consumer appears.** `resolveOrigin`/`resolveDestRoute`-style cache read/write logic is now
  duplicated three times (`invoice/route.ts`, `invoice/resolve-line/route.ts`,
  `shipments/distances/route.ts`), each a deliberate self-contained copy to avoid risking the
  live invoice-ingest path. Fine at 3; revisit if a 4th consumer needs the same pattern.
- [ ] [Logistics (v2)] **Shipment Dashboard Distance/ETA — `driving-hgv` truck-profile lane.** Today's
  miles/duration use ORS's `driving-car` profile (free-flow, no traffic) for both Invoice
  Analytics and the Distance/ETA field, labeled accordingly in the UI. A truck-accurate
  profile would need its own cache columns/keys (can't reuse `miles_from_origin`/
  `duration_sec_from_origin`, which are car-profile) — deferred until Steve wants it.
- [ ] [Logistics (v2)] **Shipment Dashboard Distance/ETA — optional Calendar-view warm pass.** Calendar view
  and List's "Show All" deliberately never trigger ORS resolution (cache-only display) to
  avoid an unbounded cold-cache loop; they'll only show real values once the default List +
  This-Week view has warmed those addresses. Revisit if Steve wants Calendar to populate
  independently (would need its own bounded/paginated warm strategy, not a blanket unlock).
- [ ] [Logistics (v2)] **Invoice Analytics — manual "Resolve unmatched" is single-destination only.** The Resolve
  popup (Upload + History) collapses a multi-destination line to one BOL # + one address, which
  discards the originally extracted BOL tokens (`bol_numbers` becomes a single-entry array). Fine
  for a genuinely single-stop line that failed to auto-match; a manually "resolved" multi-stop
  line loses its other stops. Revisit if this turns out to matter for a real multi-destination
  unmatched line.
- [ ] [Logistics (v2)] **History: multi-invoice month header polish.** `/v2/api/logistics/month`'s fallback invoice
  header for a month with >1 distinct invoice (`vendor: "Multiple"`, `invoiceNumber: "<n> invoices"`,
  `invoiceDate: <month>`) is untested against a real multi-invoice month — today there's exactly 1
  invoice/month. Revisit `MatchRateBanner`'s rendering of that fallback once a month actually holds
  several invoices.
- [ ] [Logistics (v2)] **Financials tab: vendor breakdown widget** — deferred until multi-vendor data exists (currently 1 vendor).
- [ ] [Logistics (v2)] **Invoice dedup residual edge** — same-month invoice under a different/blank `invoice_number`
  is not flagged (relies on stable parsed invoice numbers); revisit if parser numbering proves
  unstable.
- [ ] [Logistics (v2)] **Invoice export: PDF export option / branded print header** — deferred. PXXX-k shipped
  browser print (`window.print()`) + XLSX export for both the per-invoice/per-month view and an
  annual rollup; a true PDF export and a branded (logo/letterhead) print header were named in the
  prompt as future-nice but out of this pass's scope.
- [ ] [Logistics (v2)] **Unit 2 follow-up — Generate BOL modal dropped "Include packing slip"/"Include Loading Diagram".** Neither had a v2 endpoint in unit 2's scope (packing-slip bytes live in the Job Board; the Loading Diagram comes from Load Builder, unit 3). Revisit once those units exist, if Steve wants parity restored.
- [ ] [Logistics (v2)] **Unit 2 follow-up — no v2 `bol-customers` address-book search.** Legacy's Generate BOL flow has a customer search panel (`GET /api/bol-customers`) that autofills ship-to fields and sets `customer_id`; v2's `BolGenerateModal` has no equivalent endpoint yet, so `customer_id` is always sent `null`. Build `/v2/api/bol-customers` (read-only) and wire the search panel back in if Steve wants this restored.
- [ ] [Logistics (v2)] **`lb-ui-04` follow-up — the fenced GET-sweep could instead filter expired rows in the `SELECT` (`WHERE expires_at >= ?`) rather than gating the `DELETE` on the write flag.** Same zero-divergence outcome (v2 never shows expired rows) at zero write risk, since it never touches the fence question at all. Not made — the gated-`DELETE` approach was already reviewed and is correct as shipped — but worth considering if Steve would rather v2 never show stale rows even pre-Phase-3.
- [ ] [Logistics (v2)] **`lb-ui-08` follow-up — the empty-diagram-area "remaining floor" region has no visual fill/label inside the diagram itself.** Legacy's SVG shades the unused-length region and centers a "N remaining" label inside it; this prompt's PDF only captions the same fact below the diagram (`"636"L × 98"W — 10' 8" remaining"`), a deliberate simplification to keep the diagram box's layout math simple. Revisit if Steve wants closer visual parity.
- [ ] [Logistics (v2)] **`lb-ui-08` follow-up — the pieces/stack-breakdown tables clip instead of scaling or paginating when a trailer has many distinct SKUs or stack patterns.** Fixed page height budget below the diagram is ~258pt at a 14pt row height, so roughly 17 rows before content runs off the bottom of the page — a mixed load with many distinct SKUs or stack patterns can reach that. Legacy's `html2canvas`-rasterized path scaled the whole print HTML to fit one page instead of clipping; this prompt's vector approach has no equivalent fit-to-page step. Neither of this session's two bundled fixtures reached the limit (4 and 2 pieces-table rows respectively), so it wasn't hit in practice, but it's a real gap worth a fix (auto-shrink row height, or a second page) if Steve's Phase 2 pass turns up a load that clips.
- [ ] [Logistics (v2)] **`lb-ui-09` follow-up — a load-builder-sourced BOL's trailers all start with IDENTICAL ship-to/carrier/contact/PO/date prefill**, with no per-trailer override UI beyond hand-editing each page. This matches the existing dock-assignment path's own behavior exactly (not a regression introduced by this prompt — that path has always prefilled every trailer identically too), but is worth naming as a shared limitation if Steve wants a "carry from trailer 1, override trailer 2+" UI later.
- [ ] [Logistics (v2)] **`lb-ui-09` follow-up — checking "Include Loading Diagram" on multiple trailers opens one `window.open` per trailer across a loop with an `await` between each**, which can lose the click's original user-gesture context after the first round-trip; browsers are more likely to pop-up-block tab 2+ than the single-tab case `LoadingDiagramPrintButton.tsx` already handles cleanly. The existing `!opened` form-error message covers it per-trailer (tells the planner to allow pop-ups) but doesn't prevent the block. Worth a batched/sequential-with-confirmation UI later if this proves annoying in Phase 2 testing.
- [ ] [Logistics (v2)] **`lb-ui-07` follow-up — cross-row layer drag not ported.** Legacy's manual editor lets a layer be dragged from one column directly into another, including across rows, with auto-cleanup of the emptied source column/row (`load-builder.html:2412-2438`). Not in this prompt's locked operation list (`addRow`/`addColumn`/`addLayer`/`setLayerCount`/`removeRow` only) — today the equivalent requires zeroing the layer in its source column (returns it to unplaced balance) and re-adding it via `addLayer` on the target, which is not a true relocation (it round-trips through the balance bucket instead of moving directly). Revisit if Steve's floor testing flags this as a real workflow gap.
- [ ] [Logistics (v2)] **P392 follow-up — emit `loading_assignment` entity_type from `public.js`'s in_transit/delivered
  dispatch instead of `shipment`.** Would let future shipment-status notifications skip the
  `/api/shipments?id=` → `job_id` → assignment resolve hop entirely. Existing ~850 historical
  `shipment`-typed notification rows still need the resolve path either way, so this is a nicety,
  not a requirement. Also consider routing shipment notifications to a dedicated shipment-tracking
  dashboard instead of the Loading Dashboard, if that becomes the more natural landing page.
- [ ] [Logistics (v2)] Customer database (full CRUD) — icebox: revisit once all orders are entered here first, or it becomes a necessity
- [ ] [Logistics (v2)] Consider separate dashboards for staff vs. management (TV display)
- [ ] [Logistics (v2)] Load builder DISSOLVE: optional per-piece (sub-line) granularity within a move-group — current P378 checkbox toggles a whole skuCode|height|dest group at once.
- [ ] [Logistics (v2)] **P253 follow-up — per-load `shipments` rows.** The job-level `shipments` in_transit/delivered flip is gated on *all* non-archived `loading_assignments` for a job reaching that stage. If a multi-load job with staggered trailer departures/arrivals (days apart) proves the coarse job-level gating is confusing on the logistics dashboard (e.g. "delivered" not showing until the last of several trailers arrives), consider splitting `shipments` to one row per load — larger schema change, needs its own scoped prompt.
- [ ] [Job Board] **P364 follow-up — legacy BOL viewer modal (`jobs-bol-view-modal`) has no explicit Print
  button.** It only has Download (relies on the browser's native in-frame PDF toolbar for print).
  P364 gave the v2 shared `PdfViewer` explicit Download + Print controls instead of relying on that
  native toolbar (unreliable on tablets); the legacy BOL modal is now the odd one out. Low priority
  — add an explicit Print button (`iframe.contentWindow.print()`, same pattern as v2) if it comes up
  on the floor.
- [ ] [Job Board] **P272 follow-up — unarchiving a legacy `status='archived'` row leaves it in a limbo state.**
  Manual Unarchive now only clears `archived_at`, never writes `status` (P272, by design — a job's
  real status should be restored exactly as it was). But for the finite legacy population backfilled
  by P271 (real prior status unrecoverable), `status` is still literally the string `'archived'` —
  unarchiving one of these clears `archived_at` but leaves `status='archived'`, which isn't a real
  Kanban/list status (won't render in any Kanban column, shows a raw "archived" label in List view,
  isn't in the editable-status set). Not destructive, and the legacy population shrinks over time as
  new archives stop hitting this path — but if it comes up in practice, the fix is a small one-time
  prompt (e.g. force such rows to a sane default like `'done'` on unarchive, with a toast explaining
  why).
- [ ] [Job Board] Optional: map `/api/holey-chunks/preview` → a permission key in `API_PERMISSION_MAP`
  instead of relying on its QC Cleanup-11 entry in `UNMAPPED_API_MUTATION_ALLOWLIST`
  (`lib/core.js`). No longer an accidental fail-open (the route is now explicitly allowlisted
  with a documented reason and unmapped mutations are denied by default elsewhere), just still
  not tied to a module permission — tidy later if desired.
- [ ] [Job Board] Optional: `/api/notifications` (PUT .../read), `/api/push/subscribe`, and
  `/api/push/unsubscribe` are self-scoped-to-caller mutations with no `API_PERMISSION_MAP`
  entry — QC Cleanup-11 added them to `UNMAPPED_API_MUTATION_ALLOWLIST` in `lib/core.js` rather
  than a module permission key, since none of the existing module keys (jobs/logistics/qc/etc.)
  fit a cross-module personal-notification feature. Revisit only if a dedicated "notifications"
  module permission is ever wanted; today any authenticated user can use these three, which
  matches current UI behavior (notification bell + push opt-in are shown to everyone).
- [ ] [Job Board] Optional: surface the 51" chunk-height selection at order entry (nester already
  parameterized).
- [ ] [Job Board] Optional: converge `holey-board-calculator.html` onto the shared endpoint (kill the last
  client-side copy of the packing math).
- [ ] [Admin / Platform] (Optional, not required for correctness) Refactor the 29 v2 inline `.replace("T"," ").slice(0,19)` timestamp inserts (across 29 route files, re-counted 2026-09-04) to a shared `nowSqlite()`-equivalent helper in a v2 lib, for mechanism consistency with the legacy side (QC Cleanup-5 left these as-is per the prompt's explicit optionality — they already emit the correct space format, so this is DRY/consistency only, not a bug fix).
- [ ] [Infra / CI-CD] Optional: evaluate Cloudflare Workers Builds as the native alternative to this Action.
- [ ] [Manufacturing / Cutting (React pilot)] Hard enforcement on the Work Queue (P259) — block clock-in on lower-priority jobs while higher-priority ones sit incomplete. Deferred by decision; P259 is guide-only (every job stays clickable).
