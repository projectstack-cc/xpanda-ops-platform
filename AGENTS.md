# xPanda Operations Platform — Agent Guidance

This file defines rules that any AI agent (Codex, ChatGPT, etc.) must follow when making changes to this repository.

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
- **D1 Database** → QC tools (scrap log, inspections)
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

# 4. Reports Module Design

Reports follow a consistent pattern.

Backend:
- `/api/reports/...`

Frontend:
- `/reports/...`

Report pages follow this UI pattern:

- Page header
- Year selector
- Load button
- Fetch API data
- Chart.js or simple table display

Reports are **read-only visibility tools**.

They are NOT workflow systems.

---

# 5. Scope Guardrails

Agents must NOT implement:

- editing interfaces
- workflow assignment
- comments
- attachments
- notifications
- audit trails
- role-based permissions
- authentication systems

The platform focuses on:

Operational visibility  
Analytics dashboards  
Record lookup

---

# 6. Change Philosophy

Changes must be **surgical**.

Agents must:

- modify only necessary sections
- avoid refactoring unrelated code
- preserve existing naming patterns
- preserve existing API responses

Large refactors are not allowed unless explicitly requested.

---

# 7. Coding Style

Follow the existing Worker style:

- minimal abstractions
- clear helper functions
- explicit route checks
- readable logic over clever logic

Do not introduce new architectural layers.

Keep the code understandable by a single maintainer.

---

# 8. Preferred Implementation Order

When implementing new report features:

1. Backend API route
2. Validate response structure
3. Build frontend page
4. Connect navigation

Never build frontend pages that rely on APIs that do not exist yet.

---

# End of Agent Guidance