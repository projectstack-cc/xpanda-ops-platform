# Prompt 181 — Loading status on the Job Board + logistics BACKLOG cleanup

## Required reading
1. Read `AGENTS.md` and `xpanda-ops-agents.md`.
2. Agents: **db-api-agent** (`_worker.js/routes/jobs.js`), **job-board-agent** (`jobs/index.html`), plus a `BACKLOG.md` doc edit.

## Context
Surface each job's loading status on its kanban card (the long-requested "loading status indicator"). A job's loading state lives in `loading_assignments`; expose a single representative status via the job list query and render a color-coded badge on the card (colors mirror the loading dashboard). Then remove the now-closed logistics items from `BACKLOG.md`.

All edits byte-exact, each count==1. Confirm before applying.

## Edit 1 — Expose a loading-status indicator on the job list (`_worker.js/routes/jobs.js`)
Adds a subquery to `JOB_LIST_COLS` that returns the least-complete active loading status (so the badge reflects where loading actually is).
FIND (exactly once):
```
    (SELECT GROUP_CONCAT(la.trailer_number, ', ')
       FROM loading_assignments la
      WHERE la.job_id = j.id
        AND COALESCE(la.trailer_number, '') != ''
        AND la.loading_status != 'archived') AS assigned_trailers
  `;
```
REPLACE:
```
    (SELECT GROUP_CONCAT(la.trailer_number, ', ')
       FROM loading_assignments la
      WHERE la.job_id = j.id
        AND COALESCE(la.trailer_number, '') != ''
        AND la.loading_status != 'archived') AS assigned_trailers,
    (SELECT la.loading_status
       FROM loading_assignments la
      WHERE la.job_id = j.id AND la.loading_status != 'archived'
      ORDER BY CASE la.loading_status
        WHEN 'loading' THEN 1 WHEN 'not_started' THEN 2 WHEN 'awaiting' THEN 3
        WHEN 'loaded' THEN 4 WHEN 'in_transit' THEN 5 WHEN 'delivered' THEN 6 ELSE 7 END
      LIMIT 1) AS loading_status_indicator
  `;
```

## Edit 2 — Loading-status badge on the kanban card (`jobs/index.html`)
### 2a — build the badge (after the trailer badge)
FIND (exactly once):
```
  const trailerBadge = job.assigned_trailers
    ? `<div class="jobs-card-trailer" title="Trailer ${esc(job.assigned_trailers)} assigned on the loading dashboard">🚛 Trailer Assigned</div>`
    : '';
```
REPLACE:
```
  const trailerBadge = job.assigned_trailers
    ? `<div class="jobs-card-trailer" title="Trailer ${esc(job.assigned_trailers)} assigned on the loading dashboard">🚛 Trailer Assigned</div>`
    : '';
  const LOADING_BADGE = {
    not_started: { label: 'Not Loaded',   color: '#ef4444' },
    awaiting:    { label: 'Awaiting Bay',  color: '#6b7280' },
    loading:     { label: 'Loading',       color: '#f59e0b' },
    loaded:      { label: 'Loaded',        color: '#10b981' },
    in_transit:  { label: 'In Transit',    color: '#6366f1' },
    delivered:   { label: 'Delivered',     color: '#0d9488' },
  };
  const _ls = job.loading_status_indicator;
  const loadingBadge = (_ls && LOADING_BADGE[_ls])
    ? `<div class="jobs-card-loading" style="font-size:11px;font-weight:700;color:${LOADING_BADGE[_ls].color};margin-top:4px;">● ${LOADING_BADGE[_ls].label}</div>`
    : '';
```
### 2b — render it on the card (after `${trailerBadge}`)
FIND (exactly once):
```
    ${procHtml}
    ${trailerBadge}
```
REPLACE:
```
    ${procHtml}
    ${trailerBadge}
    ${loadingBadge}
```

## Edit 3 — Clean the logistics BACKLOG (`BACKLOG.md`)
Replace the whole Logistics section, dropping the closed/moot/parked-as-done items (loading status indicator — now shipped; Load tab polish — satisfied; scrap X-mark coords — dropped; AppSheets exploration — that's the loading dashboard; remove-dims — shipped P173; Siplast — shipped P180; archived-order hide Build Load — moot, already hidden for delivered/cancelled; bol-generator multi-trailer — moot, page archived P176). Keeps the genuine features and the parked print bug.

FIND (exactly once):
```
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

### BOL Issues

- [ ] **BOL print rendering bug** — when printing the BOL directly (without downloading), the "N" from "Bill of Lading No" and the "S" in "Customer Signature" are clipped/hidden. Likely a CSS `overflow: hidden` or `white-space` clip on the containing element interacting with the browser's print renderer. Needs print-preview investigation.
- [ ] **Remove dimensions from BOL commodity block** — dimensions are already embedded in most line-item descriptions, so including them separately duplicates content. Add a toggle or remove the dimension column from the BOL commodity section entirely. *(coordinating change in `bol-shared.js` `drawCommodity` / commodity tier logic)*
- [ ] **Siplast toggle on BOL** — to be scoped with Claude. Likely a conditional section or checkbox on the BOL generator that includes/excludes Siplast-specific fields or language; exact field set and placement TBD.
- [ ] **Archived-order logistics dashboard** — once a job is archived, hide the "Build Load" button (signed BOL copies are now surfaced via the Documents section shipped in P156).

### BOL Generator Follow-on

- [ ] **`bol-generator.html` multi-trailer.** The shared review surface already navigates multiple records (the picker); `bol-generator.html` still collects a single ship-to set. Small lift: collect N records → `reviewRecords([...])`. *(follow-on to P123–P128)*

---
```
REPLACE:
```
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
```

## Validation
- `node --check _worker.js/routes/jobs.js`
- `jobs/index.html` inline scripts: extract via `re.findall` to temp files, `node --check` each (no `/dev/stdin`).

## Manual sanity (Steve)
- A job with a loading assignment shows a color-coded loading badge on its kanban card (red Not Loaded → amber Loading → emerald Loaded → indigo In Transit → teal Delivered), matching the loading dashboard. Jobs with no loading assignment show no badge.
- BACKLOG Logistics section now lists only the genuine remaining features + the parked print bug.

## What NOT to change
- Do NOT touch the loading dashboard, `loading_assignments` writes, or the worker beyond `JOB_LIST_COLS`.
- Do NOT remove the BACKLOG items that are genuine roadmap features (customer DB, TV dashboards, zoning, larger load view, customize drag-drop) or the parked print bug.

## Deliverables
- `_worker.js/routes/jobs.js` — `loading_status_indicator` subquery.
- `jobs/index.html` — loading-status badge on kanban cards.
- `BACKLOG.md` — logistics section trimmed to genuine remainders.
- `jobs.js` + inline scripts pass `node --check`.
