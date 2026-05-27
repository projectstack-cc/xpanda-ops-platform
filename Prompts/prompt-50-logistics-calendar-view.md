# Prompt 50 — Logistics Dashboard Calendar View

## Goal

Add a month calendar view to the logistics dashboard, matching the same visual pattern used in the Job Board calendar. The calendar displays shipments as color-coded pills on their ship dates. Users can toggle between the existing list/table view and the new calendar view within each tab (Outbound and Inbound).

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Context

The Job Board (`jobs/index.html`) already has a calendar view with:
- Month grid with day cells
- Color-coded pills per job (by status), showing customer name
- Click a pill → open the job modal
- "+N more" overflow when a day has many items
- ← / → month navigation + "Today" button
- Responsive: smaller cells/text on mobile

The logistics dashboard (`logistics/index.html`) currently shows shipments in a table grouped by ship date (outbound) or a flat table (inbound). This prompt adds a calendar view alongside the existing table view using a toggle within each tab. The calendar uses the same CSS class names and visual structure as the job board, so they feel like the same platform.

**Status colors for shipment pills** (matching the loading dashboard and Prompt 49):

| Status | Background | Text | Border |
|---|---|---|---|
| `awaiting` | #f3f4f6 | #374151 | #9ca3af |
| `not_started` | #fef3c7 | #92400e | #f59e0b |
| `loading` | #dbeafe | #1e40af | #3b82f6 |
| `loaded` | #d1fae5 | #065f46 | #10b981 |
| `in_transit` | #e0e7ff | #3730a3 | #6366f1 |
| `delivered` | #f0fdf4 | #166534 | #22c55e |
| `cancelled` | #f3f4f6 | #9ca3af | #d1d5db |
| `scheduled` | #f1f5f9 | #475569 | #94a3b8 |

---

## Step 1 — Add calendar CSS to logistics-shared.css

Add these rules to `logistics/logistics-shared.css`. These are the same class names used in the job board so the visual language is consistent across the platform:

```css
/* ── Calendar View ── */
.cal-header-row { display: grid; grid-template-columns: repeat(7, 1fr); border-bottom: 2px solid #e5e7eb; }
.cal-header-cell { padding: 8px 4px; text-align: center; font-size: 12px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; }
.cal-body { border-left: 1px solid #e5e7eb; border-top: 1px solid #e5e7eb; }
.cal-row { display: grid; grid-template-columns: repeat(7, 1fr); }
.cal-cell { min-height: 110px; border-right: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; padding: 4px; background: #fff; overflow: hidden; }
.cal-cell-empty { background: #fafafa; min-height: 110px; border-right: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; }
.cal-today { background: #eff6ff !important; }
.cal-weekend { background: #fafafa; }
.cal-day-num { font-size: 13px; font-weight: 600; color: #6b7280; margin-bottom: 4px; padding: 2px 4px; }
.cal-day-today { color: #fff; background: #1e293b; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 12px; }
.cal-pill { padding: 3px 6px; margin-bottom: 2px; border-radius: 4px; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity 0.15s; }
.cal-pill:hover { opacity: 0.8; }
.cal-more { padding: 2px 6px; font-size: 10px; font-weight: 600; color: #6b7280; cursor: pointer; }
.cal-more:hover { color: #1e40af; text-decoration: underline; }

/* Calendar view toggle */
.logistics-view-toggle { display: flex; border: 1px solid #d1d5db; border-radius: 8px; overflow: hidden; }
.logistics-view-btn { padding: 5px 12px; font-size: 12px; font-weight: 600; border: none; background: #fff; color: #6b7280; cursor: pointer; }
.logistics-view-btn.active { background: #1e293b; color: #fff; }

@media (max-width: 768px) {
  .cal-cell { min-height: 70px; padding: 2px; }
  .cal-header-cell { font-size: 10px; padding: 6px 2px; }
  .cal-day-num { font-size: 11px; }
  .cal-pill { font-size: 9px; padding: 2px 4px; }
  .cal-day-today { width: 20px; height: 20px; font-size: 10px; }
}
@media (max-width: 480px) {
  .cal-cell { min-height: 50px; }
  .cal-pill { font-size: 8px; padding: 1px 3px; border-left-width: 2px; }
  .cal-header-cell { font-size: 9px; }
}
```

---

## Step 2 — Add view toggle and calendar container to the outbound tab

In `logistics/index.html`, inside the outbound tab (`#tab-outbound`), add a view toggle in the toolbar area and a calendar container.

### 2a. View toggle

Add a view toggle to the outbound toolbar. Place it at the start of the toolbar, before the existing buttons:

```html
<div class="logistics-toolbar">
  <div class="logistics-view-toggle">
    <button class="logistics-view-btn active" id="outbound-view-list" onclick="setOutboundView('list')">List</button>
    <button class="logistics-view-btn" id="outbound-view-calendar" onclick="setOutboundView('calendar')">Calendar</button>
  </div>
  <!-- existing buttons follow: + New Shipment, Ship from Job…, etc. -->
```

### 2b. Calendar container

Add a calendar container right after `#outbound-content`, inside `#tab-outbound`:

```html
<div id="outbound-content">
  <div style="color:#94a3b8;font-size:14px;padding:20px 0;">Loading…</div>
</div>

<!-- Outbound calendar view -->
<div id="outbound-calendar" style="display:none;">
  <div style="display:flex;align-items:center;justify-content:center;gap:16px;padding:12px 0;">
    <button onclick="changeShipCalMonth('outbound', -1)" style="background:none;border:1px solid #d1d5db;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:16px;">←</button>
    <h3 id="outbound-cal-label" style="margin:0;font-size:18px;font-weight:700;min-width:180px;text-align:center;"></h3>
    <button onclick="changeShipCalMonth('outbound', 1)" style="background:none;border:1px solid #d1d5db;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:16px;">→</button>
    <button onclick="goToShipCalToday('outbound')" style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;">Today</button>
  </div>
  <div id="outbound-cal-grid"></div>
</div>
```

---

## Step 3 — Add view toggle and calendar container to the inbound tab

Same pattern inside `#tab-inbound`:

### 3a. View toggle

```html
<div class="logistics-toolbar">
  <div class="logistics-view-toggle">
    <button class="logistics-view-btn active" id="inbound-view-list" onclick="setInboundView('list')">List</button>
    <button class="logistics-view-btn" id="inbound-view-calendar" onclick="setInboundView('calendar')">Calendar</button>
  </div>
  <!-- existing buttons follow: + New Delivery, filters, etc. -->
```

### 3b. Calendar container

After `#inbound-content`:

```html
<div id="inbound-content">
  <div style="color:#94a3b8;font-size:14px;padding:20px 0;">Loading…</div>
</div>

<!-- Inbound calendar view -->
<div id="inbound-calendar" style="display:none;">
  <div style="display:flex;align-items:center;justify-content:center;gap:16px;padding:12px 0;">
    <button onclick="changeShipCalMonth('inbound', -1)" style="background:none;border:1px solid #d1d5db;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:16px;">←</button>
    <h3 id="inbound-cal-label" style="margin:0;font-size:18px;font-weight:700;min-width:180px;text-align:center;"></h3>
    <button onclick="changeShipCalMonth('inbound', 1)" style="background:none;border:1px solid #d1d5db;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:16px;">→</button>
    <button onclick="goToShipCalToday('inbound')" style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;font-weight:600;">Today</button>
  </div>
  <div id="inbound-cal-grid"></div>
</div>
```

---

## Step 4 — JavaScript: view toggle functions and calendar rendering

Add the following JavaScript to the `<script>` block in `logistics/index.html`.

### 4a. State variables

Add near the top of the script, alongside other state variables:

```javascript
let outboundCalView = 'list';
let inboundCalView  = 'list';
let outboundCalMonth = new Date();
let inboundCalMonth  = new Date();

const SHIPMENT_STATUS_COLORS = {
  awaiting:    { bg: '#f3f4f6', text: '#374151', border: '#9ca3af' },
  not_started: { bg: '#fef3c7', text: '#92400e', border: '#f59e0b' },
  loading:     { bg: '#dbeafe', text: '#1e40af', border: '#3b82f6' },
  loaded:      { bg: '#d1fae5', text: '#065f46', border: '#10b981' },
  in_transit:  { bg: '#e0e7ff', text: '#3730a3', border: '#6366f1' },
  delivered:   { bg: '#f0fdf4', text: '#166534', border: '#22c55e' },
  cancelled:   { bg: '#f3f4f6', text: '#9ca3af', border: '#d1d5db' },
  scheduled:   { bg: '#f1f5f9', text: '#475569', border: '#94a3b8' },
};
```

### 4b. View toggle functions

```javascript
function setOutboundView(view) {
  outboundCalView = view;
  document.getElementById('outbound-view-list').classList.toggle('active', view === 'list');
  document.getElementById('outbound-view-calendar').classList.toggle('active', view === 'calendar');
  document.getElementById('outbound-content').style.display = view === 'list' ? '' : 'none';
  document.getElementById('outbound-calendar').style.display = view === 'calendar' ? '' : 'none';

  // Hide the week filter and status filter when in calendar view (calendar shows all)
  const filterRow = document.querySelector('#tab-outbound .logistics-toolbar-right');
  if (filterRow) filterRow.style.display = view === 'list' ? '' : 'none';

  if (view === 'calendar') renderShipmentCalendar('outbound');
}

function setInboundView(view) {
  inboundCalView = view;
  document.getElementById('inbound-view-list').classList.toggle('active', view === 'list');
  document.getElementById('inbound-view-calendar').classList.toggle('active', view === 'calendar');
  document.getElementById('inbound-content').style.display = view === 'list' ? '' : 'none';
  document.getElementById('inbound-calendar').style.display = view === 'calendar' ? '' : 'none';

  const filterRow = document.querySelector('#tab-inbound .logistics-toolbar-right');
  if (filterRow) filterRow.style.display = view === 'list' ? '' : 'none';

  if (view === 'calendar') renderShipmentCalendar('inbound');
}
```

### 4c. Month navigation

```javascript
function changeShipCalMonth(direction, delta) {
  if (direction === 'outbound') {
    outboundCalMonth = new Date(outboundCalMonth.getFullYear(), outboundCalMonth.getMonth() + delta, 1);
    renderShipmentCalendar('outbound');
  } else {
    inboundCalMonth = new Date(inboundCalMonth.getFullYear(), inboundCalMonth.getMonth() + delta, 1);
    renderShipmentCalendar('inbound');
  }
}

function goToShipCalToday(direction) {
  if (direction === 'outbound') {
    outboundCalMonth = new Date();
    renderShipmentCalendar('outbound');
  } else {
    inboundCalMonth = new Date();
    renderShipmentCalendar('inbound');
  }
}
```

### 4d. Calendar rendering function

This is the core function, adapted from the job board's `renderCalendar`:

```javascript
function renderShipmentCalendar(direction) {
  const isOutbound = direction === 'outbound';
  const data       = isOutbound ? outboundData : inboundData;
  const calMonth   = isOutbound ? outboundCalMonth : inboundCalMonth;
  const gridEl     = document.getElementById(isOutbound ? 'outbound-cal-grid' : 'inbound-cal-grid');
  const labelEl    = document.getElementById(isOutbound ? 'outbound-cal-label' : 'inbound-cal-label');
  if (!gridEl || !labelEl) return;

  const year  = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  labelEl.textContent = `${monthNames[month]} ${year}`;

  const firstDay  = new Date(year, month, 1);
  const lastDay   = new Date(year, month + 1, 0);
  const startDow  = firstDay.getDay();
  const totalDays = lastDay.getDate();

  // Group shipments by ship_date
  const shipByDate = {};
  data.forEach(s => {
    if (!s.ship_date) return;
    const d = s.ship_date;
    if (!shipByDate[d]) shipByDate[d] = [];
    shipByDate[d].push(s);
  });

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  let html = '<div class="cal-header-row">';
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(d => { html += `<div class="cal-header-cell">${d}</div>`; });
  html += '</div><div class="cal-body">';

  const totalCells = Math.ceil((startDow + totalDays) / 7) * 7;
  let dayNum = 1;

  for (let i = 0; i < totalCells; i++) {
    if (i % 7 === 0) html += '<div class="cal-row">';
    if (i < startDow || dayNum > totalDays) {
      html += '<div class="cal-cell cal-cell-empty"></div>';
    } else {
      const dateStr   = `${year}-${String(month+1).padStart(2,'0')}-${String(dayNum).padStart(2,'0')}`;
      const isToday   = dateStr === todayStr;
      const isWeekend = (i % 7 === 0 || i % 7 === 6);
      const dayShipments = shipByDate[dateStr] || [];
      const maxVisible = 4;

      html += `<div class="cal-cell${isToday ? ' cal-today' : ''}${isWeekend ? ' cal-weekend' : ''}">`;
      html += `<div class="cal-day-num${isToday ? ' cal-day-today' : ''}">${dayNum}</div>`;

      dayShipments.slice(0, maxVisible).forEach(s => {
        const sc = SHIPMENT_STATUS_COLORS[s.status] || SHIPMENT_STATUS_COLORS.awaiting;
        const displayName = esc(s.customer || 'Unknown');
        const titleText = `${displayName} — ${(s.status || '').replace(/_/g, ' ')}`;
        html += `<div class="cal-pill" style="background:${sc.bg};color:${sc.text};border-left:3px solid ${sc.border};" onclick="openEdit('${s.id}')" title="${esc(titleText)}">`;
        html += `${displayName}</div>`;
      });

      if (dayShipments.length > maxVisible) {
        html += `<div class="cal-more" onclick="showCalDay('${direction}','${dateStr}')">+${dayShipments.length - maxVisible} more</div>`;
      }

      html += '</div>';
      dayNum++;
    }
    if (i % 7 === 6) html += '</div>';
  }
  html += '</div>';
  gridEl.innerHTML = html;
}
```

### 4e. "+N more" click handler

When the user clicks "+N more" on a day with many shipments, switch to the list view filtered to that week:

```javascript
function showCalDay(direction, dateStr) {
  if (direction === 'outbound') {
    // Switch to list view and filter to the week containing this date
    const d = new Date(dateStr + 'T12:00:00');
    // Find the Monday of that week
    const dayOfWeek = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((dayOfWeek + 6) % 7));
    // Format as ISO week input value (YYYY-Wnn)
    const weekInput = document.getElementById('outbound-week-input');
    if (weekInput) {
      // Set the week input to the correct week
      const year = monday.getFullYear();
      const jan1 = new Date(year, 0, 1);
      const days = Math.floor((monday - jan1) / 86400000);
      const weekNum = Math.ceil((days + jan1.getDay() + 1) / 7);
      weekInput.value = `${year}-W${String(weekNum).padStart(2, '0')}`;
    }
    setOutboundView('list');
    loadOutbound();
  } else {
    // For inbound, just switch to list view (no week filter on inbound)
    setInboundView('list');
  }
}
```

### 4f. Re-render calendar when data loads

In the existing `renderOutbound()` function, at the very end (after `updateStats()`), add:

```javascript
if (outboundCalView === 'calendar') renderShipmentCalendar('outbound');
```

In the existing `renderInbound()` function, at the very end (after `updateStats()`), add:

```javascript
if (inboundCalView === 'calendar') renderShipmentCalendar('inbound');
```

### 4g. Load all shipments when in calendar view

The calendar needs to show a full month of data, not just the filtered week. When switching to calendar view, the data should include all shipments for that month.

Currently, `loadOutbound()` filters by week if the week input has a value. When the calendar is active, the week filter is hidden, but we need to make sure `loadOutbound()` loads broadly when in calendar view.

Find the `loadOutbound()` function. Add a check: if in calendar view, clear the week filter before fetching so all data loads:

```javascript
async function loadOutbound() {
  // If in calendar view, don't filter by week
  const weekVal = outboundCalView === 'calendar' ? '' : (document.getElementById('outbound-week-input').value || '');
  // ... rest of function uses weekVal instead of reading the input directly
```

If the function currently reads the week input value directly in the fetch URL construction, change it to use this `weekVal` variable instead.

Similarly, for `loadInbound()`, ensure it loads enough data for the calendar. The existing days filter (7/30/90 days) should be bypassed when in calendar view — load all shipments so the calendar can show any month:

```javascript
async function loadInbound() {
  // If in calendar view, load a wider range
  const daysVal = inboundCalView === 'calendar' ? '365' : (document.getElementById('inbound-days-filter').value || '30');
  // ... rest of function uses daysVal
```

---

## What NOT to touch

- Do NOT modify `_worker.js` — no API changes
- Do NOT modify the loading dashboard (`loading.html`)
- Do NOT modify `bol-shared.js`
- Do NOT modify the load builder
- Do NOT modify the homepage
- Do NOT modify admin pages
- Do NOT modify the job board's calendar (the CSS is now in the shared file, but the job board's inline styles will take precedence — no conflict)
- Do NOT change the existing list/table view rendering — it stays exactly as-is
- Do NOT change the shipment modal or form behavior
- Do NOT change how status filters work in list view

---

## Completion checklist

- [ ] Calendar CSS added to `logistics-shared.css` (same classes as job board)
- [ ] View toggle (List / Calendar) added to outbound toolbar
- [ ] View toggle (List / Calendar) added to inbound toolbar
- [ ] Outbound calendar container with month nav (← → Today) added
- [ ] Inbound calendar container with month nav (← → Today) added
- [ ] `renderShipmentCalendar()` renders month grid with shipment pills color-coded by status
- [ ] Clicking a pill opens the shipment edit modal (`openEdit`)
- [ ] "+N more" switches to list view (filtered to that week for outbound)
- [ ] Month navigation works (← → Today)
- [ ] Calendar re-renders when data loads
- [ ] Week/status filters hidden when calendar is active, shown when list is active
- [ ] Calendar view loads all data (not filtered by week or days range)
- [ ] Responsive: smaller cells, text, and pills on mobile
- [ ] Status colors match loading dashboard exactly
- [ ] Legacy `scheduled` status still renders correctly as fallback
- [ ] No console errors

**Notify Steve:** No migration needed. No worker changes. Test:
1. Open logistics dashboard → outbound tab → click "Calendar" toggle → month grid appears with shipment pills
2. Click ← → to navigate months → Today button jumps to current month
3. Click a pill → shipment edit modal opens
4. Click "+N more" on a busy day → switches to list view filtered to that week
5. Click "List" toggle → back to table view with filters visible
6. Switch to inbound tab → same calendar toggle works
7. Test on mobile → calendar cells shrink, pill text gets smaller, still usable
8. Create a new shipment → refresh → appears on the correct day in calendar
