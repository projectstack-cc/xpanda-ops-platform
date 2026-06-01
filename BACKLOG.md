# xPanda Ops Platform — Backlog

---

## Logistics

- [ ] Customer database (full CRUD)
- [ ] Loading status indicator
- [ ] Consider separate dashboards for staff vs. management (TV display)
- [ ] Zoning support for deck systems
- [ ] Part bundle quantities — `bundle_qty` field on parts, load builder snaps to bundle multiples
- [ ] Load builder: non-holey-board parts rotation — maximize truck load by rotating parts any way possible unless they have a bundle qty
- [ ] Load builder: make initial calculated load view larger, include the stacks visually
- [ ] Load builder: fix/clarify customize mode drag-and-drop (move layers between columns)
- [ ] Calendar view for shipments board
- [ ] BOL COORDS refinement — center commodity description text horizontally, enlarge time field font (Prompt 66, in progress)
- [ ] Explore: use Claude Chrome to navigate AppSheets apps for a "Load Dashboard" for loading team

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

- [ ] Fine-tune packing slip PDF parser (edge cases, layout variations, field extraction accuracy — blocked on Quickbase input formatting improvements)
- [ ] Create packet feature with Bill of Materials (BOM)
- [ ] Recurring jobs / job templates — "duplicate as template" or "create from previous" for repeat customers (e.g. DiversiTech, All Florida Weatherproofing)
- [ ] Calendar view for job board
- [ ] Archive feature — when a job hits "Shipped" (final state), add an "Archive" button to the card + toast confirmation; archived jobs move off the kanban to reduce clutter
- [ ] Label printing — DiversiTech and UL labels

### Done

- [x] ~~Packing slip upload + parser~~ — PDF upload, client-side parsing, job prefill
- [x] ~~Ship-to address carry-through~~ — covered by Prompt 15
- [x] ~~Auto-generate outbound shipment record when a job is created~~ — completed

---

## Admin / Platform

- [ ] "Test as role" feature — admin dropdown to preview the platform as a specific role without logging out
- [ ] Breakdown job board permissions into more granular sub-modules
- [ ] Customer master record — central `customers` table that `bol_customers`, `jobs.customer`, and shipments all reference. Eliminates fuzzy matching; packing slips either match an existing customer or create a new one. Build after Customer CRUD is done.
- [ ] Dashboard KPIs / metrics panel — homepage widget showing jobs by status, BOLs generated this week, shipments pending/in-transit/delivered, most-used parts. Simple SQL COUNT queries rendered in cards.
- [ ] Notifications / alerts — in-app notification bar with rules-based alerts (e.g. "3 jobs stuck in Production >3 days", "BOL missing trailer number", "load build exceeds weight limit"). Runs on page load, no auth dependency.
- [ ] Port language / i18n features from Safety portal to platform-wide use
- [ ] Scrap batch entry tool

### Done

- [x] ~~Admin pages: standalone parts library management~~ — Prompt 19, full CRUD at `/admin/parts.html`
- [x] ~~Activity log / audit trail~~ — Prompt 20, platform-wide logging + viewer at `/admin/activity-log.html`
- [x] ~~User login / authentication system~~ — Prompts 21–22, session-based auth with first-login password flow
- [x] ~~Role-based permissions~~ — Prompts 23–24, configurable roles with per-module view/edit toggles, admin bypass

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
