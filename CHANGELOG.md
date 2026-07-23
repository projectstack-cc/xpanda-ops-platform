# xPanda Ops Platform — Changelog

> **Process:** When an item ships, its entry moves to `CHANGELOG.md` (keyed to its prompt #) and is
> deleted from `BACKLOG.md`. BACKLOG is forward-looking only. Drift check: diff `Prompts/` against
> `CHANGELOG.md` — any prompt missing from the changelog is a gap.

Entries within each module are ordered by prompt # descending (newest first).

---

## Manufacturing / Cutting (React pilot)

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

## Logistics

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

- **P52** — Orders Report page; jobs API improvements. (1b4d2f0)

---

## Admin / Platform

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

- **P269** — Status write-site inventory (report-only, read-only recon, no code changes): `status-write-site-inventory.md` enumerates every write site for `jobs.status`/`jobs.processes`, `cutting_steps.step_status`, `cutting_lines.line_status`, `cutting_sessions.status`, `loading_assignments.loading_status`, `shipments.status` + delivery-confirmation fields, and `schedule_rows.sheet_status` across both `_worker.js/**` and `cutting-pilot/src/**`, classified into event-record / display-workflow-persisted / reconciliation-patch buckets per Steve's request ahead of an `archived`-replacement refactor. Confirms the legacy pill↔step bidirectional sync (`lib/cutting.js`) and the v2 `completeCuttingLinesForJob` backstop (`lib/cutting-lines.js`) are the reconciliation-patch guardrails a future fix would retire; flags the shipment→job reverse-sync's missing downgrade guard and the driver-QR-only population of `shipments.delivery_*` as open findings. Placed at repo root (not `Reports/`) to avoid a case-collision with the live `reports/` web module — matches the `qc-slop-audit.md`/`dark-mode-audit.md`/`permissions-audit.md` precedent. No refactor plan included (out of scope by design).
- **P195** — Agent doc sync (docs only): `xpanda-ops-agents.md` — (1) added `manufacturing/` subtree to Repository Structure (block/holey calculators moved from `production/`); (2) added Manufacturing Agent row to Available Agents table; (3) added full `# 4a. Manufacturing Agent` section covering Cutting Dashboard, `cutting_steps`, `/api/cutting*` routes, and cross-refs to job-board-agent/db-api-agent; (4) trimmed Production Agent key files to inventory-only; (5) fixed `DB Migrations/` → `DB_Migrations/` (4 occurrences); (6) fixed `block-calculator.html` path in File Size Budget table. `AGENTS.md` — added Manufacturing row to Module Overview table, updated Production row to inventory-only, fixed calculator file paths. Both files — added BACKLOG/CHANGELOG discipline rule (Cross-Cutting Rules + Implementation Order step 9). No code changes.
- **P137** — QC slop/spaghetti audit (report-only): `qc-slop-audit.md` inventories dead code, duplication, abandoned-migration sites, and roots the PO-to-PDF rendering bug in `bol-generator.html`. (untracked; no code changes)
- **P124** — Doc sync: `xpanda-ops-agents.md` worker section updated to post-F2/F5 reality (file-split worker, `API_ROUTES`, ESM bundle). (89ed041)
- **P51** — (see Logistics) Loading Dashboard link added to nav; Prompts/ and DB Migrations/ folders organized. (de867bb)
