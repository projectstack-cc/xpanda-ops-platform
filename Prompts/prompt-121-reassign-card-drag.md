# Prompt 121 — Re-assign a mis-assigned card: drag bay→bay or bay→queue

Read `AGENTS.md` and `xpanda-ops-agents.md` first. This lets a manager correct a wrong bay
assignment by dragging an on-the-floor card to a different bay or back to the queue — assume the
**logistics-agent** and the **db-api-agent** (`xpanda-ops-agents.md`).

Scope: **`logistics/loading.html`** (frontend) and **`_worker.js/routes/loading.js`** (one
manager-gate line). **No migration.** Run **after P119 and P120** (it stacks on both; all anchors
below are in regions those prompts do not modify).

## Behavior
- In the **overview**, a card that is in a bay at **Not Started / Loading / Loaded** is draggable
  (manager-only). Awaiting cards remain draggable as before. **In Transit / Delivered / Yard** cards
  stay non-draggable (they've left the floor).
- Drag to a **different bay** → re-stages there (resets to Not Started) — existing `onBayDrop`
  behavior, unchanged.
- Drag onto the **queue** → un-assigns (clears the bay, status back to Awaiting) — new `onQueueDrop`.
- The bay drill-in view stays button-only (P120 untouched). Making overview cards draggable does
  **not** re-enable bay-view drag, because P120 force-sets `draggable=false` there after render.
- The trailer input (P119) sits on these same cards, so drag is suppressed when the grab starts on an
  `<input>` — you can still focus and type the trailer # normally.

All find-blocks are exact, present, and unique (verified). Apply as full-block find/replace.

---

## FRONTEND — `logistics/loading.html`

### Edit 1 — Hover style for the queue drop target

FIND:
```
    .ld-bay-body.ld-drop-hover { background: #dbeafe; }
```
REPLACE:
```
    .ld-bay-body.ld-drop-hover { background: #dbeafe; }
    .ld-queue.ld-drop-hover { background: #dbeafe; border-radius: 8px; outline: 2px dashed #3b82f6; outline-offset: 2px; }
```

### Edit 2 — Make the queue a drop target (un-assign)

FIND:
```
      <div id="ld-awaiting" class="ld-queue"></div>
```
REPLACE:
```
      <div id="ld-awaiting" class="ld-queue" ondragover="event.preventDefault(); this.classList.add('ld-drop-hover');" ondragleave="this.classList.remove('ld-drop-hover');" ondrop="onQueueDrop(event); this.classList.remove('ld-drop-hover');"></div>
```

### Edit 3 — Make on-the-floor cards draggable (manager-only)

FIND:
```
  const dragAttrs = a.loading_status === 'awaiting'
    ? `draggable="true" ondragstart="onCardDragStart(event, '${a.id}')"`
    : '';
```
REPLACE:
```
  const reassignable = isManager && a.bay_id && ['not_started', 'loading', 'loaded'].includes(a.loading_status);
  const dragAttrs = (a.loading_status === 'awaiting' || reassignable)
    ? `draggable="true" ondragstart="onCardDragStart(event, '${a.id}')"`
    : '';
```

### Edit 4 — Don't start a drag when grabbing the trailer input

FIND:
```
function onCardDragStart(event, assignmentId) {
  draggedAssignmentId = assignmentId;
  event.dataTransfer.effectAllowed = 'move';
  event.target.style.opacity = '0.5';
  event.target.addEventListener('dragend', () => { event.target.style.opacity = '1'; }, { once: true });
}
```
REPLACE:
```
function onCardDragStart(event, assignmentId) {
  if (event.target.tagName === 'INPUT') { event.preventDefault(); return; }
  draggedAssignmentId = assignmentId;
  event.dataTransfer.effectAllowed = 'move';
  event.target.style.opacity = '0.5';
  event.target.addEventListener('dragend', () => { event.target.style.opacity = '1'; }, { once: true });
}
```

### Edit 5 — Add `onQueueDrop` (insert immediately after `onBayDrop`)

FIND:
```
async function onBayDrop(event, bayId) {
  event.preventDefault();
  if (!draggedAssignmentId) return;

  try {
    const { ok, data } = await api.put('/api/loading-assignments', { id: draggedAssignmentId, bay_id: bayId, loading_status: 'not_started' });
    if (ok) {
      loadDashboard();
    } else {
      alert(data?.error || 'Failed to assign bay');
    }
  } catch (e) {
    console.error('Drop assign failed:', e);
  }
  draggedAssignmentId = null;
}
```
REPLACE:
```
async function onBayDrop(event, bayId) {
  event.preventDefault();
  if (!draggedAssignmentId) return;

  try {
    const { ok, data } = await api.put('/api/loading-assignments', { id: draggedAssignmentId, bay_id: bayId, loading_status: 'not_started' });
    if (ok) {
      loadDashboard();
    } else {
      alert(data?.error || 'Failed to assign bay');
    }
  } catch (e) {
    console.error('Drop assign failed:', e);
  }
  draggedAssignmentId = null;
}

async function onQueueDrop(event) {
  event.preventDefault();
  if (!draggedAssignmentId) return;

  try {
    const { ok, data } = await api.put('/api/loading-assignments', { id: draggedAssignmentId, bay_id: null, loading_status: 'awaiting' });
    if (ok) {
      loadDashboard();
    } else {
      alert(data?.error || 'Failed to move to queue');
    }
  } catch (e) {
    console.error('Queue drop failed:', e);
  }
  draggedAssignmentId = null;
}
```

### Edit 6 — Touch: attach to all draggable overview cards + skip inputs

FIND:
```
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
```
REPLACE:
```
function initTouchDragForOverview() {
  const draggableCards = document.querySelectorAll('#ld-overview .ld-card[draggable="true"]');
  draggableCards.forEach(card => {
    card.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      if (e.target.tagName === 'INPUT') return;
      touchDragEl = card;
      touchDragId = card.dataset.assignmentId;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchMoved = false;
    }, { passive: true });
  });
}
```

### Edit 7 — Touch: recognize the queue as a hover target

FIND:
```
  const zone = elUnder?.closest('.ld-drop-zone') || elUnder?.closest('.ld-bay-body');
  if (zone) zone.classList.add('ld-drop-hover');
```
REPLACE:
```
  const zone = elUnder?.closest('.ld-drop-zone') || elUnder?.closest('.ld-bay-body') || elUnder?.closest('.ld-queue');
  if (zone) zone.classList.add('ld-drop-hover');
```

### Edit 8 — Touch: drop on the queue un-assigns

FIND:
```
    const hoveredBay = document.querySelector('.ld-bay-body.ld-drop-hover');
    if (hoveredBay && touchDragId) {
      const bayCol = hoveredBay.closest('.ld-bay-col');
      const bayId = bayCol?.dataset.bayId;
      if (bayId) {
        draggedAssignmentId = touchDragId;
        onBayDrop(new Event('drop'), bayId);
      }
    }
```
REPLACE:
```
    const hoveredBay = document.querySelector('.ld-bay-body.ld-drop-hover');
    if (hoveredBay && touchDragId) {
      const bayCol = hoveredBay.closest('.ld-bay-col');
      const bayId = bayCol?.dataset.bayId;
      if (bayId) {
        draggedAssignmentId = touchDragId;
        onBayDrop(new Event('drop'), bayId);
      }
    }
    const hoveredQueue = document.querySelector('.ld-queue.ld-drop-hover');
    if (hoveredQueue && touchDragId) {
      draggedAssignmentId = touchDragId;
      onQueueDrop(new Event('drop'));
    }
```

---

## BACKEND — `_worker.js/routes/loading.js`

### Edit 9 — Manager-gate the un-assign (move-to-queue) path

The bay→bay path is already manager-gated by the `payload.bay_id !== existing.bay_id` clause. This
adds the un-assign case so the server enforces it too, not just the UI.

FIND:
```
      if ((existing.loading_status === 'awaiting' && payload.loading_status === 'not_started') ||
          (payload.bay_id && payload.bay_id !== existing.bay_id)) {
```
REPLACE:
```
      if ((existing.loading_status === 'awaiting' && payload.loading_status === 'not_started') ||
          (payload.loading_status === 'awaiting' && existing.loading_status !== 'awaiting') ||
          (payload.bay_id && payload.bay_id !== existing.bay_id)) {
```

---

## Result
A manager can grab a card that's in a bay (Not Started / Loading / Loaded) and drop it on another bay
(re-stages fresh) or on the queue (un-assigns). Works with mouse and touch. The trailer input on
those cards stays usable. Bay drill-in stays button-only, and In Transit / Delivered / Yard cards
can't be dragged.

## Verify after editing
- Confirm deploy to Cloudflare (live page).
- As a manager: assign a job to Bay 3, then drag the card to Bay 5 → it moves and shows Not Started.
- Drag a bayed card onto the queue → it returns to Awaiting with no bay.
- Click into the trailer # input on a bayed card and type → no accidental drag; value saves.
- On a tablet, repeat the bay→bay and bay→queue drags by touch.
- As a non-manager, confirm those cards aren't draggable and a forced PUT to un-assign returns 403.
- Confirm bay drill-in cards still don't drag (P120 intact) and awaiting→bay assignment still works.
