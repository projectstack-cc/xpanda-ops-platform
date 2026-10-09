# xPanda Operations Platform — Agent Guidance

This file defines rules that any AI agent (Claude Code, Codex, etc.) must follow when making changes to this repository.

This is a **production ERP platform** for a foam manufacturing operation. It is actively used on the factory floor and in logistics daily. Changes must be surgical, production-safe, and must not introduce architectural drift.

**Launch target: v1.0 by end of June 2026.**

---

# 1. Platform Architecture

The xPanda Operations Platform is an ERP-lite system for foam manufacturing operations — jobs, logistics, production, quality control, and safety. It runs as two halves on one host over one data layer.

**Legacy app — Cloudflare Pages (Advanced Mode):**
- Static HTML pages with vanilla JavaScript. No frameworks, build tools, bundlers or module systems in browser code. Chart.js for report charts, pdf-lib for BOL PDFs, pdf.js for packing-slip parsing.
- **Legacy worker**, which Pages bundles into one worker (there is no build step of ours):
  - entry `_worker.js/index.js` — the session gate plus the declarative `API_ROUTES` table (F2)
  - shared helpers in `_worker.js/lib/`: `core.js` (`json()`, `logActivity()`, session validation, `PATH_PERMISSION_MAP` / `API_PERMISSION_MAP`), `bol-carrier.js`, `holey-nester.js`, `lineItems.js`, `push.js`
  - per-domain handlers in `_worker.js/routes/`: `auth.js`, `bols.js`, `jobs.js`, `loading.js`, `notifications.js`, `production.js`, `public.js`, `qc.js`, `reports.js`
  - static assets served via `env.ASSETS.fetch(request)`

**v2 migration surface — `cutting-pilot/`:**
- Next.js 14 App Router on Cloudflare Workers via OpenNext, served under `/v2/*` on the same host.
- Shares the **same D1 (`DB`) and R2 (`BOL_PHOTOS`)** bindings and the legacy `xpanda_session` cookie. v2 reads sessions; it never sets cookies (login stays on the legacy app).
- Deployed by `.github/workflows/deploy-v2-worker.yml` on pushes to `main` that touch `cutting-pilot/**`.
- **React is allowed only here.** Legacy modules stay vanilla, and nothing outside `/v2` gets React-ified. Full rules: `xpanda-ops-agents.md` §9a (platform) and §9b (React components).

**Data sources:**
- **D1 Database (SQLite)** → all operational records (jobs, BOLs, parts, shipments, users, roles, activity log, production)
- **Google Sheets gviz endpoint** → incident report analytics (legacy integration)

**Migration status.** Strangler pattern: modules are ported one at a time, built unlinked, tested, then cut over (links repointed, legacy pages archived and replaced by redirect stubs). The end state is full retirement of the legacy worker and the Pages project.
- **Cut over to v2:** Dock Loading (`/v2/logistics/loading`), BOL Email Queue (`/v2/logistics/bol-email`), Production Log (`/v2/production`), Admin (`/v2/admin`).
- **Still legacy:** Job Board Classic (`/jobs/`) and Logistics Classic (`/logistics/`) — both in active testing alongside their v2 counterparts — the Manufacturing calculators, QC, Reports, Safety, and the shell (home `index.html`, `login.html`, `track/`, `legal/`, `account/`).

---

# 2. API Structure

**Legacy APIs** live in `_worker.js/routes/*.js` and are registered in `_worker.js/index.js`'s `API_ROUTES` table (`path` = exact match, `prefix` = exact or `prefix/…`, optional `method`). To add an endpoint, write the handler in the right routes file and add **one** row. **Never collapse the worker back into one file.** Auth endpoints (`/api/auth/*`) and a few public/system paths are matched directly in `index.js`.

**v2 APIs** live in `cutting-pilot/src/app/api/**/route.ts` → `/v2/api/*`. v2 pages may also call legacy `/api/*` on the same host (for example `/api/parts`).

**Core API groups:**
```
/api/auth/*            — login, logout, session (me), password change, simulate-role (legacy)
/api/jobs              — job board CRUD, packing slip endpoints
/api/bols              — BOL CRUD, generation
/api/bol-customers     — customer address book for BOLs
/api/bol-carriers      — carrier directory
/api/shipments         — inbound/outbound shipment tracking
/api/parts             — unified parts library (block calc + load builder + job board + /v2/admin Parts tab)
/api/load-builder-skus — load builder SKU interface (maps to parts table)
/api/combos            — saved block calculator combinations
/api/saved-loads       — saved load builder states (D1, 90-day TTL)
/api/loading-*         — dock bays, assignments, photos
/api/completions       — QC final inspections
/api/scrap-log         — QC scrap entries
/api/reports/*         — read-only analytics
/api/notifications     — bell notifications (+ /api/push/* web-push)
/api/public/*          — unauthenticated carrier BOL lookup / pickup / delivery / documents
/v2/api/admin/*        — users, roles, stats, simulate-role, activity (+ facets) — v2 Admin
/v2/api/*              — other v2 module APIs (board, orders, cutting, production, logistics, schedule-board, notes, carrier, qb, …)
```
`/api/users`, `/api/roles` and `/api/activity-log` were retired in admin-09 (replaced by `/v2/api/admin/*`).

**Rules:**
- Do NOT rename existing routes
- Do NOT change response shapes of existing routes
- Use the shared `json()` helper for all legacy responses (v2: `NextResponse.json`)
- Legacy handlers follow: `async function handleSomething(request, env)`
- All mutating operations (POST/PUT/PATCH/DELETE) must include `logActivity()` calls (v2: `cutting-pilot/src/lib/activityLog.ts`)
- Error responses use the shape: `{ ok: false, error: "Human message", detail: "Technical detail" }`

---

# 3. Authentication & Authorization

**Authentication:**
- Session-based with `xpanda_session` cookie
- Plaintext passwords in D1 (intentional — admin recovery for floor workers)
- First-login password change flow
- The legacy session gate (`_worker.js/index.js`) redirects unauthenticated page requests to `/login` and returns 401 for API calls; v2 `src/middleware.ts` validates the same session row and does the same for `/v2/*`
- Static assets (CSS, JS, images, fonts) bypass the session gate

**Authorization:**
- The `roles` table stores a JSON `permissions` blob per role: permission key → `{ view: boolean, edit: boolean }`. A user may hold several roles (`user_roles`); their permissions merge most-permissive per key.
- The `role-administrator` role (or the legacy `users.role = 'admin'`) bypasses all permission checks.
- GET/HEAD → requires `view`; mutations → require `edit`.
- **Two gates:**
  - **Legacy:** `PATH_PERMISSION_MAP` / `API_PERMISSION_MAP` in `_worker.js/lib/core.js`. An unmapped legacy API **mutation** is denied by default (QC Cleanup-11; explicit allowlist in `core.js`); an unmapped GET is allowed after login.
  - **v2:** `PERMISSION_MAP` in `cutting-pilot/src/middleware.ts`. The first matching prefix wins, and a mapped prefix may list several keys (any one grants). **An unmapped v2 path is gated only by login**, so every new v2 route needs a `PERMISSION_MAP` row.
- **Fine-grained checks inside handlers** read headers set by the gate: `X-User-Is-Admin`, `X-User-Permissions` (JSON), `X-User-Is-Real-Admin` and `X-User-Simulating-Role` (v2), and the `X-User-Can-*` booleans. Examples: `jobs.manage`, and admin-07's `jobs.create` / `jobs.status` / `jobs.archive` (enforced only when the request actually changes the value).
- Frontend hides inaccessible cards/links based on the permissions in `/api/auth/me` (legacy) or the session props (v2).

**Test as role:**
- Started from `/v2/admin` → Roles → **Test as this role** (stored as `sessions.simulating_role_id`).
- A real admin keeps access to the admin surface while testing: legacy `ESCAPE_PREFIXES` (`/admin/`, `/api/auth/`, `/login`), v2 `ADMIN_ESCAPE_PREFIXES` (`/v2/admin`, `/v2/api/admin`).
- Every v2 page shows the global "Testing as …" strip with **Stop testing**; legacy module headers show their own.

**Adding a permission key:**
1. Add the key + label to **`cutting-pilot/src/lib/permissions.ts`**. It is the single source: `/v2/admin` → Roles renders the toggles from it, and new roles are seeded from it with everything false.
2. Gate the paths: legacy → the `core.js` maps; v2 → the `middleware.ts` `PERMISSION_MAP`.
3. If the key splits an existing one, ship a seed migration that copies the parent's value — with a backup and a post-check — and run it **before** the code that enforces it (admin-07 pattern).
4. Never rename a key without a data migration: keys are persisted in `roles.permissions`.

---

# 4. Module Overview

| Module | Path(s) | Status | Purpose | Key files |
|---|---|---|---|---|
| **Jobs** | `/v2/board`, `/v2/orders`; Classic `/jobs/` | both (Classic still up, in active testing) | Job lifecycle board, order entry, packing slip upload/parse, line items | `cutting-pilot/src/app/board/`, `cutting-pilot/src/app/orders/`, `jobs/index.html`, `jobs/packing-slip-parser.js` |
| **Logistics** | `/v2/logistics` (dashboard, invoice analytics), `/v2/logistics/bol-email`, `/v2/logistics/loading` (Dock Loading), `/v2/loading` (Loading TV), `/v2/logistics/load-builder` (dark); Classic `/logistics/` | both (dashboard / BOL email / dock on v2; Load Builder v2 dark, Classic still up) | Shipments, BOL generation, load building, dock loading | `cutting-pilot/src/app/logistics/`, `cutting-pilot/src/app/loading/`, `cutting-pilot/src/lib/bolShared.ts`, `logistics/bol-shared.js`, `logistics/bol-compose.js`, `logistics/index.html`, `logistics/load-builder.html` |
| **Carrier view** | `/v2/carrier` | v2 | Carrier 2-day schedule, BOLs, charges | `cutting-pilot/src/app/carrier/` |
| **Cutting** | `/v2/cutting`, `/v2/cutting/crosscutter` | v2 | Main/Blue Line cutting boards, Cross Cutter chunk board | `cutting-pilot/src/app/cutting/` |
| **Manufacturing** | `/manufacturing/`; block nesting `/v2/blocks` | legacy calculators; block nesting v2 | Block calculator, holey board calculator, block nesting | `manufacturing/block-calculator.html`, `manufacturing/holey-board-calculator.html`, `cutting-pilot/src/app/blocks/` |
| **Production** | `/v2/production`, `/v2/production/schedule`, `/v2/production/tv` | v2 (legacy `/production/` only redirects) | Production Log — Molding/Expansion sheets, silo tracking (one lot per silo), bead lots + bag ledger, schedule, TV board | `cutting-pilot/src/app/production/`, `cutting-pilot/src/lib/productionSilos.ts` |
| **Schedule** | `/v2/schedule` (TV), `/v2/schedule/desk` | v2 | Schedule board | `cutting-pilot/src/app/schedule/` |
| **Shift Notes** | `/v2/notes` | v2 | Shift notes, manager mark-viewed | `cutting-pilot/src/app/notes/` |
| **QC** | `/qc/` | legacy | Scrap log, final inspection, density calculator, incident report | `qc/` |
| **Safety** | `/safety/` | legacy | SDS browser, i18n safety content, training | `safety/` |
| **Reports** | `/reports/` | legacy | Read-only analytics dashboards (cutting, incidents, orders, scrap) | `reports/` |
| **Admin** | `/v2/admin` (tabs Users · Roles · Parts · Activity) | v2 (legacy `admin/*.html` are redirect stubs; originals in `admin/_archived/`) | Users, roles & permissions, test-as-role, parts library, audit trail | `cutting-pilot/src/app/admin/`, `cutting-pilot/src/components/admin/`, `cutting-pilot/src/components/parts/PartsLibrary.tsx` (shared with Load Builder), `cutting-pilot/src/lib/permissions.ts` |
| **Shell** | `/` (home), `/login`, `/track/`, `/legal/`, `/account/` | legacy | Home cards, login, public tracking, legal pages, password change | `index.html`, `login.html`, `track/`, `legal/`, `account/` |

**Shared infrastructure:**
- `logistics/bol-shared.js` — single source of truth for legacy BOL PDF coordinates and rendering. Both the BOL generator and the load builder consume it. **NEVER duplicate COORDS.** While legacy and v2 coexist, BOL rendering changes are mirrored in `cutting-pilot/src/lib/bolShared.ts` (§6 bilateral BOL parity).
- Module header JS files (`*-header.js`) — render the top bar, user display, logout button, 401 interceptor. Cache the auth response on `window.__xpandaUser`.
- Module shared CSS files (`*-shared.css`) — scoped per module.
- `cutting-pilot/src/lib/permissions.ts` — the single source of permission keys, labels and notification types.
- `cutting-pilot/src/middleware.ts` — the v2 session gate, `PERMISSION_MAP`, and the `X-User-*` identity headers.

---

# 5. End-to-End Workflow

The platform's core value is the seamless flow from customer order to shipped product:

```
Packing Slip PDF (from QuickBase)
  ↓ parser extracts customer, address, line items, dates, PO#
Job Board — job created with ship-to address + line items
  ↓ kanban: Not Started → In Production → Done → Loading → Shipped
  ├─→ "Generate BOL" → BOL generator (address pre-filled from job)
  └─→ "Build Load" → Load builder (parts pre-loaded from job line items)
        ↓ plan the trailer load
        └─→ "Generate BOL" from load builder → same bol-shared.js rendering
```

**All backed by one unified `parts` table.** Parts created in any context (block calculator, load builder, job board, admin) are available everywhere.

Agents working on any part of this workflow must understand the upstream and downstream effects. Don't break the chain.

---

# 6. Scope Guardrails

**Established and actively used in production — treat as stable:**
- Job Board — Kanban, packing slip upload/parse, line items, ship-to address, BOL/load builder linking
- BOL Generator — PDF generation via bol-shared.js, customer/carrier management, prefill from jobs
- Load Builder — trailer load planning, auto-pack algorithm, saved loads, BOL generation
- Logistics Dashboard — shipment tracking
- Production Log (v2) — Molding/Expansion sheets, silos (one lot per silo, operator-reported fill state), bead lot receiving + bag ledger
- Block Calculator — multi-part nesting, 2D diagrams, parts library, saved combos, XLSX export
- Holey Board Calculator — bin-packing optimization
- Auth & Permissions — session-based login, configurable roles, per-module access control
- Admin — parts CRUD, activity log, user management, role/permission management

**Intentionally not yet built (do not add unless explicitly requested):**
- Multi-tenant or multi-location support
- SMS notifications (email via Resend and web-push notifications already exist)
- Customer master record (planned but not yet scoped)

Agents must NOT speculatively add features. If it's not in the prompt, don't build it.

**Standing rule — bilateral BOL parity:** while legacy and v2 coexist, any change to BOL rendering
must be mirrored across BOTH `logistics/bol-shared.js` and `cutting-pilot/src/lib/bolShared.ts`
until legacy is archived. A render defect found on one side is STOPPED and flagged as its own
paired change — never fixed on one side only.

---

# 7. Data Storage Conventions

- **D1 (SQLite)** is the primary data store for all operational records
- Small file attachments (e.g., packing slip PDFs) → **base64 in D1**. Do NOT introduce Cloudflare R2 unless explicitly requested.
- `localStorage` keys for client-side state are **versioned** (e.g., `foam_trailer_loader_v31`). Preserve existing keys exactly — do not rename or reset.
- Database migrations are `.sql` files in `DB_Migrations/`, run manually in the **Cloudflare D1 Dashboard Console**. Agents must create migration files and instruct Steve to run them.
- **`DB_Migrations/` is gitignored, not committed (as of 2026-07-31).** Past migration files included plaintext employee/admin credentials (seed data), so the whole folder — and history containing it — was purged from git. Agents still create `.sql` files there for Steve to run manually; they just never get committed. Before writing a migration file, confirm `DB_Migrations/` is still in `.gitignore` — do not re-track it.
- Saved loads have a 90-day TTL with auto-cleanup on read.

---

# 8. CSS Conventions

Each module has a scoped CSS file. App-specific styles within a page should be scoped under a wrapper class (e.g., `.load-builder-app`) to prevent collisions.

New pages (especially admin pages) should use **inline `<style>` blocks** rather than importing module CSS files they don't belong to.

CSS variables used across the platform:
```css
--bg: #f0f2f5;
--card-bg: #ffffff;
--text: #111827;
--muted: #4b5563;
--border: #d1d5db;
--radius: 12px;
--shadow: 0 1px 3px rgba(0,0,0,.07);
```

Do NOT:
- Add global styles to a module's shared CSS for page-specific features
- Mix styles from different module CSS systems on the same page

---

# 9. Change Philosophy

**This is a production system used daily on a factory floor.** Changes must be:

- **Surgical** — modify only the necessary sections
- **Non-breaking** — preserve existing API responses, data shapes, and UI behavior
- **Tested-by-use** — the platform is battle-tested through real daily operations. Bugs are found through actual use, not theoretical analysis.

**Rules:**
- Business logic and calculation algorithms are **untouchable** during integration or cleanup work
- Do NOT refactor unrelated code while implementing a feature
- Do NOT rename existing functions, API routes, or database columns
- Large refactors require explicit approval and a dedicated prompt
- When fixing a bug, fix the bug — don't redesign the system around it
- **Targeted fix prompts over full regeneration** — regenerating entire plans wastes Claude Code usage. Only scoped, surgical fix prompts.

---

# 10. Implementation Order

When implementing new features:

1. **Scope through conversation first** — understand the full upstream/downstream impact before writing code
2. Database migration (`.sql` file at project root)
3. Backend API handler — legacy: `_worker.js/routes/*.js` + one `API_ROUTES` row; v2: `cutting-pilot/src/app/api/**/route.ts`
4. Add `logActivity()` calls for all create/update/delete operations
5. Gate every new path: legacy `core.js` maps and/or v2 `middleware.ts` `PERMISSION_MAP` (see §3)
6. Build frontend page
7. Connect navigation (homepage card, module header links)
8. Add any new permission key + label to `cutting-pilot/src/lib/permissions.ts` (see §3)

Never build frontend pages that rely on APIs that do not exist yet.

9. **Update BACKLOG.md and CHANGELOG.md** as part of the same change: add a `CHANGELOG.md` entry keyed to the prompt/task ID (`<task>-NN`, e.g. `lb-ui-02`; legacy prompts used `PNNN`) (newest-first within the module section) and remove the completed item from `BACKLOG.md`. New follow-on work goes into `BACKLOG.md`. Docs-only and report-only prompts note themselves in `CHANGELOG.md` too.

---

# 11. Prompt File Conventions

Complex features are scoped in conversation with Claude, then implemented via structured `.md` prompt files fed to Claude Code in separate sessions.

- Prompts use task-grouped IDs `<task>-NN` (e.g. `lb-engine-01`, `lb-ui-02`), with sequence numbers only within a task group and no ordering implied between groups. Older prompts used sequential `PNNN`.
- Complex features are broken into 2–3 sequential prompts with discrete responsibilities
- Each prompt ends with a completion checklist and a "Notify Steve" section listing any manual steps (migrations, file replacements, etc.)
- Prompts must explicitly state "What NOT to touch" to prevent scope creep

---

# 12. Known Technical Debt

Tracked here so agents don't "fix" these without being asked:

- `document.write()` in module header JS files — works but is a legacy pattern. Future refactor to `DOMContentLoaded` + `insertAdjacentHTML`.
- Google Sheets gviz endpoint for incident data — uncached. Caching would help but is low priority.
- `location_no` column exists in `bols` table but is no longer used in the UI. Column kept for backward compatibility.
- Legacy `role` TEXT column on `users` table — kept alongside `role_id` FK for backward compatibility during transition.

---

# End of Agent Guidance
