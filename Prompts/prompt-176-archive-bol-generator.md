# Prompt 176 — Archive bol-generator.html, make the dashboard "BOL Generator" open the popup, fix BOL-viewer stacking

## Required reading (do this first)
1. Read `AGENTS.md` (platform conventions).
2. Read `xpanda-ops-agents.md` (multi-agent definition).
3. Assume the **logistics-agent** role (`logistics/*`), with one homepage edit (`index.html`). Frontend only. No DB, no worker, no permission key.

## Context
The standalone `logistics/bol-generator.html` page is being retired in favor of the shared `BolCompose` popup (the same modal load-builder and the per-shipment "Generate BOL" launcher use). The popup carries its own injected CSS, so it already looks like the load-builder BOL modal — switching the entry point to the popup is all that's needed; there is no separate CSS to port.

This prompt:
1. Repoints the logistics dashboard "BOL Generator" button to open a **blank** `BolCompose` popup (no job context), preserving its `logistics.bol` permission gating.
2. Removes the homepage "BOL" button (which also pointed at the page).
3. Physically moves `bol-generator.html` into `logistics/_archived/`.
4. Fixes the BOL viewer modal opening **behind** the shipment modal (equal z-index).

All find/replace edits are byte-exact, each verified to appear exactly once at HEAD. Confirm `count == 1` before applying.

---

## Edit 1 — Fix BOL viewer stacking (`logistics/index.html`)
The viewer `#log-bol-view-modal` and the shipment modal `.logistics-modal-overlay` are both `z-index:1000`; at a tie the earlier DOM node (the viewer) loses and renders behind. Bump the viewer above the shipment modal.

FIND (exactly once):
```
<div id="log-bol-view-modal" onclick="if(event.target===this) closeBolViewModal()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center;">
```
REPLACE:
```
<div id="log-bol-view-modal" onclick="if(event.target===this) closeBolViewModal()" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1100;align-items:center;justify-content:center;">
```

---

## Edit 2 — Dashboard "BOL Generator" button → blank popup (`logistics/index.html`)
Repoint the button to the popup and give it a stable hook (`bol-generator-link`) so the permission gate can still hide it.

FIND (exactly once):
```
      <a class="logistics-btn logistics-btn-outline" href="/logistics/bol-generator.html" style="text-decoration:none;">BOL Generator</a>
```
REPLACE:
```
      <a class="logistics-btn logistics-btn-outline bol-generator-link" href="#" onclick="event.preventDefault();openBlankBolModal()" style="text-decoration:none;">BOL Generator</a>
```

---

## Edit 3 — Preserve permission gating for the new popup link (`logistics/index.html`)
The gate hides BOL links for users without `logistics.bol`. Since the popup link no longer contains `bol-generator` in its href, extend the selector to the new hook.

FIND (exactly once):
```
      document.querySelectorAll('a[href*="bol-generator"]').forEach(el => el.style.display = 'none');
```
REPLACE:
```
      document.querySelectorAll('a[href*="bol-generator"], .bol-generator-link').forEach(el => el.style.display = 'none');
```

---

## Edit 4 — Add the blank-BOL launcher (`logistics/index.html`)
Insert `openBlankBolModal()` immediately before the existing `openBolModalForJob` (added in P171). It opens the shared modal with a single empty record for manual entry (no job, no pack); quantities and commodity are filled by the user (the editable QUANTITIES panel from P171).

FIND (exactly once):
```
async function openBolModalForJob(jobId) {
```
REPLACE:
```
function openBlankBolModal() {
  if (typeof BolCompose === 'undefined') { alert('BOL tool failed to load. Refresh and try again.'); return; }
  const today = new Date().toISOString().slice(0, 10);
  const blank = {
    commodityDescription: '', commodityDescriptionFull: '', commodityDescriptionNoDims: '',
    totalStacks: '', totalPieces: '', totalWeight: '',
    customerSource: 'manual', customerId: null, jobId: null,
    shipToCompany: '', shipToAttention: '', shipToStreet: '', shipToStreet2: '',
    shipToCity: '', shipToState: '', shipToZip: '',
    contactName: '', contactPhone: '', carrierName: '',
    poNumber: '', deliveryTime: '', invNumber: '',
    date: today, freightTerms: 'prepaid', specialInstructions: '', carryOver: false,
    trailerIndex: 0, trailerLabel: 'BOL',
  };
  BolCompose.open({
    trailerData: [blank],
    trailerCount: 1,
    trailers: [],
    trailerInvNumbers: [''],
    buildAppendBytes: null,
  });
}

async function openBolModalForJob(jobId) {
```

---

## Edit 5 — Remove the homepage "BOL" button (`index.html`)
FIND (exactly once):
```
        <a class="hp-btn hp-btn-outline" href="/logistics/bol-generator.html" data-perm-key="logistics.bol">BOL</a>
```
REPLACE with nothing (delete the line entirely). The Dashboard and Load Builder buttons in that card remain.

---

## Edit 6 — Archive the page file
Move the file into an `_archived/` folder (preserve history):
```
mkdir -p logistics/_archived
git mv logistics/bol-generator.html logistics/_archived/bol-generator.html
```
Leave the dead `{ pattern: /^\/logistics\/bol-generator/, key: 'logistics.bol' }` entry in `_worker.js/lib/core.js` untouched — it simply no longer matches a served path (harmless; not in scope here).

---

## Step 7 — Validation
- `logistics/index.html` and `index.html` are HTML with inline `<script>` blocks: for each, extract every inline script with `re.findall` to **real temp files** (do NOT pipe via `/dev/stdin`), run `node --check` on each, confirm all pass, delete temp files.
- Confirm `logistics/_archived/bol-generator.html` exists and `logistics/bol-generator.html` no longer does.

## Step 8 — Manual sanity (notes for Steve)
- Logistics dashboard → "BOL Generator" opens the styled popup (blank, manual entry), not the old page. A user without `logistics.bol` still doesn't see the button.
- Homepage Logistics card no longer shows a "BOL" button (Dashboard + Load Builder remain).
- In a shipment's Documents section, "View BOL" now opens **in front of** the shipment modal.
- The per-shipment "Generate BOL" launcher (P171) is unchanged.

## What NOT to change
- Do NOT delete `bol-generator.html` — move it to `_archived/`.
- Do NOT touch `bol-compose.js` (it already injects the modal CSS — nothing to port), `bol-shared.js`, `load-builder.html`, or the worker.
- Do NOT change the `logistics.bol` permission key or `core.js`.
- Do NOT alter `openBolModalForJob` or the per-shipment button.

## Deliverables summary
- `logistics/index.html` — viewer z-index 1000→1100; dashboard "BOL Generator" → `openBlankBolModal()` popup with preserved gating; new `openBlankBolModal()`.
- `index.html` — homepage "BOL" button removed.
- `logistics/bol-generator.html` → `logistics/_archived/bol-generator.html` (git mv).
- Inline scripts pass `node --check`.
