# xPanda Ops Platform — Backlog

> **Process:** When an item ships, its entry moves to `CHANGELOG.md` (keyed to its prompt #) and is
> deleted from `BACKLOG.md`. BACKLOG is forward-looking only. Drift check: diff `Prompts/` against
> `CHANGELOG.md` — any prompt missing from the changelog is a gap.
>
> Shipped items live in `CHANGELOG.md`.

---

## Logistics

### Standing Logistics Backlog

- [ ] Customer database (full CRUD)
- [ ] Loading status indicator
- [ ] Consider separate dashboards for staff vs. management (TV display)
- [ ] Zoning support for deck systems
- [ ] Load builder: make initial calculated load view larger, include the stacks visually
- [ ] Load builder: fix/clarify customize mode drag-and-drop (move layers between columns)
- [ ] Load builder Load tab polish (optional, post-P131) — tune SKU grid frame height (`46vh`); cap the sticky LOAD LIST height when a load has many line items; optional "In load (N)" entry pinned atop the category rail; indicate active forced-sizes state on the collapsed Advanced toggle.
- [ ] BOL COORDS refinement — remaining: enlarge & recenter scrap pick-up X marks *(commodity centering + delivery-time enlargement already shipped as P66–P67)*
- [ ] Explore: use Claude Chrome to navigate AppSheets apps for a "Load Dashboard" for loading team

### New Batch — Loading Dashboard + Driver + BOL Alignment

- [ ] On **Mark In Transit**, clear the trailer input field on the loading dashboard.
- [ ] **Human-error fallback:** if a driver scans the QR to begin transit while the trailer was **not** marked loaded, force the trailer card into **In Transit**.
- [ ] DocuSign on the driver pages.

### BOL Issues

- [ ] **BOL download broken in Load Builder** — BOL generated from the load builder doesn't trigger a download; user has to Print → Save as PDF instead. Investigate whether the `BolCompose` save path is missing the download trigger that `bol-generator.html` uses. *(regression introduced somewhere in P123–P128 unification)*
- [ ] **"Generate BOL" → "View BOL" on logistics dashboard** — once a BOL has been generated for a job, the "Generate BOL" button on the logistics row/card should change to "View BOL" (mirrors the loading-dashboard card behavior). The `bol_count` column is already returned by the loading-assignments query — same pattern can be applied to the logistics dashboard query.
- [ ] **BOL print rendering bug** — when printing the BOL directly (without downloading), the "N" from "Bill of Lading No" and the "S" in "Customer Signature" are clipped/hidden. Likely a CSS `overflow: hidden` or `white-space` clip on the containing element interacting with the browser's print renderer. Needs print-preview investigation.
- [ ] **Remove dimensions from BOL commodity block** — dimensions are already embedded in most line-item descriptions, so including them separately duplicates content. Add a toggle or remove the dimension column from the BOL commodity section entirely. *(coordinating change in `bol-shared.js` `drawCommodity` / commodity tier logic)*

### BOL Generator Follow-on

- [ ] **`bol-generator.html` multi-trailer.** The shared review surface already navigates multiple records (the picker); `bol-generator.html` still collects a single ship-to set. Small lift: collect N records → `reviewRecords([...])`. *(follow-on to P123–P128)*

### Logistics Calendar View

- [ ] **Build Load + Generate BOL in logistics calendar popup** — users who prefer the calendar view on the logistics dashboard can't access "Build Load" or "Generate BOL" actions from the shipment popup card. Add those buttons to the popup, matching what's available in the list row. *(same permission gating as list view; `bol_count` drives "Generate BOL" vs "View BOL" once that item above ships)*

---

## Job Board

- [ ] **Mobile drag-and-drop scroll conflict** — on mobile, dragging a kanban card also triggers page scroll, making drag-and-drop unusable. Investigate `touch-action: none` on the drag handle / card element, or switch to a pointer-events approach that suppresses scroll during an active drag gesture.
- [ ] Fine-tune packing slip PDF parser (edge cases, layout variations, field extraction accuracy — blocked on Quickbase input formatting improvements)
- [ ] Create packet feature with Bill of Materials (BOM)
- [ ] Recurring jobs / job templates — "duplicate as template" or "create from previous" for repeat customers (e.g. DiversiTech, All Florida Weatherproofing)
- [ ] Label printing — DiversiTech and UL labels
- [ ] No duplicate INV# when creating a job — validate `invoice_number` uniqueness at job creation (reject/flag dupes). *(also a guard for QB auto-intake, where created/updated webhooks can fire repeatedly for the same invoice — dedupe on invoice number)*

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

- [ ] Hide `packing-slip-test.html` from any navigation/discovery surface (tiny housekeeping — can ship anytime, doesn't block anything)
- [ ] Breakdown job board permissions into more granular sub-modules *(easier after F3 audit + F1a shared header — both now done)*
- [ ] Dashboard KPIs / metrics panel — homepage widget showing jobs by status, BOLs generated this week, shipments pending/in-transit/delivered, most-used parts *(adds new endpoints)*
- [ ] Port language / i18n features from Safety portal to platform-wide use *(needs F1c shared utils as its home — now done)*
- [ ] Scrap batch entry tool *(density calc now centralized in shared-utils.js — safe to add)*

---

## Foundation Roadmap — ✅ All phases complete

All Foundation Roadmap phases (F1–F5) have shipped. See `CHANGELOG.md` (Foundation Roadmap section) for entries.

---

## Production / Manufacturing

*(No open items — all shipped. See `CHANGELOG.md`.)*

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
