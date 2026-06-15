# xPanda Ops Platform — Changelog

> **Process:** When an item ships, its entry moves to `CHANGELOG.md` (keyed to its prompt #) and is
> deleted from `BACKLOG.md`. BACKLOG is forward-looking only. Drift check: diff `Prompts/` against
> `CHANGELOG.md` — any prompt missing from the changelog is a gap.

Entries within each module are ordered by prompt # descending (newest first).

---

## Logistics

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

- **P80** — New Manufacturing module: Block and Holey Board calculators moved out of Production; Cutting Dashboard placeholder added; Production repurposed as inventory-only. (7ddcf00)

---

## QC

*(QC module bootstrapped as part of the early foundation; no items with distinct prompt numbers. P137 is in Infra / Docs.)*

---

## Safety

*(Safety portal bootstrapped as part of the early foundation; no items with distinct prompt numbers.)*

---

## Reports

- **P52** — Orders Report page; jobs API improvements. (1b4d2f0)

---

## Admin / Platform

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

- **P137** — QC slop/spaghetti audit (report-only): `qc-slop-audit.md` inventories dead code, duplication, abandoned-migration sites, and roots the PO-to-PDF rendering bug in `bol-generator.html`. (untracked; no code changes)
- **P124** — Doc sync: `xpanda-ops-agents.md` worker section updated to post-F2/F5 reality (file-split worker, `API_ROUTES`, ESM bundle). (89ed041)
- **P51** — (see Logistics) Loading Dashboard link added to nav; Prompts/ and DB Migrations/ folders organized. (de867bb)
