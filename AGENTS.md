# xPanda Operations Platform — Agent Guidance

This file defines rules that any AI agent (Claude Code, Codex, etc.) must follow when making changes to this repository.

This is a **production ERP platform** for a foam manufacturing operation. It is actively used on the factory floor and in logistics daily. Changes must be surgical, production-safe, and must not introduce architectural drift.

**Launch target: v1.0 by end of June 2026.**

---

# 1. Platform Architecture

The xPanda Operations Platform is a **Cloudflare Pages Advanced Mode application** serving as an ERP-lite system for foam manufacturing operations — covering jobs, logistics, production, quality control, and safety.

**Backend:**
- `_worker.js` contains ALL API routes in a single file
- Worker routes use flat `if (url.pathname === "...")` checks
- Static assets served via `env.ASSETS.fetch(request)`
- Session-based authentication gates all routes (except `/login`, `/api/auth/*`, and static assets)
- Role-based permissions enforce per-module view/edit access

**Data Sources:**
- **D1 Database (SQLite)** → all operational records (jobs, BOLs, parts, shipments, users, roles, activity log, inventory)
- **Google Sheets gviz endpoint** → incident report analytics (legacy integration)

**Frontend:**
- Static HTML pages with vanilla JavaScript
- No frameworks, no build tools, no bundlers
- Chart.js for report charts
- pdf-lib for client-side BOL PDF generation
- pdf.js for client-side packing slip parsing

**Do NOT introduce:** React, Vue, build tools, frameworks, bundlers, or module systems. The platform is designed for a single maintainer and floor-level simplicity.

---

# 2. API Structure

All APIs live inside `_worker.js`. No exceptions.

**Route pattern:** `/api/feature-name`

**Core API groups:**
```
/api/auth/*           — login, logout, session, password change
/api/users            — user CRUD (admin only)
/api/roles            — role CRUD (admin only)
/api/jobs/*           — job board CRUD, packing slip endpoints
/api/bols/*           — BOL CRUD, generation
/api/bol-customers    — customer address book for BOLs
/api/bol-carriers     — carrier directory
/api/shipments        — inbound/outbound shipment tracking
/api/parts            — unified parts library (block calc + load builder + job board)
/api/load-builder-skus — load builder SKU interface (maps to parts table)
/api/combos           — saved block calculator combinations
/api/saved-loads      — saved load builder states (D1, 90-day TTL)
/api/bead-types       — bead inventory types
/api/bead-stock       — bead stock levels
/api/block-inventory  — finished block inventory
/api/molding-log      — molding production log
/api/block-consumption — block consumption tracking
/api/completions      — QC final inspections
/api/scrap-log        — QC scrap entries
/api/reports/*        — read-only analytics
/api/activity-log     — platform audit trail
```

**Rules:**
- Do NOT move APIs to separate files
- Do NOT rename existing routes
- Do NOT change response shapes of existing routes
- Use the shared `json()` helper for all responses
- All new handlers follow: `async function handleSomething(request, env)`
- All mutating operations (POST/PUT/DELETE) must include `logActivity()` calls
- Error responses use the shape: `{ ok: false, error: "Human message", detail: "Technical detail" }`

---

# 3. Authentication & Authorization

**Authentication:**
- Session-based with `xpanda_session` cookie
- Plaintext passwords in D1 (intentional — admin recovery for floor workers)
- First-login password change flow
- Session gate in `_worker.js` redirects unauthenticated page requests to `/login`, returns 401 for API calls
- Static assets (CSS, JS, images, fonts) bypass the session gate

**Authorization:**
- `roles` table stores a JSON `permissions` blob per role
- Permission keys map modules/sub-modules to `{ view: boolean, edit: boolean }`
- `Administrator` role bypasses ALL permission checks (hardcoded on `role-administrator` ID)
- `PATH_PERMISSION_MAP` and `API_PERMISSION_MAP` arrays in `_worker.js` map URLs to permission keys
- Session gate enforces permissions: GET → requires `view`, POST/PUT/DELETE → requires `edit`
- Frontend hides inaccessible cards/links based on permissions from `/api/auth/me` response

**Adding new features to the permission system:**
1. Add the permission key to both `PATH_PERMISSION_MAP` and `API_PERMISSION_MAP`
2. Add the key to `PERMISSION_LABELS` in `admin/roles.html`
3. The admin UI will auto-render the new toggle — no other changes needed

---

# 4. Module Overview

| Module | Path | Purpose | Key Files |
|---|---|---|---|
| **Jobs** | `/jobs/` | Kanban workflow — packing slip upload, job lifecycle, line items | `jobs/index.html`, `jobs/packing-slip-parser.js` |
| **Logistics** | `/logistics/` | BOL generation, load building, shipment tracking | `logistics/bol-generator.html`, `logistics/load-builder.html`, `logistics/bol-shared.js`, `logistics/index.html` |
| **Manufacturing** | `/manufacturing/` | Block calculator, holey board calculator, Cutting Dashboard | `manufacturing/block-calculator.html`, `manufacturing/holey-board-calculator.html`, `manufacturing/cutting-dashboard.html` |
| **Production** | `/production/` | Bead/block inventory, molding log (inventory-only) | `production/inventory.html`, `production/bead-inventory.html` |
| **QC** | `/qc/` | Scrap log, final inspection, density calculator | `qc/` |
| **Safety** | `/safety/` | SDS browser, i18n safety content, training | `safety/` |
| **Reports** | `/reports/` | Read-only analytics dashboards (incidents, scrap) | `reports/` |
| **Admin** | `/admin/` | Parts library, activity log, user management, role management | `admin/parts.html`, `admin/activity-log.html`, `admin/users.html`, `admin/roles.html` |

**Shared infrastructure:**
- `logistics/bol-shared.js` — single source of truth for BOL PDF coordinates and rendering. Both BOL generator and load builder consume this. **NEVER duplicate COORDS — edit only this file.**
- Module header JS files (`*-header.js`) — render top bar, user display, logout button, 401 interceptor. Cache auth response on `window.__xpandaUser`.
- Module shared CSS files (`*-shared.css`) — scoped per module.

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
- Inventory — three-layer model (bead bags → blocks → molding log)
- Block Calculator — multi-part nesting, 2D diagrams, parts library, saved combos, XLSX export
- Holey Board Calculator — bin-packing optimization
- Auth & Permissions — session-based login, configurable roles, per-module access control
- Admin — parts CRUD, activity log, user management, role/permission management

**Intentionally not yet built (do not add unless explicitly requested):**
- Multi-tenant or multi-location support
- External integrations beyond Google Sheets gviz
- Email or SMS notifications
- File storage via Cloudflare R2 (D1 base64 is used for small files)
- Customer master record (planned but not yet scoped)

Agents must NOT speculatively add features. If it's not in the prompt, don't build it.

---

# 7. Data Storage Conventions

- **D1 (SQLite)** is the primary data store for all operational records
- Small file attachments (e.g., packing slip PDFs) → **base64 in D1**. Do NOT introduce Cloudflare R2 unless explicitly requested.
- `localStorage` keys for client-side state are **versioned** (e.g., `foam_trailer_loader_v31`). Preserve existing keys exactly — do not rename or reset.
- Database migrations are `.sql` files at the project root, run manually in the **Cloudflare D1 Dashboard Console**. Agents must create migration files and instruct Steve to run them.
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
3. Backend API handler in `_worker.js`
4. Add `logActivity()` calls for all create/update/delete operations
5. Add permission key to `PATH_PERMISSION_MAP` and `API_PERMISSION_MAP` if the feature is a new module
6. Build frontend page
7. Connect navigation (homepage card, module header links)
8. Add permission key label to `admin/roles.html` if new

Never build frontend pages that rely on APIs that do not exist yet.

9. **Update BACKLOG.md and CHANGELOG.md** as part of the same change: add a `CHANGELOG.md` entry keyed to the prompt number (newest-first within the module section) and remove the completed item from `BACKLOG.md`. New follow-on work goes into `BACKLOG.md`. Docs-only and report-only prompts note themselves in `CHANGELOG.md` too.

---

# 11. Prompt File Conventions

Complex features are scoped in conversation with Claude, then implemented via structured `.md` prompt files fed to Claude Code in separate sessions.

- Prompts are numbered sequentially (Prompt 14, 15, 16...)
- Complex features are broken into 2–3 sequential prompts with discrete responsibilities
- Each prompt ends with a completion checklist and a "Notify Steve" section listing any manual steps (migrations, file replacements, etc.)
- Prompts must explicitly state "What NOT to touch" to prevent scope creep

---

# 12. Known Technical Debt

Tracked here so agents don't "fix" these without being asked:

- `document.write()` in module header JS files — works but is a legacy pattern. Future refactor to `DOMContentLoaded` + `insertAdjacentHTML`.
- Flat `if/else` routing in `_worker.js` — functional but verbose at 37+ routes. A router abstraction is not planned.
- Google Sheets gviz endpoint for incident data — uncached. Caching would help but is low priority.
- `location_no` column exists in `bols` table but is no longer used in the UI. Column kept for backward compatibility.
- Legacy `role` TEXT column on `users` table — kept alongside `role_id` FK for backward compatibility during transition.

---

# End of Agent Guidance
