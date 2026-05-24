# Prompt 45 — Loading Dashboard Mobile-First Rework

**Context:** The loading dashboard is primarily used on cell phones. The current header is cramped on mobile (logo, "Loading" link, bell, username, Sign Out all fighting for space), the Overview shows no cards because pre-existing Done jobs never got loading assignments, and Bay View needs drag-and-drop between status groups for mobile workflow.

Reference `AGENTS.md` for platform conventions.

---

## Part A: Header cleanup for mobile

**File: `logistics/logistics-header.js`**

### A1: Remove the "Loading" link from the header bar

Delete this entire `<a>` element from the `header-user-bar` div (currently line 29):

```html
<a href="/logistics/loading.html" style="color:#1e293b;text-decoration:none;font-weight:600;font-size:11px;padding:4px 8px;background:#f1f5f9;border-radius:6px;">Loading</a>
```

The loading dashboard is already accessible from the nav. This link clutters the header on mobile.

### A2: Move username and Sign Out to the footer

**In the header `document.write()` block:**

Remove these two elements from the `header-user-bar` div:

```html
<span id="hdr-user-name"></span>
<a href="#" id="hdr-logout" style="color:#dc2626;text-decoration:none;font-weight:600;">Sign Out</a>
```

The `header-user-bar` div should only contain the notification bell after this change. Since only the bell remains, simplify the div — remove the flex/gap styling and just keep it positioned top-right.

Replace the `header-user-bar` div with:

```html
<div class="header-user-bar" style="position:absolute;top:14px;right:16px;">
  <span id="hdr-notif-bell" onclick="toggleNotifDropdown()" style="position:relative;cursor:pointer;font-size:18px;line-height:1;">🔔<span id="hdr-notif-badge" style="display:none;position:absolute;top:-4px;right:-6px;background:#dc2626;color:#fff;font-size:9px;font-weight:700;border-radius:50%;width:16px;height:16px;text-align:center;line-height:16px;"></span></span>
  <div id="hdr-notif-dropdown" style="display:none;position:absolute;top:36px;right:0;width:340px;max-height:420px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.12);overflow:hidden;z-index:9999;">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;border-bottom:1px solid #e5e7eb;">
      <span style="font-weight:700;font-size:14px;">Notifications</span>
      <button onclick="markAllRead()" style="background:none;border:none;color:#3b82f6;font-size:12px;font-weight:600;cursor:pointer;">Mark all read</button>
    </div>
    <div id="hdr-notif-list" style="overflow-y:auto;max-height:360px;"></div>
  </div>
</div>
```

**In the DOMContentLoaded block**, update the footer to include username and sign out. Change the footer creation code from:

```js
const footer = document.createElement("footer");
footer.className = "logistics-platform-footer";
footer.innerHTML = `<a href="/">← Back to Operations Platform</a>`;
document.body.appendChild(footer);
```

To:

```js
const footer = document.createElement("footer");
footer.className = "logistics-platform-footer";
footer.innerHTML = `
  <div id="footer-user-bar" style="margin-bottom:8px;font-size:12px;color:#6b7280;">
    <span id="hdr-user-name"></span>
    <span style="margin:0 4px;">•</span>
    <a href="#" id="hdr-logout" style="color:#dc2626;text-decoration:none;font-weight:600;font-size:12px;">Sign Out</a>
  </div>
  <a href="/">← Back to Operations Platform</a>
`;
document.body.appendChild(footer);
```

The existing DOMContentLoaded code already populates `#hdr-user-name` and attaches the logout click handler to `#hdr-logout` — since these IDs haven't changed, that code works as-is with no changes needed.

---

## Part B: Backfill loading assignments for existing Done jobs

**File: `_worker.js`**

Jobs that were already in "Done" (or "Loading" / "Shipped") status before Prompt 44 was deployed won't have loading assignments. Add a one-time backfill that runs on the GET `/api/loading-assignments` endpoint.

At the **top** of the GET handler in `handleApiLoadingAssignments()` (right after the `if (request.method === 'GET')` check, before the main query), add:

```js
// One-time backfill: create loading assignments for Done/Loading/Shipped jobs that don't have one
try {
  const orphanJobs = await db.prepare(`
    SELECT j.id FROM jobs j
    WHERE j.status IN ('done', 'loading', 'shipped')
    AND NOT EXISTS (SELECT 1 FROM loading_assignments la WHERE la.job_id = j.id)
  `).all();

  const orphans = orphanJobs.results || [];
  if (orphans.length > 0) {
    const now = new Date().toISOString();
    for (const oj of orphans) {
      const laId = crypto.randomUUID();
      await db.prepare(`
        INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, created_at, updated_at)
        VALUES (?, ?, NULL, '', 'awaiting', NULL, '', ?, ?)
      `).bind(laId, oj.id, now, now).run();
    }
  }
} catch (e) {
  console.error('Loading assignment backfill failed:', e);
}
```

This is safe to run on every GET because after the first run, the `NOT EXISTS` check will match zero rows and it becomes a no-op. It auto-corrects any future gaps too. The backfill only runs on the loading assignments GET, so it doesn't affect any other endpoint's performance.

---

## Part C: Bay View drag-and-drop between status groups

**File: `logistics/loading.html`**

### C1: Make Bay View cards draggable on mobile with touch events

The existing drag-and-drop only works on desktop (HTML5 drag API doesn't work on mobile touch). Since this dashboard is primarily used on phones, implement touch-based drag-and-drop for Bay View.

**Update `renderBayView()`** — make cards in Bay View draggable between status groups. Each status group div should be a drop target, and cards should be draggable to advance/revert status.

Replace the `renderBayView()` function with:

```js
function renderBayView() {
  const sel = document.getElementById('bay-selector');
  sel.innerHTML = allBays.map(b =>
    `<option value="${b.id}" ${b.id === selectedBayId ? 'selected' : ''}>Bay ${b.bay_number}${b.trailer_number ? ' — TR# ' + b.trailer_number : ''}</option>`
  ).join('');

  if (!selectedBayId) return;

  const bay = allBays.find(b => b.id === selectedBayId);
  if (!bay) return;
  const bayAssignments = allAssignments.filter(a => a.bay_id === selectedBayId);

  const groups = [
    { status: 'not_started', label: 'Not Started', assignments: bayAssignments.filter(a => a.loading_status === 'not_started') },
    { status: 'loading',     label: 'Loading',     assignments: bayAssignments.filter(a => a.loading_status === 'loading') },
    { status: 'loaded',      label: 'Loaded',      assignments: bayAssignments.filter(a => a.loading_status === 'loaded') },
  ];

  const html = `
    <div class="ld-bay-single">
      <div class="ld-bay-single-header">
        <h3>Bay ${bay.bay_number}</h3>
        <input class="ld-trailer-input" type="text" placeholder="Trailer #" value="${escAttr(bay.trailer_number || '')}"
          onchange="updateBayTrailer('${bay.id}', this.value)" style="max-width:140px;" />
      </div>
      ${groups.map(g => `
        <div class="ld-bay-group ld-drop-zone" data-target-status="${g.status}">
          <div class="ld-bay-group-title">${g.label} (${g.assignments.length})</div>
          ${g.assignments.length
            ? g.assignments.map(a => renderAssignmentCard(a, false, false)).join('')
            : `<div class="ld-empty-bay">No jobs ${g.label.toLowerCase()}</div>`}
        </div>
      `).join('')}
    </div>
  `;
  document.getElementById('ld-single-bay').innerHTML = html;
  initTouchDragForBayView();
}
```

### C2: Add touch drag-and-drop logic

Add these functions to the `<script>` block:

```js
let touchDragEl = null;
let touchDragId = null;
let touchClone = null;
let touchStartY = 0;
let touchStartX = 0;
let touchMoved = false;

function initTouchDragForBayView() {
  const cards = document.querySelectorAll('#ld-single-bay .ld-card');
  cards.forEach(card => {
    card.setAttribute('draggable', 'true');

    // Desktop drag
    card.addEventListener('dragstart', (e) => {
      touchDragId = card.dataset.assignmentId;
      e.dataTransfer.effectAllowed = 'move';
      card.style.opacity = '0.5';
      card.addEventListener('dragend', () => { card.style.opacity = '1'; }, { once: true });
    });

    // Touch drag
    card.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      touchDragEl = card;
      touchDragId = card.dataset.assignmentId;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchMoved = false;
    }, { passive: true });
  });

  // Drop zones
  const zones = document.querySelectorAll('#ld-single-bay .ld-drop-zone');
  zones.forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.style.background = '#dbeafe';
    });
    zone.addEventListener('dragleave', () => { zone.style.background = ''; });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.style.background = '';
      if (touchDragId) {
        const targetStatus = zone.dataset.targetStatus;
        advanceStatus(touchDragId, targetStatus);
        touchDragId = null;
      }
    });
  });
}

document.addEventListener('touchmove', (e) => {
  if (!touchDragEl) return;
  const dx = e.touches[0].clientX - touchStartX;
  const dy = e.touches[0].clientY - touchStartY;
  if (!touchMoved && Math.abs(dy) < 10 && Math.abs(dx) < 10) return;
  touchMoved = true;

  if (!touchClone) {
    touchClone = touchDragEl.cloneNode(true);
    touchClone.style.cssText = `
      position:fixed; z-index:10001; pointer-events:none;
      width:${touchDragEl.offsetWidth}px; opacity:0.85;
      box-shadow:0 8px 24px rgba(0,0,0,0.2); transform:rotate(2deg);
    `;
    document.body.appendChild(touchClone);
    touchDragEl.style.opacity = '0.3';
  }
  touchClone.style.left = (e.touches[0].clientX - touchDragEl.offsetWidth / 2) + 'px';
  touchClone.style.top = (e.touches[0].clientY - 20) + 'px';

  // Highlight drop zone under finger
  document.querySelectorAll('.ld-drop-zone').forEach(z => z.classList.remove('ld-drop-hover'));
  const elUnder = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
  const zone = elUnder?.closest('.ld-drop-zone');
  if (zone) zone.classList.add('ld-drop-hover');
}, { passive: true });

document.addEventListener('touchend', () => {
  if (!touchDragEl) return;
  if (touchClone) {
    // Find which zone the finger ended on
    const hoveredZone = document.querySelector('.ld-drop-zone.ld-drop-hover');
    if (hoveredZone && touchDragId) {
      const targetStatus = hoveredZone.dataset.targetStatus;
      advanceStatus(touchDragId, targetStatus);
    }
    touchClone.remove();
    touchClone = null;
  }
  if (touchDragEl) touchDragEl.style.opacity = '1';
  touchDragEl = null;
  touchDragId = null;
  touchMoved = false;
  document.querySelectorAll('.ld-drop-zone').forEach(z => z.classList.remove('ld-drop-hover'));
});
```

### C3: Add CSS for touch drag feedback

Add to the `<style>` block:

```css
.ld-drop-zone { transition: background 0.15s; border-radius: 8px; padding: 4px; }
.ld-drop-zone.ld-drop-hover { background: #dbeafe; }
.ld-card[draggable="true"] { cursor: grab; user-select: none; -webkit-user-select: none; }
.ld-card[draggable="true"]:active { cursor: grabbing; }
```

Update the existing `.ld-card[draggable="true"]` rule (line ~67-68) to include the `user-select` properties, or replace it entirely with the above.

### C4: Also make Overview drag work on mobile

The Overview already has desktop drag-and-drop for awaiting cards → bay columns. Add touch support there too by updating `renderOverview()`. After the bay columns are rendered (after `document.getElementById('ld-bays').innerHTML = baysHtml;`), add:

```js
// Init touch drag for overview awaiting cards
initTouchDragForOverview();
```

And add this function:

```js
function initTouchDragForOverview() {
  const awaitingCards = document.querySelectorAll('#ld-awaiting .ld-card[draggable="true"]');
  awaitingCards.forEach(card => {
    card.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      touchDragEl = card;
      touchDragId = card.dataset.assignmentId;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchMoved = false;
    }, { passive: true });
  });
}

// Reuse touchmove/touchend listeners (already global) — but need to handle overview drops
// Update the touchend handler to also check for bay-body drop targets
```

Actually, to keep this clean, **update the global `touchend` handler** to also check for `.ld-bay-body` as a drop target (for Overview bay column drops). Replace the `touchend` handler's zone detection with:

```js
document.addEventListener('touchend', () => {
  if (!touchDragEl) return;
  if (touchClone) {
    // Check Bay View status drop zones
    const hoveredZone = document.querySelector('.ld-drop-zone.ld-drop-hover');
    if (hoveredZone && touchDragId) {
      const targetStatus = hoveredZone.dataset.targetStatus;
      advanceStatus(touchDragId, targetStatus);
    }
    // Check Overview bay column drop targets
    const hoveredBay = document.querySelector('.ld-bay-body.ld-drop-hover');
    if (hoveredBay && touchDragId) {
      const bayCol = hoveredBay.closest('.ld-bay-col');
      const bayId = bayCol?.dataset.bayId;
      if (bayId) onBayDrop(new Event('drop'), bayId);
    }

    touchClone.remove();
    touchClone = null;
  }
  if (touchDragEl) touchDragEl.style.opacity = '1';
  touchDragEl = null;
  touchDragId = null;
  touchMoved = false;
  document.querySelectorAll('.ld-drop-zone, .ld-bay-body').forEach(z => z.classList.remove('ld-drop-hover'));
});
```

And update the global `touchmove` handler's zone highlight to also check `.ld-bay-body`:

```js
// In the touchmove handler, change the zone highlight section to:
document.querySelectorAll('.ld-drop-zone, .ld-bay-body').forEach(z => z.classList.remove('ld-drop-hover'));
const elUnder = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
const zone = elUnder?.closest('.ld-drop-zone') || elUnder?.closest('.ld-bay-body');
if (zone) zone.classList.add('ld-drop-hover');
```

Also add `.ld-bay-body` to the drop-hover CSS:

```css
.ld-bay-body.ld-drop-hover { background: #dbeafe; }
```

---

## Files to modify

1. **`logistics/logistics-header.js`** — Part A (remove "Loading" link, move user/sign-out to footer)
2. **`_worker.js`** — Part B (backfill loading assignments for existing Done jobs)
3. **`logistics/loading.html`** — Part C (touch drag-and-drop for Bay View + Overview)

## Files NOT to modify

- `logistics-shared.css` — all CSS changes are scoped in the loading.html `<style>` block
- `_worker.js` loading assignment handlers (POST/PUT/DELETE) — no changes
- `jobs/index.html` — no job board changes
- `admin/` — no admin changes
- `sw.js` — no service worker changes

---

## Verification checklist

- [ ] Mobile: header shows only logo, pill, and notification bell — no "Loading" link, no username, no Sign Out
- [ ] Mobile: footer shows username, "Sign Out" link, and "← Back to Operations Platform"
- [ ] Sign Out in footer works (redirects to login)
- [ ] Username displays in footer after auth loads
- [ ] Overview shows cards for all jobs in Done/Loading/Shipped status (backfill ran)
- [ ] Bay View: can touch-drag a card from "Not Started" to "Loading" group
- [ ] Bay View: can touch-drag a card from "Loading" to "Loaded" group
- [ ] Bay View: dragged card shows a floating clone that follows the finger
- [ ] Bay View: drop zone highlights blue when finger is over it
- [ ] Overview: can touch-drag an awaiting card onto a bay column on mobile
- [ ] Desktop: existing mouse drag-and-drop still works
