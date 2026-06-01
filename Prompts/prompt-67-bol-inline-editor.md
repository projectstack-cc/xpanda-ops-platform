# Prompt 67 — Live BOL Inline Editor (Phase 1: shared overlay engine + override render mode, BOL generator, ephemeral)

## Dependency

**Apply Prompt 66 first.** This prompt assumes `bol-shared.js` already has the `center`-aware `drawMultiline`, the `commodity` coord with `center: true`, the `commodityTiers` auto-sizing block, the `deliveryTime` size 24, and the updated scrap coords. The override render mode below reuses that same centering + tier logic.

## Goal

Today the BOL "Review" modal shows a read-only PDF in an iframe with two buttons, **Approve & Save** and **Edit**. The Edit button (`handleReviewEdit`) just closes the modal and dumps the user back on the HTML form. Replace that with a true inline editor: render the blank BOL template to a canvas and overlay editable inputs over each field, positioned from the shared `BolShared.COORDS`. Edits are captured as **render overrides** and the preview regenerates to match, then returns to the read-only review for the existing Approve & Save flow.

**This is Phase 1 of 3. Scope is strict:**
- **BOL generator only** (`logistics/bol-generator.html`). Do NOT touch `load-builder.html` (Phase 3).
- **Ephemeral only.** Overrides live on the in-memory bol object for the current preview/print. Do NOT add a DB column, do NOT change `_worker.js`, do NOT change the approve payload schema (Phase 2 handles persistence).
- New shared engine file `logistics/bol-editor.js`, plus an override render mode in `logistics/bol-shared.js`, plus wiring in `logistics/bol-generator.html`. No other files.

**Read `AGENTS.md` before starting. Vanilla JS only — no frameworks, no build step, no ES module bundling. Load scripts via `<script src>` / dynamic `import()` exactly as the existing code does.**

---

## Part 1 — Override render mode in `logistics/bol-shared.js`

### 1a. Export the field map and page dimensions

`BolShared` already returns `{ COORDS, generatePdf, openPdf, buildShipToLines, wrapText, confirmNoBolNumber }`. Add two exports so the editor and the renderer agree on a single field definition:

```javascript
  const PAGE = { width: 612, height: 792 }; // template is fixed US Letter

  // Field map — single source of truth for what is editable and how it renders.
  // type: 'single' | 'multiline' | 'shipto' | 'scrap'
  // overrideKey is the key used inside bol._overrides
  const FIELD_MAP = [
    { key: 'deliveryTime',  type: 'single',    coord: COORDS.deliveryTime, overrideKey: 'deliveryTime' },
    { key: 'date',          type: 'single',    coord: COORDS.date,         overrideKey: 'date' },
    { key: 'bolNumber',     type: 'single',    coord: COORDS.bolNumber,    overrideKey: 'bolNumber' },
    { key: 'carrierName',   type: 'single',    coord: COORDS.carrierName,  overrideKey: 'carrierName' },
    { key: 'trailerNo',     type: 'single',    coord: COORDS.trailerNo,    overrideKey: 'trailerNo' },
    { key: 'shipTo',        type: 'shipto',    coords: [COORDS.shipLine1, COORDS.shipLine2, COORDS.shipLine3, COORDS.shipLine4], overrideKey: 'shipTo' },
    { key: 'specialInstr',  type: 'multiline', coord: COORDS.specialInstr, overrideKey: 'specialInstr' },
    { key: 'contactInfo',   type: 'multiline', coord: COORDS.contactInfo,  overrideKey: 'contactInfo' },
    { key: 'poNumber',      type: 'multiline', coord: COORDS.poNumber,     overrideKey: 'poNumber' },
    { key: 'commodity',     type: 'multiline', coord: COORDS.commodity,    overrideKey: 'commodity' },
    { key: 'scrap',         type: 'scrap',     coords: { yes: COORDS.scrapYes, no: COORDS.scrapNo }, overrideKey: 'scrap' },
  ];
```

Add `PAGE` and `FIELD_MAP` to the returned public API object.

### 1b. Honor `bol._overrides` in `generatePdf`

`bol._overrides` is an object keyed by `overrideKey`. Multi-line fields (`shipTo`, `specialInstr`, `contactInfo`, `poNumber`, `commodity`) hold an **array of literal lines**. Single fields hold a **string**. `scrap` holds a **boolean**.

In the per-BOL render loop, at each field's draw point, check for an override and draw it verbatim when present; otherwise keep the existing derive-from-columns behavior unchanged. Specifically:

- **Single fields** (`date`, `bolNumber`, `carrierName`, `trailerNo`): if `bol._overrides?.<key>` is a non-empty string, `drawText(override, COORDS.<key>)` instead of the column value.
- **deliveryTime**: if overridden, use the override string in the existing bold-red draw block.
- **shipTo**: if `bol._overrides?.shipTo` is an array, draw up to 4 entries at `shipLine1..shipLine4` via `drawText`, instead of `buildShipToLines(bol)`.
- **specialInstr / contactInfo / poNumber**: if overridden (array), draw the literal lines (do NOT prepend `'PO: '` — the override already contains the final text). Reuse `drawMultiline` by passing `override.join('\n')` (note: `wrapText` splits on `\n`, so explicit lines are preserved; a line that still exceeds `maxW` will soft-wrap, which is acceptable).
- **commodity**: if overridden (array), apply **semantics A** — recompute the size tier from the override's line count using the same `commodityTiers` thresholds from Prompt 66, keep `center: true`, and draw `override.join('\n')`. Pull the tier-selection into a small reusable helper so the un-overridden path (Prompt 66) and the overridden path share it. The helper signature: `pickCommodityTier(lineCount) → { size, lineH }`.
- **scrap**: if `bol._overrides?.scrap` is a boolean, use it instead of `bol.is_scrap_pickup` to decide `scrapYes` vs `scrapNo`.

Do not change any coordinate values, the toast/confirm logic, the export of existing helpers, or `buildShipToLines` / `wrapText` / `drawText` themselves.

---

## Part 2 — New shared engine `logistics/bol-editor.js`

A self-contained module exposing one global, `BolEditor`, with a single entry point:

```javascript
// BolEditor.open(bol, mountEl, { onApply, onCancel })
//   bol      — the in-memory bol object (the same shape passed to generatePdf)
//   mountEl  — a container element to render the canvas + overlay into
//   onApply(updatedBol) — called with bol mutated to carry bol._overrides
//   onCancel() — called if the user backs out without applying
```

### Engine behavior

1. **Render the template to a canvas.** Dynamically import pdf.js the same way `jobs/packing-slip-parser.js` does — same version, same worker:
   ```javascript
   const PDF_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
   const WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
   ```
   Fetch `/logistics/assets/BLANK_BOL_Xpanda.pdf`, render page 1 to a `<canvas>` at a display scale that fits the modal width. Record the rendered pixel width `canvasW`.

2. **Compute the transform.** `BolShared.PAGE` is `{ width: 612, height: 792 }`. Scale `s = canvasW / 612`. For a coord `{x, y, size}` (PDF points, origin bottom-left, `y` is the text baseline):
   - `pxLeft = x * s`
   - `pxBaseline = (792 - y) * s`
   - position each input so its text baseline sits at `pxBaseline`; i.e. input `top ≈ pxBaseline - (size * s)` (treat the cap height as ≈ the font size for placement). Expose a single `BASELINE_FUDGE` constant (start at `0`) added to `top` so Steve can nudge all fields uniformly after a visual check.
   - input `font-size = size * s` px.

3. **Build inputs from `BolShared.FIELD_MAP`.** For each field, compute its initial value (from `bol._overrides` if already present, else derive from the bol — `shipTo` via `BolShared.buildShipToLines(bol)`; `contactInfo` and `poNumber` via the same derivation `generatePdf` uses, including the `'PO: '` prefix; `scrap` from `bol.is_scrap_pickup`). Then:
   - `single` → an `<input type="text">` positioned at the coord, width spanning a sensible portion of the page to the right edge.
   - `multiline` (`specialInstr`, `contactInfo`, `poNumber`, `commodity`) → a `<textarea>` positioned at the coord's top, width = `maxW * s`, initial rows ≈ current line count. Newlines the user types are authoritative lines.
   - `shipto` → a single `<textarea>` over the ship-to block (top at `shipLine1`, width spanning the address area), up to 4 lines; on apply, split by newline and cap at 4.
   - `scrap` → a small Yes/No toggle (two buttons or a labeled checkbox pair) positioned near the scrap coords.

4. **Apply.** On the editor's Apply action, build `bol._overrides` by reading every input. **Only include a field in `_overrides` if its value differs from the initial derived value** (so untouched fields keep deriving from columns and stay clean). Multi-line and shipto values split on `\n` into arrays (trim trailing empties); commodity keeps the user's explicit line breaks; scrap is a boolean. Call `onApply(bol)`.

5. **Cancel** tears down the canvas/overlay and calls `onCancel()`.

### Engine constraints
- Use the platform CSS variables (`--card-bg`, `--border`, `--text`, `--radius`, etc.) for any chrome.
- No external libraries beyond pdf.js (and pdf-lib via `BolShared`). No framework.
- Inputs must be absolutely positioned within a wrapper that is itself `position: relative` and exactly the canvas's rendered pixel size, so the transform lines up regardless of modal scaling.
- Recompute positions on container resize (a single reflow function reused on load and on `resize`).

---

## Part 3 — Wire it into `logistics/bol-generator.html`

1. Load the engine after `bol-shared.js`:
   ```html
   <script src="/logistics/bol-editor.js"></script>
   ```
   (pdf-lib 1.17.1 is already loaded; pdf.js is imported dynamically inside `bol-editor.js`, so no extra tag is needed for it.)

2. Add an editor host element inside the existing review modal markup (a container the engine can mount into), shown only in edit mode and hidden when the read-only iframe is shown. Reuse the existing modal backdrop; swap between the iframe view and the editor view.

3. Replace `handleReviewEdit()` (currently just `closeBolReview()`):
   - Hide the read-only iframe, show the editor host.
   - Call `BolEditor.open(pendingReviewPayloadAsBol, hostEl, { onApply, onCancel })`. The "bol" passed in must be the same object shape `generatePdf` consumes — reuse whatever `tempBol` was built for the preview (carry it alongside `pendingReviewPayload`, or rebuild it from the payload the same way the preview path does).
   - **onApply(updatedBol):** regenerate the preview with overrides attached —
     ```javascript
     const result = await BolShared.generatePdf([updatedBol], { previewOnly: true, packingSlipPdfBytes });
     ```
     revoke the old `pendingReviewBlobUrl`, set the new one, point the iframe at it, hide the editor, show the read-only iframe again. Keep `pendingReviewPayload` as-is (Phase 1 does NOT persist overrides; Approve & Save still sends the structured payload). The override-carrying `updatedBol` is what the preview/print reflect this session.
   - **onCancel():** hide the editor, show the read-only iframe (do not close the whole modal).

4. **Approve & Save is unchanged.** It still POSTs/PUTs `pendingReviewPayload`. The opened/printed PDF in `handleReviewApprove` already uses `pendingReviewBlobUrl`, so it will reflect the overridden preview for this session. (Persisting overrides so they survive reopen is Phase 2.)

---

## Scope Constraints (strict)

- **Three files only:** new `logistics/bol-editor.js`; edits to `logistics/bol-shared.js` (Part 1) and `logistics/bol-generator.html` (Part 3).
- No DB migration, no `_worker.js` change, no approve-payload schema change.
- Do NOT touch `load-builder.html` — it has its own review modal (`showBolReviewLB`); porting the editor there with multi-record navigation is Phase 3 (Prompt 69).
- Do not refactor unrelated code. Do not alter coordinate values, existing helpers, or the existing derive-from-columns render paths except to add the override branch described in Part 1b.
- pdf.js version must match the parser's (`4.4.168`).

## Manual steps after build

- None beyond commit (no migration this phase).
- Verify: Generate a preview → click **Edit** → the blank BOL renders with editable fields overlaid in roughly the right places → edit commodity (watch it re-center and re-size by line count), ship-to lines, delivery time, scrap toggle → **Apply** → preview regenerates with the edits visible → **Approve & Save** prints/saves the edited preview. Reopening the saved BOL will show the un-edited (column-derived) version — that's expected until Phase 2.
- If fields sit slightly high/low across the board, adjust the single `BASELINE_FUDGE` constant in `bol-editor.js`.
