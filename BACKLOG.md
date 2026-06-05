# xPanda Ops Platform — Backlog

---

## Logistics

### Soft Rollout Batch — Logistics + Loading Dashboard (test rats), Prompts 90–94

Execution order is sequenced for dependencies: P91 (pickup exclusion) lands before P92 (re-queue must respect it); P92 (status write-through) lands before P93 (yard ships through it).

- [x] ~~**P90**~~ — Logistics row header parity (INV# + load count primary, customer secondary `truncate(...,20)`, mirror `loading.html` `renderAssignmentCard`) **+** Loading dashboard sort by INV# natural/numeric (NOT parseInt; handle "3942-01") with sort dropdown. Frontend only.
- [x] ~~**P91**~~ — Fix delete-job (handler only cleans `job_line_items`; must also delete `shipments` + `loading_assignments` + `loading_photos` + any other `job_id` children) **+** Customer Pickup exclusion (`jobs.method = 'customer pickup'` skips the two loading-assignment auto-create sites; still creates the shipment so it shows on logistics dashboard). No migration.
- [x] ~~**P92**~~ — Status write-through: reverse sync in `handleApiShipments` PUT — logistics status change updates `jobs.status` (source of truth) + `loading_assignments`; kanban + loading reflect it; "ready to ship" re-queues the card (skips customer pickup). No migration.
- [x] ~~**P93**~~ — The Yard: `location` flag on `loading_assignments` ('bay' | 'yard'); "Move to Yard" frees the bay (`bay_id = NULL`), preserves assignment; unbounded Yard section with Mark Shipped / View BOL / photo actions. **Needs migration** (`ALTER TABLE loading_assignments ADD COLUMN location`).
- [x] ~~**P94**~~ — Load Builder "Pull from Job" button (reuse `prefillFromJob`, append, Done+Loading picker) **+** fix inline BOL editor rendering tiny on Build Load (`bol-editor.js:182` `clientWidth` collapses to 200px floor — size `#bol-review-editor-mount-lb` like `#bol-editor-host` + open after modal layout; do NOT touch the shared engine). No migration.

### Standing Logistics Backlog

- [ ] Customer database (full CRUD)
- [ ] Loading status indicator
- [ ] Consider separate dashboards for staff vs. management (TV display)
- [ ] Zoning support for deck systems
- [ ] Part bundle quantities — `bundle_qty` field on parts, load builder snaps to bundle multiples
- [ ] Load builder: non-holey-board parts rotation — maximize truck load by rotating parts any way possible unless they have a bundle qty
- [ ] Load builder: make initial calculated load view larger, include the stacks visually
- [ ] Load builder: fix/clarify customize mode drag-and-drop (move layers between columns)
- [ ] Calendar view for shipments board
- [ ] BOL COORDS refinement — center commodity text + auto-size by line count, enlarge delivery-time font, enlarge & recenter scrap pick-up X marks (Prompt 66, in progress)
- [ ] Live BOL inline edit (WYSIWYG, render-override model) — review modal "Edit" now opens an overlay editor instead of returning to the form:
  - [ ] P67 — shared overlay engine (`bol-editor.js`) + override render mode in `bol-shared.js`, BOL generator only, ephemeral (no persistence)
  - [ ] P68 — persistence: `render_overrides` JSON column on `bols`, worker INSERT/UPDATE wiring, `loadBolIntoForm` rehydrates overrides (needs migration)
  - [ ] P69 — port editor to load builder with multi-record (multi-BOL) navigation
- [ ] Explore: use Claude Chrome to navigate AppSheets apps for a "Load Dashboard" for loading team
- [ ] Load count edit → loading card reconcile — editing `jobs.load_count` must reconcile `loading_assignments` so the loading dashboard card count matches the new value. Current state: create-time loop in `_worker.js/routes/jobs.js` builds N cards; loading GET backfill in `routes/loading.js` only *tops up* missing cards (done/loading/shipped, non-pickup) and never removes; job PUT writes the column but does no reconcile. Need: reconcile in job PUT — add up to target, and on decrease drop only surplus `awaiting`/unassigned cards (never delete a card that has a bay/trailer/photos). No migration. *(pairs with the >10 load count guard under Job Board)*

### New Batch — Loading Dashboard + Driver + BOL Alignment (unsequenced, added 2026-06-05)

Loading dashboard / driver:

- [ ] Loading dashboard overview: reorganize bay cards into two rows — **6 on top, 5 on bottom**.
- [ ] Card status color-coding: **Not Started → red**, **In Progress → yellow**.
- [ ] Detail-view timestamps: capture & display **loading started** and **loading completed** times on the loading dashboard detail view.
- [ ] **Lock card↔trailer assignment (critical).** Once a card is assigned to a trailer it is locked — no longer draggable bay→queue or bay→bay. Previously movable; drag-and-drop misfires cause accidental re-assignments. Counters human/mouse error.
- [ ] Trailer # lifecycle: number moves with the card on assignment, **locked** while assigned/in-transit, and **released** (available again) once the card is marked **delivered**.
- [ ] On **Mark In Transit**, clear the trailer input field on the loading dashboard.
- [ ] **Human-error fallback:** if a driver scans the QR to begin transit while the trailer was **not** marked loaded, force the trailer card into **In Transit**.
- [ ] Trailer-assigned indicator on the **job board card** — when a trailer is assigned (loading dashboard trigger), write a "Trailer Assigned" text/badge onto the job's kanban card. *(cross: loading dashboard → job board)*
- [ ] Add a **"Yard"** card to the **loading team view**. *(extends P93, which added Yard to the manager dashboard only)*
- [ ] Permission for the **"Move to Yard"** button. *(extends P93)*
- [ ] DocuSign on the driver pages.
- [ ] When a trailer number is assigned on the loading dashboard, propagate it onto the generated BOL. *(flag: may not be feasible — investigate)*

Inline BOL (PDF) editor — extends the `bol-editor.js` overlay engine (P67–69):

- [ ] Allow free **dragging** of text boxes in the inline PDF editor.
- [ ] Change the **delivery-time** field to a **multi-line** text box.

BOL Generator ↔ Load Builder alignment:

- [ ] **Re-unify the BOL tooling.** `bol-generator.html` and the Build Load generator still aren't fully shared — features land in one and not the other (the `bol-shared.js` single-source goal is only partly realized). Align `bol-generator.html` to the **Build Load generator as the source of truth**, which also gives `bol-generator.html` **multi-trailer** functionality. *(pairs with the P67–69 editor port; resolves the long-standing partial-sharing drift)*

### Done

- [x] ~~Add Loading BOL / Trailer assignment app into Ops Platform~~ — Load Builder integrated natively
- [x] ~~Link BOL Generator to Load Builder~~ — covered by Prompts 16–17
- [x] ~~Load Builder column max fix~~ — 53ft Standard trailer height corrected from 108" to 109"
- [x] ~~BOL text positioning fix~~ — Prompt 18, coords remapped to new template
- [x] ~~Load Builder customize mode alerts~~ — completed
- [x] ~~Add trailer number field on logistics dashboard~~ — already implemented
- [x] ~~Saved Loads button on Load Builder initial page~~ — Prompt 53
- [x] ~~Trailer number backend permission guard~~ — Prompt 53, manager-only on PUT /api/loading-bays
- [x] ~~BOL review/approve flow + stop auto-download of PDF~~ — Prompt 54
- [x] ~~Part # and qty only toggle on BOL generator (hide dims)~~ — Prompt 55
- [x] ~~Mark Loaded checklist — three confirmation questions + photo capture/upload~~ — Prompt 56
- [x] ~~Load count multi-assignment (load_count > 1 generates multiple loading cards)~~ — Prompt 57
- [x] ~~View BOL from loading cards~~ — Prompt 58
- [x] ~~Job as source of truth — backend sync overhaul~~ — Prompt 59
- [x] ~~Logistics dashboard UI overhaul (statuses, action buttons, assign bay dropdown)~~ — Prompt 60
- [x] ~~Logistics dashboard job-mirrored modal rebuild + data migration~~ — Prompts 61–63
- [x] ~~Show Build Load / BOL for all job-linked shipments~~ — Prompt 62
- [x] ~~Status badge pill fix + remove job-linked note~~ — Prompt 64
- [x] ~~Read-only line items on logistics shipment modal~~ — Prompt 65

---

## Job Board

- [ ] Delete job not working — root-caused: orphaned `shipments`/`loading_assignments`/`loading_photos` children block/orphan the delete *(P91, with pickup exclusion)*
- [ ] Customer Pickup (`jobs.method = 'customer pickup'`) must NOT create a bay-queue card — logistics dashboard only; no migration (field exists) *(P91)*
- [ ] Fine-tune packing slip PDF parser (edge cases, layout variations, field extraction accuracy — blocked on Quickbase input formatting improvements)
- [ ] Create packet feature with Bill of Materials (BOM)
- [ ] Recurring jobs / job templates — "duplicate as template" or "create from previous" for repeat customers (e.g. DiversiTech, All Florida Weatherproofing)
- [ ] Calendar view for job board
- [ ] Archive feature — when a job hits "Shipped" (final state), add an "Archive" button to the card + toast confirmation; archived jobs move off the kanban to reduce clutter
- [ ] Label printing — DiversiTech and UL labels
- [ ] Load count guard on job entry — confirm prompt when `load_count > 10` ("Are you sure you want more than 10 trailers?"); proceed on confirm, keep editing on cancel. Frontend only (`jobs/index.html`, `f-load-count`); no `max` clamp. *(pairs with the load-count reconcile item under Logistics)*
- [ ] No duplicate INV# when creating a job — validate `invoice_number` uniqueness at job creation (reject/flag dupes). *(also a guard for QB auto-intake, where created/updated webhooks can fire repeatedly for the same invoice — dedupe on invoice number)*

### Done

- [x] ~~Packing slip upload + parser~~ — PDF upload, client-side parsing, job prefill
- [x] ~~Ship-to address carry-through~~ — covered by Prompt 15
- [x] ~~Auto-generate outbound shipment record when a job is created~~ — completed

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

## Foundation Roadmap (do this BEFORE the next module expansion)

The platform has grown Logistics deep. Every other department (sales, AP/AR, scheduling, receiving, HR) layered on next will hit the same constraints: a monolithic worker, six duplicated `*-header.js` files, business logic that lives in 2+ places, base64 blobs filling D1, and an inability to verify auth coverage by inspection. The architectural cost of fixing these grows roughly linearly with each new module added on top. Fixing them now, before module #2, is dramatically cheaper than fixing them after module #5.

Phases are ordered so each unlocks the next. Do not interleave new feature work between phases — that's how foundation projects die.

### Phase F1 — Shared utilities (highest ROI, lowest risk) — ✅ DONE

The single best near-term move. Cheap, surgical, eliminates real bugs.

- [x] ~~**F1a** — Extract `shared-header.js`~~ — Prompt 74. Consolidated 5 module headers into one. Drift eliminated.
- [x] ~~**F1b** — Extract `shared-api.js`~~ — Prompt 75. `window.api.get/post/put/del` helper + proof-of-pattern migration in `loading.html`.
- [x] ~~**F1c** — Extract `shared-utils.js`~~ — Prompt 76. Density calc canary migrated + date helpers (`isoToUS`, `isoToShortDate`, `todayIso`) + `escHtml`/`truncate` ready for adoption.

**Open follow-up: bulk migration of existing `fetch` calls to `api.*` and inline calcs to `utils.*` across all modules.** The shared utilities exist platform-wide but most module code still uses raw `fetch` / inline formulas. Each module is one tight follow-up prompt. Defer or interleave with feature work — no blocking dependency.

### Phase F2 — Worker router abstraction — ✅ DONE

- [x] ~~**F2** — Refactor flat `if/else` dispatch into `API_ROUTES` route table~~ — Prompt 77. 48 routes now in one declarative lookup; F5 modularization becomes mechanical.

### Phase F3 — Permissions audit pass — ✅ DONE

- [x] ~~**F3** — Read-only audit~~ — Prompt 78. `/permissions-audit.md` exists at repo root.
- [x] ~~**F3 gap-fix** — `/api/saved-loads` permission gap~~ — P95. Added `{ pattern: /^\/api\/saved-loads/, key: 'logistics.load-builder' }` to `API_PERMISSION_MAP`.

### Phase F4 — R2 storage migration (phased per blob type) — 🟡 IN PROGRESS

D1's 500MB ceiling is the existential cliff. Base64 inflates files ~33%; packing slips, loading photos, completion PDFs all live as base64 TEXT in D1 today. R2 bucket established and proven via Prompt 83 (BOL tracking signed photos).

- [x] ~~**F4b** — R2 binding + upload/serve worker pattern~~ — Established via Prompt 83 (`xpanda-bol-photos` bucket bound as `env.BOL_PHOTOS`; pattern proven with signed BOL photos).
- [x] ~~**F4a** — Blob inventory~~ — P96. `/r2-migration-inventory.md` created. Two columns in D1: `loading_photos.photo_data` and `jobs.packing_slip_pdf`. No F4e needed.
- [x] ~~**F4c — Loading photos migration**~~ — P97. `loading_photos.photo_key` column, R2 write/serve path with base64 fallback, `photo-gallery.js` updated to use `/api/loading-photos/:id/image`, admin backfill endpoint at `POST /api/admin/r2-backfill?type=loading-photos`. **Needs migration** (`add-photo-key-to-loading-photos.sql`).
- [x] ~~**F4d — Packing slips migration**~~ — P98. `jobs.packing_slip_key` column, R2 write/serve path with base64 fallback, backfill via `POST /api/admin/r2-backfill?type=packing-slips`. **Needs migration** (`add-packing-slip-key-to-jobs.sql`).
- [x] ~~**F4e+**~~ — No additional blob columns found during F4a inventory.

### Phase F5 — Worker modularization (Pages Functions)

- [ ] **F5** — With F2 done, the worker is already a route table. Peel each route group into its own file under `/functions/api/...` (Pages Functions per-route) while preserving single-bundle deploy semantics. Likely 3–4 prompts, one route group at a time (auth, bols, jobs, parts, etc.), each independently testable.

---

## Admin / Platform (feature work — defer most until Foundation Roadmap progresses)

These are real business needs but every one of them deepens the existing debt. Build them after Phase F1 lands at minimum; some need F4 or F5 before they're sane to add.

- [ ] Hide `packing-slip-test.html` from any navigation/discovery surface (tiny housekeeping — can ship anytime, doesn't block anything)
- [ ] "Test as role" feature — admin dropdown to preview the platform as a specific role without logging out *(builds on permission system — preferably after F3 audit)*
- [ ] Breakdown job board permissions into more granular sub-modules *(easier after F3 audit + F1a shared header)*
- [ ] Dashboard KPIs / metrics panel — homepage widget showing jobs by status, BOLs generated this week, shipments pending/in-transit/delivered, most-used parts *(adds new endpoints — much cleaner after F2 router abstraction)*
- [ ] Notifications / alerts — in-app notification bar with rules-based alerts *(adds polling endpoints — wait for F2)*
- [ ] Port language / i18n features from Safety portal to platform-wide use *(needs F1c shared utils as its home)*
- [ ] Scrap batch entry tool *(needs F1c first — risks a third density calc site otherwise)*

### Done

- [x] ~~Admin pages: standalone parts library management~~ — Prompt 19, full CRUD at `/admin/parts.html`
- [x] ~~Activity log / audit trail~~ — Prompt 20, platform-wide logging + viewer at `/admin/activity-log.html`
- [x] ~~User login / authentication system~~ — Prompts 21–22, session-based auth with first-login password flow
- [x] ~~Role-based permissions~~ — Prompts 23–24, configurable roles with per-module view/edit toggles, admin bypass
- [x] ~~New Manufacturing module + Cutting Dashboard placeholder~~ — Prompt 80. Block + Holey Board calculators moved out of Production; Production now inventory-only.
- [x] ~~Shared photo-gallery component (loading photos viewer)~~ — Prompt 81. `/shared/photo-gallery.js` consumed by loading dashboard cards and logistics shipment modal.
- [x] ~~BOL driver tracking system (QR + public flow + signed BOL to R2 + push notif)~~ — Prompts 82–84. Drivers scan QR → confirm pickup → complete delivery with signed-BOL photo → R2 storage → office push notification. QR coords nudged to bottom-left green-box position (commit `da1ad91`).

### Dropped

- ~~Customer master record / central `customers` table~~ — QuickBooks remains the customer source of truth. Revisit only if sales staff begin building jobs directly in the platform.

---

## Production / Calculators

### Done

- [x] ~~Unified parts library~~ — covered by Prompt 14, single source of truth for block calculator + load builder + job board

---

## QC

*(No open items — tracked here for future additions)*

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

---

## Completed (Archive)

Items moved here once fully shipped and verified.

- [x] Unified parts library (Prompt 14) — merged `parts_library` + `load_builder_skus` into single `parts` table
- [x] Ship-to address on jobs (Prompt 15) — full address from packing slip stored on jobs, carried through to BOL
- [x] Job → Load Builder linking (Prompt 16) — "Build Load" button, parts pre-loaded from job line items, on-the-fly part creation
- [x] BOL prefill upgrade (Prompt 17) — real address from job instead of fuzzy customer search
- [x] Load Builder 53ft trailer height fix — corrected from 108" to 109"
- [x] BOL text positioning fix (Prompt 18) — coords remapped to new template
- [x] Admin parts library page (Prompt 19) — full CRUD at `/admin/parts.html`
- [x] Activity log / audit trail (Prompt 20) — platform-wide logging + viewer at `/admin/activity-log.html`
- [x] Auth system (Prompts 21–22) — username/password login, sessions, first-login password flow, user management admin page
- [x] Roles & permissions (Prompts 23–24) — configurable roles with per-module view/edit toggles, admin bypass, permission grid UI
- [x] Shared BOL module (Prompt 25) — unified `bol-shared.js` for PDF generation, eliminated coord duplication between BOL generator and load builder, optional BOL number with toast confirmation
- [x] Parser overhaul (Prompt 26) — multi-page PDF parsing, improved address/contact extraction, zero-qty filtering, notes filtering
- [x] Job board UI cleanup (Prompt 27) — removed stale fields, inline packing slip viewer, drag-drop upload, modal close fix
- [x] Load builder improvements (Prompt 28) — saved loads to D1, BOL duplicate fix, auto-increment suffixes, customize drag-drop
- [x] Platform QC (Prompt 29) — dead code removal, auth caching, schema consolidation, hygiene pass
- [x] Parts matching at parse time (Prompt 30) — line items auto-matched to parts library during packing slip upload
- [x] BOL Generator — PDF generation, customer dropdown, edit/new/duplicate modes
- [x] Load Builder — native integration into platform (converted from React/Vite iframe)
- [x] Job Board — Kanban with five statuses, line items, production sub-steps
- [x] Packing slip upload + auto-parse to job creation
- [x] Block Calculator — multi-part nesting, parts library, saved combos, XLSX export
- [x] Holey Board Calculator — bin-packing optimization
- [x] Inventory — three-layer model (bead bags → blocks → molding log)
- [x] QR Code upload interface — merged with AppSheets
