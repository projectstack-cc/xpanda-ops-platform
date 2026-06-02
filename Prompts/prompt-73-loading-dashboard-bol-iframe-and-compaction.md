# Prompt 73 — Loading Dashboard: BOL Iframe Modal + Density + Collapsible Sections

## Agents to assume

**Read BOTH agent files before starting: `AGENTS.md` AND `xpanda-ops-agents.md`.** Then assume this agent and follow its scope and the Orchestrator's cross-cutting rules:

- **Lead: logistics-agent** — owns `logistics/loading.html`.

This prompt does NOT touch `_worker.js`, `bol-shared.js`, `bol-generator.html`, `load-builder.html`, `bol-editor.js`, any DB migration, or any other module/file.

## Dependencies

- Prompt 72 already applied (new card header structure, shipping info modal). The CSS class `ld-card-subtext` and the truncated customer line exist; density rules in this prompt assume they're present.

## Goal

Three loosely-related improvements to the Loading Dashboard, bundled because they all aim at the same problem — too many cards on the page at once make it physically hard to drag a card to its bay:

1. **BOL view via iframe modal (not popup):** `viewBolForJob` currently calls `BolShared.openPdf`, which does `window.open(...)`. PWAs and mobile browsers block this. Replace with a full-screen iframe modal in `loading.html`. `BolShared.openPdf` itself is left untouched — other modules still use it.
2. **Density bump:** smaller card padding, smaller fonts, tighter gaps. ~30% vertical reduction per card with no information lost. Cards stay readable; cards fit more per row.
3. **Collapsible sections:** a small chevron toggle on each section header (Awaiting Trailer Assignment, In Transit, Delivered) collapses the section. State persists in `localStorage` so the layout the user prefers survives reloads. Bay columns are NOT collapsible — they're the drop targets and need to stay open.

---

## Part 1 — BOL view via iframe modal

### 1a. Modal markup

Add a new modal after the shipping-info modal added in Prompt 72 (or wherever the other modals live in the markup):

```html
<div id="ld-bol-view-modal" class="ld-modal-overlay" hidden onclick="if(event.target===this) closeBolViewModal()" style="z-index: 1000;">
  <div class="ld-modal-card" style="max-width: 95vw; width: 95vw; max-height: 95vh; height: 95vh; display: flex; flex-direction: column;">
    <div style="padding: 10px 16px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
      <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #111827;">Bill of Lading</h3>
      <div style="display:flex;gap:8px;align-items:center;">
        <button id="ld-bol-download-btn" onclick="downloadBolFromViewer()" style="padding:6px 12px;background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:6px;font-weight:600;cursor:pointer;font-size:13px;">Download</button>
        <button onclick="closeBolViewModal()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #6b7280; padding: 0; line-height: 1;">×</button>
      </div>
    </div>
    <iframe id="ld-bol-view-iframe" style="flex:1; width:100%; border:none; background:#525659;"></iframe>
  </div>
</div>
```

### 1b. Rewire `viewBolForJob`

Find `viewBolForJob` (around line 846). Replace it with:

```javascript
let currentBolBlobUrl = null;
let currentBolFilename = 'BOL.pdf';

async function viewBolForJob(jobId) {
  try {
    const res = await fetch('/api/bols?job_id=' + encodeURIComponent(jobId));
    const data = await res.json();

    if (!data.ok || !data.bols || data.bols.length === 0) {
      alert('No BOL found for this job. Generate a BOL first from the BOL Generator or Load Builder.');
      return;
    }

    const bol = data.bols[data.bols.length - 1];
    const result = await BolShared.generatePdf([bol], { previewOnly: true });

    // Revoke any previous blob URL to free memory.
    if (currentBolBlobUrl) {
      try { URL.revokeObjectURL(currentBolBlobUrl); } catch {}
    }
    currentBolBlobUrl = result.blobUrl;
    currentBolFilename = `BOL_${bol.bol_number || bol.id || 'unknown'}.pdf`;

    document.getElementById('ld-bol-view-iframe').src = currentBolBlobUrl;
    document.getElementById('ld-bol-view-modal').hidden = false;
  } catch (e) {
    console.error('Failed to load BOL:', e);
    alert('Failed to load BOL. Please try again.');
  }
}

function closeBolViewModal() {
  document.getElementById('ld-bol-view-modal').hidden = true;
  document.getElementById('ld-bol-view-iframe').src = '';
  if (currentBolBlobUrl) {
    try { URL.revokeObjectURL(currentBolBlobUrl); } catch {}
    currentBolBlobUrl = null;
  }
}

function downloadBolFromViewer() {
  if (!currentBolBlobUrl) return;
  const a = document.createElement('a');
  a.href = currentBolBlobUrl;
  a.download = currentBolFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
```

**Implementer notes:**
- `BolShared.generatePdf([bol], { previewOnly: true })` returns `{ blobUrl, ... }` (existing contract used elsewhere). Don't change that contract.
- The Download button is included because PWAs/mobile users can't right-click to save; without it, the iframe is read-only.
- Setting `iframe.src = ''` on close frees the loaded PDF; revoking the blob URL releases memory.
- ESC-key close: extend the existing ESC handler from Prompt 72 to also close this modal, OR add a parallel one — same scoping rule (don't introduce a global close-all).

### 1c. Do NOT touch `BolShared.openPdf`

Leave `logistics/bol-shared.js` entirely alone. The popup behavior is used by other modules (BOL generator's print flow, etc.). Only `loading.html`'s caller changes.

---

## Part 2 — Density bump

### 2a. CSS adjustments

Find the existing card-related CSS rules (around line 33–50). Replace the values shown below; leave any rule not listed exactly as it is.

```css
.ld-card { padding: 6px 8px; border-radius: 6px; margin-bottom: 6px; border: 1px solid transparent; }
.ld-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; gap: 6px; }
.ld-card-header strong { font-size: 12px; color: #111827; }
.ld-card-subtext { font-size: 10px; color: #6b7280; margin-bottom: 2px; }
.ld-card-meta { font-size: 10px; color: #6b7280; display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.ld-card-actions { display: flex; gap: 4px; flex-wrap: wrap; }
.ld-queue .ld-card, .ld-transit-grid .ld-card { width: 230px; }
```

Changes summary:
- Card padding `10px → 6px 8px`
- Card border-radius `8px → 6px`
- Header strong font `13px → 12px`
- Subtext font `11px → 10px`
- Meta font `11px → 10px`
- Card width `260px → 230px` (fits more cards per row at desktop widths without making them feel cramped — the new header is denser so a narrower card still reads cleanly)
- Margins/gaps reduced proportionally

### 2b. Action buttons

The Assign Bay / View BOL / Mark Loaded buttons are touch targets — do NOT shrink them below their current size. The existing `.ld-btn-bay`, `.ld-btn-bol`, etc. classes (or whatever the rendered classes are) keep their padding. If their padding is currently >8px vertical, leave it; if <8px, leave it. Don't touch button CSS in this prompt.

### 2c. Mobile breakpoint

If the `@media (max-width: ...)` rule that sets `.ld-queue .ld-card, .ld-transit-grid .ld-card { width: 100%; }` exists (it does, around line 81), leave it alone — mobile cards still span full width and the desktop density tightening doesn't fight it.

---

## Part 3 — Collapsible sections

### 3a. Mark each collapsible section with a stable key

The three top-level Overview sections currently look like:

```html
<div class="ld-section">
  <h3 class="ld-section-title">Awaiting Trailer Assignment</h3>
  <div id="ld-awaiting" class="ld-queue"></div>
</div>
```

Change each `<div class="ld-section">` to carry a `data-section-key` attribute and the `<h3>` to be the toggle. Add a chevron button inside the `<h3>`:

```html
<div class="ld-section" data-section-key="awaiting">
  <h3 class="ld-section-title" onclick="toggleSection('awaiting')" style="cursor:pointer; user-select:none; display:flex; align-items:center; gap:8px;">
    <span class="ld-section-chevron" id="ld-chevron-awaiting">▾</span>
    Awaiting Trailer Assignment
  </h3>
  <div id="ld-awaiting" class="ld-queue"></div>
</div>
```

Do the same for `data-section-key="transit"` (with `id="ld-chevron-transit"`) and `data-section-key="delivered"` (with `id="ld-chevron-delivered"`).

The bay columns container (`<div class="ld-bays-scroll">`) is NOT collapsible. Leave it alone.

### 3b. Toggle handler + persistence

Add near the top of the script block (alongside other view-state helpers):

```javascript
const LD_COLLAPSE_KEY = 'ld_section_collapsed_v1';

function loadCollapseState() {
  try {
    const raw = localStorage.getItem(LD_COLLAPSE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveCollapseState(state) {
  try { localStorage.setItem(LD_COLLAPSE_KEY, JSON.stringify(state)); } catch {}
}

function applyCollapseState() {
  const state = loadCollapseState();
  ['awaiting', 'transit', 'delivered'].forEach(key => {
    const section = document.querySelector(`.ld-section[data-section-key="${key}"]`);
    if (!section) return;
    const body = section.querySelector('.ld-queue, .ld-transit-grid');
    const chevron = document.getElementById(`ld-chevron-${key}`);
    const collapsed = !!state[key];
    if (body) body.style.display = collapsed ? 'none' : '';
    if (chevron) chevron.textContent = collapsed ? '▸' : '▾';
  });
}

function toggleSection(key) {
  const state = loadCollapseState();
  state[key] = !state[key];
  saveCollapseState(state);
  applyCollapseState();
}
```

Call `applyCollapseState()` at the end of `renderOverview()` so the persisted state re-applies on every render (renders fully reset the DOM for `#ld-awaiting`, `#ld-transit`, `#ld-delivered`, so the `display: none` must be re-applied to the section's body container, which IS preserved since only its inner HTML is replaced — but to be safe, run the apply on every render).

### 3c. Chevron + heading styling

Add CSS near the existing `.ld-section-title` rule:

```css
.ld-section-title { cursor: pointer; user-select: none; }
.ld-section-chevron { display: inline-block; min-width: 14px; font-size: 12px; color: #6b7280; transition: transform 0.15s ease; }
```

If `.ld-section-title` already has rules, merge — don't duplicate.

### 3d. Bay-view side is NOT in scope

Loading Team View (bay view) shows one bay at a time and doesn't have these section headers. The collapse feature only applies to Overview mode. Do not add collapse to `renderBayView`.

---

## Scope Constraints (strict)

- **One file only:** `logistics/loading.html`.
- Do NOT touch `bol-shared.js` — leave `openPdf` and the popup path alone for other modules.
- Do NOT change action button styling or sizing.
- Do NOT add collapse to per-bay containers or to the bay view.
- Do NOT change drag-and-drop behavior or card border-left swatch colors.
- Use `localStorage` key `ld_section_collapsed_v1` exactly — versioned so future schema changes don't collide with old user state.

## Manual steps after build

- None (no migration).
- Verify:
  1. **BOL view:** Click View BOL on any card. A full-screen iframe modal opens showing the PDF. No new browser window/popup. ESC, ×, or click-outside closes it. Download button saves the PDF locally. Works in standalone PWA mode on mobile (no popup blocked errors).
  2. **Density:** Cards are visibly more compact — roughly 30% shorter. More cards fit per row at desktop. Action buttons still feel tappable.
  3. **Collapse:** Click a section heading (or its chevron) — section body hides, chevron rotates to `▸`. Reload the page — section stays collapsed. Click again — expands, chevron flips to `▾`. Each of the three sections (Awaiting, In Transit, Delivered) toggles independently. Bay columns are unaffected and always visible.
  4. The Loading Team View is unchanged (no collapse, no popup-to-iframe — only the BOL view modal applies there too, since it uses the same `viewBolForJob`).
