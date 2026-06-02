# Prompt 70 — Load-Builder Editor: Relocate "Editing BOL" Picker to Header Strip

## Agents to assume

**Read BOTH agent files before starting: `AGENTS.md` AND `xpanda-ops-agents.md`.** Then assume this agent and follow its scope and the Orchestrator's cross-cutting rules:

- **Lead: logistics-agent** — owns the load-builder review modal markup and wiring.

This prompt does NOT touch `bol-shared.js`, `bol-editor.js`, `bol-generator.html`, `_worker.js`, or any other module/file.

## Dependencies

- Prompts 66–69 already applied. The shared editor engine (`BolEditor.open(...)`) and the load-builder review modal with picker (`#bol-review-picker-lb`) are in place from P69.

## Goal

When the user clicks **Make Changes** on the load-builder review modal, the editor mounts and the picker bar (`Editing BOL: [dropdown]`) currently lives **inside** the editor host as the first child above the canvas mount. The result is a narrow PDF render because the mount is competing for space (and visually the picker reads as separate from the modal chrome).

Move the picker out of the editor host into a **full-width strip directly under the modal header** (under the Close / Make Changes / Approve button row). The picker is visible only when the editor is open; the editor mount now occupies the full modal interior.

Strictly minimal: relocate one DOM node, drop its old wrapper styles in favor of header-strip styles, toggle visibility with the editor host.

---

## Part 1 — Markup changes in `logistics/load-builder.html`

### 1a. Remove the picker from inside the editor host

Find the current editor host markup added in P69 (around the modal backdrop block, ~line 2976 area). It currently looks like this:

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

Replace with **just** the host wrapping the mount:

```html
<div id="bol-review-editor-host-lb" style="display:none; flex:1; overflow:auto; background:#f9fafb;">
  <div id="bol-review-editor-mount-lb" style="position:relative;"></div>
</div>
```

### 1b. Add the picker as a header-strip sibling

Insert the picker as a **sibling of the iframe and the editor host**, immediately after the existing modal header row (the row containing the `<h3>Review BOL</h3>` title and the Close / Make Changes / Approve buttons). It is hidden by default and shown only when the editor is open.

```html
<div id="bol-review-picker-lb" style="
  display: none;
  padding: 8px 16px;
  border-bottom: 1px solid #e5e7eb;
  background: #ffffff;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  flex-shrink: 0;
">
  <label style="font-weight:600; color:#374151;">Editing BOL:</label>
  <select id="bol-review-picker-select-lb" style="
    padding: 4px 8px;
    border: 1px solid #d1d5db;
    border-radius: 4px;
    font-size: 14px;
  "></select>
</div>
```

Notes:
- `display: none` is the default (matches editor host). When the editor opens, JS will switch to `display: flex` (the original P69 picker had `display: flex` so the existing `align-items: center; gap: 8px;` continues to apply).
- `flex-shrink: 0` keeps the strip from collapsing if the modal panel uses a flex column layout.
- `padding: 8px 16px;` matches the modal header padding for a clean horizontal alignment.

### 1c. Element ID and structural assumption

The element IDs `bol-review-picker-lb` and `bol-review-picker-select-lb` stay the same — only the picker's **position in the DOM tree and its display rules** change. All existing JS lookups by ID continue to work without modification.

---

## Part 2 — JS toggle changes

The picker must show when the editor opens and hide whenever the iframe is shown (cancel, apply→back-to-preview, or close). Find the relevant spots already added in P69 and add picker visibility toggling alongside the existing iframe/host toggling.

### 2a. Show picker on Make Changes (`handleReviewEditLB`)

In `handleReviewEditLB` (the handler wired to the Edit button), where the existing code does something like:

```javascript
  document.getElementById('bol-review-iframe').style.display = 'none';
  document.getElementById('bol-review-editor-host-lb').style.display = '';
```

…add immediately after:

```javascript
  document.getElementById('bol-review-picker-lb').style.display = 'flex';
```

### 2b. Hide picker on editor Apply or Cancel returning to preview

Inside `lbEditorOnApply` (regenerate preview, hide editor, show iframe) and `lbEditorOnCancel` (hide editor, show iframe) — wherever the iframe is shown back and the editor host is hidden — add:

```javascript
  document.getElementById('bol-review-picker-lb').style.display = 'none';
```

### 2c. Hide picker on full modal close (`closeBolReviewLB`)

In `closeBolReviewLB`, alongside the existing teardown lines (the editor host hide added in P69's Part 7), add:

```javascript
  document.getElementById('bol-review-picker-lb').style.display = 'none';
```

This ensures that if the modal is closed mid-edit, the picker is reset for the next open.

### 2d. No other JS changes

- The picker population logic (the `lbReviewBols.forEach((b, i) => ...)` block, the `cloneNode/replaceChild` re-binding of the `change` handler, the index restore) all remain exactly as in P69. The element it queries by ID still exists; only its position in the tree changed.
- Do NOT touch `BolEditor.open`, the engine itself, the save path, the persistence wiring, or any other P69 behavior.

---

## Scope Constraints (strict)

- **One file only:** `logistics/load-builder.html`.
- Three DOM-position/style changes (picker removed from host, picker added as header-strip sibling, default display becomes `none`) and three JS lines added (one per show/hide site).
- Do not refactor or restyle anything else in the modal. Do not change the modal width, the iframe sizing, the host's `flex:1`/`overflow:auto`, the canvas mount, or the engine's render scale. If the PDF still feels too small after this change, that's a separate engine-side tuning knob (`BolEditor`'s canvas render scale) handled in a future prompt — out of scope here.

## Manual steps after build

- None (no migration, no other module).
- Verify: Build a load → Generate BOL → review modal → click **Make Changes**. The picker should appear as a thin strip directly under the Close/Make Changes/Approve row, full-width. The editor canvas/PDF below should be visibly larger than before. Picker change still re-opens the editor on the selected BOL. Closing the modal or applying/cancelling the editor hides the picker.
