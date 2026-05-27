# Prompt 55 — Part Number & Qty Only Toggle on BOL Generator and Load Builder

## Goal

Add a toggle to hide dimensions from the BOL commodity description. Some customers don't want dimensions on their BOL — they just want part numbers and quantities. This is a per-session UI toggle (not persisted), available in both the BOL Generator and the Load Builder BOL modal.

**Read `AGENTS.md` before starting. Follow all rules strictly.**

---

## Context

**BOL Generator** — When prefilling commodity from job line items (around line 754 of `bol-generator.html`), each line is formatted as:

```
QTY × PART_NUMBER DESCRIPTION
```

Example: `640 × H3636-4 1.0#EPS 36" x 36" x 4" Sheet`

The description field from the parts library typically contains dims. This toggle should strip any dimension-like text from the description, leaving just qty and part number.

**Load Builder** — When building the BOL commodity string (around line 2171 of `load-builder.html`), each line is formatted as:

```
QTY pcs — NAME (SKU) L"×W"×H"
```

Example: `640 pcs — 1.0#EPS 36x36x4 Sheet (H3636-4) 36"×36"×4"`

The explicit `L"×W"×H"` suffix is appended from the SKU's length/width/height fields. This toggle should omit that suffix.

---

## Step 1 — BOL Generator: add toggle checkbox

In `logistics/bol-generator.html`, find the commodity description textarea (around line 578):

```html
<textarea id="f-commodity" rows="6" placeholder="e.g. 640 pcs - 1.0#EPS 1.25&quot; x 96&quot; x 11/9&quot; TAPER"></textarea>
```

Add a checkbox **immediately below** the textarea:

```html
<label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:13px;color:#6b7280;cursor:pointer;">
  <input type="checkbox" id="f-hide-dims" onchange="toggleHideDims()">
  Part # and qty only (hide dimensions)
</label>
```

### Toggle logic

Add a `toggleHideDims()` function. When checked, it re-processes the commodity textarea to strip dimension patterns. When unchecked, it restores the original text.

```javascript
let commodityWithDims = ''; // stores the full-dims version

function toggleHideDims() {
  const ta = document.getElementById('f-commodity');
  const hide = document.getElementById('f-hide-dims').checked;

  if (hide) {
    // Save the current full text before stripping
    commodityWithDims = ta.value;
    ta.value = stripDimsFromCommodity(ta.value);
  } else {
    // Restore full text
    if (commodityWithDims) {
      ta.value = commodityWithDims;
    }
  }
}

function stripDimsFromCommodity(text) {
  return text.split('\n').map(line => {
    // Pattern 1 (load builder format): "640 pcs — Name (SKU) 36"×36"×4""
    // Strip trailing dimension pattern like: 36"×36"×4" or 36" x 36" x 4"
    let stripped = line.replace(/\s+\d+(?:\.\d+)?"\s*[×xX]\s*\d+(?:\.\d+)?"\s*[×xX]\s*\d+(?:\.\d+)?"\s*$/, '');

    // Pattern 2 (description contains dims): "1.0#EPS 36" x 36" x 4" Sheet"
    // Strip inline dimension patterns like: 36" x 36" x 4" or 36"x36"x4"
    stripped = stripped.replace(/\s+\d+(?:\.\d+)?(?:"|'')\s*[×xX]\s*\d+(?:\.\d+)?(?:"|'')\s*[×xX]\s*\d+(?:\.\d+)?(?:"|'')\s*/g, ' ');

    // Pattern 3: dimensions with fractions like 1.25" x 96" x 11/9"
    stripped = stripped.replace(/\s+[\d/.]+"\s*[×xX]\s*[\d/.]+"\s*[×xX]\s*[\d/.]+"\s*/g, ' ');

    // Clean up extra whitespace
    stripped = stripped.replace(/\s{2,}/g, ' ').trim();

    return stripped;
  }).join('\n');
}
```

### Preserve toggle state on prefill

In the `prefillFromJob()` function (around line 754), after setting the commodity textarea value, reset the toggle state:

```javascript
// After: document.getElementById('f-commodity').value = lines.join('\n');
commodityWithDims = ''; // reset stored dims version
document.getElementById('f-hide-dims').checked = false;
```

Also reset in `clearForm()`:

```javascript
commodityWithDims = '';
if (document.getElementById('f-hide-dims')) document.getElementById('f-hide-dims').checked = false;
```

---

## Step 2 — Load Builder: add toggle to BOL modal

In `logistics/load-builder.html`, find the `openBolModal()` function (around line 2167). In the per-trailer BOL data setup, the commodity description is built at line 2171:

```javascript
const commodityDescription = breakdown.map(item => {
  const sku = state.skus.find(s => s.id === item.skuId);
  if (!sku) return `${item.pieces} pcs — ${item.name} (${item.sku})`;
  return `${item.pieces} pcs — ${item.name} (${item.sku}) ${sku.length}"×${sku.width}"×${sku.height}"`;
}).join('\n');
```

### 2a. Store both versions

For each trailer data object, store both the full commodity description and the no-dims version:

```javascript
const commodityDescriptionFull = breakdown.map(item => {
  const sku = state.skus.find(s => s.id === item.skuId);
  if (!sku) return `${item.pieces} pcs — ${item.name} (${item.sku})`;
  return `${item.pieces} pcs — ${item.name} (${item.sku}) ${sku.length}"×${sku.width}"×${sku.height}"`;
}).join('\n');

const commodityDescriptionNoDims = breakdown.map(item => {
  return `${item.pieces} pcs — ${item.name} (${item.sku})`;
}).join('\n');
```

Set both on the trailer data object:

```javascript
const td = {
  // ... existing fields
  commodityDescription: commodityDescriptionFull,
  commodityDescriptionFull: commodityDescriptionFull,
  commodityDescriptionNoDims: commodityDescriptionNoDims,
  // ... rest of existing fields
};
```

### 2b. Add toggle checkbox to BOL modal UI

Find where the BOL modal renders the commodity textarea for each trailer (the `commTA` textarea). This is in the `renderBolModal()` function. Add a checkbox above or below the commodity textarea:

```javascript
const hideDimsLabel = h('label', {
  style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#6b7280', cursor: 'pointer', marginBottom: '8px' }
});
const hideDimsCheck = h('input', {
  type: 'checkbox',
  onChange: (e) => {
    const hide = e.target.checked;
    td.commodityDescription = hide ? td.commodityDescriptionNoDims : td.commodityDescriptionFull;
    commTA.value = td.commodityDescription;
  }
});
hideDimsLabel.appendChild(hideDimsCheck);
hideDimsLabel.appendChild(document.createTextNode('Part # and qty only (hide dimensions)'));
```

Insert `hideDimsLabel` immediately before or after the commodity textarea in the modal.

### 2c. Keep manual edits in sync

When the user manually edits the commodity textarea, update the appropriate stored version:

```javascript
commTA.addEventListener('input', e => {
  td.commodityDescription = e.target.value;
  // Also update the "full" version if dims are showing, so toggling back preserves manual edits
  if (!hideDimsCheck.checked) {
    td.commodityDescriptionFull = e.target.value;
  } else {
    td.commodityDescriptionNoDims = e.target.value;
  }
});
```

---

## What NOT to touch

- Do NOT modify `bol-shared.js` — this is a UI-only change
- Do NOT modify `_worker.js` — no API changes
- Do NOT modify `loading.html` or `logistics/index.html`
- Do NOT persist the hide-dims preference to the database
- Do NOT modify how the commodity description is stored in the `bols` table — whatever text is in the textarea at generation time is what gets saved
- Do NOT change the PDF coordinate layout or rendering logic

---

## Completion checklist

- [ ] `bol-generator.html`: "Part # and qty only" checkbox below commodity textarea
- [ ] `bol-generator.html`: `toggleHideDims()` strips dimension patterns from commodity text
- [ ] `bol-generator.html`: unchecking restores original text with dims
- [ ] `bol-generator.html`: toggle resets on prefill and form clear
- [ ] `load-builder.html`: both full and no-dims commodity versions stored per trailer
- [ ] `load-builder.html`: "Part # and qty only" checkbox in BOL modal per trailer
- [ ] `load-builder.html`: checking toggle swaps commodity textarea to no-dims version
- [ ] `load-builder.html`: manual textarea edits preserved when toggling
- [ ] The text in the textarea at generation time is what gets saved to DB and rendered in PDF — toggle only affects the display
- [ ] No console errors

**Notify Steve:** No migrations needed. Deploy and test:
1. Open BOL Generator → prefill from a job with line items → commodity field shows dims
2. Check "Part # and qty only" → dims stripped from commodity text
3. Uncheck → original text restored
4. Generate BOL with toggle checked → PDF commodity shows no dims
5. Open Load Builder → add parts → Results → Generate BOLs → BOL modal opens
6. Check "Part # and qty only" on a trailer → commodity textarea updates to no-dims version
7. Uncheck → full version restored
8. Manually edit commodity text → toggle back and forth → manual edits preserved
