# Prompt 69 — BOL Inline Editor Phase 3: Port to Load Builder (multi-record) + Close button

## Agents to assume

**Read BOTH agent files before starting: `AGENTS.md` AND `xpanda-ops-agents.md`.** Then assume this agent and follow its scope and the Orchestrator's cross-cutting rules:

- **Lead: logistics-agent** — owns `load-builder.html` and the load-builder's review modal flow.

This prompt does NOT touch the BOL generator, `bol-shared.js`, or `bol-editor.js` — those landed in P67/P68. It also does NOT touch the worker or any other module. The shared engine (`BolEditor.open(...)`) and the persistence column (`bols.render_overrides`) are already in place.

## Dependencies

- Prompts 66, 67, and 68 already applied and verified in the BOL generator.
- `BolEditor.open(bol, mountEl, { onApply, onCancel })` works against any bol-shape object that `BolShared.generatePdf` accepts.
- The `bols.render_overrides` column exists; `POST /api/bols` and `PUT /api/bols/:id` already accept `render_overrides`.

## Goal

Port the WYSIWYG inline editor from the BOL generator into the load builder's review modal. The load builder previews **multiple BOLs in one PDF** (one per shipment/group in the saved load), so the editor needs **per-record navigation** — the user picks which BOL within the load to edit, applies edits to just that one, and the regenerated multi-page preview reflects the edits in place. Persistence rides through the existing load-builder save path. Plus add a Close button to the load-builder's review modal to match the BOL generator.

---

## Part 1 — Load `bol-editor.js`

Add the script tag to `load-builder.html` (near the existing `bol-shared.js` script tag):

```html
<script src="/logistics/bol-editor.js"></script>
```

The engine handles its own dynamic import of pdf.js (same `4.4.168` version the parser uses). No other deps needed.

## Part 2 — Track the multi-BOL array in module state

The load builder currently builds an array of bol objects when the user clicks "Generate BOL" — call this array whatever it's already called in the file (likely something like `lbBolsArray`, `pendingBolList`, or constructed inline inside `showBolReviewLB`). Promote it (or capture it) to module-scoped state so the editor can reference it across user actions:

```javascript
  let lbReviewBols = [];        // the array passed to generatePdf for this preview
  let lbReviewActiveIndex = 0;  // which BOL the editor is currently editing
```

When the preview is built, assign:

```javascript
  lbReviewBols = [ ...computedBolList ]; // same array passed to generatePdf
  lbReviewActiveIndex = 0;
```

(Use whatever the existing variable holding the array is named. Do not rename existing variables — just capture into the module-scoped ones.)

## Part 3 — Rewire `handleReviewEdit` for the load builder

Currently `closeBolReviewLB` is wired to the Edit button (around line 2811: `newEdit.addEventListener('click', closeBolReviewLB);`). Replace with a real handler.

```javascript
  newEdit.addEventListener('click', handleReviewEditLB);
```

Add the handler. It should:

1. Hide the iframe (`document.getElementById('bol-review-iframe').style.display = 'none';`) and show an editor host container (see Part 4 markup).
2. Render a small **picker bar** above the editor host: a dropdown or button row listing each BOL in `lbReviewBols`, labeled by ship-to company + BOL number (or just `BOL ${i+1} of ${N}` if those are empty). The active index defaults to 0. Changing the picker:
   - Cancels any open editor instance (`BolEditor` should expose a no-op `cancel()` or the engine should idempotently clean up its mount — if not, just call `onCancel` semantics by re-mounting fresh).
   - Re-mounts the editor for the newly selected bol.
3. Call `BolEditor.open(lbReviewBols[lbReviewActiveIndex], hostEl, { onApply, onCancel })`.
4. **onApply(updatedBol):** the editor mutates the same object reference (`updatedBol === lbReviewBols[lbReviewActiveIndex]` after assignment of `_overrides`). Regenerate the multi-BOL preview from the same array:
   ```javascript
   const result = await BolShared.generatePdf(lbReviewBols, { previewOnly: true });
   // revoke old blob URL, set new one on the iframe, hide editor host, show iframe
   ```
   The picker stays where the user left it — closing the editor without changing index lets them pick another BOL to edit.
5. **onCancel():** hide editor host, show iframe. Picker state preserved.

If the existing load-builder preview code (`showBolReviewLB`) passes additional options to `generatePdf` (e.g., a packing-slip merge), pass the same options through on regen so nothing drops.

## Part 4 — Modal markup additions

In the load-builder review modal markup (around line 2976, `<div id="bol-review-backdrop">`), add:

1. **An editor host container** as a sibling of the iframe, initially hidden:
   ```html
   <div id="bol-review-editor-host-lb" style="display:none; flex:1; overflow:auto; background:#f9fafb;">
     <div id="bol-review-picker-lb" style="
       padding: 8px 12px;
       border-bottom: 1px solid #e5e7eb;
       background: #ffffff;
       display: flex;
       align-items: center;
       gap: 8px;
       font-size: 14px;
     ">
       <label style="font-weight:600; color:#374151;">Editing BOL:</label>
       <select id="bol-review-picker-select-lb" style="
         padding: 4px 8px;
         border: 1px solid #d1d5db;
         border-radius: 4px;
         font-size: 14px;
       "></select>
     </div>
     <div id="bol-review-editor-mount-lb" style="position:relative;"></div>
   </div>
   ```
   The editor engine mounts into `#bol-review-editor-mount-lb`.

2. **A Close button** to the left of the Edit button (matching P68's BOL generator change):
   ```html
       <button id="bol-review-close-lb" style="
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

Wire the Close button in the same function that wires Edit/Approve (around line 2789):

```javascript
  const closeBtn = document.getElementById('bol-review-close-lb');
  if (closeBtn) {
    const newClose = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newClose, closeBtn);
    newClose.addEventListener('click', closeBolReviewLB);
  }
```

## Part 5 — Populate the picker

Inside `handleReviewEditLB`, before calling `BolEditor.open`, build the picker options from `lbReviewBols`:

```javascript
  const sel = document.getElementById('bol-review-picker-select-lb');
  sel.innerHTML = '';
  lbReviewBols.forEach((b, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    const label = b.ship_to_company || b.bol_number || `BOL ${i+1}`;
    opt.textContent = `BOL ${i+1} of ${lbReviewBols.length} — ${label}`;
    sel.appendChild(opt);
  });
  sel.value = String(lbReviewActiveIndex);
  // Re-bind change handler (clone-replace pattern as elsewhere in file)
  const newSel = sel.cloneNode(true);
  sel.parentNode.replaceChild(newSel, sel);
  newSel.addEventListener('change', (e) => {
    lbReviewActiveIndex = Number(e.target.value) || 0;
    BolEditor.open(lbReviewBols[lbReviewActiveIndex],
      document.getElementById('bol-review-editor-mount-lb'),
      { onApply: lbEditorOnApply, onCancel: lbEditorOnCancel });
  });
```

Extract `lbEditorOnApply` and `lbEditorOnCancel` as named functions in module scope so they can be reused both for the initial open and for picker-driven re-opens.

## Part 6 — Persistence on load-builder save

The load builder's existing "Approve & Save" path saves each BOL via `POST /api/bols` (or `PUT` if updating). For each saved bol, include `render_overrides` in the payload:

```javascript
  // Inside whatever function iterates lbReviewBols and POSTs each to /api/bols
  const payload = {
    ...buildBolPayloadFor(bol), // existing payload-builder, whatever it's named
    render_overrides: bol._overrides || null,
  };
```

If the load builder's save path currently constructs the payload from form fields rather than the bol object array, switch that one call to pull `render_overrides` from the corresponding `lbReviewBols[i]._overrides`. Do NOT refactor the whole save path — just add the one field.

## Part 7 — Reset on close

When `closeBolReviewLB` runs (around line 2814), clear the multi-record state so the next preview opens fresh:

```javascript
function closeBolReviewLB() {
  const backdrop = document.getElementById('bol-review-backdrop');
  // ... existing teardown ...
  document.getElementById('bol-review-iframe').src = '';
  document.getElementById('bol-review-iframe').style.display = '';  // restore default
  document.getElementById('bol-review-editor-host-lb').style.display = 'none';
  lbReviewBols = [];
  lbReviewActiveIndex = 0;
}
```

Don't remove existing lines — just add the editor-host hide and the state reset. The iframe `display = ''` line restores the default display in case Edit was clicked during this session.

---

## Scope Constraints (strict)

- **One file only:** `logistics/load-builder.html`. Single `<script src>` addition for `bol-editor.js` lives in this file's `<head>` (counted as part of the same file).
- **Do NOT touch:** `bol-shared.js`, `bol-editor.js`, `bol-generator.html`, `_worker.js`, any DB migration, any other module.
- Do not refactor existing load-builder code outside the specific touchpoints listed (review modal markup, button wiring, save-payload single-field addition, `closeBolReviewLB` teardown).
- Preserve the existing `cloneNode/replaceChild` pattern for re-binding event listeners — that's how this file avoids duplicate listeners on re-show.
- Use platform CSS variables where possible (`--border`, `--text`); the inline styles above are minimal and match the BOL generator's modal styling for consistency.

## Manual steps after build

- None (no migration this prompt — P68 already added the column).
- Verify on a multi-shipment load:
  1. Build a load with at least 2 BOLs → Generate BOL → review modal opens with multi-page PDF.
  2. Click **Edit** → picker bar appears with "BOL 1 of N — <ship-to>" options; editor opens on BOL 1.
  3. Make edits → Apply → preview regenerates; edits visible on the corresponding page.
  4. Change the picker to BOL 2 → editor re-opens on BOL 2 → edit → Apply → preview reflects BOL 2 edits while BOL 1 edits are still there.
  5. Click **Close** on the review modal → modal dismisses, no save.
  6. Re-run, this time **Approve & Save** → each BOL persists with its own `render_overrides` (or `null` if untouched). Reopening any saved BOL in the BOL generator (P68) should show its persisted overrides — and re-generating the same load in the load builder should also rehydrate (load-builder rehydrate is out of scope here unless the existing reopen path already calls `loadBolIntoForm`-equivalent logic; if not, that's a future prompt).
