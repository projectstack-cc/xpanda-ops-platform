# Prompt 60 — Logistics Dashboard UI: Status Labels, Action Buttons, Assign Bay

## Goal

Update the logistics dashboard (outbound tab) to reflect that the Job Board is now the source of truth. Add new status labels, inline action buttons (Build Load, Generate BOL, Assign Bay), and remove those same actions from the Job Board cards.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Context

After Prompt 59, shipments now have statuses that mirror the job lifecycle:
- `not_started` — job is in queue
- `in_production` — job is being produced
- `ready_to_ship` — job is done, ready for logistics
- `loading` / `loaded` / `in_transit` / `delivered` — loading flow (unchanged)

The logistics dashboard currently shows `awaiting` as a status option, which is now only used on the loading dashboard. The outbound table needs new columns and action buttons so logistics staff can work directly from this view.

---

## Step 1 — Update status labels and badge colors in `logistics/index.html`

### 1a. Update `statusBadge()` function

Find `statusBadge()` (around line 1143). Replace its labels object:

```javascript
function statusBadge(status) {
  const labels = {
    not_started:    'Not Started',
    in_production:  'In Production',
    ready_to_ship:  'Ready to Ship',
    loading:        'Loading',
    loaded:         'Loaded',
    in_transit:     'In Transit',
    delivered:      'Delivered',
    cancelled:      'Cancelled',
    scheduled:      'Scheduled',
    awaiting:       'Awaiting',  // legacy — keep for old records
  };
  return `<span class="logistics-status-badge status-${status}">${labels[status] || status}</span>`;
}
```

### 1b. Add CSS for new status badges

In `logistics/logistics-shared.css` (or in the `<style>` block if styles are inline), add badge colors for the new statuses:

```css
.status-in_production { background: #fef3c7; color: #92400e; }
.status-ready_to_ship { background: #dcfce7; color: #166534; }
```

If these don't already exist. Check for existing status badge styles and add only what's missing.

### 1c. Update the outbound status filter dropdown

Find the status filter `<select>` (around line 72):

```html
<select class="logistics-filter-select" id="outbound-status-filter" onchange="loadOutbound()">
  <option value="">All Statuses</option>
  <option value="awaiting">Awaiting</option>
  <option value="not_started">Not Started</option>
  ...
```

Replace with:

```html
<select class="logistics-filter-select" id="outbound-status-filter" onchange="loadOutbound()">
  <option value="">All Statuses</option>
  <option value="not_started">Not Started</option>
  <option value="in_production">In Production</option>
  <option value="ready_to_ship">Ready to Ship</option>
  <option value="loading">Loading</option>
  <option value="loaded">Loaded</option>
  <option value="in_transit">In Transit</option>
  <option value="delivered">Delivered</option>
  <option value="cancelled">Cancelled</option>
</select>
```

Remove `awaiting` from the filter. Old `awaiting` records will show under "All Statuses" but can't be specifically filtered.

---

## Step 2 — Add action buttons to outbound table rows

### 2a. Add "Actions" column to outbound table header

Find the outbound table `<thead>` (around line 575):

```html
<tr>
  <th>Customer</th>
  <th>Method / Carrier</th>
  <th>Trailer #</th>
  <th>Loads</th>
  <th>BDFT</th>
  <th>BOL #</th>
  <th>Status</th>
</tr>
```

Add a new column:

```html
<tr>
  <th>Customer</th>
  <th>Method / Carrier</th>
  <th>Trailer #</th>
  <th>Loads</th>
  <th>BDFT</th>
  <th>BOL #</th>
  <th>Status</th>
  <th>Bay</th>
  <th style="text-align:right;">Actions</th>
</tr>
```

### 2b. Update `buildOutboundRow()` to include bay and action buttons

Find `buildOutboundRow()` (around line 595). Replace it with:

```javascript
function buildOutboundRow(s) {
  const linkedJob = allOpenJobs.find(j => j.id === s.job_id);
  const jobLink   = linkedJob
    ? `<a class="logistics-job-link" href="/jobs/?job_id=${linkedJob.id}" onclick="event.stopPropagation()">Job: ${esc(linkedJob.customer)}${linkedJob.invoice_number ? ' · ' + esc(linkedJob.invoice_number) : ''}</a>`
    : (s.job_id ? `<a class="logistics-job-link" href="/jobs/" onclick="event.stopPropagation()">Job linked ↗</a>` : '');

  const methodCarrier = [s.method, s.carrier].filter(Boolean).join(' · ');
  const bdft = s.total_bdft ? fmtNum(s.total_bdft) : '—';

  // Bay assignment — find loading assignment for this job
  const la = s.job_id ? loadingAssignmentsByJobId[s.job_id] : null;
  const bayHtml = buildBayCell(s, la);

  // Action buttons — only show for job-linked shipments in appropriate statuses
  const actionsHtml = buildActionButtons(s);

  return `<tr onclick="openEdit('${s.id}')">
    <td class="logistics-customer-cell">
      ${esc(s.customer) || '<span style="color:#94a3b8;">—</span>'}
      ${jobLink ? `<br>${jobLink}` : ''}
    </td>
    <td>${esc(methodCarrier) || '—'}</td>
    <td>${esc(s.trailer_number) || '—'}</td>
    <td>${s.load_count || 1}</td>
    <td>${bdft}</td>
    <td>${esc(s.bol_number) || '—'}</td>
    <td>${statusBadge(s.status)}</td>
    <td>${bayHtml}</td>
    <td style="text-align:right;">${actionsHtml}</td>
  </tr>`;
}
```

### 2c. Add helper functions for bay cell and action buttons

```javascript
function buildBayCell(shipment, loadingAssignment) {
  if (!shipment.job_id) return '—';

  // If already assigned to a bay, show it
  if (loadingAssignment && loadingAssignment.bay_number) {
    return `<span style="font-size:12px;font-weight:600;">Bay ${loadingAssignment.bay_number}</span>`;
  }

  // Show dropdown for assignment (only for ready_to_ship status and beyond, before loading starts)
  if (['ready_to_ship'].includes(shipment.status) && allLoadingBays.length > 0) {
    const laId = loadingAssignment?.id || '';
    if (!laId) return '—';
    const opts = allLoadingBays.map(b =>
      `<option value="${b.id}">Bay ${b.bay_number}${b.label ? ' — ' + esc(b.label) : ''}</option>`
    ).join('');
    return `<select class="logistics-bay-select" onchange="assignBayFromDashboard('${laId}', this.value)" onclick="event.stopPropagation()">
      <option value="">Assign…</option>
      ${opts}
    </select>`;
  }

  return '—';
}

function buildActionButtons(shipment) {
  if (!shipment.job_id) return '';

  const buttons = [];

  // Build Load — available from ready_to_ship onward until shipped
  if (['ready_to_ship', 'loading', 'loaded'].includes(shipment.status)) {
    buttons.push(`<a class="logistics-action-btn action-load" href="/logistics/load-builder.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">Build Load</a>`);
  }

  // Generate BOL — available from ready_to_ship onward
  if (['ready_to_ship', 'loading', 'loaded', 'in_transit'].includes(shipment.status)) {
    buttons.push(`<a class="logistics-action-btn action-bol" href="/logistics/bol-generator.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">Generate BOL</a>`);
  }

  return buttons.join(' ');
}
```

### 2d. Add CSS for action buttons and bay select

```css
.logistics-action-btn {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 5px;
  text-decoration: none;
  white-space: nowrap;
  margin-left: 4px;
  transition: background .12s;
}
.action-load { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
.action-load:hover { background: #fde68a; }
.action-bol { background: #f0f9ff; color: #0369a1; border: 1px solid #bae6fd; }
.action-bol:hover { background: #e0f2fe; }

.logistics-bay-select {
  font-size: 12px;
  padding: 3px 6px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  max-width: 120px;
}
```

---

## Step 3 — Load bay data and loading assignments on page init

### 3a. Add state variables

Near the top of the `<script>` block, alongside the existing `let outboundData = []`:

```javascript
let allLoadingBays = [];
let loadingAssignmentsByJobId = {};
```

### 3b. Fetch bays and loading assignments on page load

Add two new fetch functions:

```javascript
async function loadBays() {
  try {
    const res = await fetch('/api/loading-bays');
    const body = await res.json();
    allLoadingBays = body.ok ? (body.bays || []).filter(b => b.is_active) : [];
  } catch {
    allLoadingBays = [];
  }
}

async function loadLoadingAssignments() {
  try {
    const res = await fetch('/api/loading-assignments');
    const body = await res.json();
    if (body.ok && body.assignments) {
      // Index by job_id — take the first (or most relevant) assignment per job
      loadingAssignmentsByJobId = {};
      for (const la of body.assignments) {
        if (!loadingAssignmentsByJobId[la.job_id]) {
          loadingAssignmentsByJobId[la.job_id] = la;
        }
      }
    }
  } catch {
    loadingAssignmentsByJobId = {};
  }
}
```

### 3c. Call on page init

Find the `init()` or `DOMContentLoaded` handler. Add calls to load bays and loading assignments alongside the existing data loads:

```javascript
await Promise.all([
  loadOutbound(),
  loadInbound(),
  loadOpenJobs(),
  loadBays(),
  loadLoadingAssignments(),
  // ... any other existing init calls
]);
```

Also reload loading assignments after outbound data refreshes (add to `loadOutbound` after the fetch):

```javascript
async function loadOutbound() {
  // ... existing fetch code ...
  renderOutbound();
  loadLoadingAssignments(); // refresh bay assignment data
}
```

### 3d. Add `assignBayFromDashboard()` function

```javascript
async function assignBayFromDashboard(assignmentId, bayId) {
  if (!bayId) return;
  try {
    const res = await fetch('/api/loading-assignments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: assignmentId,
        bay_id: bayId,
        loading_status: 'not_started',  // Move from awaiting → not_started when bay is assigned
      }),
    });
    const data = await res.json();
    if (data.ok) {
      await loadLoadingAssignments();
      renderOutbound();

      // Toast
      const toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;z-index:10000;';
      toast.innerHTML = '<span style="color:#34d399;">✓</span> Bay assigned';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    } else {
      alert(data.error || 'Failed to assign bay');
    }
  } catch (e) {
    console.error('Bay assignment failed:', e);
    alert('Failed to assign bay');
  }
}
```

---

## Step 4 — Update the shipment edit modal for job-linked shipments

When a user clicks an outbound shipment row, `openEdit()` opens the edit modal. For job-linked shipments, some fields should be **read-only** (parts are locked at the job level) while others remain editable.

### 4a. Add read-only indicators for job-linked fields

In `openEdit()` (around line 693), after populating the form fields, add a read-only state for job-linked shipments:

```javascript
// After existing field population...

// Mark job-linked fields as read-only (except logistics-only fields)
const isJobLinked = !!s.job_id;
if (isJobLinked) {
  // These fields mirror the job — show a note, but still allow editing
  // (edits on customer/carrier/date here should sync back OR the user
  //  should be directed to edit on the Job Board)
  // For now: make all fields editable but add a visual indicator
  const jobNote = document.getElementById('job-linked-note');
  if (jobNote) {
    jobNote.style.display = '';
    jobNote.innerHTML = `<span style="color:#0369a1;">ℹ</span> This shipment is linked to a job. Changes to customer, carrier, address, and dates should be made on the <a href="/jobs/?job_id=${s.job_id}" style="color:#0369a1;font-weight:600;">Job Board</a> to stay in sync.`;
  }
} else {
  const jobNote = document.getElementById('job-linked-note');
  if (jobNote) jobNote.style.display = 'none';
}
```

### 4b. Add the note element to the modal

In the shipment modal HTML, add a note banner just inside the modal body (after the modal title area):

```html
<div id="job-linked-note" style="display:none;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#1e40af;"></div>
```

---

## Step 5 — Remove Build Load / Generate BOL buttons from Job Board

In `jobs/index.html`, find the BOL row in `renderJobCard()` (around line 767):

```javascript
<div class="jobs-bol-row" id="bol-row-${job.id}">
  <a class="jobs-bol-link" href="/logistics/load-builder.html?job_id=${job.id}" onclick="event.stopPropagation()" style="background:#fef3c7;color:#92400e;">Build Load</a>
  <a class="jobs-bol-link" href="/logistics/bol-generator.html?job_id=${job.id}" onclick="event.stopPropagation()">Generate BOL</a>
</div>
```

Remove the entire `<div class="jobs-bol-row">` block. Delete these lines entirely.

Also check if there's a BOL number display element (`bol-num-${job.id}`) that was populated separately — if it was only related to these buttons, remove it too. If it shows the BOL number on the card independently, leave it.

---

## Step 6 — Update `allOpenJobs` fetch to include all relevant statuses

In `logistics/index.html`, find `loadOpenJobs()` (around line 440):

```javascript
const res = await fetch('/api/jobs?status=not_started,in_production,done');
```

Update to include `loading` and `shipped` so the job picker and job links work for all active shipments:

```javascript
const res = await fetch('/api/jobs?status=not_started,in_production,done,loading,shipped');
```

---

## What NOT to touch

- Do NOT modify `_worker.js` — all backend changes were in Prompt 59
- Do NOT modify `loading.html` — the loading dashboard stays as-is
- Do NOT modify `bol-shared.js`, `bol-generator.html`, or `load-builder.html`
- Do NOT modify the inbound deliveries tab or its rendering
- Do NOT modify the shipment modal's save/delete handlers
- Do NOT modify the calendar view rendering (it will inherit the new statuses automatically)
- Do NOT remove the "+ New Shipment" button — ad-hoc shipments still need it
- Do NOT remove the "Ship from Job…" button — it can stay as an alternative entry point

---

## Completion checklist

- [ ] `logistics/index.html`: `statusBadge()` includes `in_production`, `ready_to_ship` labels
- [ ] `logistics/index.html` or `logistics-shared.css`: CSS for `.status-in_production` and `.status-ready_to_ship` badges
- [ ] `logistics/index.html`: outbound status filter dropdown updated (removed `awaiting`, added new statuses)
- [ ] `logistics/index.html`: outbound table has "Bay" and "Actions" columns
- [ ] `logistics/index.html`: `buildOutboundRow()` renders bay dropdown and action buttons
- [ ] `logistics/index.html`: `buildBayCell()` shows assigned bay or dropdown for `ready_to_ship` shipments
- [ ] `logistics/index.html`: `buildActionButtons()` shows Build Load and Generate BOL links for appropriate statuses
- [ ] `logistics/index.html`: `loadBays()` and `loadLoadingAssignments()` functions added
- [ ] `logistics/index.html`: bay data and loading assignments fetched on page init
- [ ] `logistics/index.html`: `assignBayFromDashboard()` PUTs to loading-assignments API
- [ ] `logistics/index.html`: job-linked note banner in shipment edit modal
- [ ] `logistics/index.html`: `loadOpenJobs()` fetches all relevant job statuses
- [ ] `jobs/index.html`: Build Load and Generate BOL buttons removed from job cards
- [ ] Action buttons use `event.stopPropagation()` to avoid triggering row click (openEdit)
- [ ] Bay dropdown uses `event.stopPropagation()` similarly
- [ ] No console errors

**Notify Steve:** No migrations needed. Deploy after Prompt 59. Test:
1. Open logistics dashboard → outbound tab → status filter dropdown shows new statuses (no "Awaiting")
2. New jobs show with "Not Started" status
3. Jobs moved to "In Production" on Job Board → logistics dashboard updates to "In Production"
4. Jobs moved to "Done" → shows "Ready to Ship" with Bay dropdown and Build Load / Generate BOL buttons
5. Select a bay from the dropdown → toast confirms, bay number shows inline
6. Click "Build Load" → opens load builder with job prefilled
7. Click "Generate BOL" → opens BOL generator with job prefilled
8. Click a shipment row → edit modal opens, shows job-linked note for job-linked shipments
9. Open Job Board → confirm Build Load and Generate BOL buttons are gone from cards
10. Job card status arrows still work normally
11. Create an ad-hoc shipment via "+ New Shipment" → still works, no bay/actions shown (no job linked)
