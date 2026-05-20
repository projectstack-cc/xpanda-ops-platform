# Prompt 28 — Load Builder Improvements

## Goal

Add saved/recalled loads to D1, fix duplicate BOL number handling, add auto-incrementing BOL suffixes for multi-trailer loads, and add drag-and-drop for customize mode.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Step 1 — Saved loads (D1 storage with 90-day auto-delete)

Currently the load builder stores state in `localStorage` under `foam_trailer_loader_v31`. This is volatile and device-specific. Add D1 persistence so loads can be saved, recalled, and shared.

### 1a. Database migration

Create `saved-loads.sql` at the project root:

```sql
-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.

CREATE TABLE IF NOT EXISTS saved_loads (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  job_id TEXT DEFAULT NULL,
  customer TEXT NOT NULL DEFAULT '',
  trailer_type TEXT NOT NULL DEFAULT '',
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+90 days'))
);

CREATE INDEX IF NOT EXISTS idx_saved_loads_expires ON saved_loads(expires_at);
CREATE INDEX IF NOT EXISTS idx_saved_loads_customer ON saved_loads(customer);
```

### 1b. API handler in `_worker.js`

Add `handleApiSavedLoads`:

**GET `/api/saved-loads`** — List all saved loads (not expired), ordered by `updated_at DESC`. Return `id, name, customer, trailer_type, created_at, updated_at` (NOT the full `state_json` — that's potentially large). Delete any rows where `expires_at < now()` before querying (lightweight cleanup).

**GET `/api/saved-loads/:id`** — Return full load including `state_json`.

**POST `/api/saved-loads`** — Create a saved load. Accept `{ name, job_id, customer, trailer_type, state_json }`. Set `expires_at` to 90 days from now.

**PUT `/api/saved-loads/:id`** — Update an existing load. Reset `expires_at` to 90 days from now on each save (extends the retention).

**DELETE `/api/saved-loads/:id`** — Delete a saved load.

Add activity logging for create/delete.

Wire the route in the routing block:
```javascript
if (url.pathname === "/api/saved-loads" || url.pathname.startsWith("/api/saved-loads/")) {
  return handleApiSavedLoads(request, env);
}
```

### 1c. Load builder UI — Save and Load buttons

In `logistics/load-builder.html`, add two buttons to the toolbar area:

**"Save Load" button:**
- On click, prompt for a name (pre-fill with customer name + date if available)
- Serialize the current trailer state (pieces, trailer type, dimensions, SKU selections) to JSON
- POST to `/api/saved-loads`
- Show success toast
- If the load was previously loaded/saved (has an `id`), PUT instead of POST

**"Load" button:**
- On click, open a modal listing saved loads (fetched from GET `/api/saved-loads`)
- Each row shows: name, customer, trailer type, date saved
- Click a load → fetch its full state from GET `/api/saved-loads/:id`, deserialize, and restore the trailer
- Each row has a delete button (with confirm) → DELETE `/api/saved-loads/:id`
- Empty state: "No saved loads."

**Important:** Preserve the existing `localStorage` save behavior — it's the auto-save draft mechanism. The D1 saved loads are explicit user-initiated saves for recall later. They coexist.

---

## Step 2 — Fix duplicate BOL number handling

### 2a. Remove UNIQUE constraint if it exists

Check if there's a UNIQUE constraint on `bols.bol_number` in the live database. The schema DDL in `_worker.js` shows only a regular INDEX (`idx_bols_number`), but the error suggests a UNIQUE constraint may have been added by an earlier migration.

Create `fix-bol-unique.sql` at the project root:

```sql
-- MANUAL STEP: Run in Cloudflare D1 Dashboard Console.
-- Drops and recreates the index as non-unique.

DROP INDEX IF EXISTS idx_bols_bol_number;
DROP INDEX IF EXISTS idx_bols_number_unique;
CREATE INDEX IF NOT EXISTS idx_bols_number ON bols(bol_number);
```

### 2b. Remove retry logic in worker

In `_worker.js`, find the BOL POST handler. There's a retry loop that handles `UNIQUE constraint failed: bols.bol_number` (around line 3408). Remove this retry logic entirely — we're allowing duplicate BOL numbers.

Also remove similar retry logic in the PUT handler (around line 3463).

### 2c. Storage naming for duplicate BOLs

When generating the PDF filename (in `bol-shared.js`), if the BOL number already exists, append a suffix. This is handled at the **API level** — the response from POST should include a unique ID regardless. The filename in the PDF download can just use the BOL number + timestamp if needed. No changes needed to the DB — duplicates are fine.

---

## Step 3 — Auto-increment BOL/INV suffix for multi-trailer loads

When a load build has multiple trailers and the user enters a BOL/INV number like "1234-01" for the first trailer, automatically suggest "1234-02" for the second, "1234-03" for the third, etc.

### 3a. In `logistics/load-builder.html`

Find where the INV/BOL inputs are created for each trailer (around line 1778, the `invInput` creation). Add an `onInput` handler on the first trailer's input that auto-fills subsequent trailer inputs:

```javascript
// When trailer 0's BOL/INV number changes and follows a pattern like "XXXX-01"
// Auto-fill subsequent trailers with -02, -03, etc.
if (ti === 0) {
  invInput.addEventListener('input', () => {
    const val = invInput.value.trim();
    const match = val.match(/^(.+-)(\d+)$/);
    if (match) {
      const prefix = match[1];
      const startNum = parseInt(match[2], 10);
      // Auto-fill subsequent trailers (only if they're empty or have the old auto-fill)
      for (let j = 1; j < state.trailers.length; j++) {
        const nextInput = document.querySelector(`[data-trailer-inv="${j}"]`);
        if (nextInput && (!nextInput.value || nextInput.dataset.autoFilled === 'true')) {
          const suffix = String(startNum + j).padStart(match[2].length, '0');
          nextInput.value = prefix + suffix;
          nextInput.dataset.autoFilled = 'true';
          state.trailerInvNumbers[j] = nextInput.value;
        }
      }
    }
  });
}
```

Add `data-trailer-inv="${ti}"` and `data-auto-filled="false"` attributes to each inv input so they can be targeted.

When a user manually types in a subsequent trailer's input, clear the `autoFilled` flag so it won't be overwritten:
```javascript
invInput.addEventListener('input', () => {
  if (ti > 0) invInput.dataset.autoFilled = 'false';
  state.trailerInvNumbers[ti] = invInput.value;
});
```

---

## Step 4 — Drag-and-drop in customize mode

The load builder has a "customize" mode where users can manually adjust piece placement. Add drag-and-drop support so users can move SKU pieces between columns.

### 4a. Identify the customize mode rendering

Find where columns are rendered in customize mode. Each column displays a list of pieces/SKUs stacked vertically. The rendering likely happens in a function that iterates over columns and renders piece blocks.

### 4b. Make pieces draggable

When rendering a piece in a column in customize mode, add `draggable="true"` and drag event handlers:

```javascript
pieceEl.draggable = true;
pieceEl.dataset.pieceIndex = pieceIdx;
pieceEl.dataset.columnIndex = colIdx;

pieceEl.addEventListener('dragstart', (e) => {
  e.dataTransfer.setData('text/plain', JSON.stringify({
    pieceIndex: parseInt(pieceEl.dataset.pieceIndex),
    fromColumn: parseInt(pieceEl.dataset.columnIndex),
  }));
  pieceEl.style.opacity = '0.5';
});

pieceEl.addEventListener('dragend', () => {
  pieceEl.style.opacity = '1';
});
```

### 4c. Make columns drop targets

Each column container gets drop handlers:

```javascript
columnEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  columnEl.style.outline = '2px dashed #3b82f6';
});

columnEl.addEventListener('dragleave', () => {
  columnEl.style.outline = '';
});

columnEl.addEventListener('drop', (e) => {
  e.preventDefault();
  columnEl.style.outline = '';
  
  const data = JSON.parse(e.dataTransfer.getData('text/plain'));
  const fromCol = data.fromColumn;
  const pieceIdx = data.pieceIndex;
  const toCol = parseInt(columnEl.dataset.columnIndex);
  
  if (fromCol === toCol) return; // Same column, no-op
  
  // Move the piece from fromCol to toCol in the state
  movePieceBetweenColumns(fromCol, pieceIdx, toCol);
  render(); // Re-render the trailer view
});
```

### 4d. `movePieceBetweenColumns` function

This function removes a piece from one column and adds it to another. The exact implementation depends on how the load builder stores column data internally. Find the state structure for columns and pieces, then implement:

```javascript
function movePieceBetweenColumns(fromColIdx, pieceIdx, toColIdx) {
  // Get the piece from the source column
  const fromCol = state.trailers[state.activeTrailer].columns[fromColIdx];
  const toCol = state.trailers[state.activeTrailer].columns[toColIdx];
  
  if (!fromCol || !toCol) return;
  
  const piece = fromCol.pieces.splice(pieceIdx, 1)[0];
  if (!piece) return;
  
  toCol.pieces.push(piece);
  
  // Recalculate column heights/weights
  recalcColumn(fromColIdx);
  recalcColumn(toColIdx);
}
```

**Important:** Study the actual state structure before implementing. The column/piece model may use different property names. Trace through the existing customize mode code to understand the data structure.

### 4e. Visual feedback

Add a subtle visual cue during drag: the piece being dragged gets `opacity: 0.5`, the target column gets a blue dashed outline, and invalid drop targets (full columns) don't accept drops.

Check column height capacity before accepting a drop:
```javascript
// In the drop handler, before calling movePieceBetweenColumns:
const piece = state.trailers[state.activeTrailer].columns[fromCol].pieces[pieceIdx];
const toColHeight = calculateColumnHeight(toCol);
if (toColHeight + piece.height > trailerHeight) {
  // Column too full — show visual feedback
  columnEl.style.outline = '2px dashed #dc2626';
  setTimeout(() => { columnEl.style.outline = ''; }, 500);
  return;
}
```

---

## What NOT to touch

- Do NOT modify the load builder's core auto-pack algorithm
- Do NOT modify `bol-shared.js` or the BOL generator page
- Do NOT modify the `localStorage` key or its auto-save behavior
- Do NOT modify any other pages (jobs, admin, production, etc.)
- Do NOT modify the job board

---

## Completion checklist

- [ ] `saved-loads.sql` migration created
- [ ] `/api/saved-loads` CRUD handler added to `_worker.js`
- [ ] Expired loads auto-deleted on GET
- [ ] Save Load button serializes trailer state to D1
- [ ] Load button shows list of saved loads, restores on click
- [ ] Saved loads can be deleted
- [ ] `fix-bol-unique.sql` migration created (drops unique constraint)
- [ ] Retry logic for BOL number unique constraint removed from worker
- [ ] Multi-trailer BOL numbers auto-increment (1234-01 → 1234-02 → 1234-03)
- [ ] Customize mode pieces are draggable between columns
- [ ] Drop validates column height capacity
- [ ] Visual feedback during drag-and-drop

**Notify Steve:** After completion, run both SQL migrations in D1 Dashboard Console:
1. `saved-loads.sql` — creates the saved loads table
2. `fix-bol-unique.sql` — removes the unique constraint on BOL numbers
