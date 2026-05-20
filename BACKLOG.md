# xPanda Ops Platform — Backlog

---

## Logistics

- [ ] Customer database (full CRUD)
- [ ] Loading status indicator
- [ ] Consider separate dashboards for staff vs. management (TV display)
- [ ] Zoning support for deck systems
- [ ] Part bundle quantities — certain parts ship in customer-specific bundle counts (e.g. H3636-4 bundles in 5's). Need a `bundle_qty` field on parts so the load builder can snap to bundle multiples.

### Done

- [x] ~~Add Loading BOL / Trailer assignment app into Ops Platform~~ — Load Builder integrated natively
- [x] ~~Link BOL Generator to Load Builder~~ — covered by Prompts 16–17
- [x] ~~Load Builder column max fix~~ — 53ft Standard trailer height corrected from 108" to 109"
- [x] ~~BOL text positioning fix~~ — Prompt 18, coords remapped to new template
- [x] ~~Load Builder customize mode alerts~~ — completed
- [x] ~~Add trailer number field on logistics dashboard~~ — already implemented

---

## Job Board

- [ ] Fine-tune packing slip PDF parser (edge cases, layout variations, field extraction accuracy — blocked on Quickbase input formatting improvements)
- [ ] Create packet feature with Bill of Materials (BOM)
- [ ] UI improvements pass
- [ ] Recurring jobs / job templates — "duplicate as template" or "create from previous" for repeat customers (e.g. DiversiTech, All Florida Weatherproofing)

### Done

- [x] ~~Packing slip upload + parser~~ — PDF upload, client-side parsing, job prefill
- [x] ~~Ship-to address carry-through~~ — covered by Prompt 15
- [x] ~~Auto-generate outbound shipment record when a job is created~~ — completed

---

## Admin / Platform

- [x] ~~User login / authentication system~~ — Prompts 21-22, session-based auth with login page, change-password flow
- [x] ~~Role-based permissions (admin, staff, read-only, etc.)~~ — Prompts 23-24, roles table, permission middleware, Admin → Roles editor
- [ ] Customer master record — central `customers` table that `bol_customers`, `jobs.customer`, and shipments all reference. Eliminates fuzzy matching; packing slips either match an existing customer or create a new one. Build after Customer CRUD is done.
- [ ] Dashboard KPIs / metrics panel — homepage widget showing jobs by status, BOLs generated this week, shipments pending/in-transit/delivered, most-used parts. Simple SQL COUNT queries rendered in cards.
- [ ] Notifications / alerts — in-app notification bar with rules-based alerts (e.g. "3 jobs stuck in Production >3 days", "BOL missing trailer number", "load build exceeds weight limit"). Runs on page load, no auth dependency.
- [ ] QC login gate (depends on auth)
- [ ] Port language / i18n features from Safety portal to platform-wide use
- [ ] Scrap batch entry tool

### Done

- [x] ~~Admin pages: standalone parts library management~~ — Prompt 19, full CRUD at `/admin/parts.html`
- [x] ~~Activity log / audit trail~~ — Prompt 20, platform-wide logging + viewer at `/admin/activity-log.html`
- [x] ~~User login / authentication system~~ — Prompts 21-22, session-based auth, login page, change-password flow
- [x] ~~Role-based permissions~~ — Prompts 23-24, roles table, permission middleware, Admin → Roles editor, frontend gating on all modules

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
- [x] BOL Generator — PDF generation, customer dropdown, edit/new/duplicate modes
- [x] Load Builder — native integration into platform (converted from React/Vite iframe)
- [x] Job Board — Kanban with five statuses, line items, production sub-steps
- [x] Packing slip upload + auto-parse to job creation
- [x] Block Calculator — multi-part nesting, parts library, saved combos, XLSX export
- [x] Holey Board Calculator — bin-packing optimization
- [x] Inventory — three-layer model (bead bags → blocks → molding log)
- [x] QR Code upload interface — merged with AppSheets
