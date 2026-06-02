# Prompt 71 — Loading Diagram: Rename Print Button + Add "Include Loading Diagram" BOL Attachment

## Agents to assume

**Read BOTH agent files before starting: `AGENTS.md` AND `xpanda-ops-agents.md`.** Then assume this agent and follow its scope and the Orchestrator's cross-cutting rules:

- **Lead: logistics-agent** — owns `load-builder.html` and the BOL generation modal flow.

This prompt does NOT touch `bol-shared.js`, `bol-generator.html`, `_worker.js`, any DB migration, or any other module/file.

## Goal

Two changes to `logistics/load-builder.html`, both centered on the **loading diagram** (the trailer layout SVG + pieces/stacks tables that prints from each trailer card):

1. **Rename the existing "PRINT PACKING SLIP" button to "PRINT LOADING DIAGRAM"** (and its printed page title), because what it prints is the loading diagram — not a packing slip. The function name `printPackingSlip` and any internal variable names stay as-is to keep the diff small.
2. **Add a new BOL-modal checkbox "Include Loading Diagram"** that, when checked, captures the same diagram as PDF bytes and appends it to the generated BOL via `bol-shared.js`'s existing `packingSlipPdfBytes` pipeline. This is **separate and independent from the existing "Include packing slip" checkbox** — both can be toggled on the same BOL, and both append additional pages to the final PDF.

The existing "Include packing slip" checkbox (which fetches the QuickBase-uploaded packing slip from `/api/jobs/:id/packing-slip` and appends it) is **left exactly as it is** — name unchanged, behavior unchanged. It remains a future hook in case it's wired differently later.

## Why a new CDN dependency

`bol-shared.js` already accepts `packingSlipPdfBytes` (ArrayBuffer/Uint8Array) and appends those pages via pdf-lib's `copyPages`. To use the same pipeline for the loading diagram, we need the diagram as **PDF bytes**. The diagram is currently HTML + inline SVG + two tables rendered in a popup window for printing — not PDF.

Use **html2canvas** to render an offscreen DOM copy of the same diagram HTML to a canvas, then embed that canvas as a PNG into a single landscape `pdf-lib` page and return the bytes. This keeps the diagram's source of truth in one place (`buildPrintSvg` + the existing print HTML string), so future tweaks to the diagram print continue to flow into the BOL-attached version automatically.

Add this CDN script tag near the existing pdf-lib script tag (around line 419):

```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"></script>
```

Do NOT add any other dependency. Do NOT use a different version of html2canvas.

---

## Part 1 — Rename "Print Packing Slip" → "Print Loading Diagram"

### 1a. Button label on the trailer card

Around line 1848, find:

```javascript
tRight.appendChild(h('button', { className: 'btn btn-teal', onClick: () => printPackingSlip(trailer, trailerDims, trailerLabel, ti + 1, packList, state.trailerInvNumbers[ti] || '') }, 'PRINT PACKING SLIP'));
```

Change only the visible button text:

```javascript
tRight.appendChild(h('button', { className: 'btn btn-teal', onClick: () => printPackingSlip(trailer, trailerDims, trailerLabel, ti + 1, packList, state.trailerInvNumbers[ti] || '') }, 'PRINT LOADING DIAGRAM'));
```

The function name `printPackingSlip` stays — renaming the function is out of scope (would touch the trailer-card render path and any other call sites). The button label is the only user-visible string here.

### 1b. Printed page title and heading

Inside the `printPackingSlip` function (around line 1137), the `win.document.write(...)` template currently has:

- `<title>Packing Slip - Trailer ${trailerNumber}</title>`
- `<h1>Trailer ${trailerNumber} Packing Slip</h1>`

Change both strings to "Loading Diagram":

- `<title>Loading Diagram - Trailer ${trailerNumber}</title>`
- `<h1>Trailer ${trailerNumber} Loading Diagram</h1>`

No other string in that template changes. The `PIECES` and `STACK BREAKDOWN` table headers stay.

### 1c. Do NOT change

- The function name `printPackingSlip`.
- The variable name `packList`.
- Any non-visible internal naming.
- The existing "Include packing slip" checkbox or its handler (Part 2 adds a new checkbox alongside; the existing one is untouched).

---

## Part 2 — New "Include Loading Diagram" checkbox

### 2a. Module state

The BOL modal state already has `includePacking: false` (around line 2241). Add a sibling:

```javascript
includePacking: false,
includeLoadingDiagram: false,
```

Place `includeLoadingDiagram` immediately after `includePacking` in the same state initializer block.

### 2b. Checkbox markup

Around line 2543, the existing "Include packing slip" checkbox is appended only when `state.prefillJobData?.id` exists (it depends on a job context for the fetch). **The Loading Diagram checkbox has no such dependency** — the diagram is always available from the current trailer state. So append it as a sibling of the `if (state.prefillJobData?.id) { ... }` block, NOT inside it.

Find this block (around line 2540–2548):

```javascript
  if (state.prefillJobData?.id) {
    const packingLabel = h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', cursor: 'pointer', color: 'var(--text-muted)' } });
    const packingChk = h('input', { type: 'checkbox' });
    packingChk.checked = state.bolModal.includePacking;
    packingChk.addEventListener('change', e => { state.bolModal.includePacking = e.target.checked; });
    packingLabel.appendChild(packingChk);
    packingLabel.appendChild(document.createTextNode('Include packing slip'));
    footer.appendChild(packingLabel);
  }
```

Immediately after the closing `}` of that block (still before the `navRight` declaration), add:

```javascript
  {
    const diagramLabel = h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', cursor: 'pointer', color: 'var(--text-muted)' } });
    const diagramChk = h('input', { type: 'checkbox' });
    diagramChk.checked = state.bolModal.includeLoadingDiagram;
    diagramChk.addEventListener('change', e => { state.bolModal.includeLoadingDiagram = e.target.checked; });
    diagramLabel.appendChild(diagramChk);
    diagramLabel.appendChild(document.createTextNode('Include Loading Diagram'));
    footer.appendChild(diagramLabel);
  }
```

The block-scoping with `{ ... }` keeps `diagramLabel` / `diagramChk` from leaking and keeps the visual structure parallel to the existing packing-slip block.

### 2c. Capture-to-PDF helper

Add a new helper function `buildLoadingDiagramPdfBytes(trailer, dims, trailerType, trailerNumber, packList, invNumber)` near `printPackingSlip` (just above or below it — order is fine, both are top-level functions in the same scope). The signature matches `printPackingSlip` so the same arguments work for both.

```javascript
/**
 * Render the loading diagram HTML to an offscreen canvas via html2canvas,
 * then embed it into a single landscape US-Letter pdf-lib page and return
 * the bytes. The HTML reuses the same string template as printPackingSlip
 * so future diagram tweaks stay single-sourced — only diverging lines:
 *   - no <title>, no print script, no body margins fight
 *   - mounted into a hidden div in the current document, not a popup
 *
 * Returns Uint8Array suitable for BolShared.generatePdf({ packingSlipPdfBytes }).
 */
async function buildLoadingDiagramPdfBytes(trailer, dims, trailerType, trailerNumber, packList, invNumber = '') {
  // Build the same inner HTML printPackingSlip builds. To keep this DRY, factor
  // the inner body markup into a small helper that BOTH printPackingSlip and
  // this function consume. The factored helper builds just the <div class="page">…</div>
  // content (everything inside <body>), parameterized identically.
  const innerHtml = buildLoadingDiagramInnerHtml(trailer, dims, trailerType, trailerNumber, packList, invNumber);

  // Mount offscreen at a fixed render width so html2canvas captures at predictable resolution.
  // 1100px ≈ landscape Letter content area at ~96dpi; scale: 2 in html2canvas options gives a sharp render.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed; left:-99999px; top:0; width:1100px; background:#fff; font-family:Arial, sans-serif; color:#0f172a;';
  host.innerHTML = innerHtml;
  document.body.appendChild(host);

  let canvas;
  try {
    canvas = await html2canvas(host, { scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: true });
  } finally {
    document.body.removeChild(host);
  }

  // Embed canvas PNG into a single landscape Letter page via pdf-lib.
  const pngDataUrl = canvas.toDataURL('image/png');
  const pngBytes = await fetch(pngDataUrl).then(r => r.arrayBuffer());
  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.create();
  const page = doc.addPage([792, 612]); // US Letter landscape (points)
  const pageW = page.getWidth();
  const pageH = page.getHeight();
  const margin = 18; // ~0.25" margin
  const pngImg = await doc.embedPng(pngBytes);
  // Fit image within page minus margins, preserve aspect ratio.
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;
  const ratio = Math.min(maxW / pngImg.width, maxH / pngImg.height);
  const drawW = pngImg.width * ratio;
  const drawH = pngImg.height * ratio;
  page.drawImage(pngImg, {
    x: (pageW - drawW) / 2,
    y: (pageH - drawH) / 2,
    width: drawW,
    height: drawH,
  });
  return await doc.save();
}
```

### 2d. Factor shared inner HTML out of `printPackingSlip`

To avoid drift between the print popup and the embedded version, extract the body's inner HTML — currently inlined inside the giant `win.document.write(...)` call — into a helper that both consume:

```javascript
/**
 * Returns the inner <body> HTML for the Loading Diagram print/embed.
 * Used by both printPackingSlip (popup print) and buildLoadingDiagramPdfBytes (BOL embed).
 */
function buildLoadingDiagramInnerHtml(trailer, dims, trailerType, trailerNumber, packList, invNumber = '') {
  // Move the existing body-side string-building logic from printPackingSlip here:
  //   - invSuffix, runnerNotice, piecesHtml, stackHtml derivations (already in printPackingSlip)
  //   - the entire `<div class="page">…</div>` block (everything between <body> and </body>)
  // Return the page HTML PLUS a <style> block with the same CSS that currently lives in
  // the popup's <head>. That way the embedded render in buildLoadingDiagramPdfBytes
  // gets the same styling without us writing a <head>.
  //
  // The returned string must NOT include <html>, <head>, <body>, <title>, or the
  // window.onload print script. It is mounted directly into a div for html2canvas
  // and wrapped by printPackingSlip into its <html>…</html> envelope.

  // ... existing inv/runner/pieces/stack derivations move here verbatim ...
  // return `<style>…existing CSS…</style><div class="page">…existing markup…</div>`;
}
```

Then update `printPackingSlip` to consume the helper. Its `win.document.write(...)` becomes:

```javascript
win.document.write(`<html><head><title>Loading Diagram - Trailer ${trailerNumber}</title></head><body>${buildLoadingDiagramInnerHtml(trailer, dims, trailerType, trailerNumber, packList, invNumber)}<script>window.onload=function(){setTimeout(function(){window.print()},250)};<\/script></body></html>`);
```

(Note: the `<title>` reflects the rename from Part 1b. The `<style>` block now lives inside the inner HTML returned by `buildLoadingDiagramInnerHtml` — moving it from the popup's `<head>` to a `<style>` tag inside the body is valid HTML in this context and keeps the embedded render styled the same way.)

**Important:** the body of `buildLoadingDiagramInnerHtml` must be a verbatim move of the existing string-building from `printPackingSlip` — same `invSuffix`, `runnerNotice`, `piecesHtml`, `stackHtml` logic, same `<div class="page">` markup, same `buildPrintSvg(trailer, dims)` call. Do not "improve" the diagram, do not restyle anything. The only structural change is that the `<style>` block moves from `<head>` to a `<style>` tag at the top of the returned inner HTML.

### 2e. Wire the new checkbox into BOL generation

The BOL generation path is around line 2768:

```javascript
  let packingSlipPdfBytes = null;
  if (state.bolModal.includePacking && state.prefillJobData?.id) {
    try {
      const slipRes = await fetch('/api/jobs/' + encodeURIComponent(state.prefillJobData.id) + '/packing-slip');
      if (slipRes.ok) {
        packingSlipPdfBytes = await slipRes.arrayBuffer();
      }
    } catch { /* packing slip unavailable */ }
  }
  // ...
  const result = await BolShared.generatePdf(bolRecords, { previewOnly: true, packingSlipPdfBytes });
```

`bol-shared.js` currently accepts a single `packingSlipPdfBytes` and appends those pages. The simplest extension that requires no `bol-shared.js` change: if **both** checkboxes are enabled, **concatenate** the bytes by merging them into one combined PDF before passing as `packingSlipPdfBytes`. If only one is enabled, pass that one's bytes directly. If neither, pass `null` as today.

Replace the block above with:

```javascript
  // Collect optional appended-PDF bytes (packing slip and/or loading diagram).
  // bol-shared.js accepts a single packingSlipPdfBytes; if both are present we
  // merge them into one PDF here so the generator stays untouched.
  let packingSlipPdfBytes = null;
  let loadingDiagramPdfBytes = null;

  if (state.bolModal.includePacking && state.prefillJobData?.id) {
    try {
      const slipRes = await fetch('/api/jobs/' + encodeURIComponent(state.prefillJobData.id) + '/packing-slip');
      if (slipRes.ok) {
        packingSlipPdfBytes = await slipRes.arrayBuffer();
      }
    } catch { /* packing slip unavailable */ }
  }

  if (state.bolModal.includeLoadingDiagram) {
    try {
      // Build the diagram for the CURRENTLY-DISPLAYED trailer in the BOL modal.
      // The BOL modal is paged per trailer, so build the diagram for state.trailers[bm.currentPage].
      // Use the same arguments printPackingSlip uses on the trailer card.
      const idx = state.bolModal.currentPage;
      const trailer = state.trailers[idx];
      const trailerType = computeTrailerLabel(trailer); // use whichever existing helper printPackingSlip uses; mirror that call site exactly
      loadingDiagramPdfBytes = await buildLoadingDiagramPdfBytes(
        trailer,
        trailer.dims, // mirror the existing call: pass trailer + dims the same way printPackingSlip is invoked from the trailer card
        trailerType,
        idx + 1,
        buildPackList(trailer), // again, whatever name the existing packList builder uses at the trailer-card call site
        state.trailerInvNumbers[idx] || ''
      );
    } catch (e) {
      console.error('Failed to build loading diagram PDF:', e);
    }
  }

  // Combine: if both, merge into one. If only one, use it. Else null.
  let combinedAppendBytes = null;
  if (packingSlipPdfBytes && loadingDiagramPdfBytes) {
    try {
      const { PDFDocument } = PDFLib;
      const combined = await PDFDocument.create();
      const slipDoc = await PDFDocument.load(packingSlipPdfBytes);
      const diagDoc = await PDFDocument.load(loadingDiagramPdfBytes);
      const slipPages = await combined.copyPages(slipDoc, slipDoc.getPageIndices());
      slipPages.forEach(p => combined.addPage(p));
      const diagPages = await combined.copyPages(diagDoc, diagDoc.getPageIndices());
      diagPages.forEach(p => combined.addPage(p));
      combinedAppendBytes = await combined.save();
    } catch (e) {
      console.error('Failed to merge packing slip + loading diagram:', e);
      combinedAppendBytes = packingSlipPdfBytes || loadingDiagramPdfBytes;
    }
  } else {
    combinedAppendBytes = packingSlipPdfBytes || loadingDiagramPdfBytes;
  }
  // ...
  const result = await BolShared.generatePdf(bolRecords, { previewOnly: true, packingSlipPdfBytes: combinedAppendBytes });
```

**Implementer note — mirror the trailer-card call exactly:** the trailer card invokes `printPackingSlip(trailer, trailerDims, trailerLabel, ti + 1, packList, state.trailerInvNumbers[ti] || '')`. The names `trailerDims`, `trailerLabel`, `packList` come from the local render scope of that card. When building the diagram from the BOL modal, look up the **same values for the currently-paged trailer** by reusing whatever derivation that render path uses (or, if simpler, factor that derivation into a small helper that both call sites consume). The pseudo-names `trailer.dims`, `computeTrailerLabel(trailer)`, and `buildPackList(trailer)` in the snippet above are placeholders — replace them with the actual derivations from the trailer-card code path so the diagram for trailer N from the BOL modal renders identically to the diagram printed from trailer card N. Do **not** invent new helpers if the existing render path inlines these — just inline the same expressions.

### 2f. Multi-trailer note

The BOL modal pages through trailers (one BOL per trailer). The diagram is per-trailer. For this prompt, attach the diagram **for the trailer corresponding to each BOL being generated**. If `bolRecords` covers multiple trailers (when "GENERATE ALL BOLs" is clicked), build a diagram PDF per trailer and let each BOL append its own. The merge logic above is per-BOL-generation; if the existing code iterates BOLs and calls `BolShared.generatePdf` once per BOL, do the diagram build inside that iteration so each BOL gets the right trailer's diagram. If `BolShared.generatePdf` is called **once with all bolRecords**, then the diagram-per-trailer approach doesn't fit and we should attach only the current page's diagram — pick whichever matches the existing structure and **comment which assumption you used at the top of the diagram block** so Steve can verify. Do not refactor `bol-shared.js`'s contract to accept per-BOL append bytes — that's a future prompt if needed.

---

## Scope Constraints (strict)

- **One file only:** `logistics/load-builder.html`. Plus one new CDN `<script>` tag for html2canvas in the same file's `<head>`.
- Do NOT touch `bol-shared.js`, `bol-generator.html`, `_worker.js`, any DB migration, any other module.
- Do NOT rename the function `printPackingSlip`. Only its button label, popup `<title>`, and `<h1>` change.
- Do NOT modify or rename the existing "Include packing slip" checkbox. It is left alone as a future hook.
- Do NOT change `bol-shared.js`'s `packingSlipPdfBytes` contract. Merging happens client-side in `load-builder.html` before the call.
- Factor `buildLoadingDiagramInnerHtml` ONLY to the extent needed to share the inner body markup between the popup print and the html2canvas mount. Do not refactor any other diagram code.
- Use html2canvas exactly at version `1.4.1` from the CDN URL specified. No other versions, no other libs.

## Manual steps after build

- None (no migration).
- Verify:
  1. Trailer card button reads **PRINT LOADING DIAGRAM**. Clicking it opens the print popup with `<title>` and `<h1>` reading "Loading Diagram" instead of "Packing Slip". Diagram content is visually unchanged.
  2. BOL modal shows **Include Loading Diagram** checkbox alongside (or in place of, if no job context) the existing "Include packing slip" checkbox. Generating a BOL with **only** Loading Diagram checked appends a landscape page with the trailer layout + tables. Generating with **both** checked appends the packing slip page(s) then the diagram page. Generating with **neither** appends nothing (unchanged from today).
  3. Toggling either checkbox independently produces the expected combination.
- If the embedded diagram looks blurry, the tuning knob is the `scale: 2` parameter in the `html2canvas(...)` call inside `buildLoadingDiagramPdfBytes`. Increasing to 3 sharpens at the cost of memory and time.
