# Prompt 10 — Load Builder: Customize Mode Validation Toasts

You are working inside the xPanda Operations Platform repository.
Follow all rules in AGENTS.md.

---

## Objective

Add validation to the customize trailer panel that fires toast error messages when:

1. **A stack (column) exceeds the trailer height** — the sum of all layer heights in a column exceeds `effectiveHeight` (trailer height minus runner height)
2. **Total BDFT of the customized layout exceeds the trailer's BDFT capacity**

Errors show as toast notifications. The APPLY button is NOT blocked — these are warnings that inform the user, not hard stops.

---

## Scope

**One file only:**

`/logistics/load-builder.html`

Changes:
1. Add a `showToast` function (if one doesn't exist)
2. Add toast CSS
3. Add validation calls in `applyEditorRows`

Do NOT modify any algorithm, packing logic, or other functions.

---

## Step 1 — Add `showToast`

Add this function near the other utility functions (before `render`):

```js
function showToast(message, type = 'warn') {
  const existing = document.getElementById('lb-toast');
  if (existing) existing.remove();

  const colors = {
    warn:  { bg: 'var(--warn-bg)',   border: 'var(--warn-border)', text: 'var(--warn-text-dark)' },
    error: { bg: '#FEF2F2',          border: '#FECACA',            text: '#991B1B' },
  };
  const c = colors[type] || colors.warn;

  const toast = document.createElement('div');
  toast.id = 'lb-toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: ${c.bg};
    border: 1.5px solid ${c.border};
    color: ${c.text};
    font-weight: 700;
    font-size: 14px;
    padding: 12px 22px;
    border-radius: 10px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.13);
    z-index: 9999;
    max-width: 480px;
    text-align: center;
    pointer-events: none;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}
```

---

## Step 2 — Validation in `applyEditorRows`

At the start of `applyEditorRows(ti, skuLib)`, before building `rebuiltRows`, run these two checks:

### Check 1 — Stack height

Get the effective height (trailer height minus runner height):

```js
const trailerDims = getDims();
const effectiveHeight = trailerDims.height - (state.runnerHeight || 0);
```

For each row in `editorRows`, for each column, sum up `layer.count * sku.height` for all layers. If any column's total exceeds `effectiveHeight`, show a toast and return early:

```js
for (const row of editorRows) {
  for (const col of row.columns) {
    const colHeight = col.layers.reduce((sum, layer) => {
      const sku = skuLib.find(s => s.id === layer.skuId);
      return sum + (sku ? sku.height * layer.count : 0);
    }, 0);
    if (colHeight > effectiveHeight) {
      showToast(`⚠ Stack exceeds trailer height (${colHeight}" stacked vs ${effectiveHeight}" max). Reduce layers before applying.`, 'error');
      return;
    }
  }
}
```

### Check 2 — BDFT

After the height check passes, calculate total BDFT of the customized layout across all rows/columns/layers and compare to the trailer capacity:

```js
const trailerBdft = Math.round((trailerDims.length * trailerDims.width * trailerDims.height) / 144);

let layoutBdft = 0;
for (const row of editorRows) {
  for (const col of row.columns) {
    for (const layer of col.layers) {
      const sku = skuLib.find(s => s.id === layer.skuId);
      if (sku) layoutBdft += (sku.length * sku.width * sku.height * layer.count) / 144;
    }
  }
}
layoutBdft = Math.round(layoutBdft);

if (layoutBdft > trailerBdft) {
  showToast(`⚠ Layout exceeds trailer capacity (${layoutBdft.toLocaleString()} BDFT vs ${trailerBdft.toLocaleString()} BDFT max). Review your layout before applying.`, 'error');
  return;
}
```

Both checks use `return` to stop the apply — the layout is not committed when a violation exists.

---

## Constraints

- Do NOT modify the existing warning card in the results tab
- Do NOT change `renderEditorContent` or any render logic
- Do NOT touch any packing algorithm
- Do NOT change `STORAGE_KEY`

---

## Completion

Notify me when done. No migration required.
