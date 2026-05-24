# Prompt 40 — Job Board Simplification

## Goal

Simplify the job board to three columns: Not Started, In Production, Done. Remove the "Loading" and "Shipped" columns — those statuses are now handled by the Loading Dashboard. Also widen the kanban cards for better readability.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

**Prerequisites:** Prompts 38-39 (Loading Dashboard) should be completed.

---

## Step 1 — Remove Loading and Shipped columns

### 1a. Remove HTML columns

In `jobs/index.html`, find and remove the Loading and Shipped column HTML (lines 130-145):

Remove:
```html
<div class="jobs-col">
  <div class="jobs-col-header">Loading <span class="jobs-col-count" id="count-loading">0</span></div>
  <div class="jobs-col-body" id="col-loading" data-status="loading"></div>
</div>
<div class="jobs-col">
  <div class="jobs-col-header">Shipped <span class="jobs-col-count" id="count-shipped">0</span></div>
  <div class="jobs-col-body" id="col-shipped" data-status="shipped"></div>
</div>
```

### 1b. Remove tab buttons

Find the tab buttons for Loading and Shipped (around lines 83-85):
```html
<button class="jobs-tab" data-status="loading">Loading</button>
<button class="jobs-tab" data-status="shipped">Shipped</button>
```
Remove them.

### 1c. Update STATUS_ORDER

Find line 416:
```javascript
const STATUS_ORDER = ['not_started', 'in_production', 'done', 'loading', 'shipped'];
```

Change to:
```javascript
const STATUS_ORDER = ['not_started', 'in_production', 'done'];
```

### 1d. Update renderBoard

The `renderBoard` function iterates over `STATUS_ORDER` and places cards in columns. With Loading/Shipped removed, jobs with those statuses should appear in the "Done" column (they may exist from before the migration to the Loading Dashboard).

In `renderBoard`, after filtering jobs by status, add a fallback:

```javascript
for (const job of jobs) {
  let targetStatus = job.status;
  // Jobs still in loading/shipped status from before the Loading Dashboard show in Done
  if (targetStatus === 'loading' || targetStatus === 'shipped') targetStatus = 'done';

  const col = document.getElementById('col-' + targetStatus);
  if (!col) continue;
  // ... rest of card rendering
}
```

### 1e. Update drag-and-drop status transitions

The `prevStatus` and `nextStatus` functions calculate adjacent statuses. With the reduced STATUS_ORDER, they'll automatically work correctly. But verify that dragging from Done doesn't try to go to Loading:

```javascript
function nextStatus(s) {
  const i = STATUS_ORDER.indexOf(s);
  return i >= 0 && i < STATUS_ORDER.length - 1 ? STATUS_ORDER[i + 1] : null;
}
```

With the 3-element array, Done has no next status — correct. But the "Build Load" and "Generate BOL" buttons on Done cards should still work. Verify they don't check for status being in a specific set.

### 1f. Filter out archived jobs

The archive feature (Prompt 33) set jobs to `status: 'archived'`. These should continue to be filtered out. The existing `WHERE status != 'archived'` filter on the API handles this.

---

## Step 2 — Widen kanban cards

### 2a. Update column widths

Find the CSS for `.jobs-col` (the kanban column). Currently columns are likely sized to fit 5 across. With only 3 columns, they can be wider:

```css
.jobs-col {
  flex: 1;
  min-width: 280px;
  max-width: 450px;
}
```

### 2b. Update card width

Find `.jobs-card` CSS. Make cards fill their column width:

```css
.jobs-card {
  width: 100%;
  padding: 14px;
}
```

### 2c. Update the board container

Find `.jobs-board` or the flex container for columns. Ensure it centers the 3 columns nicely:

```css
.jobs-board {
  display: flex;
  gap: 16px;
  justify-content: center;
  padding: 0 16px;
}
```

### 2d. Mobile: stack vertically

```css
@media (max-width: 768px) {
  .jobs-board {
    flex-direction: column;
  }
  .jobs-col {
    max-width: 100%;
  }
}
```

---

## Step 3 — Update the "Show All" fetch

The "Show All" button (or default load) currently fetches jobs with all statuses. Update it to only fetch the 3 active statuses plus any legacy loading/shipped:

This is already handled by the API — it returns all non-archived jobs. The `renderBoard` fallback in Step 1d handles legacy statuses.

---

## Step 4 — Remove Loading/Shipped status badges from CSS

Find any CSS rules specific to loading/shipped status styling on cards:

```css
.jobs-card[data-status="loading"] { ... }
.jobs-card[data-status="shipped"] { ... }
```

Remove these rules.

---

## What NOT to touch

- Do NOT modify the API (`_worker.js`) — the status column is still TEXT, legacy values are fine
- Do NOT modify the Loading Dashboard
- Do NOT modify the BOL generator or load builder
- Do NOT modify the calendar view (it reads from `allJobs` and handles all statuses)
- Do NOT modify the archive feature
- Do NOT modify the packing slip parser

---

## Completion checklist

- [ ] Loading and Shipped columns removed from kanban HTML
- [ ] Loading and Shipped tab buttons removed
- [ ] `STATUS_ORDER` reduced to `['not_started', 'in_production', 'done']`
- [ ] Legacy loading/shipped jobs render in the Done column
- [ ] Drag-and-drop works with 3 columns (no attempt to move to removed columns)
- [ ] Cards are wider to fill the 3-column layout
- [ ] Mobile responsive: columns stack vertically
- [ ] Loading/Shipped CSS rules removed
- [ ] Build Load and Generate BOL buttons still work on Done cards
- [ ] Archive still works on appropriate cards
- [ ] Calendar view unaffected

**Notify Steve:** No migration needed. The job board now shows 3 columns. Jobs that were in Loading/Shipped will appear in Done until they're handled via the Loading Dashboard.
