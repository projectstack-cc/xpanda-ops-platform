# xPanda Ops Platform — Changelog

> **Process:** When an item ships, its entry moves to `CHANGELOG.md` (keyed to its prompt #) and is
> deleted from `BACKLOG.md`. BACKLOG is forward-looking only. Drift check: diff `Prompts/` against
> `CHANGELOG.md` — any prompt missing from the changelog is a gap.

Entries within each module are ordered by prompt # descending (newest first).

---

## Manufacturing / Cutting (React pilot)

- **P322** — Scaffolded the new **Block Nesting** module at `/v2/blocks` (successor to legacy
  `manufacturing/block-calculator.html`, which stays live/untouched). New `manufacturing.blocks`
  permission (GET→view, mutate→edit), no manager-only tier. `src/app/blocks/page.tsx` (server
  shell mirroring `cutting/crosscutter/page.tsx`) + `BlocksApp.tsx` (placeholder client component).
  `src/middleware.ts` gained `/v2/api/blocks` and `/v2/blocks` prefix entries. `PlatformHeader.tsx`
  gained a "Block nesting" `NAV_MODULES` entry (shape modeled on the existing Schedule entry — the
  cutting boards have no `NAV_MODULES` entry of their own by design). `admin/roles.html` gained the
  `manufacturing.blocks` label. Legacy `_worker.js/lib/core.js` **not touched** — confirmed its
  `PATH_PERMISSION_MAP`/`API_PERMISSION_MAP` carry zero `/v2/*` entries at all (its
  `manufacturing.cutting` rows are for the legacy `cutting-dashboard.html` page and legacy
  `/api/cutting`, not `/v2/cutting`); the v2 middleware is the sole enforcer for `/v2/blocks`, same
  as every other v2 module. Scaffold only — no engine, no parser, no DB, no migration (module is
  ephemeral by design, now and in P323/P324). `tsc --noEmit` + `cf-build` green.
- **P309** — Operators may now clock into multiple `/v2/cutting` jobs concurrently — the one-open-session-per-operator limit is gone. `DB_Migrations/drop-cutting-sessions-operator-index.sql` drops P280's partial `UNIQUE` index (`idx_cutting_sessions_one_open_per_operator`) — run via `wrangler d1 execute --remote` against production D1 before this shipped. `clock-in/route.ts`: removed the `mineOpen` guard (the read-then-409 check across the whole board) and the batch-insert catch that swallowed that index's violation to fake an `already_clocked_in` 409 — any other error (including a genuine `cutting_lines` UNIQUE violation) now propagates to the outer 500 handler untouched, as it always should have. The per-`(job_id, line)` `line_busy` guard is unchanged — one operator per line at a time, still enforced. `my-session/route.ts` now returns every open session for the operator (`{ sessions: [...] }`, `.all()` instead of `.first()`) instead of just one. `CuttingBoard.tsx`: `mySession` → `mySessions` array; the sticky bar renders one `<ClockedInBar>` per open session (P309 also moved the `fixed inset-x-0 bottom-0` positioning out of `ClockedInBar.tsx` into a new parent stacking wrapper, since two bars can't both own that same fixed position); removed the now-dead "you're clocked in elsewhere" flow entirely (`resolvePrompt` state, its confirm `<Modal>`, and the `already_clocked_in` branch in the clock-in handler — clock-in no longer returns that error); `myLineOnJob` (which line's checklist sidebar to show) now derives directly from the selected job's own lines rather than a single board-wide "current session" that could point at the wrong job; `LineRow`'s `clockedInElsewhere` prop is now always `false` (being clocked in elsewhere is no longer a reason to flag a line — that concept is exactly what this prompt removes). `tsc --noEmit` + `cf-build` + the post-build `custom-worker.ts` typecheck all green.
- **P308** — Read-only "Cutting Instructions" (from P307's new `jobs.cutting_instructions` column) now shows on the `/v2/cutting` selected-job detail Sheet, between the invoice/PO/ship meta line and the Tracked-time readout. `queue/route.ts`'s job SELECT gained `j.cutting_instructions` — no separate payload-assembly edit was needed since both the per-job map and the final per-job queue object build their return value via `{ ...job, ... }` spreads, so the new column flows through automatically once selected. `CuttingJob` type gained `cutting_instructions: string | null`. Rendered only when non-empty (`?.trim()`), reusing the platform's existing `--info-bg`/`--info-border`/`--info-text` callout tokens (already used the same way in `LineRow.tsx`, `CrossCutterQueue.tsx`, `HoleCutterSlots.tsx`) with `whitespace-pre-wrap` for line breaks — strictly read-only, no inputs, no handlers. `tsc --noEmit` + `cf-build` green.
- **P296** — Renamed operator-facing Clock In/Out to Start/Stop on the `/v2/cutting` board (`LineRow.tsx`, `HandoffModal.tsx`, `ClockedInBar.tsx`, `CuttingBoard.tsx`) — visible strings, toasts, and modal titles only. API paths (`/clock-in`, `/clock-out`), function/variable names (`onClockIn`, `clockOutTarget`, etc.), and "Complete" labels are unchanged. Matches the Start/Stop naming already used on the new `/v2/cutting/crosscutter` board. `tsc --noEmit` + `cf-build` green.
- **P295** — Narrowed `/v2/cutting` to Main Line / Blue Line only; Cross Cutter + Hole Cutter relocated to the standalone board (`/v2/cutting/crosscutter`, P292–P294), Laminate dropped from v2 cutting entirely. `PROCESS_ORDER` narrowed identically in `queue/route.ts`, `clock-in/route.ts`, and `complete-line/route.ts` (`["Cross Cutter", "Hole Cutter", "Main Line", "Blue Line", "Laminate"]` → `["Main Line", "Blue Line"]`) — the queue builds its returned `lines` array from `job.requiredLines`, which is filtered against `PROCESS_ORDER`, so any pre-existing Cross Cutter/Hole Cutter `cutting_lines` rows are simply no longer surfaced (not deleted). Chunk logic left dormant for later cleanup: `CHUNK_LINES`, the taper Cross Cutter derivation, `chunk-target`, `taper-yield`, and `cut-plan` endpoints are all untouched and self-skip with no Cross Cutter line in scope. `tsc --noEmit` + `cf-build` green.
- **P294** — New standalone `/v2/cutting/crosscutter` board (consumes the P293 API): tabbed Cross Cutter / Hole Cutter surface, thin server shell (`page.tsx`) rendering `PlatformHeader` + client `ChunkBoard`. Cross Cutter tab is a manager-orderable assignment queue (`CrossCutterQueue.tsx`) — Start/Stop/Complete per row, `busy_by` shown when another operator holds it, and manager-only controls (create, inline edit, delete, up/down reorder) hidden entirely when `can_manage` is false. Hole Cutter tab (`HoleCutterSlots.tsx`) shows the two fixed slots (8-hole/10-hole) with on-hand + total-holed counts, same Start/Stop/Complete loop, Complete copy made explicit that inventory persists. New `ChunkStopModal.tsx` (composes the existing `<Modal>` primitive) handles both Stop variants — cc: chunks-done-this-run; hc: holed-this-run + required on-hand count. No copy-paste modal; no hardcoded colors; tokens + `font-mono tabular-nums` throughout; ≥44px touch targets; designed loading/empty/error states. Verified: `tsc --noEmit` clean, `cf-build` green, and confirmed live against local `wrangler dev` — unauthenticated page request 307s to `/login.html` (same pattern as `/v2/cutting`) and the two new GET routes return 401 JSON, matching the auth gate.
- **P293** — API + permission wiring for the standalone Cross Cutter / Hole Cutter chunk boards (tables from P292). New permission key `manufacturing.cutting.manage` gates `/v2/api/cutting/manage/*` (added above the general `manufacturing.cutting` prefix in `middleware.ts` — order matters, first match wins); middleware also injects `X-User-Can-Manage-Cutting` so route handlers and the future UI (P294) know whether to allow manager actions (defense-in-depth: routes re-check the header too). New routes: `GET cc-assignments`/`GET hc-slots` (reads, general `manufacturing.cutting`), `POST chunk-session/{start,stop,complete}` (operator actions — one open chunk_session per operator across both boards, 409 `already_running`/`line_busy`), and manager-only `POST manage/cc-assignments`, `PATCH|DELETE manage/cc-assignments/[id]`, `POST manage/cc-assignments/reorder`. Fully decoupled from jobs — no `jobs.status` writes, no `cutting_lines`/`cutting_sessions` touches. Admin label added to `admin/roles.html`. `tsc --noEmit` + `cf-build` green.
- **P292** — Added `DB_Migrations/chunk-boards.sql`: standalone `cc_assignments`, `hc_slots` (seeded 8-hole/10-hole), `chunk_sessions` for the new Cross Cutter/Hole Cutter task board. Decoupled from jobs; manual D1 run required before P293 deploy.
- **P291** — Restored priority sorting in the v2 cutting work queue (reverts P290) and restricted the queue to active jobs (`status IN not_started, in_production`) so shipped/delivered/loaded/in_transit/done jobs no longer surface as work. Fixes stale-job pollution seen in soft rollout.
- **P290** — Temporarily disabled priority sorting in the v2 cutting work queue; queue now orders flat by ship_date then invoice_number. Original ordering preserved as an in-place comment for manual revert.
- **P284** — v2 cutting queue now excludes archived jobs via `j.archived_at IS NULL` (P271/P272's orthogonal archive signal) rather than relying solely on a literal `status='archived'` that post-P272 archives no longer write; the literal term is retained as a fallback for the legacy backfilled population, and `shipped` remains a genuine status test, untouched. `my-session` (P282) intentionally keeps no status filter, so an operator clocked into a now-excluded job can still clock out via the sticky bar. WHERE-clause-only change. `tsc --noEmit` clean; `cf-build` green.
- **P283** — v2 cutting clock-in now catches the `UNIQUE constraint failed` raised by P280's partial index (`idx_cutting_sessions_one_open_per_operator`) and returns the existing 409 `already_clocked_in` (in P282's enriched shape, via a re-query ordered `started_at ASC` to match `my-session`) instead of a 500. Narrow `try` around the `DB.batch` call only — `cutting_lines` carries its own UNIQUE constraint and an unrelated violation there must keep failing as a 500, so the catch two-pronged matches the index name plus a `UNIQUE constraint failed` + `cutting_sessions` fallback, and explicitly rethrows anything else. The pre-existing `mineOpen` guard is retained as the cheap common-case path; this closes only the true race (double-tap, two devices) that slips between the guard's SELECT and the INSERT. `tsc --noEmit` clean; `cf-build` green.
- **P282** — v2 cutting authoritative my-session endpoint + sticky clocked-in bar, fixing two ways an operator could get stuck with no way to clock out. **Orphaned sessions:** the board derived "am I clocked in?" solely from the job-status-filtered queue, so a session on a job that got archived, marked shipped, or had its process pills unchecked survived in D1 but vanished from the board — `POST /clock-in` kept 409ing `already_clocked_in` forever with no route to close it. New unfiltered `GET /v2/api/cutting/my-session` (`LEFT JOIN jobs`, no status filter, oldest-open-session-first) is the new source of truth, polled on the same refresh cycle as the queue. New bottom-anchored `<ClockedInBar>` renders whenever `mySession` is non-null — invoice/customer/line, Clock Out button, and a warning strip when `orphaned` (closes the session only, no job resurrection) — so the operator always has a way out regardless of what the filtered queue shows. Also: `clock-in`'s 409 now carries `job_id` + `session_id` so the toast can point at the bar instead of a bare line name; and fixed BUG 5 — `openClockOut` hardcoded `jobId: selectedJob?.id`, which would have reconciled the wrong job's parts list when clocking out from the bar while a different job was selected (now takes an explicit third `jobId` arg, sourced from `mySession.job_id`). `clock-out/route.ts` needed no change — already guards session ownership/open-status correctly and does no job-status write, which is exactly what orphan clock-out requires. Elapsed-time readout on the bar deferred (see `BACKLOG.md`) — `formatDuration`'s underlying UTC parser isn't exported from `src/lib/time.ts`, which was out of scope here. `tsc --noEmit` clean; `opennextjs-cloudflare` build green; `queue/route.ts` confirmed untouched.
- **P281** — v2 cutting session ownership now determined by `operator_id`, not display name. `CuttingBoard`/`LineRow` compared `open_operator_name === userName` client-side (`X-User-Name` is `display_name || username`), which broke three ways: two operators sharing a display name saw each other's session as their own, a blank name on both sides matched every open session, and any name drift (edited after clock-in, case, whitespace) made the operator's own session invisible — no Clock Out button, while `POST /clock-in` kept returning 409 `already_clocked_in`, stranding the operator. Queue route now selects and emits `open_operator_id` alongside the existing `open_operator_name` (name stays on screen — operators still need to see who holds a busy line); `CuttingBoard` stops discarding `userId` and both it and `LineRow` compare `open_operator_id === userId`, gated on `!!userId` so a blank `X-User-Id` can't match a blank `operator_id` and reintroduce the same bug in a new form. `tsc --noEmit` clean, `opennextjs-cloudflare` build green.
- **P280** — D1: enforce one open cutting session per operator. `clock-in/route.ts` guarded "one open session per operator" with a read-then-write SELECT/INSERT and no unique constraint or index behind it — a double-tap or two devices logged in as the same operator could pass the SELECT twice and open two sessions, leaving a permanent orphan the operator can't see or close. New `DB_Migrations/add-cutting-sessions-operator-index.sql`: a partial `UNIQUE INDEX` on `cutting_sessions(operator_id) WHERE status = 'open'` (the real enforcement — closed sessions stay unconstrained) plus a non-partial `(operator_id, status)` index for `my-session`/clock-in lookups. File is copy-paste-ready with no comments (Steve pastes the whole file into the D1 console); the pre-flight audit query and duplicate-remediation `UPDATE` were provided in-conversation instead, to run first if any operator holds more than one open session — the unique index creation fails outright otherwise. `add-cutting-sessions.sql` untouched (already applied in production; new index ships as its own migration). No application code changed — catching the resulting `UNIQUE constraint failed` in `clock-in/route.ts` to return the existing 409 `already_clocked_in` response is a follow-on (see `BACKLOG.md`). Verified by running the migration against a scratch SQLite stub table (not D1): parses clean, rejects a second open session per operator, allows unlimited closed history, idempotent on re-run.
- **P259** — Ranked "Work Queue" section pinned above the search/week toolbar in the v2 cutting left nav: sources the already-priority-sorted `queue` (unfiltered, so the true next-up always shows regardless of the this-week/search filter), keeps only jobs with incomplete cutting lines, shows the top `WORK_QUEUE_SIZE` (5), ranked 1..5. Reuses `JobRow` with a new optional `rank` prop (rank chip, rank 1 gets accent emphasis) — no forked row component. Guide only: every job stays clickable here and in the unchanged full list below (no clock-in locking). New `WorkQueue.tsx`; `CuttingBoard.tsx` renders it between `QueueHeader` and the toolbar. No API route, no DB, no `wrangler.toml` change. `tsc --noEmit` + `cf-build` green.
- **P258** — Legacy backstop for missed clock-ins: once a job is provably past cutting (`loaded` / `in_transit` / `delivered` — the granular shipment/loading-assignment status, since `jobs.status` can't distinguish `loaded` from `loading`), a shared helper force-completes any dangling v2 `cutting_lines` and closes any still-open `cutting_sessions` for that job. New `completeCuttingLinesForJob(db, jobId, reason)` in `_worker.js/lib/cutting-lines.js`, called from all three legacy delivery/loading write-points: the logistics dashboard shipments PUT (`routes/jobs.js`), the loading board PUT (`routes/loading.js`), and the driver QR confirm (`routes/public.js`, always `delivered`). Writes ONLY `cutting_lines` + `cutting_sessions` — never `jobs.status` (the caller already advanced the job; running the all-lines-complete→job-done cascade here would be a wrong downgrade). Idempotent (`line_status != 'complete'` guard), no INSERT of missing rows (a job never tracked in v2 has nothing to complete), every call site wrapped in try/catch so a backfill failure never breaks the delivery/loading response. No migration — `cutting_lines`/`cutting_sessions` already exist. `node --check` clean on all four touched files.
- **P257** — "Already clocked in" resolver: tapping Clock In on a line while clocked into a different job now opens a confirm dialog ("You're clocked into #\<invoice>. Clock out of #\<invoice>?") instead of a disabled button — composes the existing `<Modal>` primitive, no copy-paste. Clock Out routes into the normal `HandoffModal` completion flow (note/qty/part reconciliation) for the *session's* job, since the operator may be viewing a different job than the one they're clocked into (`clockOutTarget` widened with `jobId`; clock-out reconciliation and part list now source from the session's job via `queue.find`, not `selectedJob`). After clock-out: stop — no auto-clock-in to the tapped job. Job identified by `invoice_number` (flagged for review if a different field is wanted). Client-only — no server round-trip, no new endpoint; `CuttingBoard.myOpen` already had the answer. `LineRow`'s Clock In button is no longer disabled when clocked in elsewhere (tooltip updated). Existing `already_clocked_in` 409 toast kept untouched as a safety net. No migration, no API route, no `wrangler.toml` change. `tsc --noEmit` clean; `opennextjs-cloudflare` build green.
- **P242** — Manual chunk target for the Cross Cutter: chunk counts are a handling decision (manageable size + curing acceleration), not a geometry output, so they are entered by hand rather than derived. New `POST /v2/api/cutting/chunk-target` writes `cut_plan_lines.qty_target` for Cross Cutter and mirrors it to Hole Cutter when that line is routed (bare `UPDATE` self-mirrors, since the queue GET only creates rows for required lines); taper jobs are refused (409) — `cut_plan_lines.taper_pair` is a reserved column that's never written, so the route derives taper status from `job_line_items` the same way `queue/route.ts` does (P227), rather than trusting the unpopulated column — and taper jobs keep their derived `ceil(parts ÷ taper_yield)` target from P227. `PartsPanel`'s "Chunks required — coming soon" placeholder replaced with the input plus an "N chunks out of M blocks" readout against `cut_plans.blocks_needed` (P228). Fabricator jobs — Cross Cutter as the only routed line — label the unit "parts" (display-only; `unit` stays `'chunk'` in D1). No migration; no engine change. `tsc --noEmit` + `cf-build` green.
- **P239** — Priority-aware cutting queue: sort is now `rush DESC, priority_level DESC, ship_date ASC, invoice_number ASC`, consuming P238's `priority_level` (0–3) and the reused `priority='rush'` pin; read-only RUSH / Elevated / High / Critical badge on `JobRow` (tokens only, no badge at level 0). Priority is authored on the job board — v2 never writes it, so no new route. Queue SELECT already carried `j.priority`; the mapper's `...job` spread carried the new column through with no payload-assembly change. `tsc --noEmit` + `cf-build` green. **Requires P238's migration in D1 before deploy.**
- **P233** — v2 cutting per-line throughput readout (qty · wall · active): job-detail `LineRow` now shows a raw-numbers line below the header — `qty_done[/qty_target] unit · wall <elapsed> · active <elapsed>` — whenever `qty_done > 0`. No computed rate; managers read the ratio themselves, since Cross/Hole (chunks) and Main/Blue/Laminate (parts) aren't comparable in one number. Queue payload gains `qty_done`, `first_started_at`, `done_at` per line (derived from existing `cutting_lines.qty_done` and `cutting_sessions` MIN/MAX, no migration). New `lineWallSeconds` in `@/lib/time` (first clock-in → done, live-ticking until complete, frozen after); reuses the existing `lineLiveSeconds` chip for active time. First-pass yield still deferred (blocked on native scrap DB). `tsc --noEmit` + `cf-build` green.
- **P231** — Fix v2 cutting queue 500 past ~100 active jobs (`D1_ERROR: too many SQL variables`): all 8 `WHERE job_id IN (…)` reads in `GET /v2/api/cutting/queue` bound every active job ID in one statement, exceeding D1's 100-bound-parameter limit — the same class of bug P187 fixed in the legacy worker. Added an `allByJobIds` helper that chunks `jobIds` at 90 and concatenates results; routed all eight reads (cutting_lines, open sessions, last-handoff MAX join, line items, cut_plan_lines, cut_plans, tracked-duration SUM, checklist progress) through it. Safe for the aggregate queries: jobIds are sliced disjointly and every GROUP BY keys on job_id, so per-chunk grouping equals global. `placeholders` const removed. No schema/migration/UI change. `tsc --noEmit` + `cf-build` green.
- **P230** — Cutting v2 block-calc multi-part cut list: the planner now plans a whole order, not one part. New child table `cut_plan_setups` (one row per part/block config); `cut_plans` stays one-per-job and its `blocks_needed` becomes the SUM across setups (queue route + taper logic unchanged). `BlockPlanner` rewritten from single-primary-plus-scrap to an add/remove list of parts — each with its own block (copy-forward default), per-part `N/block · M blocks`, prefill from job line items, and a live order-total block count; it rehydrates saved setups on open (new `GET /v2/api/cutting/cut-plan/setups`) so re-saving replaces the full list instead of wiping parts. Save route rewritten to accept `setups[]`, recompute each server-side via `blockEngine`, replace `cut_plan_setups` wholesale, and write the summed `blocks_needed`; manual Cross/Hole chunk targets preserved. **Run `add-cut-plan-setups.sql` in D1 before deploying the worker.** `tsc --noEmit` + `cf-build` green.
- **P229** — Cutting v2 block-calc planner screen (finalize part 2/2): new `BlockPlanner` modal (reuses the `<Modal>` primitive, extended with an additive `size?: "md" | "lg"` prop) launched via a "Cut Plan" button in the job-detail header. Runs the P228 `blockEngine.runFullCalc` client-side for live results (parts/block, blocks-needed, utilization, produced, surplus); inputs for block L×W×H, kerf (default 0.079), orientation (auto/fixed), an editable primary part with best-effort prefill parsed from each job line item's `dimensions`, add/remove secondary parts, and optional manual Cross/Hole chunk counts. Save POSTs to `POST /v2/api/cutting/cut-plan/save` (server recomputes authoritatively), then refetches the queue and toasts — the dashboard's blocks-needed populates immediately. No 2D cut diagram (later). The block calculator is now floor-usable in v2. `tsc --noEmit` + `cf-build` green.
- **P228** — Cutting v2 block-calc engine (TS) + persistence + save route (finalize part 1/2): ported the trusted legacy nesting engine (`manufacturing/block-calculator.html` — `calcForPerm`/`runPrimaryCalc`/`bestFitInBox`/`calcSecondaryPart`/`runFullCalc`, `PERMS`/`DIM_NAMES`) 1:1 to a pure, DOM-free module `src/lib/blockEngine.ts` (kerf-in-numerator invariant preserved), usable client- and server-side. New `POST /v2/api/cutting/cut-plan/save` (X-User-Id gated) recomputes `blocks_needed` server-side via the engine (never trusts client math) and persists block dims + kerf + `blocks_needed` + a JSON `snapshot` to `cut_plans` (reusing P225's reserved columns; only `blocks_needed` added via migration); accepts optional manual Cross/Hole chunk counts (forward-compat for P229). Queue route reads + surfaces `blocks_needed`; `CuttingJob` type + dashboard job-detail header show it. No planner screen yet (P229) — verify via engine build + a `curl` to the save route. **Run `add-blocks-needed.sql` in D1 before deploying the worker.** `tsc --noEmit` + `cf-build` green.
- **P227** — Cutting v2 taper chunk targets: Cross Cutter's chunk target for taper orders now computes as `ceil(taper parts ÷ yield-per-chunk)`. Taper line items detected by the `A">B"` thickness-ramp pattern in `job_line_items.dimensions` (tolerant of `>`, `->`, `→`); a job `is_taper` when ≥1 line item matches. Yield-per-chunk is a per-job manual value on new `cut_plans.taper_yield` (nullable; NULL ⇒ default 12, the 11–14 midpoint), set via new `POST /v2/api/cutting/taper-yield` (X-User-Id gated) and surfaced/edited on the **Cross Cutter** line in `PartsPanel` (yield input + live chunks-required). Queue route reads the yield, computes chunks, and overwrites the Cross Cutter `cut_plan_lines` + `cutting_lines` target each read (parts/yield may change); job payload + `CuttingJob` type carry `is_taper` + `taper_yield`. Main Line target already correct from P225 (part line). Blocks-needed, non-taper chunk math, and structured chunk geometry remain step-2/later. **Run `add-taper-yield.sql` in D1 before deploying the worker.** `tsc --noEmit` + `cf-build` green.
- **P225** — Cutting v2 BOM cut-plan persistence + part-line targets: new instance tables `cut_plans` (one per job) + `cut_plan_lines` (one per job×line, `unit` chunk|part, `qty_target`), template `saved_combos` untouched. Queue route lazily upserts a cut plan per active job (mirroring the `cutting_lines` INSERT OR IGNORE reconcile): part-producing lines (Main Line / Blue Line / Laminate) get `qty_target` = total ordered units derived in-memory from `job_line_items` (no nesting math); chunk lines (Cross Cutter / Hole Cutter) get `unit='chunk'`, `qty_target` NULL pending the step-2 engine. Part-line targets mirrored into `cutting_lines.qty_target` where NULL. Queue payload + `CuttingLine` type now carry `unit` + `qty_target`; `PartsPanel` shows a real "parts to produce" target on part lines and narrows the "coming soon" note to chunk lines only — unblocking throughput/yield/progress for 3 of 5 lines. Reserved columns (`block_*`, `kerf`, `snapshot`, `taper_pair`, `detail`, `source`, `combo_id`) added for the step-2 nesting engine. **Run `add-cut-plans.sql` in D1 before deploying the worker.** `tsc --noEmit` + `cf-build` green.
- **P224** — Cutting v2 clock-out reconciliation: the clock-out modal now lists the line's unchecked
  parts, each with a required quantity (0 allowed), pre-filled with the current `completed_qty`;
  submit is gated until all are filled. Values (total completed for that part on this line) persist
  via new batch route `POST /v2/api/cutting/line-progress` (upserts `completed_qty`, leaves the
  `completed` flag untouched) — best-effort at submit, ordered reconcile → photo → clock-out. The
  session-total "Pieces completed this session" field and optional photo are unchanged. No
  migration. `tsc --noEmit` + `cf-build` green.
- **P220** — Cutting v2 parts checklist moved into a docked right sidebar (md:w-80, border-l; stacks
  on narrow) beside the line rows — no overlay. The sidebar shows only once the operator is clocked
  into the job, and only their clocked-in line (line tabs/selector removed; `PartsPanel` simplified
  to a single line). Enforced one-open-session-per-user: clock-in route 409s `already_clocked_in`
  (returns the line in use) if the operator has any open session; `LineRow` disables Clock In on
  every other line with a reason tooltip; `CuttingBoard` derives the user's open session across the
  queue. `tsc --noEmit` + `cf-build` green.
- **P219** — Cutting v2 parts sidebar reworked from a hovering slide-over into a **docked per-line
  checklist** at the top of the detail (coexists with the clock/complete buttons; no overlay).
  Each cutting line tracks its own completion of each part: new `cutting_line_progress` table
  (UNIQUE job/line/line_item; `completed` + reserved `completed_qty`), upsert route
  `POST /v2/api/cutting/line-item`, queue payload carries line-item `id` + a per-line `progress`
  map. Line selector defaults to the operator's open line. `PartsPanel` repurposed; slide-over
  wiring (`partsOpen`, auto-open, "Parts (N)" button, `Package` import) removed; `SlideOver`
  primitive retained but unused by cutting. Same parts list across all lines for now (chunk counts
  pending BOM). `tsc --noEmit` + `cf-build` green. **Migration run required.**
- **P218** — Cutting v2 clock-out cut-list photo (optional, never blocks clock-out): capture field
  in the handoff modal (`capture="environment"`), best-effort upload to R2 (`BOL_PHOTOS`,
  `cutting-photos/<session>/…`) via new `POST /v2/api/cutting/clock-out-photo` before the existing
  clock-out call; `cutting_sessions.photo_key` column (migration `add-cutting-session-photo.sql`).
  Authed serve route `GET /v2/api/cutting/photo/[sessionId]` streams from R2. Queue payload surfaces
  the latest photo per line per job; a camera badge on the job card opens a `<PhotoViewer>` (composes
  `<Modal>`). `tsc --noEmit` + `cf-build` green. **Migration run required.**
- **P216** — Cutting v2 per-line/per-job time tracking: the queue payload now aggregates closed
  `cutting_sessions` durations per (job, line) (`SUM(julianday diff)`) and surfaces `tracked_seconds`
  + the open session's `open_started_at`. The board shows a tracked-time badge on each line (running
  line ticks live via a 30s client clock, info-tinted) and a job total in the detail header. Time
  helpers centralized in `src/lib/time.ts` (`lineLiveSeconds`, `formatDuration`). Time-only;
  units/hour deferred (qty data still sparse). No migration, no session-write change. `tsc --noEmit`
  + `cf-build` green.
- **P215** — Cutting v2 Parts slide-over: selecting a job opens a right-anchored slide-over listing
  its parts (part #, description, dimensions, qty) from `job_line_items`, re-openable via a
  "Parts (N)" header button. New reusable `<SlideOver>` primitive (right-anchored on all
  breakpoints, scrim/Escape/close — distinct from `<Sheet>`). Queue payload (`/v2/api/cutting/queue`)
  batch-fetches `line_items` per job (existing IN-list + map pattern; no migration). "Blocks /
  chunks required" rendered as a reserved placeholder pending block-calculator BOM wiring.
  Single-job-per-user kept as UX framing (no clock-in enforcement). `tsc --noEmit` + `cf-build` green.
- **P214** — Cutting v2 custom `<CompleteLineModal>`: replaced the native `window.confirm` on Mark Complete with a tokenized modal composing the `<Modal>` primitive (completion note sent as the closing session's `handoff_note`; no route/SQL change). Scrap rendered as a disabled, clearly-labeled placeholder (anticipates reason + cubic-in + shift + density), hidden on Laminate; real persistence deferred to the native scrap-database project. Consumption out of scope. Mirrors `HandoffModal` styling, 44px targets, tokens-only. `tsc --noEmit` + `cf-build` green.
- **P213** — Cutting v2 header active-state + parity close-out: the v2 cutting board now marks the Manufacturing nav entry active (`isNavActive` maps `/v2/cutting` → `/manufacturing/`), desktop and drawer, with the legacy soft-brand active background restored; dimension/typography swept to match `shared-header.js` exactly (nav 48px / link 13px·36px·rounded-lg, `--line` borders, logo 30px). No new nav link (cutting reached via Manufacturing, per legacy nesting); `manufacturing.cutting` gating recorded in-code for a future explicit Cutting link. Completes the P210–P213 theme/header sequence. `tsc --noEmit` + `cf-build` green.
- **P212** — Cutting v2 `<PlatformHeader>` React port: replaced the bare `AppHeader` with a reusable platform header (logo, title, 8-link permission-gated module nav linking to legacy pages, user bar + Sign Out, embedded P211 `<ThemeToggle>`, mobile hamburger drawer). Per-link gating uses the session `permissions` map (admin bypass); `page.tsx` now calls `validateSession()` server-side to pass `permissions` down (read-only, no cookie writes). Logo served from `/logo/xpanda.png` (legacy app, same host; self-hosting under `/v2` deferred until asset pipeline handles `public/` prefix). Notifications bell + settings gear intentionally deferred (depend on push backend / redundant with ThemeToggle). `tsc --noEmit` + `cf-build` green.
- **P211** — Cutting v2 `<ThemeToggle>` control: reusable client component (`src/components/ThemeToggle.tsx`) consuming P210's `useTheme()` — lucide Sun/Moon (sun-in-dark, matching legacy), tokens-only, focus ring, 44px hit area, action-reflecting `aria-label`, optional `className` for reuse. Rendered in `AppHeader` beside the username (flex wrapper; title stays left). Both header render branches pick it up automatically. Engine untouched. `tsc --noEmit` + `cf-build` green.
- **P210** — Cutting v2 theme engine + token audit (dark-mode foundation, no visible control yet). React `ThemeProvider`/`useTheme` reimplementing the legacy `/shared/theme.js` contract one-to-one: `localStorage['xpanda-theme']`, `data-theme` on `documentElement`, values `dark`/`light`, default `dark` (OS ignored, matching legacy) — so v2 and the main app share the key and stay in sync. Added a pre-hydration inline script in `layout.tsx` (+`suppressHydrationWarning`) to set `data-theme` before first paint (no flash); wrapped children in the provider; SSR-guarded all `window`/`localStorage` access for the Workers runtime. Token-audit fix: added `--success-text` and `--danger-text` to the `[data-theme="dark"]` block (referenced by components, previously only defined in `:root`). No `tailwind.config` change needed. `tsc --noEmit` + `cf-build` green.
- **P209** — Cutting v2 queue toolbar: client-side search (customer + invoice #, case-insensitive) and This-Week (Mon–Sun) filter with Show All toggle, mirroring the legacy P190 pattern. This Week ON by default; no-`ship_date` jobs hidden until Show All; non-empty search bypasses the week filter and matches the full queue. `filteredQueue` memo derives the list and the Queue header count; raw `queue` state and the operator-loop refetch untouched. Designed empty/no-match states, tokens-only styling, 44px targets. `tsc --noEmit` + `cf-build` green.
- **P208** — Fix cutting v2 board rendering completely unstyled: `src/app/layout.tsx` never imported `globals.css`, so Tailwind's compiled stylesheet (directives present, content globs correct) was never linked into the document and every utility class resolved to nothing — data rendered, styles did not. Added `import "./globals.css";` as the first line of the root layout. Also corrected the mojibake em-dash in the page `<title>` (`â€"` → `—`). Single-file component fix; tokens/config/components untouched. `tsc --noEmit` + `cf-build` green; hashed `.css` confirmed at `v2/_next/static/css/`.
- **P207** — Fix cutting v2 board stuck serving stale JS: `fix-asset-prefix.mjs` silently skipped the `_next → v2/_next` rename whenever `v2/_next` already existed from a prior build (the `!existsSync(to)` guard). Every deploy after the first (P205) left stale P205 chunks at `v2/_next/` while fresh chunks landed at `_next/` — wrong path, never served. Browser hydrated with old pre-P206 code. Fix: script now removes the stale `v2/_next/` with `rmSync` before renaming so fresh chunks always land at the correct Workers asset path. `tsc --noEmit` + `cf-build` green (build log confirms "Relocated _next → v2/_next"). Single-file build-script fix; no React component, route, worker, SQL, or wrangler config touched. Alleged key mismatch (prompt premise) was not present in source — both route and component consistently use `queue`.
- **P206** — Cutting v2 UI redesign: replaced the placeholder P198 interface with a tablet-first, by-job master-detail board — dense job list with rolled-up status pill + handoff-note indicator, responsive detail (side drawer/bottom sheet) for the five-line operator loop. Established reusable `<Sheet>`/`<Modal>`/`<StatusPill>` primitives (no copy-paste). Industrial design doctrine applied (lucide icons, mono tabular-nums, borders-over-shadows, tokenized status, brand red sparing, designed empty/loading/error states). Data contract unchanged.
- **P205** — Cutting v2 chunk-404 fix: `basePath: "/v2"` rewrote asset URLs to `/v2/_next/...` but OpenNext left the files at `.open-next/assets/_next/...` → Workers asset binding 404'd every chunk. Added `scripts/fix-asset-prefix.mjs` relocating `_next` → `v2/_next` after every `opennextjs-cloudflare build` so the physical path matches the basePath URL; wired into `cf-build`/`deploy`/`preview` scripts so it can't be skipped. Middleware `_next/static` exclusion (P203) preserved. CF cache purge for `/v2/_next/*` + skew-protection flagged to Steve.
- **P203** — Cutting v2 asset routing fix: switched from folder-based routing to `basePath: "/v2"` (app files moved to `app/cutting/` and `app/api/cutting/`). `assetPrefix` approach broken — Cloudflare ASSETS binding maps URL path directly to file path, so `/v2/_next/...` URLs returned 404 because files are at `_next/...`. `basePath` tells the Next.js/OpenNext server to strip the prefix before resolving assets. Middleware matcher also had a double-prefix bug (`/v2/(...)` + `basePath: "/v2"` → compiled regexp `/v2/v2/...`); fixed by removing the `/v2` from the matcher (basePath prepends it automatically). Build and middleware regexp verified clean.
- **P198** — Cutting v2 operator loop: pick-job→pick-line clock-in/out with per-line sessions. Queue route lazily reconciles `cutting_lines` from job-board processes and returns per-line status + open operator + last handoff note (batched INSERTs chunked at 50, three supplemental queries assembled in JS for O(n) assembly). New routes `/v2/api/cutting/{clock-in,clock-out,complete-line}`: operator identity authoritative from middleware-injected `X-User-*` headers (never client body); one-open-session-per-line guard returns 409 `{ error: 'line_busy', operator }` with surfaced name; clock-out captures handoff note and optional `qty_done_delta` (line stays `in_progress`); complete-line closes lingering open sessions and, when all required lines reach `complete`, fires the single one-directional `jobs.status='done'` signal (never downgrades `loading`/`shipped`/`archived`). First real React components: reusable `<Modal>` primitive established as the anti-copy-paste precedent (`src/components/Modal.tsx`); `CuttingBoard.tsx` mobile-first operator loop (44px+ targets, job list → line detail, status pills using platform tokens, last-handoff note shown as amber resume hint). Activity logged to shared `activity_log` for all clock events. `tsc --noEmit` clean. **Verification gate requires deployed Worker** (middleware auth pass-through in `next dev` means `X-User-*` headers are absent locally; operator-identity fields and the 409 guard must be exercised against the real workerd host).
- **P197** — Cutting v2 pilot Worker build: `opennextjs-cloudflare` build green (Next.js build + OpenNext bundle), `.open-next/worker.js` produced; local workerd preview (`wrangler dev`) boots with shared D1 (`DB`, 21d6f47b) + R2 (`BOL_PHOTOS`) bindings resolving; `/v2/cutting` returns 307 → /login.html (unauthenticated redirect = PASS; auth cookie is host-pinned to legacy host) and `/v2/api/cutting/queue` returns `{"ok":false,"error":"Unauthorized"}` (correct gate response); `nodejs_compat` confirmed in wrangler.toml; `.gitignore` seeded for `.open-next/`, `.next/`, `node_modules/`, `.wrangler/`, `.dev.vars`. **Windows build note:** `@opennextjs/aws` v0.3.x injects absolute paths with backslashes into JS string literals in `plugins/edge.js`; required a one-line patch (`file.replace(/\\\\/g, '/')`) — if `npm install` is re-run on Windows the patch must be re-applied. No remote deploy — deploy + domain attach + auth-bridge validation handed off (require Cloudflare auth + real host).
- **P196** — Cutting v2 pilot route-tree reconcile: removed double `/v2` prefix (basePath vs folder) that 404'd the dev server; moved `api/cutting/queue` under `app/v2/api/` so the whole v2 surface lives under one `/v2` prefix (single future zone route, no collision with legacy `/api/cutting`); middleware relocated already at `src/middleware.ts` with `matcher: ['/v2/:path*']`; `isApi` check updated to `/v2/api/` after move; `getCloudflareContext()` awaited correctly (async in v0.3.x); try/catch pass-through added for next dev edge-middleware limitation (dynamic wrangler import fails in webpack edge context — auth gate fully active in workerd); `db.ts` switched to `getCloudflareContext()` via async `getEnv()`; `open-next.config.ts` fixed to valid v0.3.x format (removed nonexistent `OpenNextConfig` import, added `middleware: external: true`); seeded `shared/tokens.css` `:root` vars + dark mode block into pilot `globals.css` with `--font` alias; token fallbacks added for Tailwind-config vars missing from tokens.css (`--border`, `--border-light`, `--green`, `--red`, `--text-faint`); validateSession/hasPermission port confirmed faithful to `_worker.js/lib/core.js`. Local dev green at `/v2/cutting`. No deploy, no migration, no legacy file touched.

---

## Schedule Board (v2)

- **P313** — Schedule v2: removed delivery time/location and method/carrier lines from order cards (sheet cells retained for matching/sorting, display-only removal). `OrderRow.tsx`'s two faint text lines below the status-pill row (`delivery_time · location` and `method / carrier`, full density only) and their gating consts (`showTiming`, `showMethodCarrier`) are gone; `row.method` stays referenced in `formatLoadLabel`/`loadLabel` for the load-count line, and the API route/`ScheduleBoardRow` type are untouched — those columns are still selected/returned for matching/sorting. `tsc --noEmit` + `cf-build` green.
- **P306** — Removed the P301 logo sweep from `/v2/schedule` — it was the only motion left after P304 removed pixel-shift, and it's what Steve was still seeing as "the schedule moving left to right" (a `translate(-20vw)→translate(120vw)` sweep every 5 min). Deleted `LogoSweep.tsx` (confirmed no other importers), its render call in `ScheduleBoard.tsx`, and `.xpanda-logo-sweep`/`@keyframes xpanda-logo-sweep`/its `prefers-reduced-motion` line from `globals.css`. Also investigated the "still clips" report: measured the `relative flex-1 min-h-0 overflow-hidden` → `absolute inset-0 flex flex-col` chain from P305 against the live production board at 1920x1080 — it is pixel-exact against the browser viewport with zero clipping, so the P305 CSS fix is not regressed and there's no remaining CSS bug here. The edge crop Steve sees on the physical wall TV is downstream of the browser (consumer TV/HDMI overscan cropping the outer edge of the picture, independent of what's rendered) — added a small `--tv-safe-inset` (12px, new `globals.css` token) inward margin around the board content as a pragmatic hardware accommodation, replacing `absolute inset-0` with `style={{ inset: "var(--tv-safe-inset)" }}`. This is explicitly NOT a CSS bug fix — don't revert it back to `inset-0` thinking it's leftover pixel-shift cruft. `tsc --noEmit` + `cf-build` green. See the paired Loading Board entry below for the identical treatment on `/v2/loading`.
- **P305** — Fixed ~10px edge clipping (P304 pixel-shift-removal regression) — see the Loading Board section above for the shared root cause and fix; same one-line `absolute inset-0` change applied here in `ScheduleBoard.tsx`.
- **P304** — Removed the pixel-shift burn-in mitigation from `/v2/schedule` (Steve reported motion discomfort). `ScheduleBoard.tsx` no longer imports `PixelShiftLayer`; its wrapper markup (`<div className="relative flex-1 min-h-0 overflow-hidden"><div className="flex flex-col">…`) is reproduced inline byte-identical minus the animated class, so layout is unchanged. Deleted the now-unused `PixelShiftLayer.tsx` (confirmed no other importers) and its `globals.css` definitions (`--pixel-shift-px`, `.xpanda-pixel-shift-layer`, `@keyframes xpanda-pixel-shift`, and its line in the `prefers-reduced-motion` block). The logo sweep and freshness clock are untouched. See the paired Loading Board entry below for the same removal on `/v2/loading`. `tsc --noEmit` + `cf-build` green.
- **P301** — Honest freshness clock + burn-in mitigation on `/v2/schedule` (24/7 wall TV). New `FreshnessClock.tsx` replaces the render-time "updated HH:MM" stamp with `source_updated_at` (from P300): a language-proof clock-icon readout showing relative age (`3m`/`12m`, ticks on its own every `CLOCK_TICK_MS`=20s so it climbs even between the board's 60s fetches) plus the absolute time, going amber (`var(--warn-*)`) past `STALE_THRESHOLD_MS`=20 min (>2 cron cycles at the current 10-min tick), and an explicit "no data" state (not "0m") when `source_updated_at` is null. The pre-existing fetch-failure indicator (network reachability, unrelated concern) is kept but reworded from "stale" to "showing last loaded data" to stop colliding with the new source-staleness meaning. New `PixelShiftLayer.tsx` wraps the board content below the header (not the header itself — its `autoHide` overlay stays `position: fixed` to the viewport, which a transformed ancestor would break) in a `transform: translate()`-only drift, amplitude single-sourced as `--pixel-shift-px` (8px) in `globals.css`, 80s cycle, overscanned at 1.5x the amplitude so no edge is ever exposed; desktop/TV only (≥1024px) and disabled under `prefers-reduced-motion`. New `LogoSweep.tsx` sweeps `/logo/xpanda.png` across the screen every `LOGO_SWEEP_INTERVAL_MS`=5 min via a remount-driven CSS animation (`animation-fill-mode: forwards` so it clears and stays invisible off-screen between sweeps) — timer-only, not tied to the cron or the 60s refetch, logo/graphic only (no text, language-neutral). `tsc --noEmit` + `cf-build` (`npm run cf-build`) green.
- **P300** — `GET /v2/api/schedule-board` gained `source_updated_at: string | null` — the real sheet-pull time, computed as `max(last_seen_at)` across the `schedule_rows` returned for the two shown weeks (`null` when there are no rows). No new round-trip: `last_seen_at` was added to the route's existing `schedule_rows` SELECT rather than issuing a separate query. `generated_at` (render/response time) is unchanged and still present — the two fields mean different things and the paired UI prompt (P301) shows both. `types/schedule.ts` mirrored. `tsc --noEmit` clean.
- **P287** — `/v2/schedule` added to `PlatformHeader`'s `NAV_MODULES`, gated on the `schedule` permission key from P264, placed between Manufacturing and Production. Both the desktop nav and the mobile drawer pick it up automatically from the shared array — no render-branch change. `isNavActive` needed no change (default `startsWith` behavior already resolves `/v2/schedule` correctly, unlike `/v2/cutting`'s special-cased mapping to the Manufacturing entry). The P213 no-dedicated-Cutting-link decision and its explanatory comment stand untouched. Not live until `wrangler deploy` from `cutting-pilot/`.
- **P279** — Fixed the `/v2/schedule` auto-hide nav swallowing header clicks while revealed.
  Reported as "the theme toggle does nothing" — theme system (`theme.tsx`, `layout.tsx`,
  `globals.css`) verified clean; real cause was `PlatformHeader.tsx`'s `autoHide` reveal strip
  (`fixed inset-x-0 top-0 z-50 h-11`), a full-width transparent button that sits above the
  `z-40` header and covers its top 44px **at all times, including while revealed** — every
  pointer event aimed at that band hit the strip's `reveal()` handler instead of the header
  content underneath. Fixed by driving `pointer-events` off `revealed` (`pointer-events-none`
  once revealed, `pointer-events-auto` while hidden) and pulling the strip out of tab order
  when inert (`tabIndex={-1}`, `aria-hidden`) rather than unmounting it, so the grab-handle
  affordance doesn't flicker and the reveal transition stays smooth. Scope wider than the
  reported symptom: this also restores Sign Out, the logo link, every desktop nav link, and the
  mobile hamburger on the schedule board — all were being swallowed by the same strip, not just
  the theme toggle. `z-50`/`z-40` relationship and the non-`autoHide` in-flow render path
  untouched. `tsc --noEmit` clean, `cf-build` green. **Not yet live** — v2 requires an explicit
  `wrangler deploy` from `cutting-pilot/`.

- **P278** — Fixed `deriveStatuses()` (`src/lib/schedule-status.ts`) and restored the floor
  status badges (`SHOW_STATUS_BADGES` → `true`, `flags.ts`). Three defects found auditing the
  ladder against the actual write sites: (1) rung 3 (`assignmentStatuses.length > 0 → "Loading"`)
  fired on the mere existence of a `loading_assignments` row, but a row is seeded at
  `loading_status='awaiting'` the moment a job is created (`load_count` expansion in
  `_worker.js/routes/jobs.js`) — so almost every job with `load_count >= 1` read "Loading"
  regardless of real dock activity, and Ready/Cutting/Not Started were unreachable underneath it.
  Fixed by requiring `loading_status='loading'` specifically for the Loading rung; `awaiting`/
  `not_started` now fall through to the cutting rungs instead of being read as dock signals. (2)
  `in_transit` and `delivered` (written by both the driver QR flow and the manual dock-board
  button) weren't in the ladder at all and fell to the old rung 3 → "Loading," so a delivered
  order still read as sitting on the dock. Both now resolve to **Shipped** (Steve's call:
  `in_transit` doesn't get its own badge — once the truck has left, it reads the same as
  delivered). (3) Confirmed `cutting_lines`/`cutting_sessions` (v2) are the only source for the
  Ready/Cutting rungs — **no legacy `cutting_steps` fallback, by design**: that model was never
  finished and is scheduled for retirement, and reading it would import wrong data, not missing
  data. One accepted residual, not a caveat: a job that's never surfaced in the v2 cutting queue
  has zero `cutting_lines` rows (created lazily by the queue read's `INSERT OR IGNORE`), so it
  reads "Not Started" until a loading assignment reaches `loading` — correct for a job with no
  cutting work; if it's wrong for a job that should be cutting, that's a queue-reconciliation bug,
  not this ladder. New precedence, highest wins: archived (legacy sentinel) → shipped →
  delivered → in_transit → loaded → loading → all cutting_lines complete/`status='done'` (Ready)
  → any cutting_lines in_progress or open cutting_sessions (Cutting) → Not Started. `StatusBadge.tsx`
  needed no change (still the same 6-value `ScheduleStatus`, confirmed by reading it before
  concluding). `SHOW_STATUS_BADGES` flag itself kept in place (not inlined/deleted) as a one-line
  kill switch. Verified: `tsc --noEmit` clean, `cf-build` green, `CHUNK = 90` chunking intact,
  scope confirmed to `schedule-status.ts`/`flags.ts` only — nothing under `_worker.js/` touched.
  **Not yet live** — v2 requires an explicit `wrangler deploy` from `cutting-pilot/`; badges won't
  appear on the floor TV until that runs.

- **P277** — Linked jobs (3/3): `/v2/schedule` side rail for jobs sharing a `trailer_group_id`.
  `GET /v2/api/schedule-board` (`app/api/schedule-board/route.ts`) now resolves `trailer_group_id`
  for the matched job set in one batched, chunked query (mirrors `deriveStatuses`' `allByJobIds`
  approach locally rather than importing it — `schedule-status.ts` is untouched by this prompt)
  alongside status derivation; surfaced on `ScheduleBoardRow` (both the route's local interface
  and `types/schedule.ts`) as nullable `trailer_group_id`. **The rail is derived strictly from
  `trailer_group_id`, never from sheet `sort_order` adjacency** — Steve confirmed the sheet
  already stacks linked orders next to each other in practice, but deriving the rail from that
  adjacency would inherit the sheet's unreliability (the whole reason this board reads live
  platform state instead of trusting the sheet) and could bracket two unrelated customers the
  first time the updater doesn't stack them. `DayColumn.tsx`: `withGroupsAdjacent` pulls a
  group's rows contiguous (anchored at the first member's existing position — a no-op in the
  normal case), `buildBlocks` turns contiguous runs into grouped/single blocks, and
  `selectVisible` implements Steve's locked slot-priority rule — **grouped blocks always win a
  slot and are never partially clipped** (rendered in full regardless of `rowCap`; only ungrouped
  rows absorb the clipping into `+N more`, which now counts blocks actually dropped rather than
  `rows.length - visible.length`, since a full group can legitimately push the visible count past
  `rowCap` without anything having been dropped). This is the third override on top of the
  sheet's `sort_order` (after group adjacency and the rail itself) — commented in-code so a
  future reader doesn't mistake reordered rows for a bug and "fix" it back. A group whose members
  land in two different day columns (sheet disagrees about the ship date) can't be spanned by a
  rail; each orphaned member gets a small link-chip instead (`OrderRow`'s new `orphanedGroup`
  prop, a `Link2` icon on the row's always-rendered first line so it costs no height and survives
  every density tier, same as the rail itself). Rail styling is a `border-l-2 border-[var(--brand)]`
  wrapper around the grouped block — no new CSS, no hardcoded hex, no height cost. Unmatched-row
  greyed/flagged treatment (P268) and `SHOW_STATUS_BADGES = false` (also P268, still `false`)
  both left untouched. Verified the reorder/block/clip algorithm against a standalone simulation
  (already-adjacent no-op, sheet-disagreement reorder, orphan-stays-ungrouped, slot-priority with
  overflow accounting, a group larger than `rowCap` still rendering whole) — all pass.
  `tsc --noEmit` clean, `cf-build` green. **Precondition met**: the TV-fit measurement work
  (`P263` follow-up) was confirmed against real hardware before this prompt started, avoiding the
  `density.ts`/`DayColumn.tsx`/`ScheduleBoard.tsx` merge-conflict risk the prompt itself flagged.
  **Not yet visible on the floor board** — `SHOW_STATUS_BADGES` is `false` but that only affects
  status pills, not the rail; the rail *will* render once this deploys. **v2 requires an explicit
  `wrangler deploy` from `cutting-pilot/` — this does not ship on push.**

- **P274** — Schedule ingest cron tightened 15 → 10 minutes (`cutting-pilot/wrangler.toml`
  `[triggers] crons`) for fresher floor data. Pure interval change — headroom was never in
  question (Workers Paid, `[limits] cpu_ms = 60_000`, optimized parse runs ~5s), so no capacity
  implication. Updated the narrating comment above `[triggers]` so it no longer contradicts the
  config beneath it. `schedule-ingest.ts`, `custom-worker.ts`, `[limits]`, and
  `schedule-status.ts` untouched. `tsc --noEmit` + `cf-build` green. **v2 does not auto-deploy —
  needs an explicit `wrangler deploy` from `cutting-pilot/` before the new interval takes effect**
  (cron triggers register at deploy time).

- **P273** — Archive refactor (3/3): schedule board drops the archived special-case.
  `schedule-status.ts:deriveOne` used to short-circuit `jobStatus === "archived" || jobStatus ===
  "shipped"` straight to `"Shipped"` — a workaround from when archiving destroyed a job's real
  status, so derivation had nothing else to read. Now that P271/P272 made `archived_at` orthogonal
  (jobs archived from here on keep their real status), that workaround would be wrong: it'd report
  "Shipped" for a job archived while still mid-production. Split the check: `jobStatus ===
  "shipped"` remains a legitimate top rung; the `archived` half is now scoped, commented, and
  justified purely as a legacy-sentinel handler for the finite population of rows already archived
  before the refactor (real prior status unrecoverable, backfilled `archived_at` but left at the
  literal `status='archived'`) — without it those rows would misreport as "Not Started" instead of
  "Shipped". New archives never reach that branch; they fall through to the normal 6-rung ladder
  like any other job. Verified the query feeding `deriveStatuses`
  (`app/api/schedule-board/route.ts`) and the ingest match query (`lib/schedule-ingest.ts
  lookupJobIds`) both already match against `jobs` with no archived exclusion — matched rows keep
  resolving, nothing to change there. `Map<string, ScheduleStatus>` / TEXT job-id typing / ≤90
  chunking all preserved, no query shape change. Smoke-tested `deriveOne` standalone: a job
  archived while `in_production` (with an open cutting session) now derives "Cutting", not
  "Shipped"; a legacy `status='archived'` row still derives "Shipped"; a genuinely shipped job
  still derives "Shipped". `tsc --noEmit` clean. Comment-and-logic-split only — no query/schema/UI
  change. **`SHOW_STATUS_BADGES` (P268) is still `false`, so this isn't visible on the floor board
  until that flag flips back — correctness first, the flip is a separate decision.**

- **P268** — Schedule board production-status badges suppressed behind a flag ahead of the
  floor going live: new `SHOW_STATUS_BADGES` constant (`src/components/schedule/flags.ts`,
  `false`) — frontend-only, `schedule-status.ts`/the API route/ingest untouched, derivation keeps
  running and `status` keeps flowing over the wire, it simply isn't rendered. `OrderRow.tsx` now
  gates `<StatusBadge>` on `SHOW_STATUS_BADGES || row.unmatched` so **unmatched rows keep their
  full existing treatment** (greyed/desaturated row + the dashed "no job match"/`sheet_status`
  flag) regardless of the flag — that's the operator's only signal on those rows, not a derived
  production status. When a matched row has nothing left to show on its second line (badge
  suppressed, no scrap pickup, load count hided at this density), the line is skipped entirely
  (`showSecondLine`) rather than rendering an empty flex row — no dangling gap/separator.
  `<StatusBadge>` itself is unmodified and still in the tree. Density logic (`computeDensity`,
  `OrderRow`/`DayColumn` padding from P266) deliberately left alone per scope — flipping the flag
  back to `true` is a regression-free restore with zero other changes. `tsc --noEmit` + `cf-build`
  green.
- **P267** — Schedule board home-dashboard card: new `.hp-card[data-permission="schedule"]` on
  root `index.html`, matching sibling markup exactly (inline SVG calendar icon, same viewBox/
  stroke/`currentColor` convention, same `hp-card-head`/`-title`/`-desc`/`-actions` structure).
  Gated through the existing `initHomepage()` mechanism (no parallel path) — hidden unless the
  user's `/api/auth/me` permissions include `schedule` (added in P264) or they're an administrator.
  Placed between the Cutting and Production cards, grouping the two `/v2/*` React-migration cards
  together among the manufacturing/logistics operational cluster rather than after Admin. Icon
  background uses the existing `--info-bg`/`--info-text` tokens (auto dark-mode via
  `tokens.css`) instead of a new hardcoded hex pair — the one deliberate departure from the sibling
  icons' hardcoded per-theme hex, chosen to keep this addition token-only. Button reuses the shared
  unified-slate-primary selector (`var(--primary-bg)`/`var(--primary-text)`) alongside the other
  module buttons — no new button color rule. Link is a plain relative `/v2/schedule` href, no
  `target`, matching the existing Cutting card's same-host v2 crossover. No script block touched
  (`initHomepage()`'s permission-hiding loop already covers any `.hp-card[data-permission]`
  generically — zero JS changes required). All anchors (`hp-icon-schedule`, `hp-btn-schedule`,
  `data-permission="schedule"`) verified against a fresh clone before use.
- **P266** — Schedule board UI: truck-type load labels, INV# typography match, collapsible nav,
  density follow-through. (A) New `src/lib/truckType.ts` maps the sheet's free-text `method` column
  to `FB`/`TL`/`XP` (flatbed/dry van/XPanda truck, case-insensitive + whitespace-tolerant match) with
  a raw-text fallback for anything else (CPU, HAND DELIVER, blank) — never invents a code, never
  blanks it; `formatLoadLabel()` renders `<CODE> x<N>`, or the code alone when `load_count` is NULL
  (continuation rows). `OrderRow.tsx`'s load-count span now calls it — one definition, no inline
  duplication. (B) Customer name and INV# now share one `PRIMARY_LABEL_CLS` typography constant in
  `OrderRow.tsx` (size/weight/color); INV# stacks `font-mono tabular-nums` on top for numeric
  alignment without diverging from the shared tier. (C) `PlatformHeader.tsx` gained an opt-in
  `autoHide` prop (schedule board only — every other caller omits it, so `/v2/cutting` etc. are
  unaffected): the header becomes `position: fixed` (overlay, no reflow of the board underneath),
  hidden by default, revealed on pointermove/touchstart/keydown or `:focus-within` (CSS, so
  Tab-focusing into nav links reveals it even before the JS state catches up), and auto-hides after
  `NAV_AUTO_HIDE_IDLE_MS` (5s) idle. A persistent 44px-tall tap/hover zone with a small pill indicator
  stays fixed at the very top at all times so the affordance is discoverable even fully hidden.
  (D) Density follow-through: `OrderRow`/`DayColumn` chrome tightened (`py-1`→`py-0.5` at
  compact/minimal density, day-header padding trimmed) and `ScheduleBoard`'s own status strip
  trimmed — paired with the nav now overlaying instead of consuming flex layout height, a day column
  comfortably fits 8–9 orders at `compact` density (previously clipped silently inside
  `DayColumn`'s `overflow-hidden` well before the existing `rowCap`/`+N more` safety valve engaged).
  `computeDensity()` thresholds unchanged (rowCap already permitted 9 — the bug was visual capacity,
  not the cap). `tsc --noEmit` + `cf-build` (+ `fix-asset-prefix.mjs`) green.
- **P265** — Archived jobs resolve to `Shipped` on the schedule board, highest precedence in
  `deriveStatuses` (`schedule-status.ts`): `jobs.status = 'archived'` (confirmed the only
  representation — no separate boolean column) now short-circuits before the existing `shipped`
  check, so a job archived off the legacy job board without every cutting line/loading-bay row
  ticked no longer shows a stale mid-production status on the TV board. No new query — `jobs.status`
  was already selected for the ladder. Confirmed archived jobs already reach the ladder: `matchAndUpsert`'s
  `lookupJobIds` (`schedule-ingest.ts`) has no status filter on `jobs`, so archived jobs match by
  invoice number exactly like any other job — no endpoint/poller filtering to fix. `tsc --noEmit` +
  `cf-build` green.
- **PENDING date-of-delivery section removed (by request), across all three layers.**
  `schedule-ingest.ts`'s `parseSchedule()` now treats the "PENDING DATE OF DELIVERY" row as a hard stop
  — it clears `currentSection` instead of opening a `"PENDING"` one, so nothing after it gets captured
  (and, critically, doesn't leak into whatever day section preceded it). `Section` narrowed to just the
  five weekday names; `shipDateFor` lost its now-unreachable PENDING branch. The read endpoint
  (`route.ts`) lost its `isPending` grouping branch — day-groups are now always keyed by
  `ship_week::ship_date`, which was PENDING's special-cased fallback. `ScheduleBoard.tsx` lost the
  compact horizontal strip below the two week bands entirely (dead `OrderRow` import removed with it).
  Deleted the 9 stale PENDING rows already sitting in `schedule_rows` from the last poll directly via
  `wrangler d1 execute --remote` rather than waiting up to 15 minutes for the next cron's mark-and-sweep
  prune to catch them. Re-validated against the real spreadsheet: MONDAY–FRIDAY row counts per tab are
  unchanged, zero PENDING rows captured, zero leakage into FRIDAY at the tab that has a real PENDING
  block. `tsc --noEmit` + `cf-build` green.
- **P261 hotfix — poller switched from Sheets API to Drive API + XLSX parsing.** Live diagnosis after
  deploy: `schedule_rows` stayed empty through every cron tick with no visible error. Isolated it with
  a standalone script replaying the poller's own token-refresh + first API call against the real
  credentials — OAuth was fine (200, valid access token), but the Sheets API `values:batchGet` call
  itself returned `400 FAILED_PRECONDITION — "This operation is not supported for this document. The
  document must not be an Office file."` The source file is an uploaded `.xlsx` kept in Drive's Office
  compatibility mode, not a converted native Google Sheet — and Sheets API v4 refuses to read Office
  files at all. Converting it once was the obvious fix, but the sheet's human updater habitually
  re-uploads a fresh Excel file over the same document, which would revert it to Office format and
  break ingestion again — so instead `fetchSheetTabs` (`src/lib/schedule-ingest.ts`) now downloads the
  raw file bytes via the Drive API (`GET /drive/v3/files/{id}?alt=media`, format-agnostic — works
  whether the file is native or Office) and parses them with SheetJS (`xlsx` — installed from
  **SheetJS's own CDN, not the npm registry**: the npm-published `xlsx` package carries two unpatched
  high-severity CVEs — prototype pollution `GHSA-4r6h-8v6p-xvw6` and ReDoS `GHSA-5pgg-2g8v-p4x9` — that
  SheetJS stopped fixing on npm; their CDN tarball is the maintained, patched build).
  `XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" })` reproduces the exact
  `string[][]` shape the old Sheets API response gave, so `parseSchedule()` needed zero changes.
  Bonus side effect: tab lookup is now per-sheet-name against one downloaded workbook instead of one
  all-or-nothing API call, so a not-yet-created "next week" tab no longer takes down "this week" too.
  `google-auth.ts` (the OAuth token exchange) is unchanged — only the *scope* baked into the refresh
  token needs to change, not the exchange code. **Requires a new refresh token with the `drive.readonly`
  scope (replacing `spreadsheets.readonly`)** and the Google Drive API enabled in the same Cloud
  project — both manual steps for Steve, stated back in the conversation this shipped in (no separate
  prompt file). `tsc --noEmit` + `cf-build` green;
  `wrangler deploy --dry-run` confirms `xlsx` bundles cleanly (+~177 KB gzipped, 1.77 MB total — well
  under Workers' size limit). **Validated against the real spreadsheet** (1000+ rows/tab) once a
  `drive.readonly`-scoped refresh token existed, which surfaced two real bugs no synthetic test data
  would have caught: (1) a totals/summary row sitting above the real MONDAY header reads "PENDING
  DELIVERIES @ BOTTOM," which a bare `includes("PENDING")` in `sectionHeader()` matched as the PENDING
  block opening — harmless today only because the real MONDAY header on the very next row immediately
  overrides it before any order row is processed, but fragile; tightened the match to the real header's
  actual phrase, "PENDING DATE OF DELIVERY." (2) The upsert key was `(invoice_number, ship_week)`, but
  large orders routinely split their base invoice across multiple delivery days in the same
  week — live data has "INV 4203-001 thru 003" on Tuesday and "INV 4203-004 thru 007" on Wednesday,
  both correctly reducing to base invoice 4203 under the `INV\s*(\d+)` regex — so the two-field key was
  silently dropping one of the two rows on every poll. Widened to
  `(invoice_number, ship_week, day_of_week)`, confirmed against live data (0 collisions, previously 1).
- **P261 hotfix #2 — scheduled handler was hitting the Workers CPU time limit.** Even with the Drive/
  XLSX fix (previous entry) and a corrected refresh token, `schedule_rows` still stayed empty after
  redeploy. `wrangler tail` on the live worker caught the actual cron invocation this time:
  `"*/5 * * * *" - Exceeded CPU Limit`. Root cause: the live workbook carries 190+ historical tabs (one
  per ship-week back to late 2024, ~14 MB total), and `XLSX.read()` fully parses every sheet by
  default — a local benchmark against the real file measured ~16s just to parse, only 2 of those 196
  sheets are ever used. Fixed with SheetJS's `sheets` read option (`XLSX.read(bytes, { type: "array",
  sheets: tabs })`), which restricts actual parsing to the requested tab names — cut the same benchmark
  to ~5s (`SheetNames` still lists everything; only the two requested sheets get decompressed/parsed).
  Added `[limits] cpu_ms = 60_000` in `wrangler.toml` as a safety margin on top (default is 30s; max
  allowed is 300s) — applies worker-wide (fetch + scheduled) but costs nothing unless actually used,
  since Workers billing is metered on real CPU-ms consumed, not the configured ceiling. First deploy
  attempt with this config hard-failed at the Cloudflare API (error 100328): the account was on the
  **Workers Free plan**, where `[limits] cpu_ms` isn't just defaulted lower — it's rejected outright,
  and Free's Cron Trigger CPU budget is a fixed, non-configurable **10ms**, roughly 500x under even
  the optimized parse. No amount of further optimization could have closed that gap. Steve upgraded to
  Workers Paid ($5/mo, account-wide) specifically to unblock this. **Confirmed working end-to-end in
  production 2026-07-22**: first successful poll wrote 48 rows with the correct day/week distribution
  (verified directly against D1). Cron interval was temporarily dropped to `*/5 * * * *` during
  verification and is now back to the normal `*/15 * * * *`. `tsc --noEmit` + `cf-build` green.
- **P263** — `/v2/schedule` TV board UI (read-only wall display, no new API routes). Design read:
  a floor/office TV board for anyone glancing at the shipping schedule from across a room, dense +
  industrial, two-week stacked bands, no interaction. `src/app/schedule/page.tsx` (thin server shell,
  same identity/permission pattern as `/v2/cutting`) renders `"use client"` `ScheduleBoard.tsx`, which
  polls `GET /v2/api/schedule-board` every 60s and swaps data in place — on fetch failure it keeps the
  last-good render and shows a subtle "stale" stamp instead of ever blanking the wall or spinning
  forever. Layout: current week on top, next week below, both always visible (no auto-scroll, no
  rotation); within each band `WeekBand.tsx` lays MONDAY–FRIDAY out as `DayColumn.tsx`s across, each
  reusing one `OrderRow.tsx` (also reused for the PENDING strip below both bands — no copy-paste row
  markup). Shrink-to-fit is two mechanisms working together: CSS `clamp()` continuously scales key text
  between a TV-readable floor and a roomier ceiling tied to viewport height, while a `computeDensity()`
  heuristic (`density.ts`, keyed off the tallest day column's row count) progressively trims secondary
  fields (delivery time/location/method/carrier, then load count/scrap icon) before ever hitting the
  font floor, and hard-clips a column past its row cap with a "+N more" chip rather than rendering
  illegible microtext. `StatusBadge.tsx` maps the 6-state ladder to distinct hues — reused existing
  ghost/info/warn/success tokens for 4 states and added two new ones, `--loading-`/`--loaded-*`
  (globals.css, light+dark), pulling the `loaded` color directly from the legacy loading-dashboard's
  established palette (`logistics-shared.css`) for platform consistency; `Cutting` intentionally reuses
  the same blue already used for "Cutting · x/y" in `StatusPill.tsx` rather than the legacy loading
  module's blue-for-"loading" convention, since the two conventions collide here and the in-project
  precedent won. Unmatched rows render desaturated with a dashed "no job match" badge showing
  `sheet_status`. New `src/types/schedule.ts` mirrors 3/5's response contract exactly (flagged to keep
  in sync). No new nav link added — `schedule` isn't in the roles table yet (5/5), so a link would be
  dead; backlogged. **Windows build fix (same commit):** `opennextjs-cloudflare`'s own build spawns a
  transient `workerd` process for middleware validation that doesn't always release its handle on
  `_next/static/**` before the post-build step runs, making `scripts/fix-asset-prefix.mjs`'s
  `renameSync` fail `EPERM` even after the process exits — hardened with a copy+delete fallback on
  `EPERM` (rename still tried first, fast path unchanged). `tsc --noEmit` + `cf-build` green; local
  `wrangler dev` smoke confirms `/v2/schedule` redirects to legacy login when unauthenticated and a
  `/v2/_next/static/*` chunk serves 200 (asset-prefix wiring intact). No UI polish pass against a real
  TV yet — the density thresholds and clamp floors are engineering judgment, not measured against
  hardware (flagged below).
- **P262** — `GET /v2/api/schedule-board` read endpoint + live-status derivation (new
  `src/app/api/schedule-board/route.ts`, read-only, no mutations). Reads `schedule_rows` for
  `ship_week IN (currentTab, nextTab)` (reuses `schedule-ingest.ts`'s tab-name helper, no duplicated
  date logic — PENDING rows carry a real `ship_week` in the DB but always merge into one output group
  with `ship_week: null`, per the stable contract for 4/5), groups one entry per calendar date
  (`ship_week`/`ship_date` key, so the same weekday in the two different ship weeks never collapses),
  and orders chronologically with PENDING last. New `src/lib/schedule-status.ts` derives each matched
  row's status via a precedence ladder — Shipped (`jobs.status`) → Loaded/Loading
  (`loading_assignments.loading_status`, excluding `archived`) → Ready (all `cutting_lines` complete,
  or `jobs.status='done'`) → Cutting (`in_progress` line or an open `cutting_sessions` row) → Not
  Started — using 4 batched, ≤90-chunked `IN (...)` queries run in parallel (no N+1). Unmatched rows
  (`match_job_id IS NULL`) skip derivation entirely: `status: null`, `unmatched: true`, `sheet_status`
  passed through for the UI to grey/flag. Corrected the prompt's `loading_bays.status` reference to
  the real schema — per-job loading state lives on `loading_assignments.loading_status`, not
  `loading_bays` (that table is just the physical bay directory). Middleware generalized from one
  hardcoded `manufacturing.cutting` permission for all of `/v2/*` to a path-keyed `PERMISSION_MAP`
  (mirrors legacy `PATH_PERMISSION_MAP`) — `/v2/schedule` + `/v2/api/schedule-board` now require the
  new `schedule` key (defined in 5/5; until then no one can be granted it — no hardcoded bypass),
  cutting's behavior is unchanged. Matcher already covered the new route (no change needed). `tsc
  --noEmit` + `cf-build` green; local `wrangler dev` smoke confirms the route/middleware chain is
  wired (unauthenticated `GET /v2/api/schedule-board` → clean 401, `GET /v2/schedule` → redirect to
  legacy login) — full grouped-payload/status-derivation behavior needs a real session + populated
  `schedule_rows`/`jobs` data against the deployed host (Steve). No UI yet (4/5).
- **P261** — v2 cron poller + Sheets API v4 ingestion into `schedule_rows` (unattended, no worker
  route, no UI): a `*/15 * * * *` Cron Trigger on the v2 OpenNext worker reads the current and next
  Monday-anchored ship-week tabs (`M-D-YY`, quoted A1 sheet names) via `values:batchGet`,
  authenticating with a stored **OAuth refresh token** exchanged for an access token each run
  (`src/lib/google-auth.ts` — service-account keys are blocked by org policy, so this is user OAuth,
  never a JWT/key). `src/lib/schedule-ingest.ts` parses the day-section state machine (MONDAY..FRIDAY
  + PENDING), extracts columns B–J per order row, derives `invoice_number` from col F via
  `INV\s*(\d+)` (leading digit run, tolerant of suffixes like `-002`), treats `^^^` continuation
  markers as NULL, and matches to `jobs.invoice_number` (chunked `IN (...)` lookups at ≤90 bound
  params). Because `schedule_rows` (1/5) has no `UNIQUE(invoice_number, ship_week)` constraint, the
  upsert is done in application code (select-then-insert/update) rather than SQL `ON CONFLICT`;
  pruning is mark-and-sweep — every row touched this run shares one `last_seen_at`, and anything
  older for a *successfully fetched* week is deleted, so a failed tab fetch never wipes that week's
  board. Cron handler lives in a new `custom-worker.ts` (wrangler `main` now points here instead of
  the raw `.open-next/worker.js`) that re-exports the generated `fetch` unchanged and adds
  `scheduled()` alongside it — the sanctioned OpenNext custom-worker pattern, since the generated
  output has no hook for a cron export and gets regenerated every build. New `[triggers]` +
  `SCHEDULE_SHEET_ID` `[vars]` entry in `cutting-pilot/wrangler.toml`. No board read endpoint or UI
  yet (3/5, 4/5). `tsc --noEmit` + `cf-build` green; `wrangler deploy --dry-run` confirms the custom
  entry point bundles cleanly. **Requires the three `GOOGLE_OAUTH_*` secrets set via `wrangler secret
  put` before deploy — see Manual steps.**
- **P260** — `schedule_rows` migration (schema only, no worker/routes): new D1 table staging/holding
  the human-managed Google-Sheet schedule for the floor-facing `/v2/schedule` TV board. Keyed on
  `invoice_number` (parsed `INV \d+` from the sheet's DELIVERY TIME column), joining to the confirmed
  `jobs.invoice_number` column. Stores the raw sheet fields (ship week/date, day, customer, load
  count, method, location, delivery time, carrier, bdft, scrap pickup) plus `match_job_id` (TEXT,
  mirroring `jobs.id`) and a `sheet_status` fallback used only for unmatched rows. Idempotent
  (`CREATE TABLE IF NOT EXISTS`). New file `DB_Migrations/schedule-board.sql`. **Run in the D1
  console before deploying the v2 cron poller (2/5).**

---

## Loading Board (v2)

- **P306** — Removed the P301 logo sweep from `/v2/loading` and applied the same `--tv-safe-inset` (12px) hardware-overscan accommodation as the paired Schedule Board entry above (same root cause, same fix, same "not a CSS bug" caveat — see that entry for the full writeup). Removed the inline `LogoSweep` function, its render call, `LOGO_SWEEP_*` constants, and the `xp-loading-sweep`/`@keyframes xp-loading-sweep-kf` rules from `LoadingBoard.tsx`'s `TV_HARDENING_STYLE` (the `<style>` tag and its 3 render sites were removed entirely — `FreshnessClock` needed no injected CSS). `absolute inset-0` → `style={{ inset: "var(--tv-safe-inset)" }}` on the content wrapper. `tsc --noEmit` + `cf-build` green.
- **P305** — Fixed ~10px edge clipping on both TV boards, a regression from P304's pixel-shift removal. The removed shift layer was `position: absolute; inset: -12px`, which gave the inner content column a definite full-parent height; P304's unwrap replaced it with a static `<div className="flex flex-col">` (auto-height), so `flex-1 min-h-0` no longer resolved against the full parent height and the layout sat slightly off. Fixed by making the inner column `absolute inset-0` (fills the still-`relative overflow-hidden` parent exactly, no overscan, no motion) in both `LoadingBoard.tsx` and `ScheduleBoard.tsx` — identical one-line change in each. `tsc --noEmit` + `cf-build` green.
- **P304** — Board-wide notes, reversed bay order, and pixel-shift removal on `/v2/loading` (delta against P303 — modified in place, not rebuilt). **Notes**: new `DB_Migrations/loading-board-notes.sql` (single-row `loading_board_notes` singleton — no existing settings/kv table to reuse). `GET /v2/api/loading-board` now also returns `board_note` (from the singleton row); new `PUT` handler upserts it (`{ notes }`, ≤2000 chars, `updated_by` stamped from the `X-User-Name`/`X-User-Id` middleware header) — no middleware change needed since the existing `logistics.loading.tv` mapping already resolves GET→view / PUT→edit. `LoadingBoard.tsx` renders a slim full-width bar below the bay grid (moved there same-day per Steve's feedback — originally shipped between the header and the grid): view-only accounts see plain text (nothing rendered if the note is empty — no empty box on the wall); edit accounts (`isAdmin || permissions["logistics.loading.tv"].edit`) get a textarea + explicit Save button, saving on blur too. Local dirty/focused state means an in-progress edit is never clobbered by the 30s poll — the field only re-syncs from `board_note` when neither focused nor dirty. **Reversed bay order**: `ORDER BY lb.bay_number ASC` → `DESC` (bays 20–30 now render 30→20, matching the physical dock; `la.load_number ASC` unchanged so stacked loads stay in order). **Pixel-shift removed** (Steve reported motion discomfort) — see the Schedule Board section above for the parallel `/v2/schedule` removal; the loading board's own `.xp-loading-shift`/`@keyframes xp-loading-shift-kf` rules and wrapper class are deleted from `LoadingBoard.tsx`'s inline `TV_HARDENING_STYLE`, keeping the logo sweep and freshness clock untouched. No legacy files touched (roles.html/index.html already shipped in P303). `tsc --noEmit` + `cf-build` green.
- **P303** — View-only Loading TV board at `/v2/loading`, mirroring `/v2/schedule`'s architecture. New read-only `GET /v2/api/loading-board` (`cutting-pilot/src/app/api/loading-board/route.ts`) — one JOIN query (`loading_bays` LEFT JOIN `loading_assignments` filtered to the three "active in a bay" statuses `not_started`/`loading`/`loaded` LEFT JOIN `jobs`, no D1 100-bound-param risk), returns `{ generated_at, bays: [{ bay_id, bay_number, label, loads: [...] }] }` with every active bay present (`loads: []` when empty). New permission key `logistics.loading.tv`, genuinely independent of `logistics.loading` (exact-match `hasPermission`) so a kiosk/TV-only role can reach the board without the manual loading dashboard — wired into `middleware.ts`'s `PERMISSION_MAP` (both `/v2/api/loading-board` and `/v2/loading`) and `admin/roles.html`'s `PERMISSION_LABELS` ("Loading Board (TV)"). New components under `cutting-pilot/src/components/loading/`: `LoadingBoard.tsx` (30s poll, adaptive `auto-fit` grid sized off the live bay count so bays fit one screen without scrolling), `BayTile.tsx` (background tints to the dominant active load's status color — `loading` wins if present, else lowest `load_number`; empty bay = neutral surface), `LoadCard.tsx` (customer/invoice/trailer + own-status pill + `Load N of M`, graceful "— no trailer —"), `status.ts` (`LD_STATUS_COLORS` copied verbatim from `logistics/loading.html` — single hex source for this board). TV hardening (freshness clock, pixel-shift, 5-min logo sweep) is self-contained inside `LoadingBoard.tsx` via a scoped inline `<style>` block — deliberately **not** imported from `components/schedule/**`, so P301's schedule-board hardening and this board's are two independent implementations of the same technique (see BACKLOG.md follow-up to extract a shared `components/tv/`). Legacy edits (§8, the only two legacy files touched): home page Loading card gate widened to `data-permission="logistics.loading,logistics.loading.tv"` with per-button `data-perm-key` gating (confirmed the existing homepage JS already honors `data-perm-key` before relying on it) and a new "TV Board" button linking `/v2/loading`. No DB migration, no backend (`_worker.js`) change — `logistics.loading.tv` is enforced entirely by the v2 middleware, same pattern as `schedule`. `tsc --noEmit` + `cf-build` (`npm run cf-build`) green; both legacy inline `<script>` edits verified with `node --check` against real temp files.

---

## Database / API

- **P321** — Worker now serves `.js`/`.css` and `/sw.js` with `Cache-Control: no-cache` (ETag
  revalidation via `env.ASSETS.fetch`) instead of the prior 4-hour `max-age`, ending the
  shared-JS staleness window that let floor tablets keep running pre-deploy code for up to 4 hours
  after a push. Root cause of the "3 master BOL copies" report: after P317 shipped, tablets still
  holding the cached pre-P317 `bol-shared.js` (no `TEMPLATE_BY_COPY`) rendered three master copies
  while production/edge were correct. One-time `?v=317` flush of every non-archived
  `bol-shared.js`/`bol-compose.js` `<script src>` include (the two files P317 actually changed)
  unsticks tablets already sitting on a stale cached copy; no future JS/CSS deploy should ever be
  stale on the floor after this. `node --check` clean; `logistics/_archived/bol-generator.html`
  confirmed untouched.
- **P318** — Per-load ship date for split-shipment support (multi-load jobs shipping across several
  days). New nullable `loading_assignments.ship_date` column (NULL = "ships on the job's date");
  `jobs.ship_date` is never auto-touched — purely additive. New manager-gated batch write
  `PUT /api/loading-assignments/load-days` (`{ job_id, days: [{ load_number, ship_date }] }`,
  dispatched via the existing `/api/loading-assignments` prefix, no new `index.js` route row) —
  validates `YYYY-MM-DD` per load, updates `loading_assignments` by `(job_id, load_number)`, logs
  one activity entry per call. Jobs-list `loads_summary` aggregate added to `JOB_LIST_COLS`
  (`json_group_array` of `{n: load_number, d: ship_date, s: loading_status}` per non-archived load)
  so the job board can render the split badge without an extra fetch. New migration
  `DB_Migrations/add-ship-date-to-loading-assignments.sql` (single `ALTER TABLE ADD COLUMN`) —
  **manual D1 console run required before this deploys**; not committed (folder gitignored). First
  of three (P319 job board, P320 logistics). `node --check` clean.
- **P315** — `shipments` now persists `delivery_time` + `scrap_pickup` (previously dropped on every
  write path, so neither the logistics board nor a shipment-sourced BOL ever saw them, despite the
  logistics shipment modal already sending both). `_worker.js/routes/jobs.js`: the job-create
  handler's auto-shipment INSERT now binds the already-parsed `delivery_time`/`scrap_pickup` consts;
  `POST /api/shipments` parses both from the payload (mirroring the existing `trailer_number`
  pattern) and includes them in its INSERT; the `PUT /api/shipments/:id` allowlist gained both keys
  (fall through to the default `String(raw ?? "").trim()` branch, no special handling). `GET`
  already does `SELECT *`, so both surface to the frontend with no read-path change. New migration
  `DB_Migrations/add-shipment-delivery-scrap-columns.sql` (two `ALTER TABLE ADD COLUMN`s) —
  **manual D1 console run required before this deploys**; not committed (folder gitignored per the
  2026-07-31 policy). The BOL-compose scrap-pickup fix is the separate, independent P316.
  `node --check` clean.

## Logistics

- **P320** — Split-shipment: per-load ship-day pill on loading cards (`renderAssignmentCard` in
  `logistics/loading.html`, reading P318's `loading_assignments.ship_date` via the existing `la.*`
  read path); per-load BOL `date` prefilled from `ship_date` in `logistics/index.html`'s
  `openBolModalForJob` (`Object.assign`-ed over `base`, so unsplit loads keep `base.date` unchanged
  and split loads inherit their own day). Reuses the BOL's existing `date` field — `bol-shared.js`
  untouched, no coordinate change. Bay-view card render and shipping-info render parity deferred to
  `BACKLOG.md`. `node --check` clean on both files' extracted inline `<script>` blocks.
- **P317** — Reverted P310 (restored the 3-copy printed BOL: original/driver/customer) — the
  supervisor's actual complaint was the **signed-copy viewer** on the logistics dashboard showing
  two signed copies (Driver + Customer), which P310 never touched; the printed-BOL collapse was
  the wrong fix for that. Restored via `git revert b8bb420` (code auto-merged cleanly on top of
  P311–P313; only `CHANGELOG.md`/`BACKLOG.md` conflicted and were discarded in favor of this entry)
  — `logistics/bol-compose.js`, `logistics/bol-shared.js` (`TEMPLATE_BY_COPY`), `logistics/index.html`
  all back to their pre-P310 3-copy form. Existing driver/customer copy PDF assets untouched (never
  deleted by P310 in the first place).
  Real fix, Part B: delivery now captures a **single** signed copy of record — `track/index.html`'s
  `uploadSignedCopy` renders the plain `original` template (`copyType` `undefined`) and stores it as
  `doc_type = 'original_signed'` (driver/customer stamps only if explicitly requested elsewhere);
  the delivery-submit flow calls `uploadSignedCopy('original')` once instead of the old
  driver-then-customer double upload. `_worker.js/routes/public.js`'s doc-type validator accepts
  `original_signed` alongside the legacy `driver_signed`/`customer_signed` (kept for backward
  compatibility — no data migrated/deleted). The dashboard signed-copy viewer
  (`logistics/index.html`) now shows **one** link per BOL via `pickSignedDoc()` — prefers
  `original_signed`, falls back to the newest doc (API returns newest-first) so legacy
  driver/customer-only shipments still show a copy. No DB migration — `bol_documents.doc_type` is
  an unconstrained `TEXT` column (confirmed no `CHECK` constraint). `node --check` clean on
  `bol-compose.js`, `public.js`, and both edited inline `<script>`s.
- **P316** — BOL compose now carries Scrap Pickup from the job instead of hardcoding
  `is_scrap_pickup: 0` on every composed BOL. `logistics/bol-compose.js`'s internal job-picker path
  now reads `job.scrap_pickup` onto `td.scrapPickup`, and the payload maps it
  (`td.scrapPickup === 'YES' → is_scrap_pickup: 1`, else `0`) instead of the hardcoded literal.
  `logistics/index.html` carries `scrapPickup` on the from-job entry (`openBolModalForJob`) and
  seeds it on the blank/manual template so the map reads `'' → 0` cleanly — mirrors how
  `delivery_time`/`deliveryTime` already carry. `bol-shared.js` (rendering) untouched — populate-only
  fix. No manual override at compose time yet (tracked in `BACKLOG.md`). No migration.
- **P314** — Logistics dashboard calendar/list fix: the outbound/inbound calendar view now always
  shows all shipments regardless of the list view's week filter or "Show All" state.
  `setOutboundView`/`setInboundView` previously only re-rendered stale in-memory data on toggle;
  they now call `loadOutbound()`/`loadInbound()`, which already branch correctly (calendar mode
  drops the week filter and fetches `days=365`) — the toggle just wasn't invoking that branch.
  Also added **This Week** / **Next Week** quick buttons to the outbound list toolbar (next to
  "Show All"), via a new `setOutboundWeekOffset(weeks)` helper mirroring `setCurrentWeek()`'s
  week-input format. Inbound has no week input, so it's out of scope. Frontend-only,
  `logistics/index.html`. No migration, no API/permission change.
- **P311** — The loading dashboard's "Pull Job" search now expands multi-load jobs into one
  selectable row per load, joined from `allAssignments` (already in memory) by `job_id`. Each row
  shows "Load N of M" plus current placement (`Awaiting` or `On Bay {n} · {status}`); selecting a
  load and a bay routes through the existing `PUT /api/loading-assignments { id, bay_id,
  loading_status }` path to place that specific load's assignment on the chosen bay, rather than
  the prior job-level auto-pick. Single-load jobs render one plain row (no "Load 1 of 1"
  clutter); jobs with no in-memory assignments (e.g. customer-pickup, intentionally hidden from
  the board) fall back to the prior job-level `POST` auto-pick behavior unchanged. `selectPullJob`
  replaced by `selectPullRow`, which branches on `data-kind` (`job` vs `load`) to set either
  `pullJobSelectedId` or the new `pullJobSelectedAssignmentId`. The "Assign Bay" existing-assignment
  branch of `confirmPullJob` is untouched. Frontend-only — no worker, route, or migration changes.

- **P310** — Collapsed BOL PDF output to a single copy: the driver and customer copy pages are
  removed, leaving just the original page (which already carried the QR code and shipper
  signature — no coordinate or signature changes needed). The `for (const copyType of [undefined,
  'driver', 'customer'])` loop in both `logistics/bol-compose.js` and `logistics/index.html` now
  iterates `[undefined]` only. `bol-shared.js`'s dead `TEMPLATE_BY_COPY` map (driver/customer
  template PDFs) and the customer-copy QR suppression gate were stripped, since `opts.copyType` is
  no longer read anywhere in that file. Template PDF assets (`BLANK_BOL_Xpanda_driver.pdf`,
  `BLANK_BOL_Xpanda_customer.pdf`) are left in place — deletion tracked as a follow-up in
  `BACKLOG.md`.

- **P289** — the BOL ship-to attention line now renders its stored value verbatim instead of
  force-prefixing "attn: ", since the field is frequently used as a secondary address line.
  Applies everywhere via `bol-shared.js`. No data migration; existing values render as-is.
  Follow-up: `track/index.html` (the public driver/customer QR tracking page) formats the ship-to
  address independently of `bol-shared.js` and had its own hardcoded `'attn: ' + …` prefix — missed
  by the original scope, which assumed `bol-shared.js` was the only render path. Same verbatim fix
  applied there.

- **P288** — BOL edits made in the review/approval flow now survive re-view. The override diff was
  always persisted to `bols.render_overrides` but stored-view paths passed the raw DB row (where it
  is a JSON string) into `generatePdf`, which only reads the parsed `_overrides` — so re-view always
  rendered the original. Fixed with a single hydration step at the top of the `generatePdf` render
  loop (string → `_overrides`), fixing all three `viewBolForJob` callers at once with no caller
  changes. Note the no-clobber guard (approve path already sets the object) and fail-safe JSON
  parse.

- **P256** — Loading dashboard: hardened the status-transition notification dispatch in the
  `loading_assignments` PUT handler (`_worker.js/routes/loading.js`). Previously the
  `dispatchNotification` call ran **before** the `UPDATE loading_assignments` and was `await`ed with
  no try/catch — a VAPID error, stale push subscription, or any transient dispatch failure would
  throw, aborting the whole request and returning a 500 that dropped the status change itself, not
  just the notification. The transition block now stashes the computed notification (type, title,
  message) in a `pendingNotification` variable instead of dispatching immediately; the actual
  `dispatchNotification` call moved to right after the `UPDATE` succeeds, inside its own try/catch
  (mirroring the existing shipment-status-sync pattern in the same block), so a dispatch failure is
  logged and swallowed and can never block the status change or the operator's response. No change
  to `typeMap`, message strings, `notifTitle`, or which transitions notify; the QR/public path
  (`routes/public.js`) and the POST-handler's `loading.assigned` dispatch are untouched.

- **P253** — Driver QR scan: scoped transit/delivery to a single load, restored the In Transit
  notification. `_worker.js/routes/public.js`'s pickup/delivery handlers ignored `bols.load_number`
  entirely — scanning trailer 1's QR flipped **every** trailer on a multi-load job to In Transit
  (and later Delivered) at once. Both handlers now select `load_number` and apply the P170
  NULL-fallback match rule everywhere: a populated `load_number` scopes the `loading_assignments`
  UPDATE (and sets `in_transit_at`/`delivered_at`) to that one load; a NULL `load_number` (legacy
  single-BOL job) keeps the prior job-wide behavior. The job-level `shipments` flip to
  `in_transit`/`delivered` is now gated on **all** non-archived assignments for the job having
  reached that stage (a single count query after the write; zero assignments still counts as
  complete). Idempotency guards on both handlers now read the **matched assignment's** status
  instead of the job-level shipment, so a second driver's scan on a sibling trailer no longer
  short-circuits with `already: true`. `bol-lookup` derives `stage` from the matched assignment
  (falls back to job-level shipment if no assignment matches) so each trailer's QR page shows its
  own stage. Added a `loading.in_transit` dispatch to the pickup handler (previously only fired
  from the manual dashboard path) — message mirrors the manual path's voice, includes the trailer
  number when known, wrapped in try/catch so a dispatch failure never breaks the driver response.
  The existing `loading.delivered` dispatch now only fires once the job-level shipment actually
  flips (last trailer) to avoid per-trailer spam. No migration — `loading_assignments.load_number`
  (load-number.sql) and `in_transit_at`/`delivered_at` already existed. No DB migration, no
  `access_token` handling change, `track/index.html`/`loading.js` untouched.

- **P252** — Load Builder: fixed the REFRESH LOAD guard (from P251) — it compared column count
  before/after the re-pack, but compaction manifests as a **shorter load** (rows consolidating
  along trailer length), while columns-per-row stay flat or rise when the emptied lane gets filled.
  That made the guard true in exactly the case it was meant to handle, so the button always
  reported "already compact" and never shifted product. Replaced the column-count check with an
  arrangement-signature comparison (row length + per-column width + per-layer SKU×count) so the
  dense result applies whenever the actual arrangement changed; kept a distinct message for the
  true bail (`repackTrailerDense` returning the same `rows` reference, i.e. couldn't reconcile) so
  a genuine failure isn't mislabeled "already compact." `repackTrailerDense`, `trailerDims`, and
  `calcLoading` untouched. Frontend-only: `logistics/load-builder.html`. No migration.

- **P251** — Load Builder: customize now applies after DISSOLVE, plus a per-trailer REFRESH LOAD
  top-off compaction button. Two bugs fixed and one new control:
  (1) after committing a DISSOLVE, `getResult()` returned `state.committedTrailers` verbatim,
  bypassing `state.manualRowsByTrailer` entirely — so opening CUSTOMIZE, editing, and applying on
  a dissolved trailer silently discarded the edit. `getResult()` now layers manual rows over the
  committed trailers (via `buildTrailerStats`) exactly like the auto-pack path already does.
  (2) extracted `repackTrailerDense(rows, dims)` — a shared helper that densifies a trailer's
  current pieces by re-packing them through the untouched `calcLoading` (top-off only: never
  adds/removes pieces, never re-nests across trailers, bails to the unchanged rows if the re-pack
  can't reconcile exactly) — from `planDissolve`'s inline source re-pack block. `planDissolve`'s
  output is unchanged; only the inline block became a call to the helper. (3) new **REFRESH LOAD**
  button next to DISSOLVE → OTHER on each trailer card: runs `repackTrailerDense` on the trailer's
  current rows, writes the result to `state.manualRowsByTrailer[ti]`, and re-renders — shifts
  pieces to fill the empty width lane left after removing a column, without a full re-nest or any
  change to the auto-pack algorithm. Frontend-only: `logistics/load-builder.html`. No migration.

- **P250** — Multi-load BOL matching on loading bay cards. Each `loading_assignments` row
  (one per load, `load_number`) maps 1:1 to a BOL via that same `load_number` (P170's contract,
  with a NULL fallback for legacy single-BOL jobs) — but the card's View BOL button ignored it:
  `viewBolForJob(a.job_id)` always grabbed `data.bols[data.bols.length - 1]`, so every card on a
  multi-load job opened the same (last) BOL, and `bol_count` was computed per-job, so a card for
  a load with no BOL of its own still showed an enabled button that found nothing.
  `logistics/loading.html`: the button now passes the card's `load_number`
  (`viewBolForJob(a.job_id, a.load_number ?? null)`); the function matches `data.bols` by that
  `load_number`, falling back to a lone NULL-`load_number` legacy BOL, and alerts (no silent
  wrong-BOL) if nothing matches. `_worker.js/routes/loading.js`: `bol_count` in the assignment
  SELECT now counts only BOLs matching the assignment's own `load_number` (plus the same
  lone-legacy fallback), so the button disables correctly per-load. No migration, no permission
  change, trailer back-write/`bol-shared.js`/photo count untouched. `node --check` clean on
  `loading.js`; anchors re-confirmed single-occurrence pre/post edit.
- **P248** — Correct the flatbed orientation rule (supersedes the P246/P247 filter): flatbed
  parts are now forced to lie FLAT on their largest face — `buildDemand` keeps only the
  orientation where `length === longest side` and `height (stacking axis) === shortest side`
  (width = middle dim). P246/P247 only pinned the longest side to the length, leaving the on-edge
  orientation legal (e.g. a 96×21×3 stacking on its 3″ edge); this pins all three axes so it lays
  flat with the longest side down the trailer length. Orientation always exists → no SKU dropped;
  scoring math, `STORAGE_KEY`, box-truck downsize, and Holey Board unchanged. Frontend-only,
  `logistics/load-builder.html`.
- **P247** — Load Builder flatbed stacking constraint (companion to P246): on `48ft Flatbed`
  loads a part's longest side may no longer stand vertical (can't be stacked on its shortest
  side). Extends the P246 flatbed orientation filter in `buildDemand` to drop orientations whose
  across-width **or** vertical axis is the part's longest side — so the longest side must run
  along the trailer length. Cube / two-equal-long-side fallback retained; scoring math,
  `STORAGE_KEY`, and Holey Board unchanged. Frontend-only, `logistics/load-builder.html`.
- **P246** — Load Builder flatbed strapping constraint: on `48ft Flatbed` loads, a part's longest
  side may no longer be oriented across the trailer width (can't be strapped otherwise). Additive,
  flatbed-only filter in `buildDemand` — narrows the candidate orientation set (drops orientations
  whose across-width dimension is the part's max side; cube fallback keeps all) before the existing
  best-fit loop; flag threaded via `calcLoading` `options.isFlatbed` from the auto-result and
  dissolve-repack call sites (`state.trailerType === '48ft Flatbed'`). Scoring math, bundle logic,
  `STORAGE_KEY`, box-truck downsize, and Holey Board (early-return, never rotates) all unchanged.
  Frontend-only, `logistics/load-builder.html`.
- **P241** — Fix multi-load BOLs saving with `job_id = NULL`: the job prefill in `openBolModal()` (`logistics/load-builder.html`) was gated `state.prefillJobData && i === 0`, so "Pull from Job" only set `td.jobId` (and ship-to/carrier/contact/PO/date) on trailer index 0 — loads 2..N kept the initializer `jobId: null` and persisted orphaned, invisible to `GET /api/bols?job_id=` and therefore absent from P240's Documents section; their driver copies were never pulled up for signing (`bol_documents` had zero rows), and the token-preserving dedupe in `routes/bols.js` (gated on `payload.job_id`) never ran for them, stacking a fresh row per regeneration attempt (5 rows for INV 4149's loads 2/3). Fix, three parts: (1) gate dropped to `state.prefillJobData` so the prefill applies to every trailer; `td.invNumber` assignment changed to `td.invNumber || job.invoice_number || job.packing_slip_invoice || ''` so a per-trailer typed INV # override still wins (previously unconditionally overwritten). (2) New `DB_Migrations/backfill-bol-job-id.sql` relinks existing orphaned rows via `bol_group_id` (P170) — inherits `job_id` from any linked sibling in the same group; pre-P170 rows have no `bol_group_id` and can't be auto-relinked. Backfill restores the link only, not signatures — relinked loads with no prior signing show "No signed copies yet" and must be re-signed through the normal driver flow. (3) Worker guard in `_worker.js/routes/bols.js` POST handler: any incoming BOL with no `job_id` but a `bol_group_id` now inherits `job_id` from an already-linked sibling before the dedupe check runs, belt-and-braces against any client path that omits `job_id`. **Deployment order: run `backfill-bol-job-id.sql` in the D1 console first, then deploy worker + frontend.** `node --check` green on both files.
- **P240** — Shipment modal Documents section now shows signed BOL copies for every load, not just the first: `loadBolDocuments()` (`logistics/index.html`) rewritten wholesale. Root cause was threefold — the per-BOL `GET /api/bols/:id/documents` call was wrapped in an empty `catch (e) {}` that silently degraded any failure to `docs = []`, it only recognized one response envelope (`dRes.data.data`) so a differently-shaped success response also evaluated to `[]`, and the section had no load-number labelling so a multi-load job's cards were indistinguishable. Now: BOLs are deduped to the latest row per `load_number` (regenerations can leave stale rows), fetched in parallel via `Promise.all`, tolerate either response envelope, and log+surface real failures ("Could not load signed copies") instead of masking them as "No signed copies yet". Each card is labelled `Load N of M —` when `load_count > 1`; single-load jobs render unchanged. Each trailer's signatures remain independent — no propagation across `bol_group_id`. `deleteAllBolsForJob` still receives the raw (pre-dedupe) BOL count. Frontend-only, `logistics/index.html`. No worker, no migration, no change to `bol-shared.js`/`bol-compose.js`/`track/index.html`.
- **P237** — Load Builder dissolve source re-pack: after P236 made the dissolve diagram render truthfully, it exposed that `planDissolve` (P204) removes placed units from the source trailer *in place* — decrementing `layer.count` and dropping emptied layers/columns/rows — leaving partially-emptied rows full of holes (a 4-wide row down to 2 columns still occupies its full `rowLength`). The source trailer's leftover layers are now bundled into a synthetic cart (`skuId → qty`) and re-packed from scratch through the untouched auto-pack (`calcLoading(leftoverCart, state.skus, dims, state.variant)`), replacing the fragmented `srcRowsLeft` with dense rows. Mandatory safety bail: only adopted when `calcLoading` returns exactly one trailer whose `totalUnits` matches the leftover piece count exactly — any other outcome (2+ trailers, thrown error) keeps the fragmented rows unchanged, never drops/duplicates pieces. Re-packed rows arrive with correct geometry straight from `buildRow`, so P236's `reflowRowGeometry(sv.rows)` is a no-op over them and stays as-is. Receiving trailers are untouched (topped off in place, no holes to repack). `calcLoading`/`buildColumn`/`buildRow`/`buildDemand`, `STORAGE_KEY`, the move-planning loop, preview modal, `dissolveSig`, `commitDissolve`, and UNDO path all untouched. Frontend-only, `logistics/load-builder.html`. Builds on P236.
- **P236** — Load Builder dissolve geometry reflow: `planDissolve` (P204) mutated `col.layers`/filtered rows/columns but never reassigned stored layout geometry, so `buildTopViewSVG`/`buildPrintSvg` drew the source trailer's surviving rows at their stale pre-dissolve `posFromFront`/`posY` — overlapping the hatched remaining-length band — while receiver trailers' `rowWidthUsed` (and derived FLOOR USED %) drifted. New `reflowRowGeometry(rows)` helper reassigns `posFromFront` cumulatively across rows and `posY` cumulatively across each row's columns, and recomputes `rowWidthUsed`, mirroring the existing customize-mode `rebuiltRows` pattern. Called on every survivor (source + receivers) immediately before `buildTrailerStats` in `planDissolve`. `calcLoading`/`buildColumn`/`buildRow`/`buildDemand`, `STORAGE_KEY`, and `recomputeColumnGeom`'s contract untouched. Frontend-only, `logistics/load-builder.html`.
- **P223** — Loading Dashboard "Pull from Job" defaults the bay dropdown to the drilled-in bay in Team View: `openPullJobModal()` now pre-selects `selectedBayId` when the single-bay panel (`#ld-bay-view`) is visible; gated on panel visibility rather than `selectedBayId` (which `backToBayList()` leaves stale) so overview + bay-grid still default to "Awaiting Queue". Frontend-only.
- **P222** — Loading Dashboard "Move back to bay" for yard trailers + Team View trailer-# fix: (1) manager-only "Move back to bay" button on yard cards (`location==='yard'`, not in_transit/delivered/archived) → new `revertYardToBay()` PUTs `{ location:'bay', bay_id:null, loading_status:'awaiting' }`, returning the trailer to the awaiting queue for manager bay re-assignment; existing `in_transit` `revertToBay` (undo In Transit) untouched. Worker gates the `location:'bay'` (from yard) transition behind `logistics.loading.manage` and logs the revert. (2) Fixed Team View trailer-# mismatch — the drilled-in bay header (`renderBayView`) selected its active job from an unfiltered `bayAssignments`; now filtered to `['not_started','loading','loaded']` to match the bay grid + overview, so the header trailer agrees with the card inputs. Frontend + worker; no migration.
- **P221** — Delivery Incident capture on the shipment edit modal: "Delivery incident?" checkbox at the bottom of the modal body reveals a free-text details box when checked; persisted to `shipments` (`delivery_incident` flag + `delivery_incident_notes`) and re-rendered on reopen. Migration `add-delivery-incident-to-shipments.sql`; POST/PUT in `_worker.js/routes/jobs.js` carry both fields (GET surfaces via `SELECT *`; existing `logActivity` covers the change). Frontend `logistics/index.html` (markup + openModal populate + clearForm reset + saveShipment payload + `toggleDeliveryIncident`). **Run migration in D1 before deploying worker.** `node --check` green.
- **P215** — Fix Loading Dashboard "Pull Job": jobs auto-create `awaiting` loading cards at creation, so the Pull-Job POST always tripped the `currentCount >= maxLoads` guard ("all loads assigned"). POST handler now, when a job is at its load cap **and** a `bay_id` is supplied, adopts an existing unbayed `awaiting` card (sets bay + `not_started`, syncs shipment) instead of erroring; errors clearly with "All loads for this job already have bays assigned." only when no awaiting card remains. Awaiting-queue pulls with no bay keep the prior message. Worker-only (`_worker.js/routes/loading.js`); no migration, no frontend change.
- **P204** — Load Builder "Dissolve trailer into other trailers": per-trailer `DISSOLVE → OTHER` button (shown when >1 trailer) tops off existing compatible stacks on the other trailers (footprint match `rowLength`+`colWidth`, any product, gated by remaining headroom and receiving `maxWeight`). Best-effort — places what fits, shrinks the source in place, removes it only when emptied. Preview modal (per-SKU move list + outcome) → APPROVE & COMMIT. Commit writes a new `state.committedTrailers` override consumed by `getResult()` and auto-invalidated by a cart/type/runner/variant signature; `UNDO DISSOLVE` button reverts; persisted in saved-load `state_json`. Reuses `mergeLayers` + `buildTrailerStats` only — auto-pack algorithm, `STORAGE_KEY`, and column/row footprints untouched. Frontend-only, `logistics/load-builder.html`.
- **P192** — Auto-populate ship date next to shipper signature: `shipperDate` coord added (`x: 157, y: 48, size: 8`); after the cursive shipper-signature block, `_displayDate` is drawn at that coord via the regular `drawText` helper. Reuses the already-computed `_displayDate` so the signature-area date always agrees with the top-right date and respects any `date` override. Renders on all copies (default/driver/customer). Frontend-only, `logistics/bol-shared.js`.
- **P191** — BOL surgical adjustments (`bol-shared.js`): (1) BOL/INV # font size 18→22; (2) POC (Contact Info) field moved up 30 points (`y: 495→525`); (3) PO block split — bold `PO:` label rendered in `fontBold`, PO number offset by the measured label width in regular font; override (literal-lines array) path unchanged and still uses `drawMultiline`. Updated blank BOL template PDFs (driver + customer copies). Frontend-only.
- **P190** — Loading Dashboard: search bar + current-week default filter (Mon–Sun) with Show All toggle (Overview only). New state vars `ldSearchTerm` / `ldShowAll`; helpers `ldCurrentWeekRange`, `ldInCurrentWeek`, `ldMatchesSearch`, `ldOverviewSet`, `toggleLdShowAll`; search input and "This Week" toggle button inserted before sort select in toolbar (token-only colors). `renderOverview` pulls a single `ldSet = ldOverviewSet()` working set and routes all five section filters through it; `renderBayList`/`renderBayView` (Team View) are untouched. Search bypasses the week filter; assignments with no `ship_date` are always visible. Frontend-only, `logistics/loading.html`.
- **P189** — Loading-assignments GET hides customer-pickup jobs (read-side guard: `COALESCE(j.method, '') != 'customer pickup'` added as first condition so jobs method-changed to pickup after an assignment existed no longer appear on the dashboard); bidirectional Loading/Loaded status sync from logistics dashboard — `SHIPMENT_TO_JOB_STATUS` gains `loading: 'loading'` and `loaded: 'loading'` entries; mirror block in shipments PUT widened from `['in_transit', 'delivered']` to `['loading', 'loaded', 'in_transit', 'delivered']` so logistics-dashboard status changes propagate back to `loading_assignments`. Worker-only: `_worker.js/routes/loading.js` + `_worker.js/routes/jobs.js`. No migration, no frontend.
- **P188** — Logistics fixes: (A) added missing `bol-editor.js` `<script>` tag to `logistics/index.html` so the BOL Edit step in the shipment modal renders correctly; (B) manager-only "Move back to bay" button on in_transit loading cards in `logistics/loading.html`; (C) `_worker.js/routes/loading.js` server guard blocks non-managers from reverting out of `in_transit`, clears `in_transit_at` on revert.
- **P187** — Fixed `/api/jobs` 500 "too many SQL variables" crash: line-items `SELECT` for large job lists now chunks job IDs into groups of 90 (D1's 100-variable limit, with headroom) in `_worker.js/routes/jobs.js`.
- **P186** — Dark-mode platform token swap (9 modules, one pass): applied all Bucket A token substitutions from `dark-mode-audit.md` across logistics, job board, shared, production, QC, and reports. Files changed: `logistics/loading.html` (style block + inline modal styles, ~26 subs), `logistics/logistics-shared.css` (`.cal-more:hover` → `--link`), `logistics/index.html` (BOL viewer modal, job-linked-note banner, signed BOL section, loading photos heading, job picker, calendar nav, line-items, ~15 subs), `logistics/bol-compose.js` (review-modal markup + hide-dims/siplast labels, ~13 subs), `jobs/index.html` (list-view table, calendar nav, dropzone, packing slip link/iframe, renderListTabs JS, row styles, BDFT badge, BOL close button, ~18 subs), `jobs/jobs-shared.css` (`.jobs-back-link` → `--link`), `shared/shared-header.js` (notifications, push banner, mode/theme toggles, footer user bar, ~10 subs), `shared/components.css` (`.badge-warning`/`.badge-info` text colors), `shared/photo-gallery.js` (thumbnail border/bg + error text), `production/production-shared.css` (`.prod-badge` → warn tokens, `.prod-back-link` → `--link`), `production/inventory.html` (empty state, modal close, job banner, molding-days select, cm-job-label banner), `production/bead-inventory.html` (`.bead-silo-meta`, `.bead-empty-row`, all inline `color:#94a3b8` → `var(--text-hint)`), `qc/qc-shared.css` (`.qc-back-link` → `--link`), `reports/reports-shared.css` (`.reports-back-link` → `--link`, `.reports-badge:hover` → `--ghost-bg`), `index.html` (`.hp-denied-banner` → rgba danger tints + `var(--danger-bg)` text). All Bucket B items (status-color maps, toast surfaces, photo overlays, BOL iframe surround, semantic semantic colors) preserved. No worker/migration/admin/load-builder/track file touched.
- **P185** — Dark-mode token foundation (`shared/tokens.css`): additive-only — adds `/* Links + banners */` group in both `:root` (light) and `:root[data-theme="dark"]` (dark). New tokens: `--link` (#0074cc light / #60a5fa dark), `--info-bg/border/text` (solid blue tints light / rgba(59,130,246) dark), `--warn-bg/border/text` (solid amber tints light / rgba(245,158,11) dark). No existing token altered; no module files touched. Prerequisite for dark-mode fix batches (P186+).
- **P184** — Dark-mode legibility audit (`dark-mode-audit.md`): report-only inventory of ~91 Bucket A hardcoded-color hits across 11 modules. Worst offenders: Safety (zero token adoption, fully broken), Loading Dashboard (63-hit inline `<style>` block), Logistics/bol-compose modal, Job Board List view (P182 introduced ~12 hardcoded inline styles). Identifies 3 missing tokens needed before fix batches (`--link`, `--info-bg/border`, `--warn-bg/border`). Recommended fix order: Safety → Loading Dashboard → bol-compose modal → Logistics → Job Board → Load Builder → Shared → Production → QC+Reports → track/ → Homepage. No code changes.
- **P183** — Job Board List view: inline status dropdown on editable rows (Not Started / In Production / Done); read-only pill for logistics-driven statuses (loading/shipped/archived); `listStatusChange` delegates to existing `moveCard` (optimistic update, server PUT, revert on failure, bead prompt on Done); clicking the dropdown stops row-click propagation.
- **P182** — Job Board: new dense List view as the primary/default view; Kanban and Calendar retained as toggles. Features: status filter tabs with live counts, customer/invoice search, "This Week" filter (Mon–Sun), sortable columns (INV#, Customer, Ship Date, BDFT — default ship date asc), color-coded status pill, loading status dot (from P181), row-click opens job modal. `currentView` defaults to `'list'`; init loads all jobs (no week pre-filter). `renderList`, `renderListTabs`, `listFilteredJobs`, `sortList`, `setListTab`, `listSearchChanged`, `toggleListWeek` all client-side; no worker/DB changes.
- **P181** — Loading status badge on Job Board kanban cards: `loading_status_indicator` subquery added to `JOB_LIST_COLS` (returns least-complete active assignment status); color-coded `●` badge renders on each card (red Not Loaded, gray Awaiting Bay, amber Loading, green Loaded, indigo In Transit, teal Delivered); no badge for jobs with no active loading assignments. Logistics BACKLOG trimmed: shipped items (loading status indicator, Load tab polish, remove-dims, Siplast, scrap coords, AppSheets exploration, archived-order build-load, bol-generator multi-trailer) removed; customer DB note icebox'd; BOL print bug updated with root-cause note.
- **P180** — Siplast Product toggle on the BOL modal: `siplast INTEGER DEFAULT 0` column added to `bols` (migration `add-siplast-to-bols.sql`); worker INSERT carries the flag; `bol-compose.js` adds `siplast: false` to modal state, saves `siplast` in the POST payload, and renders a "Siplast Product?" checkbox in the commodity panel (below hide-dims); `bol-shared.js` prefixes the SKU inside parentheses — `(HB-10)` → `(Siplast HB-10)` — when `bol.siplast` is set. Non-Siplast BOLs unchanged. **Run migration in D1 before deploying worker.**
- **P179** — Logistics dashboard action-button column alignment: actions cell wrapped in `.logistics-actions-cell` flex container (right-aligned, wrapping, 4px gap); col 5 (BDFT) 9%→7%, col 6 (BOL #) 8%→6%, col 9 (ACTIONS) 19%→23% — total stays 100%.
- **P178** — "Hide tracking QR code" checkbox on the BOL modal footer (default unchecked — QR shows by default). When checked, `generateCombinedCopies` passes `hideQr: true` to `BolShared.generatePdf`, and `bol-shared.js`'s QR block is gated behind `!opts.hideQr`. Generation-time only — saved BOLs re-render with QR on "View BOL". Customer copy is unaffected (already never gets the QR).
- **P177** — BOL popup self-contained styling + remove QUANTITIES panel: `bol-compose.js` injected CSS gains `.bol-modal`-scoped `.panel`/`.panel-title`/`.inp`/`.btn`/`.btn-dark`/`.btn-white` rules (mirroring load-builder's values, with CSS token fallbacks) so the modal looks identical on any host page without relying on host-provided generic classes. The P171 editable QUANTITIES panel is removed — it was redundant clutter (header already shows pcs/stacks; load-builder derives them from the pack). No visual change on load-builder; dashboard popup now renders with full styling.
- **P176** — Archive `bol-generator.html` (moved to `logistics/_archived/`): dashboard "BOL Generator" button now opens a blank `BolCompose` popup via `openBlankBolModal()` (same modal as load-builder/P171 launcher, all fields blank for manual entry); permission gate selector extended to `.bol-generator-link` class; homepage Logistics card "BOL" button removed. BOL viewer z-index bumped 1000→1100 so it no longer renders behind the shipment modal. No worker/CSS/`bol-compose.js` changes.
- **P175** — Gate "Mark In Transit" to managers: loading-team cards no longer show the advance button when `next === 'in_transit'`; `_worker.js/routes/loading.js` 403s any non-manager/admin PUT that transitions to `in_transit`. Driver QR-scan pickup path (`routes/public.js`) is untouched.
- **P174** — Manager-only "Delete all BOLs" for a job: new `DELETE /api/bols?job_id=` endpoint in `_worker.js/routes/bols.js` cascades through `bol_documents` rows and R2 objects before deleting all `bols` rows; existing single-id delete also gains the manager gate. Documents section in `logistics/index.html` shows a "Delete all BOLs" button (managers only); `deleteAllBolsForJob()` confirms, calls the endpoint, refreshes Documents + board. No migration needed.
- **P171** — Logistics dashboard BOL launcher + editable quantities: "Generate BOL" on the logistics dashboard now opens the shared `BolCompose.open()` modal (same engine as load-builder) instead of navigating to `bol-generator.html`; `openBolModalForJob()` fetches the job, builds `trailerData` (one record per `load_count`, multi-load for free), and pre-fills ship-to/carrier/PO/commodity from the job (pieces seeded from line-item qty); `bol-compose.js` loaded on `logistics/index.html`. Editable QUANTITIES panel (Pieces / Stacks / Weight) added to the modal's `render()` after the commodity panel — load-builder pre-fills from the pack, dashboard launcher leaves blank for user entry. `bol-generator.html` remains reachable by direct link. Frontend-only.
- **P170** — BOL multi-load group linking foundation: new migration `add-bol-group-linking.sql` adds `bol_group_id TEXT`, `load_number INTEGER`, `load_count INTEGER` to `bols` + index; worker INSERT updated (38→41 placeholders, column list, bind args); `bol-compose.js` `generateAll()` mints one `bolGroupId` (UUID or fallback) per multi-load run and stamps `bol_group_id`/`load_number`/`load_count` into each per-record save payload — singles get `null`. No GET change (`SELECT *` surfaces new columns automatically). **Run migration in D1 before deploying worker.**
- **P169** — Loading Team View batch: (1) bay-list items color-tinted by active-job loading status with status-label badge (`renderBayList`); (2) active-job trailer # surfaced on the bay-list header line and on the drilled-in single-bay header, with larger header text + field spacing; (3) fix trailer "needs two saves to stick" — `updateAssignmentTrailer` now patches the in-memory `allAssignments` model on success so re-renders no longer overwrite the input with a stale value; (4) status-color disambiguation — `delivered` re-keyed emerald→teal (`#0d9488`) so all six statuses are unique. Frontend-only, `logistics/loading.html`. Also closes the rest of the "New Batch — Loading Dashboard + Driver + BOL Alignment" cluster: trailer-input-clear-on-transit and driver-QR-force-in-transit verified already-shipped (card re-render / `public.js` pickup handler), and DocuSign-on-driver-pages superseded by native signature capture (P154–P155).
- **P168** — Double BOL signature stamp box height (16→32 pts) for customer and carrier slots in `track/index.html`; date slot unchanged; pdf-lib bottom-left origin means signatures grow upward from baseline `y`. (58447f7)
- **P167** — Fix signed BOL copies never displaying in the Documents section: `/api/bols/:id/documents` returns `{ ok, data: [...] }` so the array lives at `res.data.data`, not `res.data`; `Array.isArray(dRes.data)` was always false, always returning `[]`. (7f419d0)
- **P166** — Remove Recent BOLs sidebar from BOL generator: sidebar markup deleted, `.bol-columns` changed to `display:block` (full-width form), `loadRecentBols` function and all three call sites removed; `loadBolIntoForm` preserved. (0016cf9)
- **P165** — Logistics dashboard "View BOL" renders the BOL inline (combined 3 copies) instead of navigating to the generator: pdf-lib/qrcode/fontkit/bol-shared loaded; `viewBolForJob()` fetches the latest BOL and renders original→driver→customer into an in-page modal with a Download button; calendar-popup and action-button links rerouted; "Generate BOL" link preserved for jobs without a BOL. (0016cf9)
- **P164** — Combined 3-copy BOL output via shared `generateCombinedCopies` helper in `bol-compose.js`: iterates `[undefined, 'driver', 'customer']`, merges pages into one PDF, appends packing slip once; both `generateBolPdf` (load-builder) and `rrRegenerate` (bol-generator) route through it for output parity. (db971fe)
- **P163** — Fix cursive font path case crash: `FRSCRIPT.ttf` → `FRSCRIPT.TTF` (Cloudflare Pages is case-sensitive); added byte-guard to detect HTML-shell responses masquerading as font bytes (content-type check + 4-byte magic number); wrapped `embedFont` in its own try/catch so any future font failure degrades to no signature rather than crashing all BOL rendering. (87c0a89)
- **P162** — Fix driver signature submit: `uploadSignedCopy` was calling `generatePdf` without `previewOnly`, causing the non-preview branch to fire — opening a blank tab with the unsigned BOL and returning `undefined`, which crashed before `stampCopy` or the upload fetch could run (throw swallowed by empty `catch`). Fix: add `previewOnly: true`; also surface real error messages in the catch block via `console.error` + descriptive `alert`. (a6ca681)
- **P161** — Cursive shipper signature on all BOL copies: `@pdf-lib/fontkit` loaded before `bol-shared.js` on all 4 BOL pages; `bol-shared.js` fetches `FRSCRIPT.ttf` once per render (null-safe), registers fontkit, embeds the cursive font per-document, and draws `bol.shipper_name` at `COORDS.shipperSignature` on every copy (default/driver/customer); gracefully skips if font/fontkit unavailable. `bol-compose.js` injects `shipper_name` from `window.__xpandaUser.displayName` into the pre-save review preview. **Placement is a placeholder — tune in bol-test (#3).** (69081fb)
- **P160** — Shipper auto-sign foundation: `bols.shipper_name` column (migration `add-shipper-name-to-bols.sql`); BOL POST resolves the generating user's `display_name` from `users` via `X-User-Id` session header and stores it — authoritative, not client-trusted. No rendering yet (that's prompt #2). **Run migration before deploying worker.** (60d226e)
- **P159** — Both signed copies stamp customer sig + carrier sig + signing date at tuned coords: `SIG_COORDS` replaced by tuned `SLOTS`; `stampSignature` replaced by `stampCopy` which embeds customer sig image, carrier (driver) sig image, and today's date on every copy; `uploadSignedCopy` simplified (no pad arg); driver copy still carries the QR from `bol-shared.js`. (f792ea7)
- **P158** — `bol-test.html` three-slot placeholder upgrade: replaces the single "Signature" box with three labeled red boxes — Customer Sig, Carrier Sig, Date Signed — all drawn on both driver and customer copies at the same coords; box renders whenever a copy type is selected, enabling visual tuning of all three stamp positions before they go into `track/index.html`. (coords are best-guess starting values — tune then copy to track/)
- **P157** — `bol-test.html` copyType toggle + "Signature" coord-tuning aid: Copy type selector (Default / Driver / Customer) added above the Render button; selecting a signed copy type passes `copyType` through to `BolShared.generatePdf`, then stamps a red "Signature" placeholder box (via pdf-lib) at the matching `SIG_COORDS` position used by `track/` — lets QR box and signature box both be dialed in visually without touching the live driver page. (bd4aa2d)
- **P156** — Documents section in shipment modal: `#modal-documents` container added below `#modal-actions`; `loadBolDocuments()` fetches linked BOLs via `/api/bols?job_id=` then requests `/api/bols/:id/documents` for each; renders a card per BOL with a "View BOL" link and labeled links for any stored signed copies (driver/customer from R2); falls back to "No signed copies yet"; cleared on new-shipment form open. (273b480)
- **P155** — BOL Signatures #4 — customer signature capture: `customerSigPad` added to delivery form between driver pad and submit button; wired via `initSignaturePad`; `updateSubmitState` gate requires both pads signed; `uploadSignedCopy('customer', customerSigPad)` called on submit (after driver copy), storing a `customer_signed` PDF rendered with the customer template (no QR). (7af1b60)
- **P154** — BOL Signatures #3 — driver signature capture: `track/index.html` loads pdf-lib + qrcode + bol-shared; signature pad infrastructure (`initSignaturePad`, `stampSignature`, `bytesToBase64`, `uploadSignedCopy`, `SIG_COORDS`) added; driver pad added to delivery form; submit gated on pad non-empty; driver copy rendered, stamped, and POSTed to `/api/public/bol-document/:token` as `driver_signed` before the delivery confirmation request. `public.js` lookup widened to `SELECT *` so the client has all fields needed for `generatePdf`. Note: `SIG_COORDS` values are best-guess — tune after first real render. (d31412a)
- **P153** — BOL Signatures #2 — `generatePdf` copy-type support: `TEMPLATE_BY_COPY` map routes `opts.copyType === 'driver'` → `BLANK_BOL_Xpanda_driver.pdf` and `opts.copyType === 'customer'` → `BLANK_BOL_Xpanda_customer.pdf`; no `copyType` falls back to the original template. QR code block gated on `opts.copyType !== 'customer'` so the customer copy never renders a tracking QR. Callers that pass no `copyType` are unchanged. (ed9cdf0)
- **P152** — BOL Signatures #1 — `bol_documents` foundation: new `bol_documents` table (migration `add-bol-documents.sql`); public token-scoped `POST /api/public/bol-document/:token` stores a signed PDF in R2 under `signed-bols/<bolId>/`; authed `GET /api/bols/documents/:docId` serves it; authed `GET /api/bols/:id/documents` lists stored copies. Does not touch the existing delivery-photo (`signed_bol_photo_key`) flow. **Run migration before deploying worker.** (997842c)
- **P149** — BOL download on approve (Load Builder): the `showReview()` approve handler in `bol-compose.js` now triggers a real file download (`<a download>`) instead of opening the PDF in a new tab; blob URL revoked after 30 s. The `bol-generator.html` standalone path (`reviewRecords`/`rrApprove`) is unchanged. (298e71c)
- **P148** — Build Load + BOL actions in the logistics edit modal: `#modal-actions` bar added at the top of the shipment modal body; populated by `buildActionButtons(s)` when a shipment is opened from calendar or list view; cleared in `clearForm()` for new-shipment modal. Requires P147 for accurate "View BOL" label. (451f934)
- **P147** — "Generate BOL" → "View BOL" on logistics dashboard: correlated `bol_count` subquery added to the shipments GET query; `buildActionButtons()` reads "View BOL" when `bol_count > 0`, otherwise "Generate BOL". (451f934)
- **P144** — Trailer→BOL back-write: when a trailer number is set/changed on a loading assignment, `bols.trailer_no` is updated automatically so it renders on next BOL view/download. Scoped to single-BOL jobs only; multi-BOL jobs silently skipped (multi-trailer matching is a separate backlog item). (4d684be)
- **P143** — Load count reconcile on job PUT: increasing `load_count` inserts new `awaiting` loading-assignment cards; decreasing drops only surplus safe cards (unbayed + untrailered + awaiting + no photos). Customer-pickup jobs bypass. Resolves the loading-dashboard card drift. (5fd71d0)
- **P142** — Gate "Move to Yard" behind `logistics.loading.manage`: button hidden for non-managers on the loading dashboard; server-side 403 guard on `location=yard` PUT. No new permission key — reuses `logistics.loading.manage`. (4d684be)
- **P138** — Durable PO-number fix on BOL save: `po_number` column + migration, worker INSERT/UPDATE, bol-generator field wired end-to-end. (34621c8)
- **P136** — Restore `saveLoad`/`openLoadModal` in Load Builder; un-sticky LOAD LIST header; preserve SKU grid scroll position on category-rail switch. (07cd40b)
- **P135** — Move Saved Loads and Pull From Job into the tab nav row; remove the now-empty options bar. (55ebe05)
- **P134** — Condense Load-tab options bar; fix active-tab contrast in dark mode. (ab5e8e7)
- **P133** — Loading dashboard dark-mode card scheme: token-based surface/border/status-tint replaces hardcoded pastels; Photos and View BOL buttons render disabled when nothing is attached. (14021fe)
- **P132** — Add non-collapsible Yard section (`#ld-yard-team`) to Loading Team View, below the bay list; populated by `renderBayList()` reusing existing yard filter and card renderer. (f35f1b3)
- **P131** — Condense Load tab: fixed-height internally-scrolling SKU grid; sticky LOAD LIST/Calculate bar; Force Trailer Sizes collapsed behind Advanced disclosure. (b847216)
- **P130** — SKU picker CSS hotfix: remove dead `.load-builder-app` scope; rename `.sku-grid`/`.sku-card` → `skp-*` to eliminate pre-existing class collision. (a402112)
- **P129** — Load Builder SKU picker redesign: master-detail layout (category rail + card grid) replaces the long flat list; cart and auto-pack algorithm untouched. (b5f2051)
- **P128** — Hotfix: inject BOL review modal lazily (was crashing IIFE at head-eval, leaving `BolCompose` undefined and breaking load-builder render); fix dangling `closeBolReviewLB` ref. (a12bae3)
- **P127** — BOL re-unification phase 4: `bol-generator.html` adopts shared `BolCompose.reviewRecords()` review surface; removes duplicate review modal/handlers; preserves overrides on re-save. (4cdfbcc)
- **P125–P126** — BOL re-unification phases 2+3: `BolCompose` takes ownership of the full BOL flow (modal + generate + save + review); both consumers run one engine. (8796fc6)
- **P123** — BOL re-unification phase 1: `bol-compose.js` scaffold with own `h()` helper and injected modal CSS; logistics CSS lifted out of `load-builder.html`; zero behavior change. (6b71666)
- **P122** — BOL editor free-drag all fields (`{dx,dy}` PDF-point deltas stored under `_pos` in `render_overrides`, no migration; double-click reset); delivery-time field changed to multiline override-only. (27cd320)
- **P119–P121** — Trailer # lifecycle: input on card (manager + bayed + pre-transit only); read-only at in-transit+; released on delivered; server 409 conflict guard. Bay-view drag disabled entirely (button-only status changes); manager-only drag in overview with server guard. (33b0433, 7c0a42b)
- **P115–P118** — Loading dashboard: overview bay grid reflow 6×5; card status color-coding (not_started→red, loading→amber); detail-view timestamps (`fmtTs()`, hidden until captured); BOL output dev-harness (`logistics/bol-test.html`). (33b0433)
- **P109** — Load Builder: fix false skip-warning; accurate orientation labels; single-trailer box-truck auto-downsize. (6c92d0e)
- **P93–P94** — The Yard: `location` flag on `loading_assignments` ('bay'|'yard'); Move to Yard frees bay, preserves assignment; unbounded Yard section with full card actions (Mark In Transit / View BOL / Photos). Load Builder "Pull from Job" button (reuses `prefillFromJob`, append mode); fix BOL editor sizing inside load-builder modal.
- **P90–P92** — Soft Rollout Batch: logistics row header parity (INV# + load count primary, customer secondary, natural sort by INV#); status write-through (logistics PUT reverse-syncs `jobs.status` + `loading_assignments`, re-queues card on "ready to ship"); Customer Pickup exclusion (skips loading-card auto-create for `method='customer pickup'`).
- **P88–P89** — Front-door reskin + logistics dashboard reskin. (aa59ab5)
- **P82–P84** — BOL driver tracking system: QR scan → pickup confirm → delivery photo uploaded to R2 + signed-BOL storage; push notification to office on driver delivery; QR code coords nudged to green-box position. (7982144, 11b07b9, cae5688, da1ad91)
- **P71–P73** — Loading dashboard card resize/collapse + PDF view in load-builder review modal; primary info display reordered. (b97ddf6)
- **P70** — Relocate BOL record picker to header strip in load-builder review modal. (ae0fd71)
- **P68–P69** — BOL inline editor persistence: `render_overrides` JSON column on `bols`; worker INSERT/UPDATE wiring; `loadBolIntoForm` rehydrates overrides; editor ported to load-builder. (0fb02cf)
- **P66–P67** — Shared overlay editor engine (`bol-editor.js`): per-field drag with `{dx,dy}` override model, drag handles; BOL COORDS refinement: commodity centered (`center: true`), auto-sized by wrapped line count (`pickCommodityTier`), delivery-time font enlarged to `size: 24`. (fbd79aa)
- **P65** — Read-only line items on logistics shipment modal. (d7af121)
- **P64** — Fix status badge pills; remove job-linked note. (771b6dd)
- **P61–P63** — Logistics modal rebuild: job-mirrored modal, status fix, CSS for action buttons; `syncJobFromModal` refactor; show Build Load/BOL for all job-linked shipments. (acd24c3, 5e226df, 40a30d5)
- **P59–P60** — Job as source of truth: backend sync overhaul; logistics dashboard action buttons. (203af68)
- **P53–P58** — Loading dashboard milestone: saved loads to D1; BOL review/approve flow (stop auto-download); Part#/qty-only toggle on BOL generator; Mark Loaded checklist (3 confirm questions + photo upload); load count multi-assignment (N cards for `load_count > 1`); View BOL from loading cards; status sync. (1b340eb)
- **P50** — Logistics calendar view: List/Calendar toggle on outbound and inbound boards. (ee1d026)
- **P49** — Sync loading statuses to shipments; remove `delivery_date`. (73f376b)
- **P47** — Loading Team View (bay-grouped card list) + mobile performance fixes. (0f683eb)
- **P45** — Mobile-first loading dashboard: header cleanup, backfill, touch drag-and-drop. (4009b43)
- **P35** — Load Builder & BOL UI fixes. (9f3a343)
- **P34** — Load Builder BOL fixes: contact info, PO field, carry-over between forms. (8cf3d3c)
- **P31–P32** — Bundle qty on parts (`bundle_qty` field; auto-pack snaps to bundle multiples); full 6-axis rotation for non-holey-board parts to maximize trailer load. (5ff34b8)
- **P28** — Load builder: saved loads to D1, BOL duplicate fix, auto-increment suffixes, customize drag-drop. (a454f91)
- **P25** — Shared BOL module (`bol-shared.js`): unified PDF generation; eliminate coord duplication between BOL generator and load builder; optional BOL number with toast confirmation. (f37bee6)
- **P17** — BOL prefill upgrade: structured ship-to address fields from job replace fuzzy customer search. (016c2eb)
- **P16** — Job → Load Builder linking: "Build Load" button on job; parts pre-loaded from line items; on-the-fly part creation during load build. (8d523bb)
- **P15** — Ship-to address on jobs: full address from packing slip stored on `jobs`, carried through to BOL. (ba3e561)

---

## Job Board

- **P319** — Split-shipment: manager-only Assign-Ship-Days modal on the job card, per-load date
  inputs writing `/api/loading-assignments/load-days`; Kanban card badge showing day groups
  (`Fri Aug 8: 01, 02, 03 • Mon Aug 11: 04…`) plus a derived Partially-shipped indicator. Depends on
  P318's `loads_summary` aggregate and `load-days` endpoint. Author surface is the job card only —
  list/table view and the calendar day-detail modal are unchanged (parity follow-up in
  `BACKLOG.md`); load builder untouched. `node --check` clean on both extracted inline `<script>`
  blocks.
- **P312** — Calendar: `+N more` now opens a day-detail modal listing all jobs for that day (each row opens the job); dark-mode sweep of the calendar view (nav controls, headers, day cells, day numbers, `+N more`). Pills unchanged.
- **P307** — New "Cutting Instructions" field on the job-entry modal (above Packing Instructions) — cutting-floor-facing routing/taper/batch notes, mirrored end-to-end alongside the existing `packing_instructions` field: `_worker.js/routes/jobs.js` (GET SELECT, POST payload/INSERT, PUT `textFields`), new `jobs.cutting_instructions` TEXT column (`DB_Migrations/add-cutting-instructions-to-jobs.sql`, run via `wrangler d1 execute --remote` against production D1), and `jobs/index.html`'s field-id array/load/save wiring. Job-entry modal widened ~20% (700px → 840px) via a scoped `#jobs-modal .jobs-modal-panel` override in `jobs/jobs-shared.css` — the shared 700px base rule is untouched, so the parts/combo/trailer-picker and BOL-view modals (also `.jobs-modal-panel`) are unaffected. Read-only display on `/v2/cutting` is P308. `node --check` clean on the worker route and both extracted inline `<script>` blocks.
- **P286** — `DELETE /api/jobs` now mirrors the PUT unlink path's Linking Rule 1 cleanup ("never leave a group of one"): the pre-flight SELECT now also reads `trailer_group_id`, and after the delete commits, a best-effort check counts the surviving group members and clears `trailer_group_id` on the lone survivor. Deliberately omits the PUT path's `AND id != ?` exclusion — the row is already gone by the time this runs, so a bare `WHERE trailer_group_id = ?` returns exactly the survivors. Wrapped in try/catch since the delete has already succeeded and cannot be rolled back. Found (not fixed) a related gap: the DELETE cascade doesn't touch v2's `cutting_lines`/`cutting_sessions` — logged to `BACKLOG.md`.
- **P276** — Linked jobs (2/3): worker + legacy entry UI, one commit (legacy auto-deploys on
  push, so splitting worker/frontend would open a window where they disagree — same reasoning as
  P272). `jobs.trailer_group_id` is a self-grouping id: N jobs share one value, NULL = unlinked.
  **Not `bols.bol_group_id`** (that's the inverse relation — one job across several trailers).
  **API design decision:** no dedicated `/link`/`/unlink` routes — linking is reused through the
  existing `PUT /api/jobs`, since the payload's `trailer_group_id` value is always simply *the id
  of the job you want to join* (never a raw group id the client has to resolve itself). The
  server figures out what that means: joining an already-grouped job merges into that job's real
  group (its row is untouched); joining a still-unlinked job forms a brand-new group anchored on
  that job's own id (a follow-up `UPDATE`, batched atomically with the main write, self-assigns
  it); two jobs already in *different* non-null groups is rejected 409 `group_conflict` (the
  entry UI only ever offers unlinked jobs or jobs already in the target group, so this only fires
  on a stale/racing client). Unlinking clears this job's own value and, in the same atomic batch,
  clears the last remaining member's value too if that would otherwise leave a group of one
  (Linking Rule 1 — never leave a group of one). Ship dates must match to link (409
  `ship_date_mismatch`, names both conflicting dates); archived jobs can't be linked (409
  `job_archived`, `archived_at IS NOT NULL` per P272's semantics — deliberately not
  `status`-based). **Ship-date decision (Linking Rule 3):** changing a linked job's `ship_date` is
  *rejected* (409 `linked_ship_date_locked`) rather than silently cascaded to the whole group — a
  single-field edit silently rewriting other jobs' dates was judged a worse surprise than asking
  the user to unlink first; allowed in the same call if that call is also unlinking. New
  `GET /api/jobs/:id/group` resolves full group membership in one query (no N+1) for both the
  entry UI and future consumers. `JOB_LIST_COLS` exposes `trailer_group_id`; POST always inserts
  it as NULL (no linking at creation time). Verified the full resolution logic (link into new
  group, link into existing group, ship-date mismatch, archived rejection, unlink from a 3-group,
  unlink from a 2-group triggering cleanup, group-conflict rejection) against a standalone SQLite
  simulation — all pass. Frontend: new "Trailer Group" section in the job edit modal (hidden for
  new jobs and archived jobs), reusing the existing combo-badge/picker visual pattern (no new
  CSS — `.jobs-combo-badge`/`.jobs-picker-*` are already token-based); link/unlink fire
  immediately against the API rather than deferring to Save Job, since they mutate a second job's
  row as a side effect and that shouldn't be bundled with unrelated field edits. The 409 error
  text is surfaced verbatim in the modal status line, not swallowed into a generic failure.
  `node --check` clean on both inline `<script>` blocks. Confirmed via `grep` that no
  `jobs.status`-based archived filter was reintroduced (only the expected, out-of-scope
  `loading_assignments.loading_status` hits remain) and that nothing under `cutting-pilot/` was
  touched. **Deliberately deferred to BACKLOG** (out of this prompt's locked scope): `DELETE
  /api/jobs` doesn't cascade the group-of-one cleanup the way link/unlink do. **Precondition
  confirmed met**: `DB_Migrations/jobs-trailer-group.sql` (P275) has been run in D1.

- **P275** — Linked jobs (1/3): schema step. New migration `DB_Migrations/jobs-trailer-group.sql`
  adds a nullable `jobs.trailer_group_id TEXT` (+ index) so Steve can mark two or more jobs as
  shipping on the **same trailer**, for the `/v2/schedule` board to draw as a linked set.
  Self-grouping id (N jobs share one value) — a `linked_job_id` pointer was rejected as
  asymmetric, breaks down past two jobs, and orphans siblings when the "parent" is unlinked.
  **Not `bols.bol_group_id`**: that column (`add-bol-group-linking.sql`) models the inverse
  cardinality — ONE job split across SEVERAL trailers/BOLs. This is SEVERAL jobs on ONE trailer.
  Different table, different cardinality — do not merge them. No backfill: there's no existing
  signal to derive historical trailer-sharing from, so every existing row stays NULL (mirrors the
  no-guessing backfill decision on `jobs.archived_at`, P271). Migration written as bare SQL with
  no header comment, per Steve's standing instruction (2026-07-23) that `DB_Migrations/*.sql`
  files carry no explanatory comments since he copy-pastes them directly into the D1 console —
  this changelog entry carries the context instead. Migration-only: no worker/frontend code in
  this prompt. **Must run in the D1 console before prompt 2/3 (worker + legacy entry UI) is
  deployed** — legacy auto-deploys on push, so 2/3 goes live the moment it's pushed.

- **P272** — Archive refactor (2/3): legacy archive semantics, worker + frontend in one commit
  (splitting them would leave a window where the UI and API disagree about what archiving means,
  since legacy auto-deploys on push). Archiving stops touching `jobs.status` entirely: manual
  Archive/Unarchive (`jobs/index.html`) and the auto-archive sweep (`_worker.js/routes/jobs.js`)
  now set/clear `archived_at` only. Manual Unarchive no longer hardcodes `'shipped'` — it just
  clears `archived_at`, so the job returns to whatever its real, preserved status already is.
  **Sweep tightened** (the actual operational bug this refactor targets): previously any job
  >14 days stale that wasn't already shipped/loading got archived, including jobs still mid-cut —
  since both cutting queues exclude archived jobs, a late in-progress order would silently vanish
  from the floor. Now restricted to jobs that are actually finished: `status IN ('done','shipped')`,
  or a delivered outbound `shipments` row as direct evidence even when `jobs.status` hasn't caught
  up (the legacy dock board can advance `loading_assignments`/`shipments` without ever writing
  `jobs.status` — status-write-site-inventory.md L23/L26). A late `not_started`/`in_production`/
  `loading` job with no delivery evidence now stays visible, on the board and both cutting queues.
  Every `jobs.status`-based archived filter across the worker moved to `archived_at IS NULL`
  (`routes/jobs.js` list/search/week/status-param queries, the duplicate-invoice checks in
  `routes/jobs.js` and `routes/quickbooks.js`, the legacy cutting dashboard exclusion in
  `routes/cutting.js`) — confirmed exhaustive by grep, `loading_assignments.loading_status`
  filters (L24, a different table/column, out of scope) untouched. `PUT /api/jobs` gained
  `archived_at` field support and dropped `'archived'` from the settable `status` enum (archiving
  now only happens via `archived_at`); `JOB_LIST_COLS` exposes `archived_at`. Frontend: Archive
  button now requires `status === 'shipped' && !archived_at`; Unarchive now keys off `archived_at`
  alone (a job can be archived at any real status); card `data-archived` attribute replaces the
  `data-status="archived"` CSS hook so dimming still applies once status stops being overwritten;
  cards are non-draggable while archived regardless of real status. Verified via a standalone
  SQLite simulation of the write/sweep SQL: archiving mid-production preserves `in_production`;
  unarchiving restores it exactly (not a hardcoded value); the sweep archives late done/shipped/
  delivery-evidenced jobs but leaves late in-progress ones untouched; legacy `status='archived'`
  rows still filter out via `archived_at IS NULL`. `node --check` clean on all touched files
  (worker files + both inline `<script>` blocks in `jobs/index.html`). Two gaps found but left
  out of this locked scope, logged to BACKLOG: `reports/orders/index.html` still filters/labels by
  `status==='archived'` and will stop tracking new archives; unarchiving a legacy sentinel row
  leaves `status` literally `'archived'` (no real prior value to restore).

- **P271** — Archive refactor (1/3): schema step. `jobs.status` was carrying two orthogonal facts —
  lifecycle stage and whether the job's been filed away — so writing `'archived'` destroyed the
  first to record the second (the "Unarchive" button hardcoded `'shipped'` because the true prior
  status was gone; a late-but-still-in-production job silently dropped off both cutting queues).
  New migration `DB_Migrations/jobs-archived-at.sql` adds `jobs.archived_at` (nullable ISO
  timestamp; NULL = active) and backfills it for existing `status='archived'` rows from
  `updated_at`, falling back to `created_at`, falling back to `datetime('now')`. Existing
  `status='archived'` rows are left exactly as-is — that prior lifecycle value is genuinely
  unrecoverable, so the backfill does not guess/derive/fabricate a replacement; `'archived'`
  remains a legal legacy sentinel meaning "archived, prior status unknown" and ages out naturally
  as future archives (prompts 2/3, 3/3) start setting `archived_at` instead of overwriting
  `status`. Schema-only — no worker or frontend change. `loading_assignments.loading_status =
  'archived'` (site L24 in `status-write-site-inventory.md`) has the same defect but is
  lower-stakes and explicitly out of scope, tracked in BACKLOG. **Migration must run in D1 before
  the prompt 2/3 worker deploy.**

- **P270** — Forward-only guard on the shipment→job reverse status sync (site L17,
  `_worker.js/routes/jobs.js`). `PUT /api/shipments` writes a mapped status back onto the linked
  `jobs.status` (e.g. `in_transit`/`delivered` → `shipped`) with no protection against regression —
  unlike every other cascade on the same handler and in v2, which guard with a `WHERE status
  IN (...)`-style check. Editing a shipment backward on the logistics dashboard could silently
  regress `jobs.status`, including pulling a job back out of `shipped` or `archived`. Fixed with a
  single `JOB_STATUS_RANK` ordering (`not_started` < `in_production` < `done` < `loading` <
  `shipped`) defined once next to `SHIPMENT_TO_JOB_STATUS`; the `UPDATE` now applies only when the
  mapped status ranks strictly higher than the job's current status, expressed as a SQL `WHERE`
  clause (`CASE status … END < ?`) so the check is atomic with the write. `'shipped'` and
  `'archived'` are additionally excluded via `status NOT IN (...)` — never moved by this path
  regardless of rank. Standalone bug fix, no schema/frontend change, no dependency on the archive
  refactor (P271). L15/L16/L18/L19/L20 on the same handler untouched.

- **P255** — Lob address verification diagnostic (observability only, no behavior change).
  Every ship-to address was coming back `unverifiable`, but the handler collapsed two very
  different failures into that one string: Lob answering `no_match`/`undeliverable` (Path A) vs.
  the `fetch` throwing or Lob returning non-2xx (Path B, `reason: 'lob_error'`) — and discarded the
  distinguishing detail to `console.error` only. `handleApiAddressValidate`
  (`_worker.js/routes/jobs.js`) now captures the caught error into a sanitized `error_detail`
  (truncated to 500 chars) and derives a `key_mode` (`'test'`/`'live'`/`'unknown'`) from the
  `LOB_API_KEY` prefix — never the key itself, never logged/stored beyond that one word. Both are
  added to the response payload (`{ status, standardized, deliverability, reason, error_detail,
  key_mode }`, additive) and to the `logActivity` details object. `jobs/index.html` replaces the
  single generic unverifiable toast with a reason-based one (`lob_error` → "Address service
  unavailable — saved as entered."; otherwise → "Address not found by USPS — saved as entered.")
  and `console.warn`s the full diagnostic object so Steve can read `key_mode`/`error_detail` from
  a real save. Save behavior, verification decision logic, and non-blocking guarantee are
  unchanged — leading hypothesis (test-mode key) to be confirmed from the console output.

- **P254** — Fixed ship-to address silently wiping on every job edit-save. Root cause:
  `JOB_LIST_COLS` (`_worker.js/routes/jobs.js`) selected `j.ship_to_verified` but never selected
  the seven `ship_to_*` address columns, so every job object on the board (and thus the edit
  form, populated from the list payload) was missing its address; saving then sent empty strings,
  and the PUT handler's correct key-presence guard (`if (f in payload)`) wrote them over good
  data. Fixed by widening `JOB_LIST_COLS` to include `ship_to_company/attention/street/street2/
  city/state/zip`. Also fixed a secondary defect: `jobs/index.html` hardcoded
  `ship_to_street2: ''` into every save payload (there's no street2 form input), destroying any
  suite/unit line a Lob correction had written on the very next save — the hardcoded key is
  removed; `shipToFields.street2` (used for the Lob verification call) now reads from the
  `originalShipTo` snapshot (which gained a `street2` member, sourced from
  `job.ship_to_street2`) instead, falling back to `''` on create. The one legitimate writer —
  the address-correction accept branch setting `payload.ship_to_street2` from Lob's suggested
  `standardized.street2` — is unchanged. No form field added (locked decision); no PUT
  key-presence-guard change; no per-job GET added.

- **P249** — Ship-to address verification at job entry, via Lob US Verifications (CASS
  standardize). New `POST /api/address/validate` (`_worker.js/routes/jobs.js`, gated by the
  existing `jobs` permission — `/^\/api\/address/` added to `API_PERMISSION_MAP`) posts
  `{street, street2, city, state, zip}` to Lob with HTTP Basic auth (`LOB_API_KEY` as username,
  blank password), server-side only. Maps `deliverability`: `undeliverable`/`no_match` →
  `unverifiable`; otherwise standardizes and compares (case-insensitive/trimmed) to the entered
  address → `verified` (exact) or `corrected` (differs). Network/Lob errors are caught and
  degrade to `unverifiable` — the route never blocks. `jobs/index.html` fires this once per save
  (on create, or on edit only when a ship-to field changed vs. the loaded job — checked via a new
  `originalShipTo` snapshot) before the existing job POST/PUT: `verified` proceeds silently;
  `corrected` opens a new correction modal (`Use suggested` / `Keep original`, promise-based,
  reuses the `.jobs-modal-overlay`/`.jobs-modal-panel` pattern); `unverifiable` shows a
  non-blocking toast and keeps the entry verbatim. New `ship_to_verified` (enum, default
  `unverified`), `ship_to_standardized` (JSON), `ship_to_verified_at` columns on `jobs`, threaded
  through the INSERT/UPDATE paths and parsed back out on the single-job GET; `JOB_LIST_COLS` gains
  `ship_to_verified` so a small status pill (`shipToVerifiedBadge`) can render on the kanban card,
  the list-view row, and the edit-form ship-to header — the default `unverified` state is
  suppressed on cards/list (legacy-job noise) but shown on the edit form. Legacy surface only, no
  v2/React changes, no new permission key. **Run `DB_Migrations/address-verification.sql` in D1
  before deploying the worker.** `LOB_API_KEY` Cloudflare Pages secret (production) set for this
  prompt. `node --check` clean on `_worker.js/index.js`, `routes/jobs.js`, and the extracted
  `jobs/index.html` script block.
- **P245** — Job-entry "Qty entered as BDFT — convert to pieces" checkbox in the line-items
  footer. Bulk-converts each convertible row's Qty from total board feet to a piece count using
  `pieces = round(BDFT ÷ ((L×W×H)/144))` from the row's Dimensions; reversible (unchecking
  restores originals via `row.dataset.bdftOrig`); rows without three dimensions or a Qty are
  skipped. New helpers `liBdftPerPiece`/`toggleBdftConvert`. Frontend-only, `jobs/index.html`.
- **P244** — Backfill line-item Dimensions from the matched part when the packing-slip parser
  produced none. `prefillForm` now carries the matched part's canonical dims (`length_in` ×
  `width_in` × `height_in`, formatted `L" x W" x H"`) onto the mapped line item as `_partDims`,
  and the row build uses `li.dimensions || li._partDims || ''`. Parsed dims still win when
  present; fixes blank Dimensions on Holey Board rows matched by P243's thickness pass (whose
  `(24" x 48") x N"` layout the L×W×H regex can't parse). Frontend-only, `jobs/index.html`.
- **P243** — Holey Board thickness→HB part matching at packing-slip intake. Parser
  (`jobs/packing-slip-parser.js`) gains `extractThickness()` and emits `thickness` on Holey
  Board / Insulperm line items (trailing inch value; parenthetical footprints stripped; foot
  marks ignored). Matcher (`jobs/index.html` `matchLineItemToPart`) adds height-keyed **Pass 3b:
  Holey Board by thickness** — matches `category === 'Holey Board'` parts by `height_in ≈
  thickness` (±0.1), ignoring L/W (printed footprint is 24"x48", reversed vs catalog 48x24), with
  a Siplast/1.0# tiebreak; method `holey_board_thickness`. Fixes real Siplast/GAF slips whose
  `(24" x 48") x N"` layout broke the L×W×H regex so no HB pass fired. Existing Pass 3 retained as
  fallback. Frontend-only; no DB/worker/migration.
- **P238** — Dual-input job priority: base ship-date ordering plus a manual graded `priority_level` (0–3: Normal/Elevated/High/Critical, new column, migration `add-priority-level.sql`) and the **existing** `jobs.priority='rush'` reused as a pin-to-top flag (previously validated in the worker but surfaced in no UI). Worker exposes `priority_level` in `JOB_LIST_COLS` and validates it on PUT (POST untouched — new jobs take the schema default). Job board gains a Priority select + Rush checkbox in the edit-mode status section and a tokenized RUSH/level badge on the list view. No new permission key (`jobs` edit already gates the writes). Cutting-queue sort consumes this in P239. **Run `add-priority-level.sql` in D1 before deploying the worker.**
- **P232** — Auto-archive abandoned jobs (cleanup-on-read): the jobs list GET now runs a best-effort sweep that sets `status='archived'` for jobs with a real `ship_date` more than 14 days old that aren't already `archived`/`shipped`/`loading`. Mirrors the saved-loads TTL-on-read pattern (Pages Advanced Mode has no cron); idempotent and wrapped in try/catch so a sweep failure can't break the board. Keeps active-job counts bounded — the upstream pressure behind the P231 queue-variable 500. `status`-only, no cascade, no schema change.
- **P173** — Stop duplicating dimensions on BOL commodity: `jobs/index.html` parse-review no longer appends the structured `dimensions` field to the line-item description (the description already contains inline dims for SKU-less parts); `dimensions` field and Dims input are unchanged. Also extends `pickCommodityTier` ladder in `bol-shared.js` from 3 tiers (floor size 20) to 6 tiers (floor size 10, lineH 12) so long commodity lists shrink gracefully instead of overflowing the box. Affects new jobs only; existing merged descriptions are not backfilled.
- **P151** — Fix mobile kanban drag-scroll conflict: `card.draggable` is now gated behind `!window.matchMedia('(pointer: coarse)').matches` so touch devices (floor tablets) can scroll normally; desktop mouse drag unchanged. Arrow buttons and modal status dropdown handle status changes on mobile. (97dacab)
- **P150** — Reject duplicate invoice numbers at job creation: the POST handler checks for a non-archived job with the same `invoice_number` before inserting, returns 409 `duplicate_invoice` on conflict. Error surfaces in the modal via the existing `setModalStatus` path. No UNIQUE constraint (archived jobs may legitimately reuse old numbers). Also guards future QB webhook re-fires. (f741d2c)
- **P145** — Job board UX batch: (1) Status dropdown in job detail modal — shows Not Started / In Production / Done for the three main statuses; hidden for shipped/loading/archived; PUT payload includes new status on save. (2) View BOL button on kanban cards — revealed by `fetchJobBols()` when a BOL exists; inline PDF viewer via `pdf-lib` + `bol-shared.js` added to page; also available in the job modal via async BOL check on open. (3) Calendar scroll-to-week — `renderCalendar()` scrolls the row containing today to the top of the viewport after rendering (applies to both job board and logistics calendars). (e3e5a17, d021df6)
- **P141** — Trailer-assigned badge on job board card: `assigned_trailers` GROUP_CONCAT subquery added to `JOB_LIST_COLS`; indigo pill badge ("🚛 Trailer Assigned") renders on the kanban card whenever a non-archived loading assignment has a trailer number. (5fd71d0)
- **P117** — Load count guard: confirm dialog when `load_count > 10`; proceed on confirm, keep editing on cancel. (33b0433)
- **P91** — Fix delete-job: handler now deletes `shipments`, `loading_assignments`, `loading_photos` children before deleting job; Customer Pickup exclusion (method='customer pickup' skips bay-queue card auto-create while still creating the shipment).
- **P40** — Job board simplification: 3-column layout; legacy loading/shipped jobs in Done column. (df8470e)
- **P36** — Calendar view toggle on job board (Kanban/Calendar). (3a63370)
- **P33** — Archive feature: "Archive" button on Shipped cards; archived jobs move off the kanban. (0baa50d)
- **P30** — Parts matching at parse time: packing slip upload auto-matches line items to parts library. (0da6359)
- **P27** — Job board UI cleanup: remove stale fields, inline packing slip viewer, drag-drop upload, modal close fix. (076ef5a)
- **P26** — Parser overhaul: multi-page PDF parsing, improved address/contact extraction, zero-qty and notes filtering. (3b0f9f2)

---

## Production / Manufacturing

- **P297** — Split the Manufacturing Cutting tile into two: Main Line / Blue Line (`/v2/cutting`) and Cross Cutter / Hole Cutter (`/v2/cutting/crosscutter`). Both tiles keep the `mfg-cutting-link` class so the existing `manufacturing.cutting` permission-based show/hide (`gateMfgNav()`) governs both without any script change. `manufacturing/index.html` only; no inline `<script>` touched, so no `node --check` was needed.
- **P234** — Cutting cutover: Manufacturing tile repointed from legacy `cutting-dashboard.html` to the v2 board at `/v2/cutting` (operator loop validated on the real host); legacy page archived to `manufacturing/_archived/` (P176 precedent, still reachable by direct link as fallback); permission gate re-keyed from a fragile `href*="cutting-dashboard"` substring match to a stable `.mfg-cutting-link` class so `manufacturing.cutting` gating survives the href change; `PATH_PERMISSION_MAP` pattern widened to keep the archived path gated. `cutting_steps`, `/api/cutting*`, `routes/cutting.js`, and `lib/cutting.js` deliberately left intact — their removal remains a separate backlog item.
- **P194** — Cutting Dashboard frontend (C2): five-lane floor board in `manufacturing/cutting-dashboard.html`. Lanes: Cross Cutter, Hole Cutter, Main Line, Blue Line, Laminate. Cards sorted in_progress → queued → completed per lane (with active-count badge on header). Step card shows invoice #, customer, ship date, status badge, inline operator input, and context-sensitive actions: Start Job (job-level, calls `POST /api/cutting/start`), Complete (calls `PUT /api/cutting/:stepId { step_status: 'completed' }`), Un-complete (reverts to in_progress). Search + This-Week filter mirroring P190 pattern (`cdCurrentWeekRange`, `cdInCurrentWeek`, `cdMatchesSearch`, `cdFilteredJobs`). Auto-refresh every 60 s. Dark-mode token–only colors (warn/info/success tokens for queued/in_progress/completed). Touch targets ≥44px. Requires P193 deployed and migration run.
- **P193** — Cutting Dashboard: data model + worker automation (C1). New `cutting_steps` table (`DB_Migrations/add-cutting-steps.sql`); helpers in `_worker.js/lib/cutting.js` (`reconcileCuttingSteps`, `mirrorProcessesToSteps`, `syncJobFromSteps`, `applyStepCompletionToProcesses`); `_worker.js/routes/cutting.js` — `GET /api/cutting` (board payload with steps), `POST /api/cutting/start` (queued→in_progress + job not_started→in_production), `PUT /api/cutting/:stepId` (step status/operator/notes + pill/job sync). `routes/jobs.js`: POST auto-creates steps from processes; PUT reconciles steps + mirrors pill↔step + syncs job status; DELETE cascades cutting_steps. Permission mapped in `API_PERMISSION_MAP`. **Run `add-cutting-steps.sql` in D1 before deploying worker.**
- **P80** — New Manufacturing module: Block and Holey Board calculators moved out of Production; Cutting Dashboard placeholder added; Production repurposed as inventory-only. (7ddcf00)

---

## QC

- **P172** — Hotfix: repair malformed `getCheckedDepartments` function declaration in `qc/incident-report.html` (missing `() {`); a parse error at line 348 was aborting the entire inline script, leaving the customer dropdown stuck on "Loading Customers".

*(QC module bootstrapped as part of the early foundation; no items with distinct prompt numbers. P137 is in Infra / Docs.)*

---

## Safety

*(Safety portal bootstrapped as part of the early foundation; no items with distinct prompt numbers.)*

---

## Reports

- **P285** — Orders Report now treats `archived_at` as the archive signal (P271/P272) instead of `status === 'archived'`, via a shared `isArchived()` predicate used by the Status filter, both stat tiles, and the status badge. The literal-status term is retained inside `isArchived()` as a fallback for the legacy backfilled population; non-archived filter selections now exclude archived jobs, since a job's real status survives archiving post-P272 and would otherwise bleed into e.g. a "Done" filter. Also dropped a stale `BACKLOG.md` item to hide `packing-slip-test.html` from navigation (not implemented — the page isn't linked from anywhere, so nobody stumbles onto it). Read-only filter/label logic only, no API/schema change.
- **P52** — Orders Report page; jobs API improvements. (1b4d2f0)

---

## Admin / Platform

- **P305** — Fixed broken sign-out: `handleAuthLogout` (`_worker.js/routes/auth.js`) called `getSessionToken(request)` on its first line, but the helper was defined (not exported) in `_worker.js/lib/core.js` and `auth.js` only imported `{ json, logActivity, validateSession }` — a `ReferenceError` 500'd `/api/auth/logout` before the session row was deleted or the clear-cookie header was emitted, so the `xpanda_session` cookie survived and the next request re-validated it ("click sign out, it signs out, then refreshes back as signed in"). Fix: exported `getSessionToken` from `core.js` and imported it in `auth.js` (the actual bug); also wrapped the teardown body in `try {} catch {}` so the clear-cookie header is emitted even if session teardown throws for any future reason. Backend-only, no migration, no permission change; v2 middleware only reads the cookie so `cutting-pilot/` is unaffected. `node --check` clean on both files.
- **P299** — Home page: two-button cards now stay side by side and shrink together via a container query (based on card width), stacking only when the card is truly narrow. Fixes buttons wrapping on maximized screens. Single-button cards unaffected.
- **P298** — Split the homepage Cutting card into two links: Main / Blue Line (`/v2/cutting`) and Cross / Hole Cutter (`/v2/cutting/crosscutter`), mirroring the existing primary + `hp-btn-outline` two-button pattern (Safety, Logistics, Admin cards). Single card, single `data-permission="manufacturing.cutting"` gate — both links show/hide together, no permission change. `index.html` only; no inline `<script>` touched, so no `node --check` was needed.
- **P264** — New `schedule` permission key ("Schedule Board (TV)", own `Schedule` group) added to
  `PERMISSION_LABELS` in `admin/roles.html` — the last piece of the schedule board (1–4/5): the v2
  middleware (3/5) already enforces this key, but until it existed in the roles system no admin could
  grant it. `permissions` is stored as an opaque JSON blob with no separate key whitelist anywhere in
  `_worker.js` (confirmed — `routes/admin.js` just serializes whatever the client sends, and
  `roles.html`'s render/toggle/save logic iterates `PERMISSION_LABELS` generically with no
  hardcoded key list), so the label edit is the whole change — no `core.js` edit, no new
  `PATH_PERMISSION_MAP`/`API_PERMISSION_MAP` entry (the board has no legacy path or `/api/schedule*`
  route to map). No homepage card or legacy nav added — the board is a v2 wall display, linked to
  directly. `node --check` clean on the extracted inline script.
- **P235** — Dedicated Cutting card on the homepage, gated on `manufacturing.cutting`, opening `/v2/cutting` directly — gives the cutting team a one-tap, correctly-named entry point instead of routing through the Manufacturing card (both paths retained). New `hp-icon-cutting` swatch (emerald, light + dark) and `hp-btn-cutting` added to the shared primary-button rule; lucide scissors glyph. No JS change — the existing generic `.hp-card[data-permission]` gate (P48) picks the card up automatically. No new permission key, no migration.
- **P226** — Fixed inert Sign Out button: both header implementations previously gated the `/login.html` redirect on the logout POST resolving, so a network blip, worker hiccup, or offline tablet left the `await` throwing and the user stuck. Legacy `shared/shared-header.js` now binds a single delegated `document` click listener (guarded by `window.__xpandaLogoutBound`) instead of a one-shot `getElementById('hdr-logout')?.addEventListener`, so it works regardless of DOM timing or whether the link is in the topbar or footer; redirect now fires in `.finally()` so sign-out always completes even if the POST rejects. v2 `cutting-pilot/src/components/PlatformHeader.tsx` gets the matching try/catch-then-redirect fix. Backend `/api/auth/logout` unchanged. `tsc --noEmit` + `cf-build` green.
- **P199** — Temporary 302 redirect: `xpanda-ops-platform.pages.dev` → `https://www.xpandaops.com` in `_worker.js/index.js`. Path + query string preserved. Placed after the `/health` check (monitor-safe) and before static-asset passthrough. 302 not 301 — not hard-cached, removed cleanly once all links/bookmarks updated.
- **P146** — PWA install prompt for mobile users: new `/shared/pwa-install.js` auto-loaded by `shared-header.js`. Android shows a dismissible bottom banner with one-tap install via `beforeinstallprompt`; iOS Safari shows "Share → Add to Home Screen" instructions. Skips if already installed (standalone mode) or previously dismissed (persisted in localStorage). Mobile-only (pointer:coarse or width < 1024). (3ca97e7)
- **P114** — Shared header page-desc typography: h1 15px/700, subtitle 11px/text-hint. (855152c)
- **P110–P113** — Shared header restructure; dark mode contrast sweep; load builder shared design tokens; logistics table alignment. (9841b06, a9fb1fa)
- **P85–P87** — UI frontend redesign: SVG icons, IBM Plex font, `tokens.css`, theme toggle, nav bar. (ac6e151, 496e7de, e4aeb33, 0bbd12c)
- **Test-as-role** — Admin dropdown to preview the platform as a specific role without logging out; `test-as-role.sql` migration. (a4855dd)
- **P81** — Shared photo-gallery component (`/shared/photo-gallery.js`): lightbox viewer consumed by loading dashboard cards and logistics shipment modal. (7982144)
- **P48** — Homepage redesign: compact icon cards, Loading as its own card, `data-perm-key` link gating. (4719e2c)
- **P46** — iOS push fix: user-gesture permission via banner, SW active wait; PWA meta tags (`apple-capable`, `touch-icon`, `manifest`) added to all HTML pages. (b6b0f61, 833dfe8)
- **P44** — Loading card rework; auto-assign on Done; VAPID web push implementation (push notification on loading events). (cd21e7c)
- **P43** — Loading dashboard QC fixes: modal hidden override, admin permissions display. (becc4c5)
- **P41** — Notification type configuration per role; roles API saves `notification_types`. (3627a67)
- **P39+P42** — Loading dashboard frontend: notification bell; `sw.js`; `manifest.json`; service-worker registration. (534ceb9)
- **P38** — Loading dashboard & notification backend: D1 schema, API handlers, dispatch logic. (d46bf1f)
- **P37** — Multi-role system: junction table, merged permissions, checkbox UI in roles admin. (5fc45a4)
- **P29** — Platform QC pass: dead code removal, auth caching, schema consolidation, hygiene. (d135fd7)
- **P23–P24** — Roles & permissions: configurable roles with per-module view/edit toggles; admin bypass; permission grid UI. (e07b890)
- **P21–P22** — Authentication system: username/password login, session-based auth, first-login password flow, user management admin page. (b8bd8c2)
- **P19–P20** — Admin parts library (full CRUD at `/admin/parts.html`); activity log / audit trail (platform-wide event logging, viewer at `/admin/activity-log.html`). (5649fc3)

---

## Foundation Roadmap

- **F5 (P99–P103)** — Worker modularization: file-split source (`_worker.js/index.js` entry, `lib/core.js`, `lib/push.js`, `routes/*.js` per domain); single bundled Pages Advanced Mode worker. Superseded the dead `/functions/` per-route plan; actual implementation ships as file-split source bundled into one worker. (ad7cd94, e1f3d1b, 93eee6f)
- **P106–P108** — F1 follow-up: jobs, logistics dashboards, load builder, and BOL generator migrated from raw `fetch` to `api.*`. (bf8bcfb)
- **P104–P105** — F1 follow-up: production, QC, and reports pages migrated to `api.*` / `utils.*`. (860bd77)
- **P97–P98** — F4c+F4d: loading photos and packing slips migrated to R2 storage with base64 fallback; admin backfill endpoints; `add-photo-key-to-loading-photos.sql` + `add-packing-slip-key-to-jobs.sql` migrations.
- **P96** — F4a: blob inventory audit (`r2-migration-inventory.md` at repo root).
- **P95** — F3 gap-fix: `/api/saved-loads` permission gap patched (`logistics.load-builder` key added to `API_PERMISSION_MAP`).
- **F4b (P83)** — R2 binding + upload/serve pattern established: `xpanda-bol-photos` bucket, signed-URL pattern proven with BOL tracking. (11b07b9)
- **P78** — F3: read-only permissions audit (`permissions-audit.md` at repo root). (c9269b8)
- **P77** — F2: worker router abstraction — 48 routes in declarative `API_ROUTES` lookup table, replacing flat if/else dispatch. (24e8e52)
- **P76** — F1c: `shared-utils.js` — density calculator migration + date helpers (`isoToUS`, `isoToShortDate`, `todayIso`) + `escHtml`/`truncate`. (99adfe4)
- **P75** — F1b: `shared-api.js` — `window.api.get/post/put/del` helper; proof-of-pattern migration in `loading.html`. (0ba05f8)
- **P74** — F1a: `shared-header.js` — consolidated 5 module headers into one universal header; document.write execution-order bug fixed. (67f394b, cb4fd8b)
- **P14** — Unified parts library: merge `parts_library` + `load_builder_skus` into single `parts` table; single source of truth for block calculator, load builder, and job board. (7c6037c)

---

## QuickBooks Integration

*(Scoped and tabled — no items shipped. Full spec in BACKLOG.md.)*

---

## Infra / Docs

- **P302** — Added GitHub Actions CI/CD for the v2 Worker: pushes touching `cutting-pilot/**` auto build + typecheck; deploy gated behind a manual approval (production environment). D1 migrations remain manual. New `.github/workflows/deploy-v2-worker.yml`, path-filtered to `cutting-pilot/**` + the workflow file so legacy-only pushes never trigger it. Two jobs: `build` (`npm ci` → `tsc --noEmit` → `npm run cf-build` → uploads `.open-next` as an artifact, 1-day retention) → `deploy` (`environment: production`, held for a required reviewer; downloads the artifact and runs `wrangler deploy` with `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` from GitHub secrets — no double build). The approval gate is deliberately where Steve confirms any pending D1 migration has been run before the worker that depends on it goes live — the workflow itself never runs migrations. Coexists untouched with the legacy Pages auto-deploy (different route space, different mechanism). CI config only, no app code changed. YAML validated (`yaml-lint`).
- **P302 hotfix** — Fixed the CI build job failing on its very first real run (`Cannot find module './.open-next/worker.js'`, exit code 2). Root cause: `custom-worker.ts` imports `./.open-next/worker.js`, which `opennextjs-cloudflare build` generates and which is gitignored — it doesn't exist on a truly clean checkout until AFTER that build step runs, but both the workflow's standalone `Typecheck` step (`npx tsc --noEmit`) and `next build`'s own internal type check (inside `npm run cf-build`) run *before* that point. Never surfaced locally because every dev/agent session in this repo has worked in the same long-lived directory, where a stale `.open-next/worker.js` from an earlier build always happened to be sitting on disk — GitHub Actions' genuinely fresh checkout was the first environment to actually exercise the cold-start path. Reproduced locally by simulating a clean checkout (moving `.open-next` aside, confirming both `npx tsc --noEmit` and `npm run cf-build` fail identically) before fixing. Fix: `custom-worker.ts` added to `tsconfig.json`'s top-level `exclude` (Next's own tsconfig, so this fixes `next build`'s internal check too, not just the standalone command) plus a new `tsconfig.worker.json` (extends the base config, scoped to just that one file) so the workflow can still typecheck it — new `Typecheck custom-worker.ts (post-build)` step added *after* `npm run cf-build`, once `.open-next/worker.js` genuinely exists. No type safety lost, just reordered to when the check can actually succeed. Only `.github/workflows/deploy-v2-worker.yml`, `cutting-pilot/tsconfig.json`, and new `cutting-pilot/tsconfig.worker.json` touched.
- **P302 follow-up** — Dropped the deploy approval gate: `deploy` no longer references `environment: production`, so every green `build` on `cutting-pilot/**` now deploys immediately with no manual click. Steve's call — migration-before-push discipline ("never push code that depends on a migration before running that migration in the D1 console") moves to a human rule he's encoding in `AGENTS.md`/`xpanda-ops-agents.md` himself, rather than a CI checkpoint. (Separately, the token used for `CLOUDFLARE_API_TOKEN` needs a `Zone → Workers Routes → Edit` scope on `xpandaops.com` in addition to the two account-level permissions — `wrangler deploy` also updates the `[[routes]]` binding in `wrangler.toml`, which is a zone-level resource the original account-only token couldn't touch.)
- **P269** — Status write-site inventory (report-only, read-only recon, no code changes): `status-write-site-inventory.md` enumerates every write site for `jobs.status`/`jobs.processes`, `cutting_steps.step_status`, `cutting_lines.line_status`, `cutting_sessions.status`, `loading_assignments.loading_status`, `shipments.status` + delivery-confirmation fields, and `schedule_rows.sheet_status` across both `_worker.js/**` and `cutting-pilot/src/**`, classified into event-record / display-workflow-persisted / reconciliation-patch buckets per Steve's request ahead of an `archived`-replacement refactor. Confirms the legacy pill↔step bidirectional sync (`lib/cutting.js`) and the v2 `completeCuttingLinesForJob` backstop (`lib/cutting-lines.js`) are the reconciliation-patch guardrails a future fix would retire; flags the shipment→job reverse-sync's missing downgrade guard and the driver-QR-only population of `shipments.delivery_*` as open findings. Placed at repo root (not `Reports/`) to avoid a case-collision with the live `reports/` web module — matches the `qc-slop-audit.md`/`dark-mode-audit.md`/`permissions-audit.md` precedent. No refactor plan included (out of scope by design).
- **P195** — Agent doc sync (docs only): `xpanda-ops-agents.md` — (1) added `manufacturing/` subtree to Repository Structure (block/holey calculators moved from `production/`); (2) added Manufacturing Agent row to Available Agents table; (3) added full `# 4a. Manufacturing Agent` section covering Cutting Dashboard, `cutting_steps`, `/api/cutting*` routes, and cross-refs to job-board-agent/db-api-agent; (4) trimmed Production Agent key files to inventory-only; (5) fixed `DB Migrations/` → `DB_Migrations/` (4 occurrences); (6) fixed `block-calculator.html` path in File Size Budget table. `AGENTS.md` — added Manufacturing row to Module Overview table, updated Production row to inventory-only, fixed calculator file paths. Both files — added BACKLOG/CHANGELOG discipline rule (Cross-Cutting Rules + Implementation Order step 9). No code changes.
- **P137** — QC slop/spaghetti audit (report-only): `qc-slop-audit.md` inventories dead code, duplication, abandoned-migration sites, and roots the PO-to-PDF rendering bug in `bol-generator.html`. (untracked; no code changes)
- **P124** — Doc sync: `xpanda-ops-agents.md` worker section updated to post-F2/F5 reality (file-split worker, `API_ROUTES`, ESM bundle). (89ed041)
- **P51** — (see Logistics) Loading Dashboard link added to nav; Prompts/ and DB Migrations/ folders organized. (de867bb)
