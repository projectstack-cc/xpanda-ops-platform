# Prompt 190 — Loading Dashboard: search bar + current-week (Mon–Sun) default with Show All toggle

## Required reading (do this first)
1. Read `AGENTS.md` (repo root) in full.
2. Read `xpanda-ops-agents.md` (repo root) in full.
3. You are acting as the **logistics-agent**.

## Scope
**Frontend only. One file: `logistics/loading.html`.** No worker, no DB, no other file.
Depends on prompt 189 being run already (pickup hide + bidirectional status) — but is independent of it; do not add conditional language.

Do NOT touch: the worker, any other module, `bol-*.js`, `load-builder.html`, the auto-pack algorithm, or `LD_STATUS_COLORS`/card rendering internals.

---

## Behavior to build (Overview view ONLY)

1. **Search box** in the toolbar: filters by INV# (`invoice_number`), customer (`customer`), or PO (`po_number`), case-insensitive substring.
2. **Week filter**: by default Overview shows only assignments whose `ship_date` falls in the **current Mon–Sun week**. A **Show All** toggle disables the week filter.
3. **Search bypasses the week filter**: whenever the search box is non-empty, the week filter is ignored and search runs across ALL assignments (regardless of Show All state).
4. **Null-ship_date safety**: assignments with no `ship_date` (empty/null) are ALWAYS shown in Overview regardless of the week filter, so an unscheduled active load never disappears from the floor view.
5. **Loading Team View (bay list / single bay) is UNCHANGED** — no search, no week filter applied there. Only Overview is touched.

---

## Implementation

### 1 — Toolbar markup
The current toolbar (`<div class="ld-toolbar">`) ends with the sort `<select>` and the Pull Job button:

```html
    <select id="ld-sort-select" style="padding:6px 10px;border:1px solid var(--input-border);border-radius:6px;font-size:13px;background:var(--card-bg);cursor:pointer;" onchange="ldSortOrder=this.value;renderDashboard()">
      <option value="inv_asc">INV# ↑</option>
      <option value="inv_desc">INV# ↓</option>
      <option value="date_asc">Date added</option>
    </select>
    <button id="btn-pull-job" class="ld-btn-pull" onclick="openPullJobModal()" style="display:none;">+ Pull Job</button>
  </div>
```

Insert the search input and week toggle BEFORE the sort select. Replace the block above with:

```html
    <input type="text" id="ld-search" placeholder="INV#, customer, or PO"
      oninput="ldSearchTerm=this.value;renderDashboard()" autocomplete="off"
      style="padding:6px 10px;border:1px solid var(--input-border);border-radius:6px;font-size:13px;background:var(--card-bg);color:var(--text);min-width:180px;" />
    <button id="ld-week-toggle" onclick="toggleLdShowAll()"
      style="padding:6px 12px;border:1px solid var(--input-border);border-radius:6px;font-size:13px;background:var(--card-bg);color:var(--text);cursor:pointer;font-weight:600;">This Week</button>
    <select id="ld-sort-select" style="padding:6px 10px;border:1px solid var(--input-border);border-radius:6px;font-size:13px;background:var(--card-bg);cursor:pointer;" onchange="ldSortOrder=this.value;renderDashboard()">
      <option value="inv_asc">INV# ↑</option>
      <option value="inv_desc">INV# ↓</option>
      <option value="date_asc">Date added</option>
    </select>
    <button id="btn-pull-job" class="ld-btn-pull" onclick="openPullJobModal()" style="display:none;">+ Pull Job</button>
  </div>
```

Use the existing token variables for colors (`--input-border`, `--card-bg`, `--text`) exactly as shown — no hardcoded hex.

### 2 — State + helpers
Find the state declarations near the top of the main `<script>`:

```js
let ldSortOrder = 'inv_asc';
```

Add the new state and helpers immediately after that line:

```js
let ldSortOrder = 'inv_asc';
let ldSearchTerm = '';
let ldShowAll = false;

// Current week, Monday 00:00:00 → Sunday 23:59:59 local (matches job board "This Week").
function ldCurrentWeekRange() {
  const now = new Date();
  const day = now.getDay();                 // 0=Sun..6=Sat
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const mon = new Date(now);
  mon.setHours(0, 0, 0, 0);
  mon.setDate(mon.getDate() + diffToMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return { start: mon, end: sun };
}

function ldInCurrentWeek(shipDate) {
  if (!shipDate) return true;               // no ship_date → always visible (floor safety)
  const d = new Date(shipDate);
  if (isNaN(d.getTime())) return true;      // unparseable → don't hide it
  const { start, end } = ldCurrentWeekRange();
  return d >= start && d <= end;
}

function ldMatchesSearch(a) {
  const q = ldSearchTerm.trim().toLowerCase();
  if (!q) return true;
  return [a.invoice_number, a.customer, a.po_number]
    .some(v => String(v || '').toLowerCase().includes(q));
}

// The working set the Overview renders from. Search (when present) bypasses the week filter.
function ldOverviewSet() {
  const searching = ldSearchTerm.trim().length > 0;
  return allAssignments.filter(a => {
    if (!ldMatchesSearch(a)) return false;
    if (searching) return true;             // search ignores week filter
    if (ldShowAll) return true;
    return ldInCurrentWeek(a.ship_date);
  });
}

function toggleLdShowAll() {
  ldShowAll = !ldShowAll;
  const btn = document.getElementById('ld-week-toggle');
  if (btn) btn.textContent = ldShowAll ? 'Show All' : 'This Week';
  renderDashboard();
}
```

> Verify the field name: the loading-assignments GET aliases the job ship date as `j.ship_date` and returns it as `ship_date` on each assignment. Confirm `a.ship_date` exists on the objects before relying on it. INV# is `invoice_number`, PO is `po_number`, customer is `customer`.

### 3 — Apply the working set in `renderOverview` ONLY
`renderOverview()` currently filters `allAssignments` directly in five places (awaiting, per-bay, yard, transit, delivered). Introduce a single local working set at the very top of `renderOverview` and use it for every one of those filters.

Find the start of `renderOverview`:

```js
function renderOverview() {
  const user = window.__xpandaUser;
  const isManager = user && (user.isAdministrator || user.permissions?.['logistics.loading.manage']?.edit);
  const awaiting = sortAssignments(allAssignments.filter(a => a.loading_status === 'awaiting'));
```

Replace through the `awaiting` line with:

```js
function renderOverview() {
  const user = window.__xpandaUser;
  const isManager = user && (user.isAdministrator || user.permissions?.['logistics.loading.manage']?.edit);
  const ldSet = ldOverviewSet();
  const awaiting = sortAssignments(ldSet.filter(a => a.loading_status === 'awaiting'));
```

Then, within `renderOverview` ONLY, change the remaining four `allAssignments.filter(...)` calls to `ldSet.filter(...)`:
- the per-bay map: `sortAssignments(allAssignments.filter(a => a.bay_id === bay.id && ...))` → `sortAssignments(ldSet.filter(a => a.bay_id === bay.id && ...))`
- yard: `sortAssignments(allAssignments.filter(a => a.location === 'yard'))` → `sortAssignments(ldSet.filter(a => a.location === 'yard'))`
- transit: `sortAssignments(allAssignments.filter(a => a.loading_status === 'in_transit'))` → `sortAssignments(ldSet.filter(a => a.loading_status === 'in_transit'))`
- delivered: `sortAssignments(allAssignments.filter(a => a.loading_status === 'delivered'))` → `sortAssignments(ldSet.filter(a => a.loading_status === 'delivered'))`

**Do not** change any `allAssignments.filter`/`allAssignments.find` calls outside `renderOverview` (renderBayList, renderBayView, card action handlers, checklist, etc. all keep using `allAssignments`). Make these four substitutions surgically inside the `renderOverview` function body only — verify by line range, not global replace.

---

## Verification (run before declaring done)
1. Extract the inline `<script>` to a temp `.js` file and run `node --check` on it (do NOT pipe via `/dev/stdin`).
2. Grep `renderOverview` body and confirm exactly five filters now read from `ldSet`, and that no `allAssignments.filter` remains inside `renderOverview`.
3. Confirm `renderBayList`/`renderBayView` still reference `allAssignments` (Team View untouched).
4. Confirm the toggle button text flips This Week ⟷ Show All and that a non-empty search renders results even when This Week is active.
5. Confirm no hardcoded hex was introduced — only `--input-border`, `--card-bg`, `--text` tokens.

## What NOT to change
- Loading Team View (bay list / single bay): no filtering.
- The worker, DB, any other file.
- `sortAssignments`, `LD_STATUS_COLORS`, `renderAssignmentCard`, collapse-state logic.
- The Pull Job search (`searchJobsForPull`) is a separate, unrelated input — leave it alone.

## Manual steps for Steve
- None. Frontend-only; deploy on `main`.
