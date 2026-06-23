# P148 — Build Load + BOL Actions in the Logistics Edit Modal (Calendar Access)

## Agents
Read **both** `AGENTS.md` and `xpanda-ops-agents.md` first. **logistics-agent** only,
`logistics/index.html`. No backend, no migration.

> **Deploy order:** land **P147 first**. The button label ("View BOL" vs "Generate BOL") is driven
> by `bol_count`, which P147 adds. P148 reuses `buildActionButtons`, so without P147 the modal
> button always reads "Generate BOL" (functional, just not the right label).

## Goal
Calendar-view users open a shipment via the edit modal (calendar pills call `openEdit()`), but the
modal has no "Build Load" / "Generate BOL" actions — those live only in the list row's action cell.
Surface the same `buildActionButtons(s)` output inside the edit modal so calendar (and modal) users
can reach them.

## Files
- `logistics/index.html` — 3 edits (container, populate in `openEdit`, clear in `clearForm`)

---

### Edit 1 — add an action container at the top of the modal body

FIND (count == 1):
```
    <div class="logistics-modal-body">
      <div class="logistics-error" id="modal-error"></div>
```

REPLACE:
```
    <div class="logistics-modal-body">
      <div class="logistics-error" id="modal-error"></div>
      <div id="modal-actions" class="logistics-modal-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;"></div>
```

### Edit 2 — populate it in `openEdit` (where the shipment object `s` is in hand)

FIND (count == 1):
```
  editingId        = id;
  currentDirection = s.direction;
```

REPLACE:
```
  editingId        = id;
  currentDirection = s.direction;
  const _mab = document.getElementById('modal-actions');
  if (_mab) _mab.innerHTML = buildActionButtons(s);
```

### Edit 3 — clear it in `clearForm` (so the "New Shipment" modal shows no stale actions)

FIND (count == 1):
```
function clearForm() {
  ['f-ship-date','f-carrier','f-bol-number','f-notes',
```

REPLACE:
```
function clearForm() {
  const _mab = document.getElementById('modal-actions'); if (_mab) _mab.innerHTML = '';
  ['f-ship-date','f-carrier','f-bol-number','f-notes',
```

---

## Verify
- All three FINDs `count == 1`.
- Extract the `logistics/index.html` `<script>` block to a temp `.js` and `node --check` it.
- `buildActionButtons` already returns `''` for delivered/cancelled/no-job shipments, so the modal
  bar is correctly empty in those cases — no extra guard needed.
- Test: open a shipment from the **calendar** view → modal shows Build Load + BOL; open "New
  Shipment" → bar is empty.

## What NOT to change
- Do NOT duplicate `buildActionButtons`; reuse it.
- Do NOT alter the list-row action cell or the modal footer (Delete/Cancel/Save).
- No backend, no migration. Do NOT touch auto-pack, `STORAGE_KEY`, or BOL engine files.

## Deploy
```
git add logistics/index.html
git commit -m "P148: surface Build Load + BOL actions in the logistics edit modal (calendar-view access)"
git push
```
