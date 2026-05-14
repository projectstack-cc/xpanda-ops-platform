# xPanda Operations Platform — Agent Guidance

This file defines rules that any AI agent (Claude Code, Codex, etc.) must follow when making changes to this repository.

Agents must follow these rules strictly.  
Changes must be surgical and must not introduce architectural drift.

---

# 1. Platform Architecture

The xPanda Operations Platform is a **Cloudflare Pages Advanced Mode application**.

Backend:
- `_worker.js` contains ALL API routes.
- Worker routes use `if (url.pathname === "...")`.
- Static assets are served using:

env.ASSETS.fetch(request)

Data Sources:
- **D1 Database** → Jobs, Logistics, QC tools (scrap log, inspections, BOLs, inventory)
- **Google Sheets gviz endpoint** → incident report analytics

Frontend:
- Static HTML pages
- Vanilla JavaScript
- No frameworks
- Chart.js for report charts

Do NOT introduce:
- React
- Vue
- build tools
- frameworks
- bundlers

---

# 2. API Structure

All APIs live inside `_worker.js`.

Pattern:

/api/feature-name

Examples:

/api/completions  
/api/scrap-log  
/api/reports/scrap-summary  
/api/reports/incidents-trend
/api/jobs
/api/bol

Rules:

- Do NOT move APIs to separate files.
- Do NOT rename existing routes.
- Do NOT change response shapes of existing routes.
- Use the shared `json()` helper for responses.

New API handlers must follow the existing style:

async function handleSomething(request, env)

---

# 3. Incident Reporting Architecture

Incident analytics come from a **Google Sheets gviz endpoint** configured in:

env.INCIDENT_TRACKER_JSON_URL

Raw gviz rows MUST be normalized using:

parseIncidentRows(gvizData)

This helper produces canonical incident objects used across all report routes.

Agents must NOT:
- re-parse raw sheet cell indexes in multiple places
- duplicate gviz parsing logic

All incident analytics must operate on the normalized incident array.

---

# 4. Module Overview

The platform has grown beyond read-only reporting and now includes operational workflow modules. Each module has its own subdirectory, shared header JS, and shared CSS file.

| Module | Path | Purpose |
|---|---|---|
| Jobs / Job Board | `/jobs/` | Kanban workflow — job lifecycle from creation to shipping |
| Logistics | `/logistics/` | BOL generator, load builder, shipment tracking |
| Production | `/production/` | Bead inventory, block calculator, holey board calculator |
| QC | `/qc/` | Scrap log, final inspection, density calculator, incident report |
| Safety | `/safety/` | SDS browser, i18n safety content |
| Reports | `/reports/` | Read-only analytics dashboards (incidents, scrap) |

Each module uses a shared header JS file (`*-header.js`) and shared CSS file (`*-shared.css`).  
Agents must NOT modify shared CSS or shared header files unless the task explicitly requires it.

---

# 5. Scope Guardrails

The platform has expanded from read-only reporting into operational workflow tooling. The following modules are **established and active** — agents must treat them as stable, production code:

**Established modules (do not restructure):**
- Job Board — Kanban with five statuses, line items, production sub-steps, packing slip upload
- BOL Generator — PDF generation via pdf-lib, customer dropdown, edit/new/duplicate modes
- Load Builder — trailer load planning, parts placement, auto-resize, repack logic
- Logistics Dashboard — inbound/outbound shipment tracking
- Inventory — three-layer model (bead bags → blocks → molding log)
- Block Calculator — multi-part nesting, 2D diagrams, parts library, saved combos, XLSX export
- Holey Board Calculator — bin-packing optimization

**Intentionally not yet built (do not add unless explicitly requested):**
- Authentication / user login
- Role-based permissions
- Notifications or push alerts
- Audit trails
- Comments or attachments on records
- Multi-tenant or multi-location support

Agents must NOT speculatively add any of the above even if the feature seems useful.

---

# 6. Data Storage Conventions

- **D1 (SQLite)** is the primary data store for all operational records.
- Small file attachments (e.g. packing slip PDFs) are stored as **base64 in D1** — do NOT introduce Cloudflare R2 unless explicitly requested.
- `localStorage` keys for client-side state are **versioned** (e.g. `foam_trailer_loader_v31`). Preserve existing keys exactly — do not rename or reset them.

---

# 7. CSS Conventions

Each module has a scoped CSS file. App-specific styles within a page should be scoped under a wrapper class (e.g. `.load-builder-app`) to prevent collisions.

Do NOT:
- Add global styles to a module's shared CSS file for page-specific features
- Mix styles from different module CSS systems on the same page

---

# 8. Change Philosophy

Changes must be **surgical**.

Agents must:

- modify only necessary sections
- avoid refactoring unrelated code
- preserve existing naming patterns
- preserve existing API responses

Large refactors are not allowed unless explicitly requested.

Business logic and calculation algorithms are **untouchable** during integration or chrome work.

---

# 9. Coding Style

Follow the existing Worker style:

- minimal abstractions
- clear helper functions
- explicit route checks
- readable logic over clever logic

Do not introduce new architectural layers.

Keep the code understandable by a single maintainer.

---

# 10. Preferred Implementation Order

When implementing new features:

1. Backend API route (if needed)
2. Validate response structure
3. Build frontend page
4. Connect navigation

Never build frontend pages that rely on APIs that do not exist yet.

---

# End of Agent Guidance
