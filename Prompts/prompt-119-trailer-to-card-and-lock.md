# Prompt 119 — Trailer # moves to the card (assignment), locks at In Transit

Read `AGENTS.md` and `xpanda-ops-agents.md` first. This moves trailer-number ownership from the bay
to the loading card and locks it once the load departs — assume the **logistics-agent** and the
**db-api-agent** (`xpanda-ops-agents.md`), plus the **Frontend Designer** (`agent-frontend-designer.md`)
for the card input styling.

Scope: **`logistics/loading.html`** (frontend) and **`_worker.js/routes/loading.js`** (one backend
guard). **No migration** — `loading_assignments.trailer_number` already exists and
`PUT /api/loading-assignments` already updates it.

Background (already true — do not reimplement): the card already renders `a.trailer_number`, the PUT
handler already accepts `trailer_number`, and the transit notification already prefers the
assignment's trailer. This prompt makes the trailer **editable on the card**, removes the bay-level
trailer entirely, and **locks editing at In Transit**. Trailer #s are intentionally **not unique** —
piggyback loads (multiple orders on one truck) share a trailer #, entered manually per card.

All find-blocks are exact and single-source (verified). Apply each as full-block find/replace. Do not
touch the auto-pack algorithm, `STORAGE_KEY`, drag handlers (separate prompt), or any other file.

---

## FRONTEND — `logistics/loading.html`

### Edit 1 — Add card trailer-input CSS (after the `.ld-card-meta` rule)

FIND:
```
    .ld-card-meta { font-size: 10px; color: #6b7280; display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
```
REPLACE:
```
    .ld-card-meta { font-size: 10px; color: #6b7280; display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
    .ld-card-trailer-input { width: 100%; padding: 4px 6px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 11px; box-sizing: border-box; margin-bottom: 4px; }
```

### Edit 2 — Remove the trailer input from the OVERVIEW bay header

FIND:
```
        <div class="ld-bay-header">
          <div class="ld-bay-number">Bay ${bay.bay_number}</div>
          ${isManager
            ? `<input class="ld-trailer-input" type="text" placeholder="Trailer #"
                value="${escAttr(bay.trailer_number || '')}"
                onchange="updateBayTrailer('${bay.id}', this.value)" />`
            : bay.trailer_number
              ? `<span style="font-size:13px;color:#6b7280;">Trailer: ${esc(bay.trailer_number)}</span>`
              : ''}
        </div>
```
REPLACE:
```
        <div class="ld-bay-header">
          <div class="ld-bay-number">Bay ${bay.bay_number}</div>
        </div>
```

### Edit 3 — Remove the trailer input from the single-bay (drill-in) header

FIND:
```
      <div class="ld-bay-single-header">
        <h3>Bay ${bay.bay_number}</h3>
        ${isManager
          ? `<input class="ld-trailer-input" type="text" placeholder="Trailer #" value="${escAttr(bay.trailer_number || '')}"
              onchange="updateBayTrailer('${bay.id}', this.value)" style="max-width:140px;" />`
          : bay.trailer_number
            ? `<span style="font-size:13px;color:#6b7280;">Trailer: ${esc(bay.trailer_number)}</span>`
            : ''
        }
      </div>
```
REPLACE:
```
      <div class="ld-bay-single-header">
        <h3>Bay ${bay.bay_number}</h3>
      </div>
```

### Edit 4 — Remove the bay trailer line from the bay-list item

FIND:
```
          <div style="font-weight:700;font-size:18px;color:var(--text);">Bay ${bay.bay_number}</div>
          ${bay.trailer_number ? `<div style="font-size:13px;color:#6b7280;margin-top:2px;">Trailer: ${esc(bay.trailer_number)}</div>` : ''}
```
REPLACE:
```
          <div style="font-weight:700;font-size:18px;color:var(--text);">Bay ${bay.bay_number}</div>
```

### Edit 5 — Drop "— TR#" from the bay-selector option labels (three sites)

FIND:
```
    `<option value="${b.id}" ${b.id === selectedBayId ? 'selected' : ''}>Bay ${b.bay_number}${b.trailer_number ? ' — TR# ' + b.trailer_number : ''}</option>`
```
REPLACE:
```
    `<option value="${b.id}" ${b.id === selectedBayId ? 'selected' : ''}>Bay ${b.bay_number}</option>`
```

FIND:
```
    `<option value="${b.id}">Bay ${b.bay_number}${b.trailer_number ? ' — TR# ' + b.trailer_number : ''}</option>`
```
REPLACE:
```
    `<option value="${b.id}">Bay ${b.bay_number}</option>`
```

FIND:
```
    allBays.map(b => `<option value="${b.id}">Bay ${b.bay_number}${b.trailer_number ? ` — TR# ${b.trailer_number}` : ''}</option>`).join('');
```
REPLACE:
```
    allBays.map(b => `<option value="${b.id}">Bay ${b.bay_number}</option>`).join('');
```

### Edit 6 — Compute the card trailer field in `renderAssignmentCard`

FIND:
```
  const dragAttrs = a.loading_status === 'awaiting'
    ? `draggable="true" ondragstart="onCardDragStart(event, '${a.id}')"`
    : '';
```
REPLACE:
```
  const dragAttrs = a.loading_status === 'awaiting'
    ? `draggable="true" ondragstart="onCardDragStart(event, '${a.id}')"`
    : '';
  const trailerEditable = isManager && a.bay_id && ['not_started', 'loading', 'loaded'].includes(a.loading_status);
  const trailerHtml = trailerEditable
    ? `<input class="ld-card-trailer-input" type="text" placeholder="Trailer #" value="${escAttr(a.trailer_number || '')}" onclick="event.stopPropagation();" onchange="updateAssignmentTrailer('${a.id}', this.value)" />`
    : (a.trailer_number ? `<span>Trailer: ${esc(a.trailer_number)}</span>` : '');
```

### Edit 7 — Render the trailer field in the card meta

FIND:
```
      <div class="ld-card-meta">
        ${a.trailer_number ? `<span>Trailer: ${esc(a.trailer_number)}</span>` : ''}
        ${a.ship_to_city ? `<span>${esc(a.ship_to_city)}${a.ship_to_state ? ', ' + esc(a.ship_to_state) : ''}</span>` : ''}
      </div>
```
REPLACE:
```
      <div class="ld-card-meta">
        ${trailerHtml}
        ${a.ship_to_city ? `<span>${esc(a.ship_to_city)}${a.ship_to_state ? ', ' + esc(a.ship_to_state) : ''}</span>` : ''}
      </div>
```

### Edit 8 — Replace `updateBayTrailer` with `updateAssignmentTrailer`

(After Edits 2–3 there are no remaining callers of `updateBayTrailer`, so replace the function
outright. The new function writes to the assignment and only re-renders on failure to avoid
focus/jank while typing.)

FIND:
```
async function updateBayTrailer(bayId, trailerNumber) {
  await api.put('/api/loading-bays', { id: bayId, trailer_number: trailerNumber });
}
```
REPLACE:
```
async function updateAssignmentTrailer(assignmentId, trailerNumber) {
  const { ok, data } = await api.put('/api/loading-assignments', { id: assignmentId, trailer_number: trailerNumber });
  if (!ok) {
    alert(data?.error || 'Failed to update trailer #');
    loadDashboard();
  }
}
```

---

## BACKEND — `_worker.js/routes/loading.js`

### Edit 9 — Lock the trailer once the load is in transit (server-side guard)

`existing` (the current row) is already loaded just above this line.

FIND:
```
    if (payload.trailer_number !== undefined) { updates.push('trailer_number = ?'); binds.push(String(payload.trailer_number)); }
```
REPLACE:
```
    if (payload.trailer_number !== undefined) {
      const trailerLockedStatuses = ['in_transit', 'delivered', 'archived'];
      if (trailerLockedStatuses.includes(existing.loading_status) &&
          String(payload.trailer_number) !== String(existing.trailer_number || '')) {
        return json({ ok: false, error: 'Trailer # is locked once the load is in transit.' }, 409);
      }
      updates.push('trailer_number = ?'); binds.push(String(payload.trailer_number));
    }
```

---

## Result
- The trailer # is entered **on the loading card**, manager-only, and editable while the card is in a
  bay at Not Started / Loading / Loaded. Once the card is In Transit (or beyond), the input becomes
  read-only text and the server rejects any change with a 409.
- Bays no longer carry a trailer # anywhere (header, drill-in, bay list, all selector labels) — a bay
  is now just a dock number.
- Piggyback loads work by entering the same trailer # on each card going on that truck (manual, no
  uniqueness enforcement). Each card locks independently when its load is scanned/transited at pickup.

## Verify after editing
- Confirm the change deployed to Cloudflare (live page).
- Assign a job to a bay → a Trailer # input appears on the card; enter a value, refresh, it persists.
- Advance the card to In Transit → the input becomes read-only text; attempting an edit (via a stale
  client) returns the 409 lock error.
- Put two cards on the same bay with the same trailer # (piggyback) → both accept it, no error.
- Confirm no leftover trailer UI on any bay header, the bay list, or any bay dropdown.
