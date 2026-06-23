# P151 — Fix Mobile Kanban Drag-Scroll Conflict

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **job-board-agent** only,
`jobs/index.html`. No backend, no migration.

## Problem & approach
On touch devices, native HTML5 drag-and-drop barely functions, and making a card `draggable`
hijacks the touch gesture so the page won't scroll — the kanban becomes unusable on floor tablets.

Native HTML5 DnD does not reliably fire from touch anyway, so the fix is **not** to build a
touch-drag engine. Mobile users already have a working status-change path: the per-card **← / →
arrow buttons** (`jobs-arrow-btn`, handler at the board click delegator) plus the status dropdown in
the job modal (P145). So: **disable native `draggable` on coarse-pointer (touch) devices** — scroll
returns to normal, and status changes happen via the arrows. Desktop (fine pointer) keeps drag.

## File
- `jobs/index.html` — 1 edit in the card render

---

### Edit — gate `draggable` on pointer type

FIND (count == 1 — verify exact whitespace before applying):
```
  card.draggable    = job.status !== 'archived';
```

REPLACE:
```
  card.draggable    = job.status !== 'archived' && !window.matchMedia('(pointer: coarse)').matches;
```

---

## Verify
- FIND `count == 1` (confirm the multi-space alignment matches the live file exactly; adjust the
  FIND to the real whitespace if needed).
- Extract the `jobs/index.html` `<script>` block to a temp `.js` and `node --check` it.
- Test on a touch device / DevTools touch emulation: the kanban scrolls normally and the ← / →
  arrows move a job between statuses. On desktop with a mouse, drag-and-drop still works.

## What NOT to change
- Do NOT remove or alter the existing native drag handlers (`dragstart`/`dragover`/`drop`) — they
  stay for desktop; only `draggable` is gated off on touch.
- Do NOT remove the arrow buttons or the modal status dropdown.
- Do NOT touch auto-pack, `STORAGE_KEY`, or any logistics/load-builder code.

## Deploy
```
git add jobs/index.html
git commit -m "P151: disable native kanban drag on touch devices (resolves mobile drag-scroll conflict; arrows handle status on mobile)"
git push
```
