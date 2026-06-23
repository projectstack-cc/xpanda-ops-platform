# Prompt 194 — Cutting Dashboard frontend (C2)

## Agent context (read first, in this order)
1. Read `AGENTS.md` (platform-wide rules).
2. Read `xpanda-ops-agents.md` (domain agents).
3. **You are acting as the manufacturing/logistics domain owner for `/manufacturing/`** (the module
   that holds the calculators and the Cutting Dashboard). Also read the **Frontend Designer** agent
   (`agent-frontend-designer.md`) for the design system. **Pull `main`; repo is source of truth.**
   This depends on **P193** (worker) being deployed — the dashboard consumes `/api/cutting`.

## Goal
Replace the "coming soon" placeholder in `manufacturing/cutting-dashboard.html` with a real, live
cutting floor board. Floor-facing (TVs + tablets). Frontend only — no worker, no migration.

## Backend contract (from P193 — do not re-implement, just consume)
- `GET  /api/cutting` → jobs that have cutting steps, each with its `cutting_steps`
  (`{ id, job_id, process_name, step_status, operator, notes, started_at, completed_at }`).
  `step_status` ∈ `queued | in_progress | completed`. (Confirm the exact response envelope by reading
  `routes/cutting.js` after pulling — use `window.api.get` per `shared-api.js`.)
- `POST /api/cutting/start`  body `{ job_id }` → job-level Start (flips queued→in_progress, job→In Production).
- `PUT  /api/cutting/:stepId` body `{ step_status? , operator?, notes? }` → per-step update.

The job-board pill greening and job status transitions are handled server-side; the dashboard just
calls these endpoints and re-renders.

## Files in scope
- `manufacturing/cutting-dashboard.html`  (build out — currently a 38-line placeholder)
- `manufacturing/manufacturing-shared.css`  (only if a shared class is genuinely needed; prefer
  page-scoped styles in the page under a wrapper class, per the module CSS pattern)

Do **not** touch the worker, migrations, `jobs/`, admin, or the calculators.

## Layout & behavior
- Keep the existing header bootstrap (`manufacturing-header.js`, `mfg-page-title`/`mfg-page-subtitle`).
  Update subtitle to something live (e.g. "Live cutting floor status").
- **Lanes per process:** five columns — Cross Cutter, Hole Cutter, Main Line, Blue Line, Laminate.
  Each lane lists the step cards currently in that process, grouped/sorted by status
  (in_progress first, then queued, then completed — or a clear visual separation). A job with
  multiple checked processes appears as a card in each relevant lane simultaneously.
- **Step card** shows: invoice #, customer, ship date, status, operator (editable), and the action(s):
  - If job has any `queued` steps and is not yet started → a **Start Job** button (job-level; calls
    `/api/cutting/start`). Once started, queued steps become in_progress across all lanes.
  - Per step in `in_progress` → **Complete** button (calls `PUT /api/cutting/:stepId`
    `{ step_status: 'completed' }`).
  - Completed steps render in a done/greyed treatment; allow un-complete (PUT back to `in_progress`)
    for mistakes.
- **Filtering:** reuse the P190 Loading Dashboard pattern — a search bar (customer/invoice) and a
  current-week ("This Week", Mon–Sun by ship_date) toggle with a Show All toggle. Read
  `logistics/loading.html` and mirror the helper structure (`ldCurrentWeekRange`/`ldInCurrentWeek`/
  `ldMatchesSearch` analogues) rather than inventing a new approach. Search bypasses the week filter;
  steps for jobs with no ship_date stay visible.
- **Floor ergonomics (Frontend Designer agent):** touch targets ≥ 44px, large legible type, dark-mode
  via existing tokens (`shared/tokens.css` — use token vars, **no hardcoded colors**), status colors
  from the semantic tokens. Designed to be readable on a wall TV and usable on a 7" tablet in portrait.
- Status color mapping should be unambiguous across the three step states (don't reuse a single hue);
  follow the dark-mode token approach used in `loading.html` after P186.

## Validation (required)
- Extract every inline `<script>` block to a real temp `.js` file (NOT `/dev/stdin`) and run
  `node --check` on each:
  ```python
  import re; html=open('manufacturing/cutting-dashboard.html').read()
  for i,b in enumerate(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S)):
      open(f'/tmp/cd_{i}.js','w').write(b)
  ```
  then `node --check /tmp/cd_*.js`.
- Confirm it loads the shared scripts it needs (`shared-header.js` chain, `shared-api.js`) the same way
  sibling manufacturing pages do — verify by reading `manufacturing/index.html` and
  `manufacturing/block-calculator.html` headers.
- For any edit to `manufacturing-shared.css`, use byte-exact `grep -n`/`grep -c` (count == 1) anchors.

## Output
- Write the built-out page (and CSS delta if any). Summarize the lane layout, the Start/Complete flow,
  the filter reuse, and confirm dark-mode token compliance.
- Note that this requires P193 deployed (and its migration run) to show data.
