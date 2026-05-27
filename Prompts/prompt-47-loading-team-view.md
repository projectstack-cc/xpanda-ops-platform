# Prompt 47 — Loading Team View + Mobile Performance Fixes

## Goal

Two changes to `logistics/loading.html`:

1. **Loading Team View** — Rename "Bay View" to "Loading Team View". For non-manager users (those without `logistics.loading.manage` edit permission), this is the ONLY view they see — no toggle buttons, no Overview. The Loading Team View starts as a **bay list** (showing each bay with its job info) and tapping a bay navigates into the existing single-bay detail view.

2. **Quick mobile performance** — Reduce time-to-first-render on mobile devices by eliminating artificial delays and showing content faster.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Context

`logistics/loading.html` currently has two views toggled by buttons: "Overview" (multi-bay grid with awaiting/transit/delivered sections) and "Bay View" (single-bay detail with status groups). The view toggle buttons are in the toolbar. On mobile (<768px), Bay View is auto-selected on load.

Permission keys:
- `logistics.loading` — base access to the loading dashboard (view/edit)
- `logistics.loading.manage` — manager-level access (pull jobs, assign bays, etc.)

The `window.__xpandaUser` object is set by the shared header JS after `/api/auth/me` resolves.

---

## Part 1 — Loading Team View

### 1a. Rename "Bay View" to "Loading Team View"

In the HTML toolbar section, change the button text:

```html
<!-- BEFORE -->
<button id="view-bay" class="ld-view-btn" onclick="setLdView('bay')">Bay View</button>

<!-- AFTER -->
<button id="view-bay" class="ld-view-btn" onclick="setLdView('bay')">Loading Team View</button>
```

### 1b. Add a "bay list" as the entry point for Loading Team View

Currently, when you switch to bay view, it immediately shows a single bay's detail (with the bay selector dropdown). Change this so the Loading Team View first shows a **list of all bays**, and tapping a bay navigates into the single-bay detail.

Add a new container in the HTML, right after the existing `#ld-bay-view` div:

```html
<!-- Bay list (entry point for Loading Team View) -->
<div id="ld-bay-list" style="display:none;">
  <div id="ld-bay-list-content"></div>
</div>
```

#### Bay list rendering

Add a new function `renderBayList()`:

```javascript
function renderBayList() {
  const container = document.getElementById('ld-bay-list-content');
  if (!allBays.length) {
    container.innerHTML = '<div class="ld-empty" style="padding:32px;">No bays configured</div>';
    return;
  }

  const html = allBays.map(bay => {
    const bayAssignments = allAssignments.filter(a =>
      a.bay_id === bay.id && ['not_started', 'loading', 'loaded'].includes(a.loading_status)
    );
    const jobCount = bayAssignments.length;
    const activeJob = bayAssignments.find(a => a.loading_status === 'loading') || bayAssignments[0];

    return `
      <div class="ld-bay-list-item" onclick="drillIntoBay('${bay.id}')" style="
        display:flex; align-items:center; justify-content:space-between;
        padding:16px; margin-bottom:8px; background:#fff;
        border:1px solid #e5e7eb; border-radius:12px;
        cursor:pointer; transition:background 0.15s;
      " onmouseenter="this.style.background='#f9fafb'" onmouseleave="this.style.background='#fff'">
        <div>
          <div style="font-weight:700;font-size:18px;color:#111827;">Bay ${bay.bay_number}</div>
          ${bay.trailer_number ? `<div style="font-size:13px;color:#6b7280;margin-top:2px;">Trailer: ${esc(bay.trailer_number)}</div>` : ''}
          ${activeJob
            ? `<div style="font-size:13px;color:#374151;margin-top:4px;">
                ${esc(activeJob.customer || 'Unknown')}${activeJob.invoice_number ? ' — INV# ' + esc(activeJob.invoice_number) : ''}
              </div>`
            : `<div style="font-size:13px;color:#9ca3af;margin-top:4px;">No active jobs</div>`
          }
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          ${jobCount > 0
            ? `<span style="background:#dbeafe;color:#1e40af;font-size:12px;font-weight:700;padding:4px 10px;border-radius:20px;">${jobCount} job${jobCount > 1 ? 's' : ''}</span>`
            : ''
          }
          <span style="color:#9ca3af;font-size:18px;">›</span>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = html;
}
```

#### Drill-in and back navigation

```javascript
function drillIntoBay(bayId) {
  selectedBayId = bayId;
  document.getElementById('ld-bay-list').style.display = 'none';
  document.getElementById('ld-bay-view').style.display = '';
  document.getElementById('bay-selector').style.display = '';
  renderBayView();
}
```

Modify `renderBayView()` — add a "← Back" button at the top of the single-bay detail:

Find the line in `renderBayView()` that builds the `html` string starting with `<div class="ld-bay-single">`. Prepend a back button:

```javascript
const html = `
  <div class="ld-bay-single">
    <button onclick="backToBayList()" style="
      background:none;border:none;color:#3b82f6;font-size:14px;font-weight:600;
      cursor:pointer;padding:0;margin-bottom:12px;display:flex;align-items:center;gap:4px;
    ">← All Bays</button>
    <div class="ld-bay-single-header">
      ...existing header content...
    </div>
    ...existing groups content...
  </div>
`;
```

Do NOT replace the existing header/groups content — just prepend the back button before the `ld-bay-single-header` div.

```javascript
function backToBayList() {
  document.getElementById('ld-bay-view').style.display = 'none';
  document.getElementById('bay-selector').style.display = 'none';
  document.getElementById('ld-bay-list').style.display = '';
  renderBayList();
}
```

### 1c. Update `setLdView()` for the new bay list flow

When switching to Loading Team View, show the bay list first (not the single-bay detail):

```javascript
function setLdView(view) {
  currentLdView = view;
  document.getElementById('view-overview').classList.toggle('active', view === 'overview');
  document.getElementById('view-bay').classList.toggle('active', view === 'bay');

  document.getElementById('ld-overview').style.display = view === 'overview' ? '' : 'none';

  if (view === 'bay') {
    // Show bay list as entry point
    document.getElementById('ld-bay-list').style.display = '';
    document.getElementById('ld-bay-view').style.display = 'none';
    document.getElementById('bay-selector').style.display = 'none';
    renderBayList();
  } else {
    document.getElementById('ld-bay-list').style.display = 'none';
    document.getElementById('ld-bay-view').style.display = 'none';
    document.getElementById('bay-selector').style.display = 'none';
  }
}
```

### 1d. Update `renderDashboard()` to handle bay list

```javascript
function renderDashboard() {
  if (currentLdView === 'overview') {
    renderOverview();
  } else {
    // If we're drilled into a bay, render bay view; otherwise render bay list
    if (document.getElementById('ld-bay-view').style.display !== 'none') {
      renderBayView();
    } else {
      renderBayList();
    }
  }
  updatePullButtonVisibility();
}
```

### 1e. Permission-based view locking

After auth resolves and before the first render, check if the user is a manager or not. Non-managers get locked to Loading Team View only.

Replace the `DOMContentLoaded` handler at the bottom of the file:

```javascript
window.addEventListener('DOMContentLoaded', () => {
  // Wait for auth to settle, then initialize
  function initWhenReady() {
    const user = window.__xpandaUser;

    // If auth hasn't resolved yet, poll
    if (user === undefined) {
      setTimeout(initWhenReady, 50);
      return;
    }

    const isManager = user && (user.isAdministrator || user.permissions?.['logistics.loading.manage']?.edit);

    if (!isManager) {
      // Non-managers: lock to Loading Team View only
      // Hide the view toggle buttons entirely
      document.querySelector('.ld-view-toggle').style.display = 'none';
      // Force Loading Team View
      currentLdView = 'bay';
      document.getElementById('ld-overview').style.display = 'none';
      document.getElementById('ld-bay-list').style.display = '';
      document.getElementById('ld-bay-view').style.display = 'none';
      document.getElementById('bay-selector').style.display = 'none';
    } else {
      // Managers: default to overview on desktop, team view on mobile
      if (window.innerWidth < 768) {
        currentLdView = 'bay';
        document.getElementById('view-overview').classList.remove('active');
        document.getElementById('view-bay').classList.add('active');
        document.getElementById('ld-overview').style.display = 'none';
        document.getElementById('ld-bay-list').style.display = '';
        document.getElementById('bay-selector').style.display = 'none';
      }
    }

    loadDashboard();
    updatePullButtonVisibility();
  }

  initWhenReady();

  // Auto-refresh every 30 seconds
  setInterval(loadDashboard, 30000);
});
```

This replaces the old `DOMContentLoaded` handler entirely (including the `setTimeout(() => { ... }, 200)` call).

### 1f. Hide management actions for non-managers in the bay detail view

The existing `renderAssignmentCard` already checks `isManager` for some buttons. Verify it also hides:
- The "Assign Bay" button (already gated by `isManager`)
- The trailer number input in bay headers — non-managers should see the trailer number as **read-only text**, not an editable input

In `renderBayView()`, find the trailer number input and make it conditional:

```javascript
${isManager
  ? `<input class="ld-trailer-input" type="text" placeholder="Trailer #" value="${escAttr(bay.trailer_number || '')}"
      onchange="updateBayTrailer('${bay.id}', this.value)" style="max-width:140px;" />`
  : bay.trailer_number
    ? `<span style="font-size:13px;color:#6b7280;">Trailer: ${esc(bay.trailer_number)}</span>`
    : ''
}
```

Where `isManager` is determined at the top of `renderBayView`:
```javascript
const user = window.__xpandaUser;
const isManager = user && (user.isAdministrator || user.permissions?.['logistics.loading.manage']?.edit);
```

Do the same for the bay list rendering in `renderBayList()` — trailer input should not appear (it's already just display text, so this is fine as-is).

Also do the same in `renderOverview()` for the trailer input in bay column headers — wrap it in the same `isManager` conditional, showing read-only text for non-managers.

---

## Part 2 — Quick Mobile Performance Fixes

These are targeted changes to reduce time-to-first-render. No architectural refactor.

### 2a. Remove the 200ms artificial delay

The old `DOMContentLoaded` handler had `setTimeout(() => { loadDashboard(); }, 200)`. This is already removed by the new handler in Step 1e above — `initWhenReady()` polls for auth at 50ms intervals instead of waiting a flat 200ms.

### 2b. Show a loading skeleton immediately

Add a lightweight loading state that's visible in the HTML before any JS runs. This gives users instant visual feedback.

In the HTML, inside `#ld-bay-list-content`, add a default skeleton:

```html
<div id="ld-bay-list-content">
  <!-- Skeleton shown before JS loads -->
  <div class="ld-skeleton" style="padding:12px;">
    <div style="height:72px;background:#f3f4f6;border-radius:12px;margin-bottom:8px;animation:pulse 1.5s infinite;"></div>
    <div style="height:72px;background:#f3f4f6;border-radius:12px;margin-bottom:8px;animation:pulse 1.5s infinite;"></div>
    <div style="height:72px;background:#f3f4f6;border-radius:12px;margin-bottom:8px;animation:pulse 1.5s infinite;"></div>
  </div>
</div>
```

Add the pulse animation to the `<style>` block:

```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

The skeleton will be replaced by real content when `renderBayList()` sets `container.innerHTML`.

### 2c. Reduce auto-refresh interval for mobile

Change the auto-refresh from 30 seconds to 15 seconds. Loading team operators need fresher data since they're actively working bays:

```javascript
setInterval(loadDashboard, 15000);
```

---

## What NOT to touch

- Do NOT modify `_worker.js` — no API changes, no permission map changes, no route changes
- Do NOT modify `bol-shared.js`
- Do NOT modify the auto-pack algorithm in load-builder.html
- Do NOT modify any other page besides `logistics/loading.html`
- Do NOT modify any admin pages
- Do NOT remove or rename the Overview mode — managers still need it
- Do NOT change the loading assignment status flow (awaiting → not_started → loading → loaded → in_transit → delivered)
- Do NOT change how drag-and-drop works in the existing bay detail view

---

## Completion checklist

- [ ] "Bay View" button text changed to "Loading Team View"
- [ ] Loading Team View starts with a bay list (bay number, trailer info, active job)
- [ ] Tapping a bay in the list drills into the existing single-bay detail view
- [ ] "← All Bays" back button at top of single-bay detail returns to bay list
- [ ] Non-manager users see ONLY the Loading Team View — no toggle buttons, no Overview access
- [ ] Trailer number inputs are read-only for non-managers (in bay detail AND in overview)
- [ ] `setLdView('bay')` shows bay list first, not single-bay detail
- [ ] `renderDashboard()` correctly handles bay list vs drilled-in bay view
- [ ] 200ms artificial delay removed — auth polling at 50ms intervals instead
- [ ] Loading skeleton shown immediately before data loads
- [ ] Auto-refresh set to 15 seconds
- [ ] Overview mode still works exactly as before for managers
- [ ] Pull Job button still hidden for non-managers
- [ ] Assign Bay button still hidden for non-managers in bay detail

**Notify Steve:** No migration needed. No worker changes. Test:
1. Log in as admin → see both Overview and Loading Team View toggle → Loading Team View shows bay list → tap a bay → drill in → "← All Bays" takes you back
2. Log in as a role that has `logistics.loading: view` but NOT `logistics.loading.manage: edit` → should see ONLY the bay list, no toggle buttons, no trailer inputs, no pull/assign buttons
3. On mobile → should see skeleton briefly, then bay list renders → no 200ms blank gap
4. Auto-refresh should tick every 15 seconds (check network tab)
