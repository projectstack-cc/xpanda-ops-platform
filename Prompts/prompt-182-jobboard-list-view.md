# Prompt 182 — Job Board: new "List" view as the primary view

## Required reading
1. Read `AGENTS.md` and `xpanda-ops-agents.md`.
2. Assume the **job-board-agent** role. Single file: `jobs/index.html`. Frontend only — no DB/worker changes (the `loading_status_indicator` field already ships on each job from P181).

## Context
The kanban doesn't scale to a week's order volume. Add a dense, sortable, filterable **List** view and make it the default. Keep Kanban and Calendar as toggles. The List has: status filter tabs with live counts, search (customer/invoice), a "This Week" filter, sortable columns (INV#, Customer, Ship date, BDFT), a color-coded status pill, the loading-status dot (from P181), and row-click opens the existing job detail modal. (Status stays a read-only pill in this prompt; P183 converts it to an inline dropdown.)

All edits byte-exact, each count==1. Confirm before applying.

## Edit 1 — Add the List toggle button, make it default-active (`jobs/index.html`)
FIND (exactly once):
```
    <div class="jobs-view-toggle" style="display:inline-flex;border:1px solid #d1d5db;border-radius:8px;overflow:hidden;">
      <button id="view-kanban" class="jobs-view-btn active" onclick="setView('kanban')">Kanban</button>
      <button id="view-calendar" class="jobs-view-btn" onclick="setView('calendar')">Calendar</button>
    </div>
```
REPLACE:
```
    <div class="jobs-view-toggle" style="display:inline-flex;border:1px solid #d1d5db;border-radius:8px;overflow:hidden;">
      <button id="view-list" class="jobs-view-btn active" onclick="setView('list')">List</button>
      <button id="view-kanban" class="jobs-view-btn" onclick="setView('kanban')">Kanban</button>
      <button id="view-calendar" class="jobs-view-btn" onclick="setView('calendar')">Calendar</button>
    </div>
```

## Edit 2 — Insert the List container; hide the kanban container by default (`jobs/index.html`)
FIND (exactly once):
```
<!-- Kanban board -->
<div class="jobs-board-scroll" id="kanban-container">
```
REPLACE:
```
<!-- List view -->
<div id="list-container" style="padding:0 16px 24px;">
  <div id="list-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;"></div>
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
    <input type="text" id="list-search" placeholder="Search customer or invoice…" oninput="listSearchChanged(this.value)" style="flex:1;min-width:220px;max-width:340px;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
    <button id="list-week-btn" class="jobs-view-btn" style="border:1px solid #d1d5db;border-radius:8px;" onclick="toggleListWeek()">This Week</button>
  </div>
  <div style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fff;">
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="background:#f9fafb;">
          <th onclick="sortList('invoice_number')" style="text-align:left;padding:10px 12px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;cursor:pointer;">INV#</th>
          <th onclick="sortList('customer')" style="text-align:left;padding:10px 12px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;cursor:pointer;">Customer</th>
          <th onclick="sortList('ship_date')" style="text-align:left;padding:10px 12px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;cursor:pointer;">Ship Date</th>
          <th onclick="sortList('total_bdft')" style="text-align:right;padding:10px 12px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;cursor:pointer;">BDFT</th>
          <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">Status</th>
          <th style="text-align:left;padding:10px 12px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;">Loading</th>
        </tr>
      </thead>
      <tbody id="list-tbody"></tbody>
    </table>
    <div id="list-empty" style="display:none;padding:24px;text-align:center;color:#9ca3af;font-size:14px;">No jobs match.</div>
  </div>
  <div id="list-foot" style="margin-top:8px;font-size:12px;color:#9ca3af;"></div>
</div>

<!-- Kanban board -->
<div class="jobs-board-scroll" id="kanban-container" style="display:none;">
```

## Edit 3 — Default view = list; add List view state (`jobs/index.html`)
FIND (exactly once):
```
let currentView      = 'kanban';
```
REPLACE:
```
let currentView      = 'list';
let listTab          = 'all';
let listSort         = 'ship_date';
let listDir          = 1;
let listSearch       = '';
let listWeekOnly     = false;
```

## Edit 4 — Load all jobs on init (List is primary and filters client-side) (`jobs/index.html`)
FIND (exactly once):
```
  loadJobs({ week: monday });
```
REPLACE:
```
  loadJobs({});
```
(The `week-filter` input still drives Kanban/Calendar via its existing change handler.)

## Edit 5 — Render the List from the shared render path (`jobs/index.html`)
FIND (exactly once):
```
  if (currentView === 'calendar') renderCalendar(jobs);
}
```
REPLACE:
```
  if (currentView === 'calendar') renderCalendar(jobs);
  if (currentView === 'list') renderList(jobs);
}
```

## Edit 6 — Handle 'list' in setView (`jobs/index.html`)
FIND (exactly once):
```
function setView(view) {
  currentView = view;
  document.getElementById('view-kanban').classList.toggle('active', view === 'kanban');
  document.getElementById('view-calendar').classList.toggle('active', view === 'calendar');
  document.getElementById('kanban-container').style.display = view === 'kanban' ? '' : 'none';
  document.getElementById('calendar-container').style.display = view === 'calendar' ? '' : 'none';
  if (view === 'calendar') loadJobs({});
}
```
REPLACE:
```
function setView(view) {
  currentView = view;
  document.getElementById('view-list').classList.toggle('active', view === 'list');
  document.getElementById('view-kanban').classList.toggle('active', view === 'kanban');
  document.getElementById('view-calendar').classList.toggle('active', view === 'calendar');
  document.getElementById('list-container').style.display = view === 'list' ? '' : 'none';
  document.getElementById('kanban-container').style.display = view === 'kanban' ? '' : 'none';
  document.getElementById('calendar-container').style.display = view === 'calendar' ? '' : 'none';
  if (view === 'calendar' || view === 'list') loadJobs({});
}
```

## Edit 7 — Add the renderList function + helpers (`jobs/index.html`)
Insert immediately before `fetchJobBols`.
FIND (exactly once):
```
async function fetchJobBols(jobIds) {
```
REPLACE:
```
const STATUS_LIST_TABS = ['all', 'not_started', 'in_production', 'done', 'loading', 'shipped'];
const LIST_LOADING = {
  not_started: { label: 'Not Loaded',  color: '#ef4444' },
  awaiting:    { label: 'Awaiting Bay', color: '#6b7280' },
  loading:     { label: 'Loading',      color: '#f59e0b' },
  loaded:      { label: 'Loaded',       color: '#10b981' },
  in_transit:  { label: 'In Transit',   color: '#6366f1' },
  delivered:   { label: 'Delivered',    color: '#0d9488' },
};

function listTabLabel(s) { return s === 'all' ? 'All' : (STATUS_LABELS[s] || s); }
function setListTab(s)   { listTab = s; renderList(allJobs); }
function listSearchChanged(v) { listSearch = v; renderList(allJobs); }
function toggleListWeek() {
  listWeekOnly = !listWeekOnly;
  const b = document.getElementById('list-week-btn');
  if (b) b.classList.toggle('active', listWeekOnly);
  renderList(allJobs);
}
function sortList(key) {
  if (listSort === key) listDir *= -1; else { listSort = key; listDir = 1; }
  renderList(allJobs);
}

function listActiveJobs() { return (allJobs || []).filter(j => j.status !== 'archived'); }

function listFilteredJobs() {
  let r = listActiveJobs();
  if (listTab !== 'all') r = r.filter(j => j.status === listTab);
  if (listWeekOnly) {
    const monday = getCurrentWeekMonday();
    const d = new Date(monday + 'T00:00:00'); d.setDate(d.getDate() + 6);
    const sunday = d.toISOString().split('T')[0];
    r = r.filter(j => j.ship_date && j.ship_date >= monday && j.ship_date <= sunday);
  }
  if (listSearch) {
    const q = listSearch.toLowerCase();
    r = r.filter(j =>
      (j.customer || '').toLowerCase().includes(q) ||
      (j.invoice_number || '').toLowerCase().includes(q));
  }
  r = r.slice().sort((a, b) => {
    let x = a[listSort], y = b[listSort];
    if (listSort === 'total_bdft') return ((Number(x) || 0) - (Number(y) || 0)) * listDir;
    x = (x == null ? '' : String(x)); y = (y == null ? '' : String(y));
    return x < y ? -listDir : x > y ? listDir : 0;
  });
  return r;
}

function renderListTabs() {
  const el = document.getElementById('list-tabs');
  if (!el) return;
  const active = listActiveJobs();
  el.innerHTML = STATUS_LIST_TABS.map(s => {
    const n  = s === 'all' ? active.length : active.filter(j => j.status === s).length;
    const on = listTab === s;
    return `<button onclick="setListTab('${s}')" style="padding:6px 11px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;border:1px solid ${on ? '#9ca3af' : 'transparent'};background:${on ? '#f3f4f6' : 'transparent'};color:${on ? '#111827' : '#6b7280'};">${esc(listTabLabel(s))} <span style="opacity:.6;">${n}</span></button>`;
  }).join('');
}

function renderList(jobs) {
  renderListTabs();
  const tbody = document.getElementById('list-tbody');
  if (!tbody) return;
  const rows = listFilteredJobs();
  tbody.innerHTML = '';
  for (const job of rows) {
    const sc          = STATUS_COLORS[job.status] || STATUS_COLORS.not_started;
    const statusLabel = STATUS_LABELS[job.status] || job.status;
    const lo          = LIST_LOADING[job.loading_status_indicator];
    const loadStr     = job.load_count > 1 ? ` <span style="font-size:11px;color:#2563eb;font-weight:600;">&times; ${job.load_count}</span>` : '';
    const tr = document.createElement('tr');
    tr.style.cssText = 'border-top:1px solid #f3f4f6;cursor:pointer;';
    tr.onmouseover = () => { tr.style.background = '#f9fafb'; };
    tr.onmouseout  = () => { tr.style.background = ''; };
    tr.onclick     = () => openModal(job.id);
    tr.innerHTML = `
      <td style="padding:9px 12px;font-size:13px;font-weight:600;">${job.invoice_number ? esc(job.invoice_number) : '—'}${loadStr}</td>
      <td style="padding:9px 12px;font-size:13px;">${esc(job.customer || '')}</td>
      <td style="padding:9px 12px;font-size:13px;color:#6b7280;">${esc(formatShipDate(job.ship_date)) || '—'}</td>
      <td style="padding:9px 12px;font-size:13px;text-align:right;">${job.total_bdft ? Number(job.total_bdft).toLocaleString() : '—'}</td>
      <td style="padding:9px 12px;"><span style="display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;background:${sc.bg};color:${sc.text};">${esc(statusLabel)}</span></td>
      <td style="padding:9px 12px;font-size:12px;color:#6b7280;">${lo ? `<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:7px;height:7px;border-radius:50%;background:${lo.color};"></span>${lo.label}</span>` : '<span style="color:#d1d5db;">—</span>'}</td>
    `;
    tbody.appendChild(tr);
  }
  document.getElementById('list-empty').style.display = rows.length ? 'none' : 'block';
  const foot = document.getElementById('list-foot');
  if (foot) foot.textContent = `${rows.length} of ${listActiveJobs().length} jobs${listWeekOnly ? ' · this week' : ''}`;
}

async function fetchJobBols(jobIds) {
```

## Validation
Extract `jobs/index.html` inline `<script>` blocks via `re.findall` to real temp files and `node --check` each (do NOT pipe via `/dev/stdin`).

## Manual sanity (Steve)
- Job Board opens on the **List** view; Kanban and Calendar toggles still work and return correctly.
- Status tabs show live counts and filter; search narrows by customer/invoice; "This Week" filters to Mon–Sun of the current week; column headers sort (default: ship date ascending); the loading dot matches the loading dashboard colors; clicking a row opens the existing job modal.
- Note for review: the List "All" tab shows every non-archived job, including older shipped ones. If old-shipped noise is heavy, we can add a default active-only or recent-window filter as a fast follow.

## What NOT to change
- Do NOT alter `buildCard`, the kanban columns, the calendar, `moveCard`, or the job modal.
- Do NOT add a status dropdown here — that is P183.
- Do NOT touch the worker, DB, or any other file.

## Deliverables
- `jobs/index.html` — List toggle (default), `#list-container`, `renderList` + helpers, `setView`/`renderBoard`/init wiring, default `currentView = 'list'`.
- Inline scripts pass `node --check`.
