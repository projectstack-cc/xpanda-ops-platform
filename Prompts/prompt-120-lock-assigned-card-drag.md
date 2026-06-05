# Prompt 120 — Lock assigned cards from dragging (prevent accidental re-staging)

Read `AGENTS.md` and `xpanda-ops-agents.md` first. This freezes drag-and-drop on cards that are
already assigned to a bay — assume the **logistics-agent** (`xpanda-ops-agents.md`).

Scope: **`logistics/loading.html` only.** Frontend only. **No migration. No backend change.**
Pairs with P119 — run this right after it.

## Why
In the single-bay (drill-in) view, `initTouchDragForBayView()` makes **every** card draggable and
wires drops to `advanceStatus`, so a card can be dragged between status groups. For non-developer
floor/office users this misfires and accidentally re-stages cards (the "critical" item in the
backlog). The overview already only lets *awaiting* cards drag (to assign to a bay); assigned cards
there are not draggable. This prompt brings the bay view in line: **assigned cards are not draggable
at all — status changes happen only via the action buttons** (Start Loading, Mark Loaded, etc.).

## Edit — Disable drag in the bay view

Replace the entire `initTouchDragForBayView` function. The new version ensures bay-view cards are not
draggable and registers no drag/drop handlers, so the status-group containers become inert.

FIND:
```
function initTouchDragForBayView() {
  const cards = document.querySelectorAll('#ld-single-bay .ld-card');
  cards.forEach(card => {
    card.setAttribute('draggable', 'true');

    card.addEventListener('dragstart', (e) => {
      touchDragId = card.dataset.assignmentId;
      e.dataTransfer.effectAllowed = 'move';
      card.style.opacity = '0.5';
      card.addEventListener('dragend', () => { card.style.opacity = '1'; }, { once: true });
    });

    card.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      touchDragEl = card;
      touchDragId = card.dataset.assignmentId;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchMoved = false;
    }, { passive: true });
  });

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
```
REPLACE:
```
function initTouchDragForBayView() {
  // Drag-to-advance disabled: cards in a bay are not draggable. Status changes happen
  // only via the card action buttons, to prevent accidental re-staging (mouse/touch misfires).
  document.querySelectorAll('#ld-single-bay .ld-card').forEach(card => {
    card.setAttribute('draggable', 'false');
  });
}
```

## Result
In the single-bay view, cards can no longer be dragged between status groups. Advancing or changing a
card's status is done only through its buttons. The overview's awaiting→bay assignment drag is
untouched (that lives in `initTouchDragForOverview`, not this function), so jobs can still be dragged
from the queue onto a bay.

## Verify after editing
- Confirm the change deployed to Cloudflare (live page).
- Drill into a bay → try to drag a card between Not Started / Loading / Loaded groups: it should not
  move, and status must not change.
- Confirm the status buttons (Start Loading, Mark Loaded, Mark In Transit, etc.) still work.
- Confirm you can still drag an awaiting card onto a bay from the overview.
