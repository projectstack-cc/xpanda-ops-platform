# Prompt 68 — BOL Inline Editor Phase 2: Persistence + Tweaks

## Agents to assume

**Read BOTH agent files before starting: `AGENTS.md` AND `xpanda-ops-agents.md`.** Then assume these agents and follow their scopes and the Orchestrator's cross-cutting rules:

- **Lead: db-api-agent** — owns the migration, the `_worker.js` INSERT/UPDATE wiring for the new column, and the activity-log entry.
- **Support: logistics-agent** — owns `bol-shared.js` (load overrides, coord tweaks, date format) and `bol-generator.html` (persist on Approve & Save, rehydrate on load, Close button on review modal).

This prompt does NOT touch the load builder (`load-builder.html`) — that's Phase 3 (Prompt 69). It also does NOT modify any other module.

## Dependencies

- Prompts 66 and 67 already applied.
- Prompt 67's ephemeral editor wiring is in place: `BolEditor.open(...)` already attaches `bol._overrides` to the in-memory bol on Apply; the override render mode in `bol-shared.js` already draws overridden fields verbatim and re-tiers/centers commodity per semantics A.

## Goal

Make WYSIWYG BOL edits **durable**: persist `bol._overrides` to the `bols` row on Approve & Save; rehydrate on reopen so subsequent preview/print/edit reflect the saved overrides. Plus squeeze in three small adjustments while logistics-agent is already in the same files: a Close button on the review modal, three coord nudges with a 10% size bump on commodity/contact/PO, and a date-format change at render time.

---

## Part 1 — db-api-agent: schema + worker wiring

### 1a. Migration

Create `DB Migrations/render-overrides.sql`:

```sql
-- Adds render_overrides JSON blob to bols for the WYSIWYG inline editor.
-- Stored as TEXT (D1/SQLite has no native JSON type). NULL means no overrides.
ALTER TABLE bols ADD COLUMN render_overrides TEXT;
```

Steve runs this manually in the Cloudflare D1 Dashboard Console. Do NOT attempt to run it via Wrangler.

### 1b. POST /api/bols — accept render_overrides

In `_worker.js`, inside the `POST /api/bols` handler (starts around line 3288), add a parsed JSON payload field and include it in the INSERT.

After the existing `const is_scrap_pickup = payload.is_scrap_pickup ? 1 : 0;` line, add:

```javascript
    // render_overrides: persisted JSON blob from the inline editor (P67).
    // Accept either an object (stringify) or a string (validate then store).
    let render_overrides = null;
    if (payload.render_overrides != null) {
      if (typeof payload.render_overrides === 'object') {
        render_overrides = JSON.stringify(payload.render_overrides);
      } else if (typeof payload.render_overrides === 'string' && payload.render_overrides.trim()) {
        try { JSON.parse(payload.render_overrides); render_overrides = payload.render_overrides; }
        catch { render_overrides = null; }
      }
    }
```

Then add `render_overrides` to the INSERT column list and the corresponding `?` and bind value. The column list currently ends with `... job_id, notes, created_at`. Change to `... job_id, notes, render_overrides, created_at`. Add a `?` to the VALUES tuple. In the `.bind(...)` call, insert `render_overrides` in the same position (between the `s("notes")` bind and the `now` bind).

### 1c. PUT /api/bols/:id — accept render_overrides

In the `PUT /api/bols/:id` handler (starts ~line 3346), add the same `render_overrides` parsing block after `is_scrap_pickup`. Then add `render_overrides = ?` to the `UPDATE bols SET ...` column list (place it right before `WHERE id = ?`, after `notes = ?`). Add the corresponding bind in the same position. Use `null` if not provided — but in PUT, if `payload.render_overrides` is `undefined`, do NOT clobber the existing column; only set it when the field is explicitly present on the payload (including `null` to clear). Simplest pattern:

```javascript
    const hasOverridesField = Object.prototype.hasOwnProperty.call(payload, 'render_overrides');
    // ...later, build the UPDATE conditionally:
```

If conditional UPDATE construction is messy, an acceptable alternative is to always include the column in the UPDATE but only overwrite when `hasOverridesField` is true — by reading the existing row's value first when it isn't and binding that back. Pick whichever you find cleaner; the requirement is: **an UPDATE without `render_overrides` on the payload must not erase the column.**

### 1d. GET endpoints

`GET /api/bols/:id` and `GET /api/bols` both `SELECT *`, so they'll return the new column automatically. No change needed.

### 1e. Activity log

The existing `logActivity(...)` calls in POST and PUT can stay as-is. Optionally, when `render_overrides` is non-null on create/update, append a small note like `' with custom render overrides'` to the activity description. Not required.

---

## Part 2 — logistics-agent: bol-shared.js changes

### 2a. Coord tweaks (commodity / contact / PO)

In the `COORDS` object, find these three entries:

```javascript
    contactInfo:   { x: 315, y: 525, size: 11, lineH: 12, maxW: 255 },
    poNumber:      { x: 315, y: 498, size: 11, lineH: 12, maxW: 255 },
    commodity:     { x: 55,  y: 410, size: 13, lineH: 28, maxW: 510, center: true },
```

Change to:

```javascript
    contactInfo:   { x: 315, y: 495, size: 12, lineH: 13, maxW: 255 },
    poNumber:      { x: 315, y: 468, size: 12, lineH: 13, maxW: 255 },
    commodity:     { x: 55,  y: 380, size: 13, lineH: 28, maxW: 510, center: true },
```

Tuning notes (do not bake into the prompt anywhere else; this is just context for Steve):
- `y -= 30` brings all three down ~0.42" on the page.
- Contact/PO `size` and `lineH` are +10%.
- Commodity base `size`/`lineH` here are defaults (overridden at render time by the tier block).

### 2b. Commodity tier sizes (+10%)

Find the `commodityTiers` array added in Prompt 66:

```javascript
        const commodityTiers = [
          { size: 24, lineH: 30, maxLines: 2 },
          { size: 20, lineH: 26, maxLines: 5 },
          { size: 18, lineH: 22, maxLines: Infinity },
        ];
```

Change to (sizes +10%, line heights scaled to match):

```javascript
        const commodityTiers = [
          { size: 26, lineH: 32, maxLines: 2 },
          { size: 22, lineH: 28, maxLines: 5 },
          { size: 20, lineH: 24, maxLines: Infinity },
        ];
```

### 2c. Date format at render time

Find the date render line:

```javascript
      drawText(bol.date, COORDS.date);
```

Replace with:

```javascript
      // Reformat YYYY-MM-DD (from <input type="date">) to MM/DD/YYYY for display.
      // Falls through to raw value if the input doesn't match the ISO shape.
      const formatBolDate = (iso) => {
        if (!iso) return '';
        const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[2]}/${m[3]}/${m[1]}` : String(iso);
      };
      drawText(formatBolDate(bol.date), COORDS.date);
```

If `bol._overrides?.date` is present (single-field override from the editor), `bol.date` will already be the override string from the existing P67 override path — do NOT reformat in that case. Guard like so instead:

```javascript
      const rawDate = bol._overrides?.date ?? bol.date;
      const displayDate = bol._overrides?.date ? String(rawDate) : formatBolDate(rawDate);
      drawText(displayDate, COORDS.date);
```

(If the existing P67 override branch for `date` already lives in the file, keep that branch intact and apply `formatBolDate` only to the non-override fallback. Refactor minimally — do not restructure the render block.)

### 2d. Touching nothing else

Do not change `wrapText`, `drawText`, `buildShipToLines`, `drawMultiline`, `pickCommodityTier`, `FIELD_MAP`, `PAGE`, the public API export, the toast logic, or any other coord. Do not refactor.

---

## Part 3 — logistics-agent: bol-generator.html

### 3a. Persist overrides on Approve & Save

The Approve & Save handler POSTs/PUTs `pendingReviewPayload`. P67 left this payload unchanged on edit-apply so persistence wasn't introduced. Now we want overrides to ride along.

Find where `BolEditor.open(...)`'s `onApply(updatedBol)` callback lives in `bol-generator.html`. Today it regenerates the preview and updates `pendingReviewBlobUrl`. Add one line: attach the overrides to the outgoing payload:

```javascript
  pendingReviewPayload.render_overrides = updatedBol._overrides || null;
```

Place this immediately after the line that captures the updated bol (before the `generatePdf` regen call is fine — order doesn't matter, just make sure the payload carries it). When `_overrides` is empty/undefined, set to `null` so the server explicitly clears any previously saved overrides.

### 3b. Rehydrate on reopen

Find `loadBolIntoForm(b)` (around line 1374 — where `set('f-date', b.date)` lives). At the bottom of that function, parse and stash overrides on a module-scoped variable that the preview path already consults for `tempBol` construction:

```javascript
  // Rehydrate persisted render overrides from the saved row (P68).
  try {
    currentLoadedOverrides = b.render_overrides ? JSON.parse(b.render_overrides) : null;
  } catch {
    currentLoadedOverrides = null;
  }
```

Declare `let currentLoadedOverrides = null;` near the top of the script alongside other module-scoped state (next to whatever holds the loaded BOL id, if present; otherwise just at the top of the IIFE/script block).

Then, in the place where `tempBol` is built for preview/generatePdf (the function that runs when the user clicks Preview/Review), attach the overrides if present:

```javascript
  if (currentLoadedOverrides) tempBol._overrides = currentLoadedOverrides;
```

Place this **before** the `generatePdf([tempBol], ...)` call. If the editor is then opened and the user applies new edits, the existing `onApply` flow already overwrites `tempBol._overrides` via `updatedBol`, so the rehydrated value is correctly replaced rather than merged.

When the user clicks **New** (starts a fresh BOL form), reset `currentLoadedOverrides = null;` in whatever existing reset function handles new-form state.

### 3c. Close button on the review modal

In the review modal markup (around line 1574, `<div id="bol-review-backdrop">` ... down to the action buttons around line 1592), add a third button to the left of the Edit button. Use a neutral/ghost style — gray border, no fill — to distinguish it from Edit (primary action) and Approve (success action).

```html
        <button id="bol-review-close" style="
          padding: 8px 16px;
          background: #ffffff;
          color: #374151;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-weight: 600;
          cursor: pointer;
          font-size: 14px;
        ">Close</button>
```

In the function that wires up the review modal buttons (around line 1253, where `approveBtn` and `editBtn` are looked up), wire the new button:

```javascript
  const closeBtn = document.getElementById('bol-review-close');
  if (closeBtn) {
    const newClose = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newClose, closeBtn);
    newClose.addEventListener('click', closeBolReview);
  }
```

(The `cloneNode/replaceChild` pattern matches how the existing Edit and Approve buttons are wired in this file — keep it consistent.)

`closeBolReview()` already exists and tears down the iframe; nothing else to change there. The Close button does NOT save and does NOT prompt — it just dismisses.

---

## Scope Constraints (strict)

- **Files touched (5 total):** new `DB Migrations/render-overrides.sql`; edits to `_worker.js` (POST + PUT /api/bols only); `logistics/bol-shared.js`; `logistics/bol-generator.html`. No other files.
- **NOT touched this prompt:** `logistics/load-builder.html`, `logistics/bol-editor.js`, anything outside the logistics module, any other API endpoint.
- Do not refactor unrelated handlers, helpers, or markup.
- Do not change the editor engine's behavior — only consumer wiring around it.

## Manual steps after build

1. Run `DB Migrations/render-overrides.sql` in the Cloudflare D1 Dashboard Console (Steve, not Claude Code).
2. Commit and deploy.
3. Verify: Create a new BOL → click Edit → make edits → Apply → Approve & Save. Then click that saved BOL in Recent BOLs → click Preview/Review → the edits should still appear in the rendered PDF and in the editor overlay. Click Close on the review modal → modal dismisses without saving. Date should render as `MM/DD/YYYY`. Commodity/Contact/PO should sit lower on the page and read slightly larger.
4. If anything sits visually wrong, the tuning knobs are: `commodity.y`, `contactInfo.y/size/lineH`, `poNumber.y/size/lineH`, `commodityTiers[*].size/lineH`. All in `bol-shared.js`.
