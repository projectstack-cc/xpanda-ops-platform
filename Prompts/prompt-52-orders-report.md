# Prompt 52 — Orders Report

## Goal

Add an Orders report to the Reports section. This is a searchable, filterable list of all jobs (active and archived) so Steve can quickly see what's in the system, find missing orders, and verify uploads.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Context

The existing Jobs API (`GET /api/jobs`) supports:
- `?include_archived=1` — includes archived jobs
- `?search=` — searches customer, PO#, invoice#
- `?status=` — comma-separated status filter (not_started, in_production, done, loading, shipped)
- Default returns active + recently shipped, excludes archived

The report needs to show ALL jobs (including archived) in a flat sortable table — a different view than the Job Board kanban which only shows active work.

---

## Step 1 — Create reports/orders directory and page

Create `reports/orders/index.html`. Follow the same structure as `reports/scrap/summary.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Orders Report — xPanda</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="apple-touch-icon" href="/assets/img/favicon.png">
<link rel="manifest" href="/manifest.json">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="mobile-web-app-capable" content="yes">
<link rel="stylesheet" href="/reports/reports-shared.css">
</head>
<body>

<script src="/reports/reports-header.js"></script>
<script>
document.getElementById('reports-page-title').textContent = 'Orders Report';
</script>

<div class="reports-wrap">

  <a href="/reports/" class="reports-back-link">← Back to Reports</a>

  <div class="reports-section-intro">
    <h2 class="reports-section-title">Orders Report</h2>
    <p class="reports-section-subtitle">All jobs — active and archived. Search by customer, PO#, or invoice#.</p>
  </div>

  <!-- Filters -->
  <div class="card" style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;">

    <div class="reports-field" style="flex:1;min-width:200px;">
      <label>Search</label>
      <input type="text" id="f-search" placeholder="Customer, PO#, or Invoice#" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
    </div>

    <div class="reports-field">
      <label>Status</label>
      <select id="f-status" style="padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
        <option value="">All</option>
        <option value="not_started">Not Started</option>
        <option value="in_production">In Production</option>
        <option value="done">Done</option>
        <option value="loading">Loading</option>
        <option value="shipped">Shipped</option>
        <option value="archived">Archived</option>
      </select>
    </div>

    <div class="reports-field">
      <label>Ship Date From</label>
      <input type="date" id="f-date-from" style="padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
    </div>

    <div class="reports-field">
      <label>Ship Date To</label>
      <input type="date" id="f-date-to" style="padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
    </div>

    <div>
      <button class="btn primary" onclick="loadReport()">Load</button>
      <button class="btn ghost" onclick="clearFilters()">Clear</button>
    </div>

  </div>

  <!-- Stats -->
  <div class="report-stats">
    <div class="report-stat-card">
      <div class="report-stat-label">Total Orders</div>
      <div class="report-stat-value" id="stat-total">--</div>
    </div>
    <div class="report-stat-card">
      <div class="report-stat-label">Active</div>
      <div class="report-stat-value" id="stat-active">--</div>
    </div>
    <div class="report-stat-card">
      <div class="report-stat-label">Shipped</div>
      <div class="report-stat-value" id="stat-shipped">--</div>
    </div>
    <div class="report-stat-card">
      <div class="report-stat-label">Archived</div>
      <div class="report-stat-value" id="stat-archived">--</div>
    </div>
  </div>

  <!-- Results -->
  <div id="results-wrap"></div>

</div>

<script>
const _origFetch = window.fetch;
window.fetch = async function(...args) {
  const res = await _origFetch.apply(this, args);
  if (res.status === 401 && !window.location.pathname.startsWith('/login')) {
    window.location.href = '/login.html';
  }
  return res;
};

let allJobs = [];
let sortCol = 'ship_date';
let sortDir = 'desc';

async function loadReport() {
  const search   = document.getElementById('f-search').value.trim();
  const status   = document.getElementById('f-status').value;
  const dateFrom = document.getElementById('f-date-from').value;
  const dateTo   = document.getElementById('f-date-to').value;

  const wrap = document.getElementById('results-wrap');
  wrap.innerHTML = '<p style="color:#94a3b8;padding:12px;">Loading…</p>';

  try {
    // Fetch all jobs including archived
    let url = '/api/jobs?include_archived=1';
    if (search) url += '&search=' + encodeURIComponent(search);

    const res  = await fetch(url);
    const data = await res.json();
    if (!data.ok) { wrap.innerHTML = '<p style="color:#ef4444;">Error loading jobs.</p>'; return; }

    allJobs = data.jobs || [];

    // Client-side filters (status, date range)
    let filtered = allJobs;

    if (status) {
      filtered = filtered.filter(j => j.status === status);
    }
    if (dateFrom) {
      filtered = filtered.filter(j => j.ship_date && j.ship_date >= dateFrom);
    }
    if (dateTo) {
      filtered = filtered.filter(j => j.ship_date && j.ship_date <= dateTo);
    }

    updateStats(filtered);
    renderTable(filtered);
  } catch {
    wrap.innerHTML = '<p style="color:#ef4444;">Network error.</p>';
  }
}

function updateStats(jobs) {
  document.getElementById('stat-total').textContent    = jobs.length;
  document.getElementById('stat-active').textContent   = jobs.filter(j => !['shipped','archived'].includes(j.status)).length;
  document.getElementById('stat-shipped').textContent  = jobs.filter(j => j.status === 'shipped').length;
  document.getElementById('stat-archived').textContent = jobs.filter(j => j.status === 'archived').length;
}

function sortBy(col) {
  if (sortCol === col) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
  else { sortCol = col; sortDir = 'asc'; }
  renderTable(getFiltered());
}

function getFiltered() {
  const status   = document.getElementById('f-status').value;
  const dateFrom = document.getElementById('f-date-from').value;
  const dateTo   = document.getElementById('f-date-to').value;

  let filtered = allJobs;
  if (status)   filtered = filtered.filter(j => j.status === status);
  if (dateFrom) filtered = filtered.filter(j => j.ship_date && j.ship_date >= dateFrom);
  if (dateTo)   filtered = filtered.filter(j => j.ship_date && j.ship_date <= dateTo);
  return filtered;
}

function renderTable(jobs) {
  const wrap = document.getElementById('results-wrap');
  if (!jobs.length) {
    wrap.innerHTML = '<p style="color:#94a3b8;padding:12px;">No orders found.</p>';
    return;
  }

  // Sort
  const sorted = [...jobs].sort((a, b) => {
    let va = a[sortCol] || '';
    let vb = b[sortCol] || '';
    if (sortCol === 'ship_date' || sortCol === 'created_at') {
      va = va || '9999'; vb = vb || '9999';
    }
    const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const arrow = (col) => sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

  wrap.innerHTML = `
    <div class="report-table-wrap">
      <table class="report-table">
        <thead>
          <tr>
            <th onclick="sortBy('customer')" style="cursor:pointer;">Customer${arrow('customer')}</th>
            <th onclick="sortBy('invoice_number')" style="cursor:pointer;">Invoice#${arrow('invoice_number')}</th>
            <th onclick="sortBy('po_number')" style="cursor:pointer;">PO#${arrow('po_number')}</th>
            <th onclick="sortBy('ship_date')" style="cursor:pointer;">Ship Date${arrow('ship_date')}</th>
            <th onclick="sortBy('status')" style="cursor:pointer;">Status${arrow('status')}</th>
            <th>Source</th>
            <th onclick="sortBy('created_at')" style="cursor:pointer;">Created${arrow('created_at')}</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map(j => `
            <tr onclick="window.open('/jobs/#${j.id}','_blank')" style="cursor:pointer;" title="Open in Job Board">
              <td style="font-weight:600;">${esc(j.customer || '—')}</td>
              <td>${esc(j.invoice_number || '—')}</td>
              <td>${esc(j.po_number || '—')}</td>
              <td>${j.ship_date ? formatDate(j.ship_date) : '—'}</td>
              <td>${statusBadge(j.status)}</td>
              <td style="font-size:11px;color:#6b7280;">${esc(j.source || 'manual')}</td>
              <td style="font-size:11px;color:#6b7280;">${j.created_at ? formatDate(j.created_at.slice(0,10)) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <p style="font-size:11px;color:#9ca3af;padding:8px 0;">Showing ${sorted.length} order${sorted.length !== 1 ? 's' : ''}. Click a row to open in Job Board.</p>
  `;
}

function clearFilters() {
  document.getElementById('f-search').value  = '';
  document.getElementById('f-status').value  = '';
  document.getElementById('f-date-from').value = '';
  document.getElementById('f-date-to').value   = '';
  loadReport();
}

function statusBadge(status) {
  const labels = {
    not_started: 'Not Started', in_production: 'In Production', done: 'Done',
    loading: 'Loading', shipped: 'Shipped', archived: 'Archived',
  };
  const colors = {
    not_started:   'background:#f3f4f6;color:#374151;',
    in_production: 'background:#fef3c7;color:#92400e;',
    done:          'background:#d1fae5;color:#065f46;',
    loading:       'background:#dbeafe;color:#1e40af;',
    shipped:       'background:#e0e7ff;color:#3730a3;',
    archived:      'background:#f9fafb;color:#9ca3af;',
  };
  return `<span style="display:inline-block;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:600;${colors[status] || ''}">${labels[status] || status}</span>`;
}

function formatDate(d) {
  if (!d) return '—';
  const parts = d.split('-');
  if (parts.length !== 3) return d;
  return `${parseInt(parts[1])}/${parseInt(parts[2])}/${parts[0]}`;
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

// Debounced search on typing
let searchTimer;
document.getElementById('f-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadReport, 400);
});

// Load on page open
loadReport();
</script>

</body>
</html>
```

---

## Step 2 — Add tile to reports index

In `reports/index.html`, add a new tile after the Incident Reports tile and before the "Inspection Trends" disabled tile:

```html
<a class="reports-tile" href="/reports/orders/">
  <h2>Orders Report</h2>
  <p>All active and archived orders — searchable by customer, PO#, or invoice#.</p>
</a>
```

---

## Step 3 — Add API support for fetching all jobs (no limit)

The current `/api/jobs` search endpoint has `LIMIT 10` on search queries. The orders report needs all results. 

In `_worker.js`, in the `handleApiJobs` GET handler, find the search query:

```javascript
query = `SELECT ${JOB_LIST_COLS} FROM jobs j WHERE (j.customer LIKE ? OR j.po_number LIKE ? OR j.invoice_number LIKE ?)${archiveClause} ORDER BY j.ship_date DESC LIMIT 10`;
```

Change `LIMIT 10` to `LIMIT 200` to allow the report to return more results while still capping for safety. Also add a `limit` query parameter override:

```javascript
const limitParam = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 500);
```

Then use `LIMIT ${limitParam}` in the search query. Apply the same limit to the other query branches (weekParam, statusParam, default) — add `LIMIT ${limitParam}` to each if they don't already have one.

For the report's default (no search, include_archived=1), the query currently filters to "active + shipped in last 7 days". With `include_archived=1` and no other params, the report needs ALL jobs. Add a branch: if `include_archived=1` and no search/week/status params, return all jobs:

```javascript
} else if (includeArchived && !searchParam && !weekParam && !statusParam) {
  // All jobs including archived — for reports
  query = `SELECT ${JOB_LIST_COLS} FROM jobs j ORDER BY j.ship_date DESC LIMIT ${limitParam}`;
  binds = [];
} else {
  // Default: active + recently shipped
  ...
}
```

Place this branch **before** the existing default `else` block.

---

## What NOT to touch

- Do NOT modify the Job Board page (`jobs/index.html`)
- Do NOT modify the loading dashboard
- Do NOT modify `bol-shared.js`
- Do NOT modify the homepage
- Do NOT modify the logistics dashboard
- Do NOT change any existing report pages (scrap, incidents)
- Do NOT modify `reports-shared.css` — the existing report styles are sufficient
- Do NOT modify `reports-header.js`

---

## Completion checklist

- [ ] `reports/orders/index.html` created with full report page
- [ ] Search by customer, PO#, invoice# with 400ms debounce
- [ ] Status filter dropdown (All, Not Started, In Production, Done, Loading, Shipped, Archived)
- [ ] Date range filter (from/to)
- [ ] Stat cards: Total, Active, Shipped, Archived
- [ ] Sortable table columns: Customer, Invoice#, PO#, Ship Date, Status, Source, Created
- [ ] Click row → opens job in Job Board in new tab
- [ ] Color-coded status badges matching job board colors
- [ ] "Clear" button resets all filters
- [ ] Loads all jobs (including archived) on page open
- [ ] Reports index has new "Orders Report" tile
- [ ] Worker: new `else if` branch for include_archived without other filters returns all jobs
- [ ] Worker: search query limit raised from 10 to 200, configurable via `?limit=` param
- [ ] No console errors

**Notify Steve:** No migration needed. Test:
1. Go to Reports → Orders Report tile appears
2. Click it → all jobs load, including archived
3. Search for a customer name → results filter live
4. Filter by status "Archived" → only archived jobs shown
5. Set a date range → only jobs in that range shown
6. Click a column header → table sorts
7. Click a row → Job Board opens in new tab
8. Clear → resets everything, all jobs shown again
