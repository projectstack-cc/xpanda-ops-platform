# xPanda Ops Platform — Backlog

> **Process:** When an item ships, its entry moves to `CHANGELOG.md` (keyed to its prompt #) and is
> deleted from `BACKLOG.md`. BACKLOG is forward-looking only. Drift check: diff `Prompts/` against
> `CHANGELOG.md` — any prompt missing from the changelog is a gap.
>
> Shipped items live in `CHANGELOG.md`.

---

## Manufacturing / Cutting (React pilot)

- [ ] Enable OpenNext skew protection on the v2 Worker (durable fix for hashed-asset 404s across deploys) — see https://opennext.js.org/cloudflare/howtos/skew

---

## Logistics

### Standing Logistics Backlog

- [ ] Customer database (full CRUD) — icebox: revisit once all orders are entered here first, or it becomes a necessity
- [ ] Consider separate dashboards for staff vs. management (TV display)
- [ ] Zoning support for deck systems
- [ ] Load builder: make initial calculated load view larger, include the stacks visually
- [ ] Load builder: fix/clarify customize mode drag-and-drop (move layers between columns)

### BOL Issues

- [ ] **BOL print rendering bug** — when printing the BOL directly (without downloading), the "N" from "Bill of Lading No" and the "S" in "Customer Signature" are clipped/hidden. Parked: root cause is the blank-template artwork + browser print scaling (not our drawn text); needs print-preview testing on a real printer.

---

## Job Board

- [ ] **Batch Packing Slip upload for job creation** — allow uploading multiple packing slips at once to create multiple jobs in bulk; likely a first feature of a planned Order Entry dashboard.
- [ ] Fine-tune packing slip PDF parser (edge cases, layout variations, field extraction accuracy — blocked on Quickbase input formatting improvements)
- [ ] Create packet feature with Bill of Materials (BOM)
- [ ] Recurring jobs / job templates — "duplicate as template" or "create from previous" for repeat customers (e.g. DiversiTech, All Florida Weatherproofing)
- [ ] Label printing — DiversiTech and UL labels

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

- [ ] Remove temporary `pages.dev` → `xpandaops.com` redirect from `_worker.js/index.js` once all internal links/bookmarks confirmed updated.
- [ ] Hide `packing-slip-test.html` from any navigation/discovery surface (tiny housekeeping — can ship anytime, doesn't block anything)
- [ ] Breakdown job board permissions into more granular sub-modules *(easier after F3 audit + F1a shared header — both now done)*
- [ ] Dashboard KPIs / metrics panel — homepage widget showing jobs by status, BOLs generated this week, shipments pending/in-transit/delivered, most-used parts *(adds new endpoints)*
- [ ] Port language / i18n features from Safety portal to platform-wide use *(needs F1c shared utils as its home — now done)*
- [ ] Scrap batch entry tool *(density calc now centralized in shared-utils.js — safe to add)*
- [ ] **Dark mode Bucket A — remaining passes** — P184 audit identified Bucket A hits in Safety (0% token adoption — highest priority), `logistics/load-builder.html` (local token system, separate batch), and `track/index.html` (standalone, no tokens.css). P186 covered all other modules. These three remain for dedicated prompts.

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
- [ ] Deploy + domain attach (Steve — requires wrangler auth + real hostname; workers.dev cannot host the cookie-shared `/v2/*` route)
- [ ] Auth-bridge + operator loop validation (requires real host after domain attach; walk the full clock-in→handoff→complete→job-done loop)
- [ ] Priority ordering for the queue (next prompt)
- [ ] Block-calculator BOM wiring (`cutting_lines.qty_target`)
- [ ] Kill `cutting_steps` / legacy `cutting-dashboard.html` once v2 is on the floor

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
