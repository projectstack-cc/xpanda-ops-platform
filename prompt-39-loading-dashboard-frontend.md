# Prompt 39 — Loading Dashboard: Frontend

## Goal

Create the Loading Dashboard page at `/logistics/loading.html` — a bay-based view where jobs are assigned to physical loading bays and progress through loading statuses. Supports two view modes: full overview (desktop/tablet landscape) and per-bay view (mobile/tablet portrait).

**Read `AGENTS.md` before starting. Follow all rules strictly.**

**Prerequisites:** Prompt 37 (multi-role) and Prompt 38 (loading schema + API) must be completed.

---

## Step 1 — Create the page

Create `logistics/loading.html`. Use the same shared header as other logistics pages:

```html
<script src="/logistics/logistics-header.js"></script>
<link rel="stylesheet" href="/logistics/logistics-shared.css" />
```

---

## Step 2 — Page layout

### Two view modes

**Overview mode (default on desktop):** Shows all 11 bays in a horizontal scrollable layout with the awaiting queue on the left, bay columns in the middle, and in-transit/delivered sections below.

**Bay mode (default on mobile, togglable on desktop):** Shows a single bay selected from a dropdown, with its assignments listed vertically by status. Better for phone use.

### HTML structure

```html
<div class="loading-dashboard">
  <!-- Top bar -->
  <div class="ld-toolbar">
    <h2>Loading Dashboard</h2>
    <div class="ld-view-toggle">
      <button id="view-overview" class="ld-view-btn active" onclick="setLdView('overview')">Overview</button>
      <button id="view-bay" class="ld-view-btn" onclick="setLdView('bay')">Bay View</button>
    </div>
    <select id="bay-selector" style="display:none;" onchange="selectBay(this.value)">
      <!-- populated dynamically -->
    </select>
    <button id="btn-pull-job" class="ld-btn-pull" onclick="openPullJobModal()" style="display:none;">+ Pull Job</button>
  </div>

  <!-- Overview mode -->
  <div id="ld-overview">
    <!-- Awaiting queue -->
    <div class="ld-section">
      <h3 class="ld-section-title">Awaiting Trailer Assignment</h3>
      <div id="ld-awaiting" class="ld-queue"></div>
    </div>

    <!-- Bay columns (horizontal scroll) -->
    <div class="ld-bays-scroll">
      <div id="ld-bays" class="ld-bays-grid">
        <!-- Bay columns rendered dynamically -->
      </div>
    </div>

    <!-- In Transit -->
    <div class="ld-section">
      <h3 class="ld-section-title">In Transit</h3>
      <div id="ld-transit" class="ld-transit-grid"></div>
    </div>

    <!-- Delivered -->
    <div class="ld-section">
      <h3 class="ld-section-title">Delivered</h3>
      <div id="ld-delivered" class="ld-transit-grid"></div>
    </div>
  </div>

  <!-- Bay mode (single bay) -->
  <div id="ld-bay-view" style="display:none;">
    <div id="ld-single-bay"></div>
  </div>
</div>

<!-- Pull Job Modal -->
<div id="pull-job-modal" class="ld-modal-backdrop" hidden>
  <div class="ld-modal-card">
    <div class="ld-modal-header">
      <h3>Pull Job to Loading</h3>
      <button onclick="closePullJobModal()" class="ld-modal-close">✕</button>
    </div>
    <div class="ld-modal-body">
      <label>Search Jobs</label>
      <input type="text" id="pull-job-search" placeholder="Customer, PO, or INV #" oninput="searchJobsForPull(this.value)" />
      <div id="pull-job-results" class="ld-job-results"></div>
      <hr style="margin:12px 0;" />
      <label>Assign to</label>
      <select id="pull-job-bay">
        <option value="">Awaiting Queue (no bay)</option>
        <!-- bay options populated dynamically -->
      </select>
    </div>
    <div class="ld-modal-footer">
      <button onclick="closePullJobModal()" class="ld-btn-cancel">Cancel</button>
      <button onclick="confirmPullJob()" class="ld-btn-confirm">Pull to Loading</button>
    </div>
  </div>
</div>
```

---

## Step 3 — State and data loading

```javascript
let allBays = [];
let allAssignments = [];
let selectedBayId = null;
let currentLdView = window.innerWidth < 768 ? 'bay' : 'overview';
let pullJobSelectedId = null;

async function loadDashboard() {
  const [baysRes, assignRes] = await Promise.all([
    fetch('/api/loading-bays').then(r => r.json()),
    fetch('/api/loading-assignments').then(r => r.json()),
  ]);
  allBays = baysRes.bays || [];
  allAssignments = assignRes.assignments || [];

  renderDashboard();
}

function setLdView(view) {
  currentLdView = view;
  document.getElementById('view-overview').classList.toggle('active', view === 'overview');
  document.getElementById('view-bay').classList.toggle('active', view === 'bay');
  document.getElementById('ld-overview').style.display = view === 'overview' ? '' : 'none';
  document.getElementById('ld-bay-view').style.display = view === 'bay' ? '' : 'none';
  document.getElementById('bay-selector').style.display = view === 'bay' ? '' : 'none';

  if (view === 'bay') {
    if (!selectedBayId && allBays.length) selectedBayId = allBays[0].id;
    renderBayView();
  }
}
```

---

## Step 4 — Overview rendering

```javascript
function renderDashboard() {
  if (currentLdView === 'overview') renderOverview();
  else renderBayView();
  updatePullButtonVisibility();
}

function renderOverview() {
  // Awaiting queue
  const awaiting = allAssignments.filter(a => a.loading_status === 'awaiting');
  document.getElementById('ld-awaiting').innerHTML = awaiting.length
    ? awaiting.map(a => renderAssignmentCard(a, true)).join('')
    : '<div class="ld-empty">No jobs awaiting assignment</div>';

  // Bay columns
  const baysHtml = allBays.map(bay => {
    const bayAssignments = allAssignments.filter(a => a.bay_id === bay.id && ['not_started','loading','loaded'].includes(a.loading_status));

    return `
      <div class="ld-bay-col" data-bay-id="${bay.id}">
        <div class="ld-bay-header">
          <div class="ld-bay-number">Bay ${bay.bay_number}</div>
          <input class="ld-trailer-input" type="text" placeholder="Trailer #"
            value="${bay.trailer_number || ''}"
            onchange="updateBayTrailer('${bay.id}', this.value)" />
        </div>
        <div class="ld-bay-body">
          ${bayAssignments.length
            ? bayAssignments.map(a => renderAssignmentCard(a, false)).join('')
            : '<div class="ld-empty-bay">Empty</div>'}
        </div>
      </div>
    `;
  }).join('');
  document.getElementById('ld-bays').innerHTML = baysHtml;

  // In Transit
  const transit = allAssignments.filter(a => a.loading_status === 'in_transit');
  document.getElementById('ld-transit').innerHTML = transit.length
    ? transit.map(a => renderAssignmentCard(a, false)).join('')
    : '<div class="ld-empty">No trailers in transit</div>';

  // Delivered
  const delivered = allAssignments.filter(a => a.loading_status === 'delivered');
  document.getElementById('ld-delivered').innerHTML = delivered.length
    ? delivered.map(a => renderAssignmentCard(a, true, true)).join('')
    : '<div class="ld-empty">No recent deliveries</div>';
}
```

---

## Step 5 — Assignment card rendering

```javascript
const LD_STATUS_COLORS = {
  awaiting:    { bg: '#f3f4f6', border: '#9ca3af', text: '#374151', label: 'Awaiting' },
  not_started: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', label: 'Not Started' },
  loading:     { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af', label: 'Loading' },
  loaded:      { bg: '#d1fae5', border: '#10b981', text: '#065f46', label: 'Loaded' },
  in_transit:  { bg: '#e0e7ff', border: '#6366f1', text: '#3730a3', label: 'In Transit' },
  delivered:   { bg: '#f0fdf4', border: '#22c55e', text: '#166534', label: 'Delivered' },
};

function renderAssignmentCard(a, showAssignBtn, showArchiveBtn) {
  const sc = LD_STATUS_COLORS[a.loading_status] || LD_STATUS_COLORS.awaiting;
  const nextStatus = getNextLoadingStatus(a.loading_status);

  return `
    <div class="ld-card" style="border-left:4px solid ${sc.border};background:${sc.bg};" data-assignment-id="${a.id}">
      <div class="ld-card-header">
        <strong>${a.customer || 'Unknown'}</strong>
        <span class="ld-status-badge" style="color:${sc.text};">${sc.label}</span>
      </div>
      <div class="ld-card-meta">
        ${a.invoice_number ? `<span>INV# ${a.invoice_number}</span>` : ''}
        ${a.trailer_number ? `<span>Trailer: ${a.trailer_number}</span>` : ''}
        ${a.ship_to_city ? `<span>${a.ship_to_city}, ${a.ship_to_state || ''}</span>` : ''}
      </div>
      <div class="ld-card-actions">
        ${a.loading_status === 'awaiting' ? `<button class="ld-btn-assign" onclick="openAssignBayModal('${a.id}')">Assign Bay</button>` : ''}
        ${nextStatus ? `<button class="ld-btn-advance" onclick="advanceStatus('${a.id}', '${nextStatus}')">${getAdvanceLabel(nextStatus)}</button>` : ''}
        ${showArchiveBtn ? `<button class="ld-btn-archive" onclick="archiveAssignment('${a.id}')">Archive</button>` : ''}
      </div>
    </div>
  `;
}

function getNextLoadingStatus(current) {
  const flow = ['awaiting', 'not_started', 'loading', 'loaded', 'in_transit', 'delivered'];
  const i = flow.indexOf(current);
  return i >= 0 && i < flow.length - 1 ? flow[i + 1] : null;
}

function getAdvanceLabel(nextStatus) {
  const labels = {
    not_started: 'Assign to Bay',
    loading: 'Start Loading',
    loaded: 'Mark Loaded',
    in_transit: 'Mark In Transit',
    delivered: 'Mark Delivered',
  };
  return labels[nextStatus] || 'Advance';
}
```

---

## Step 6 — Bay view (mobile-first single bay)

```javascript
function renderBayView() {
  // Populate bay selector
  const sel = document.getElementById('bay-selector');
  sel.innerHTML = allBays.map(b =>
    `<option value="${b.id}" ${b.id === selectedBayId ? 'selected' : ''}>Bay ${b.bay_number}${b.trailer_number ? ` — TR# ${b.trailer_number}` : ''}</option>`
  ).join('');

  if (!selectedBayId) return;

  const bay = allBays.find(b => b.id === selectedBayId);
  const bayAssignments = allAssignments.filter(a => a.bay_id === selectedBayId);

  // Group by status for vertical layout
  const groups = [
    { status: 'not_started', label: 'Not Started', assignments: bayAssignments.filter(a => a.loading_status === 'not_started') },
    { status: 'loading', label: 'Loading', assignments: bayAssignments.filter(a => a.loading_status === 'loading') },
    { status: 'loaded', label: 'Loaded', assignments: bayAssignments.filter(a => a.loading_status === 'loaded') },
  ];

  let html = `
    <div class="ld-bay-single">
      <div class="ld-bay-single-header">
        <h3>Bay ${bay.bay_number}</h3>
        <input class="ld-trailer-input" type="text" placeholder="Trailer #" value="${bay.trailer_number || ''}"
          onchange="updateBayTrailer('${bay.id}', this.value)" />
      </div>
      ${groups.map(g => `
        <div class="ld-bay-group">
          <div class="ld-bay-group-title">${g.label} (${g.assignments.length})</div>
          ${g.assignments.length
            ? g.assignments.map(a => renderAssignmentCard(a, false)).join('')
            : `<div class="ld-empty-bay">No jobs ${g.label.toLowerCase()}</div>`}
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('ld-single-bay').innerHTML = html;
}

function selectBay(bayId) {
  selectedBayId = bayId;
  renderBayView();
}
```

---

## Step 7 — Actions

```javascript
async function advanceStatus(assignmentId, newStatus) {
  try {
    const res = await fetch('/api/loading-assignments', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: assignmentId, loading_status: newStatus }),
    });
    const data = await res.json();
    if (data.ok) {
      loadDashboard();
    } else {
      alert(data.error || 'Failed to update status');
    }
  } catch (e) {
    console.error('Status advance failed:', e);
  }
}

async function updateBayTrailer(bayId, trailerNumber) {
  await fetch('/api/loading-bays', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bayId, trailer_number: trailerNumber }),
  });
}

async function archiveAssignment(assignmentId) {
  await advanceStatus(assignmentId, 'archived');
  // Show toast
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1e293b;color:#fff;padding:12px 24px;border-radius:10px;font-size:14px;z-index:10000;';
  toast.innerHTML = '<span style="color:#34d399;">✓</span> Archived';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
```

---

## Step 8 — Pull Job modal

```javascript
let pullJobSearchResults = [];

async function openPullJobModal() {
  document.getElementById('pull-job-modal').hidden = false;
  pullJobSelectedId = null;
  document.getElementById('pull-job-search').value = '';
  document.getElementById('pull-job-results').innerHTML = '';

  // Populate bay dropdown
  const baySelect = document.getElementById('pull-job-bay');
  baySelect.innerHTML = '<option value="">Awaiting Queue (no bay)</option>' +
    allBays.map(b => `<option value="${b.id}">Bay ${b.bay_number}</option>`).join('');
}

function closePullJobModal() {
  document.getElementById('pull-job-modal').hidden = true;
}

async function searchJobsForPull(query) {
  if (query.length < 2) { document.getElementById('pull-job-results').innerHTML = ''; return; }

  const res = await fetch('/api/jobs?search=' + encodeURIComponent(query));
  const data = await res.json();
  pullJobSearchResults = data.jobs || [];

  document.getElementById('pull-job-results').innerHTML = pullJobSearchResults.map(j => `
    <div class="ld-job-result ${pullJobSelectedId === j.id ? 'selected' : ''}" onclick="selectPullJob('${j.id}')">
      <strong>${j.customer || 'Unknown'}</strong>
      <span style="font-size:12px;color:#6b7280;">
        ${j.invoice_number ? 'INV# ' + j.invoice_number : ''} ${j.po_number ? '| PO: ' + j.po_number : ''}
        ${j.status ? '| ' + j.status.replace('_',' ') : ''}
      </span>
    </div>
  `).join('');
}

function selectPullJob(jobId) {
  pullJobSelectedId = jobId;
  document.querySelectorAll('.ld-job-result').forEach(el => el.classList.remove('selected'));
  document.querySelector(`.ld-job-result[onclick*="${jobId}"]`)?.classList.add('selected');
}

async function confirmPullJob() {
  if (!pullJobSelectedId) { alert('Select a job first'); return; }

  const bayId = document.getElementById('pull-job-bay').value || null;

  const res = await fetch('/api/loading-assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: pullJobSelectedId, bay_id: bayId }),
  });
  const data = await res.json();

  if (data.ok) {
    closePullJobModal();
    loadDashboard();
  } else {
    alert(data.error || 'Failed to pull job');
  }
}
```

---

## Step 9 — Manager-only UI gating

The "Pull Job" button should only show for users with `logistics.loading.manage` permission:

```javascript
function updatePullButtonVisibility() {
  const user = window.__xpandaUser;
  const btn = document.getElementById('btn-pull-job');
  if (!user) return;
  if (user.isAdministrator || user.permissions?.['logistics.loading.manage']?.edit) {
    btn.style.display = '';
  } else {
    btn.style.display = 'none';
  }
}
```

Also hide the "Assign Bay" button on awaiting cards for non-managers.

---

## Step 10 — CSS

Include all styles inline in a `<style>` block. Key styling:

```css
.loading-dashboard { padding: 16px; max-width: 100%; }
.ld-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.ld-toolbar h2 { margin: 0; font-size: 20px; }
.ld-view-btn { padding: 6px 14px; font-size: 12px; font-weight: 600; border: none; background: #fff; color: #6b7280; cursor: pointer; }
.ld-view-btn.active { background: #1e293b; color: #fff; }
.ld-section { margin-bottom: 20px; }
.ld-section-title { font-size: 14px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
.ld-bays-scroll { overflow-x: auto; margin-bottom: 20px; padding-bottom: 8px; }
.ld-bays-grid { display: flex; gap: 12px; min-width: max-content; }
.ld-bay-col { width: 220px; min-width: 220px; background: #f9fafb; border-radius: 12px; border: 1px solid #e5e7eb; }
.ld-bay-header { padding: 10px; border-bottom: 1px solid #e5e7eb; text-align: center; }
.ld-bay-number { font-weight: 700; font-size: 14px; margin-bottom: 6px; }
.ld-trailer-input { width: 100%; padding: 6px 8px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 12px; text-align: center; }
.ld-bay-body { padding: 8px; min-height: 150px; }
.ld-card { padding: 10px; border-radius: 8px; margin-bottom: 8px; cursor: default; }
.ld-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.ld-card-header strong { font-size: 13px; }
.ld-status-badge { font-size: 10px; font-weight: 700; text-transform: uppercase; }
.ld-card-meta { font-size: 11px; color: #6b7280; display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.ld-card-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.ld-btn-advance { padding: 4px 10px; border: none; background: #1e293b; color: #fff; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; }
.ld-btn-assign { padding: 4px 10px; border: 1px solid #3b82f6; background: #eff6ff; color: #1e40af; border-radius: 6px; font-size: 11px; font-weight: 600; cursor: pointer; }
.ld-btn-archive { padding: 4px 10px; border: 1px solid #d1d5db; background: #fff; color: #6b7280; border-radius: 6px; font-size: 11px; cursor: pointer; }
.ld-btn-pull { padding: 8px 16px; background: #1e293b; color: #fff; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; }
.ld-empty, .ld-empty-bay { color: #9ca3af; font-size: 12px; text-align: center; padding: 16px; }
.ld-queue { display: flex; flex-wrap: wrap; gap: 8px; }
.ld-transit-grid { display: flex; flex-wrap: wrap; gap: 8px; }

/* Bay view (mobile) */
.ld-bay-single { max-width: 500px; margin: 0 auto; }
.ld-bay-single-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.ld-bay-single-header h3 { margin: 0; }
.ld-bay-group { margin-bottom: 16px; }
.ld-bay-group-title { font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }

/* Pull job modal */
.ld-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 10000; display: flex; align-items: center; justify-content: center; }
.ld-modal-card { background: #fff; border-radius: 12px; width: 90%; max-width: 480px; max-height: 80vh; overflow-y: auto; }
.ld-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid #e5e7eb; }
.ld-modal-header h3 { margin: 0; font-size: 16px; }
.ld-modal-close { background: none; border: none; font-size: 18px; cursor: pointer; color: #6b7280; }
.ld-modal-body { padding: 16px; }
.ld-modal-body label { display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px; }
.ld-modal-body input, .ld-modal-body select { width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 8px; font-size: 14px; margin-bottom: 12px; }
.ld-modal-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 16px; border-top: 1px solid #e5e7eb; }
.ld-btn-cancel { padding: 8px 16px; border: 1px solid #d1d5db; background: #fff; border-radius: 8px; cursor: pointer; font-weight: 600; }
.ld-btn-confirm { padding: 8px 16px; background: #1e293b; color: #fff; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
.ld-job-results { max-height: 250px; overflow-y: auto; }
.ld-job-result { padding: 10px; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 6px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
.ld-job-result:hover { background: #f3f4f6; }
.ld-job-result.selected { background: #eff6ff; border-color: #3b82f6; }

@media (max-width: 768px) {
  .ld-bays-grid { flex-direction: column; min-width: unset; }
  .ld-bay-col { width: 100%; min-width: unset; }
}
```

---

## Step 11 — Navigation links

### 11a. Homepage Logistics card

In `index.html`, update the Logistics card actions to add a Loading Dashboard button:

```html
<div class="actions">
  <a class="btn btn-logistics" href="/logistics/">Open Logistics</a>
  <a class="btn btn-logistics" href="/logistics/loading.html">Loading Dashboard</a>
</div>
```

### 11b. Logistics header nav

In `logistics/logistics-header.js`, add a nav link for Loading Dashboard alongside existing links (Dashboard, BOL Generator, Load Builder).

---

## Step 12 — Auto-refresh

The loading dashboard should refresh data periodically since it's a live operational view:

```javascript
// Refresh every 30 seconds
setInterval(loadDashboard, 30000);

// Initial load
loadDashboard();
```

---

## What NOT to touch

- Do NOT modify `_worker.js` (API was built in Prompt 38)
- Do NOT modify the job board
- Do NOT modify the BOL generator or load builder
- Do NOT modify any other pages except `index.html` (homepage card) and `logistics-header.js` (nav link)

---

## Completion checklist

- [ ] `logistics/loading.html` created with full loading dashboard UI
- [ ] Overview mode shows: awaiting queue, 11 bay columns (20-30), in-transit, delivered sections
- [ ] Bay view mode shows single bay with status groups, selected via dropdown
- [ ] Default view: overview on desktop (>768px), bay on mobile (<768px)
- [ ] View toggle switches between overview and bay view
- [ ] Bay columns show trailer number input, assignment cards with status colors
- [ ] "Pull Job" button opens modal (manager-only, hidden for non-managers)
- [ ] Pull Job modal: search jobs, select, assign to bay or awaiting queue
- [ ] Status advance buttons on each card (Start Loading, Mark Loaded, etc.)
- [ ] Archive button on delivered cards with toast confirmation
- [ ] Bay trailer number updates via PUT on change
- [ ] Auto-refresh every 30 seconds
- [ ] Homepage Logistics card updated with Loading Dashboard link
- [ ] Logistics header nav includes Loading Dashboard link
- [ ] Mobile responsive: bay columns stack vertically, bay view is default

**Notify Steve:** No migration needed (Prompt 38 handled it). Navigate to the Loading Dashboard, verify bays 20-30 appear, try pulling a job.
