# Prompt 123 — BOL re-unification, Phase 1 of 3: shared compose-module scaffold

## Track context (read before doing anything)
This is the **first of three** surgical prompts that re-unify the BOL tooling so the load builder's multi-trailer BOL modal becomes a shared module that `bol-generator.html` will later adopt. Phasing (do **not** do P124/P125 work here):
- **P123 (this prompt)** — scaffold only: create `/logistics/bol-compose.js` owning a self-contained `h()` helper + the BOL-modal CSS (lifted verbatim from `load-builder.html`), injected at load. Remove that CSS from `load-builder.html`. **No JS logic is moved. Zero behavior change.**
- P124 — move `openBolModal`/`renderBolModal` into `BolCompose.open(...)`; load builder becomes a thin adapter.
- P125 — move `generateAllBols`/`generateBolPdf`/`showBolReviewLB`/`lbEditorOnApply` into the module.

## Agent setup
Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. Assume the **logistics-agent** (BOL tooling, `load-builder.html`). No db-api-agent: **no migration, no `_worker.js` change.** Note: the agents doc still calls `_worker.js` a monolith — it has since been modularized; irrelevant to this prompt, do not act on it.

## Success criterion (the whole point of this phase)
After this change, the load builder's "GENERATE BOLs" modal looks and behaves **byte-for-byte identically** — same layout, fonts, spacing, pagination, dark mode — except its CSS now comes from the injected `<style>` in `bol-compose.js` instead of inline in `load-builder.html`. If anything about the modal looks different, the lift was not verbatim.

## DO NOT TOUCH
- `openBolModal`, `renderBolModal`, `generateAllBols`, `generateBolPdf`, `showBolReviewLB`, `closeBolReviewLB`, `lbEditorOnApply`, `saveLoad`, the auto-pack/packing engine, `STORAGE_KEY` (`foam_trailer_loader_v31`), the load-builder `h()` at line ~1219 (leave it; the module ships its own copy), `bol-shared.js`, `bol-editor.js`, `bol-generator.html`, any `.sql`, `_worker.js`.
- Do not rename CSS classes or change any CSS values. Lift them exactly.

---

## Deliverable 1 — create new file `/logistics/bol-compose.js`

Create this file **verbatim**:

```javascript
window.BolCompose = (function () {
  'use strict';

  // ── Self-contained DOM helper (copy of load-builder's h(); kept local so this
  //    module carries no dependency on any consuming page's internals) ──
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'className') el.className = v;
    else if (k === 'innerHTML') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  children.flat(Infinity).forEach(c => {
    if (c == null || c === false) return;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  });
  return el;
}

  // ── Modal styles, lifted verbatim from load-builder.html (P123). Injected once
  //    at load so any consumer gets identical BOL-modal styling without owning the CSS. ──
  const STYLE_ID = 'bol-compose-styles';
  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = `
  /* BOL Modal ─────────────────────────────────────────────────── */
  .bol-backdrop {
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(15,23,42,0.5);
    display: flex; align-items: center; justify-content: center;
  }
  .bol-modal {
    background: var(--surface); border-radius: var(--radius-lg);
    max-width: 680px; width: 95vw; max-height: 90vh; overflow-y: auto;
    box-shadow: 0 20px 60px rgba(15,23,42,0.3);
    display: flex; flex-direction: column;
  }
  .bol-modal-header {
    padding: 20px 24px 16px; border-bottom: 1px solid var(--border-light);
    position: sticky; top: 0; background: var(--surface); z-index: 1; flex-shrink: 0;
  }
  .bol-modal-body { padding: 20px 24px; flex: 1; }
  .bol-modal-footer {
    padding: 14px 24px; border-top: 1px solid var(--border-light);
    display: flex; align-items: center; justify-content: space-between;
    position: sticky; bottom: 0; background: var(--surface); flex-shrink: 0;
  }
  .bol-source-tabs { display: flex; gap: 4px; margin-bottom: 16px; flex-wrap: wrap; }
  .bol-search-results {
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface); box-shadow: 0 4px 16px rgba(15,23,42,0.1);
    max-height: 200px; overflow-y: auto; margin-top: 4px;
  }
  .bol-search-item {
    padding: 10px 14px; cursor: pointer;
    border-bottom: 1px solid var(--border-light); font-size: 14px;
  }
  .bol-search-item:hover { background: var(--bg); }
  .bol-search-item:last-child { border-bottom: none; }
  .bol-confirm-msg { font-size: 13px; color: var(--green); font-weight: 600; margin-bottom: 12px; }
  .bol-form-group { margin-bottom: 12px; }
  .bol-form-group .form-label { display: block; margin-bottom: 4px; }
  .bol-city-row { display: grid; grid-template-columns: 1fr 60px 90px; gap: 8px; }
  .bol-freight-row { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
  .bol-progress-list, .bol-success-list { list-style: none; padding: 0; margin: 12px 0; }
  .bol-progress-list li, .bol-success-list li {
    padding: 8px 0; font-size: 14px; border-bottom: 1px solid var(--border-light);
  }
  @media (max-width: 600px) {
    .bol-modal { border-radius: 0; width: 100vw; max-height: 100vh; }
    .bol-city-row { grid-template-columns: 1fr; }
  }
`;
    document.head.appendChild(el);
  }

  injectStyles();

  // ── Public API ──
  // open() is wired in P124 (render extraction). Scaffold only for P123: this module
  // currently just owns h() and the injected styles. Load builder still uses its own
  // openBolModal/renderBolModal in this phase.
  function open() {
    throw new Error('BolCompose.open is not wired until P124 (render extraction).');
  }

  return { open, _h: h, _injectStyles: injectStyles };

})();
```

The box-drawing characters in the CSS comment (`─`) must be preserved exactly; copy the block as-is.

---

## Deliverable 2 — edit `/logistics/load-builder.html`

### 2A — Remove the BOL Modal CSS from the inline `<style>`
Inside the `<style>` block there is a section that begins with the comment line `/* BOL Modal ─… */` and ends with the closing `}` of its `@media (max-width: 600px)` rule. It defines exactly these selectors and nothing else: `.bol-backdrop`, `.bol-modal`, `.bol-modal-header`, `.bol-modal-body`, `.bol-modal-footer`, `.bol-source-tabs`, `.bol-search-results`, `.bol-search-item` (+ `:hover`, `:last-child`), `.bol-confirm-msg`, `.bol-form-group` (+ `.form-label`), `.bol-city-row`, `.bol-freight-row`, `.bol-progress-list`/`.bol-success-list` (+ their `li`), and the `@media (max-width: 600px)` block.

**Delete that entire section.** Leave the closing `</style>` tag in place. The CSS now lives in `bol-compose.js` (Deliverable 1) — it is identical, so deleting it here is safe.

Start anchor (delete from this line, inclusive):
```
  /* BOL Modal ─────────────────────────────────────────────────── */
```
End anchor (delete through this line, inclusive — it is the closing brace of the media query):
```
  @media (max-width: 600px) {
    .bol-modal { border-radius: 0; width: 100vw; max-height: 100vh; }
    .bol-city-row { grid-template-columns: 1fr; }
  }
```
Do **not** delete `</style>` or anything after it.

### 2B — Load the new module
FIND:
```
<script src="/logistics/bol-editor.js"></script>
```
REPLACE:
```
<script src="/logistics/bol-editor.js"></script>
<script src="/logistics/bol-compose.js"></script>
```

---

## Verify after editing
- `node --check logistics/bol-compose.js` passes.
- In `load-builder.html`, `<style>` and `</style>` counts are still balanced; searching the inline `<style>` for `.bol-backdrop {` returns **nothing** (it moved to the module). The JS still references the classes (e.g. `className: 'bol-backdrop'`, `'bol-modal'`) — leave those untouched.
- Open the load builder, build a load, click **GENERATE BOLs**. The modal renders identically to before: same header, commodity box, hide-dims toggle, search, all form fields, freight radios, special instructions, footer checkboxes, prev/next pagination, GENERATE ALL on the last page. Toggle dark mode — still correct (CSS uses the same `var(--surface)` etc. tokens, which resolve from the page's `tokens.css`).
- DevTools → `<head>` contains one injected `<style id="bol-compose-styles">`. `window.BolCompose._h` is a function. Calling `BolCompose.open()` throws the P124 placeholder error (expected — nothing calls it yet).
- Full regression: generate a single-trailer BOL and a multi-trailer BOL end-to-end (review, edit, save). Behavior unchanged — this phase touched only where the CSS is defined.

## Deploy
```
git add logistics/bol-compose.js logistics/load-builder.html
git commit -m "P123: BOL re-unification phase 1 — bol-compose.js scaffold (own h() + injected modal CSS), CSS lifted out of load-builder, zero behavior change"
git push
```
No migration. No worker change.
