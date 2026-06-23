# Prompt 171 — Logistics dashboard BOL launcher + editable quantities (one BOL feature, two callers)

## Required reading (do this first)
1. Read `AGENTS.md` (platform conventions).
2. Read `xpanda-ops-agents.md` (multi-agent definition).
3. Assume the **logistics-agent** role (`logistics/*`). Frontend-only. No DB migration, no worker change, no permission key.

## Context
The BOL engine is already a shared component: `logistics/bol-compose.js` (`window.BolCompose`) owns the full collect → generate → save → review flow, and load-builder calls `BolCompose.open(...)` to drive it. Crucially, `generateAll()` builds the BOL save payload entirely from `trailerData` fields — it does **not** require a packed load; the packed `trailers` array only feeds an optional appended loading diagram via `buildAppendBytes`.

This prompt makes BOL generation "one feature, called in two places":
- **(A)** On the logistics dashboard, the "Generate BOL" button currently links out to the standalone `bol-generator.html` page. Repoint it to pop the **same** `BolCompose.open()` modal load-builder uses, with `trailerData` built from the job/shipment (and `load_count` → N records, so multi-load works for free).
- **(B)** In the modal, pieces/stacks/weight are currently read-only header values fed from the packed load. Make them **editable inputs** so a BOL can be produced without a pack (the dashboard launch has no pack). Load-builder still pre-fills them from the pack; they simply become editable too.

`bol-generator.html` is left in place (still reachable by direct link) but is no longer the dashboard's destination.

This prompt assumes P170 (BOL multi-load linking) has landed. P170 edits `generateAll()`; this prompt edits `render()` and `logistics/index.html` — disjoint regions, no overlap.

All edits are byte-exact find/replace, each verified to appear exactly once at HEAD. Confirm `count == 1` before applying.

---

## Edit 1 — Editable quantities in the modal (`logistics/bol-compose.js`)
Insert an editable QUANTITIES panel (Pieces / Stacks / Weight) right after the commodity panel, bound to `td.totalPieces` / `td.totalStacks` / `td.totalWeight`. These three already flow into the save payload in `generateAll()` (`package_qty` / `handling_unit_qty` / `weight`).

FIND (exactly once):
```
    body.appendChild(commPanel);

    // Carry-over checkbox (pages 2+)
```
REPLACE:
```
    body.appendChild(commPanel);

    // Quantities — editable so a BOL can be generated without a packed load.
    // Load-builder pre-fills these from the pack; the dashboard launcher leaves
    // them blank for the user to enter.
    const qtyPanel = h('div', { className: 'panel', style: { marginBottom: '14px' } });
    qtyPanel.appendChild(h('div', { className: 'panel-title' }, 'QUANTITIES'));
    const qtyRow = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' } });
    [['Pieces', 'totalPieces'], ['Stacks', 'totalStacks'], ['Weight (lb)', 'totalWeight']].forEach(([lbl, field]) => {
      const cell = h('div', {});
      cell.appendChild(h('label', { style: { display: 'block', fontSize: '12px', color: '#6b7280', marginBottom: '4px', fontWeight: 600 } }, lbl));
      const inp = h('input', { type: 'number', className: 'inp', min: '0' });
      inp.value = (td[field] === 0 || td[field]) ? td[field] : '';
      inp.addEventListener('input', e => { td[field] = e.target.value === '' ? '' : Number(e.target.value); });
      cell.appendChild(inp);
      qtyRow.appendChild(cell);
    });
    qtyPanel.appendChild(qtyRow);
    body.appendChild(qtyPanel);

    // Carry-over checkbox (pages 2+)
```

---

## Edit 2 — Load `bol-compose.js` on the logistics dashboard (`logistics/index.html`)
The page already loads pdf-lib, qrcode, fontkit, and `bol-shared.js`, but not the compose engine. Add it.

FIND (exactly once):
```
<script src="/logistics/bol-shared.js"></script>
```
REPLACE:
```
<script src="/logistics/bol-shared.js"></script>
<script src="/logistics/bol-compose.js"></script>
```

---

## Edit 3 — Repoint the "Generate BOL" button to the modal (`logistics/index.html`)
In `buildActionButtons`, change the no-BOL branch from a page link into a handler call.

FIND (exactly once):
```
`<a class="logistics-action-btn action-bol" href="/logistics/bol-generator.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">Generate BOL</a>`
```
REPLACE:
```
`<a class="logistics-action-btn action-bol" href="#" onclick="event.stopPropagation();event.preventDefault();openBolModalForJob('${shipment.job_id}')">Generate BOL</a>`
```

---

## Edit 4 — Add the launcher (`logistics/index.html`)
Insert `openBolModalForJob()` immediately after `buildActionButtons`. It fetches the job, builds `trailerData` (one record per load via `load_count`, mirroring load-builder's shape), and pops the shared modal. No packed load, so `trailers` is empty and `buildAppendBytes` is null; pieces/stacks/weight are left for the user (Edit 1).

FIND (exactly once):
```
  return `<a class="logistics-action-btn action-load" href="/logistics/load-builder.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">Build Load</a> ${bolBtn}`;
}
```
REPLACE:
```
  return `<a class="logistics-action-btn action-load" href="/logistics/load-builder.html?job_id=${shipment.job_id}" onclick="event.stopPropagation()">Build Load</a> ${bolBtn}`;
}

// Pop the shared BOL modal (same engine load-builder uses) for a job, with no
// packed load. One record per load (load_count); the user fills quantities.
async function openBolModalForJob(jobId) {
  if (typeof BolCompose === 'undefined') { alert('BOL tool failed to load. Refresh and try again.'); return; }
  try {
    const res = await api.get('/api/jobs/' + encodeURIComponent(jobId));
    if (!res.ok || !res.data || !res.data.job) { alert('Could not load job for BOL.'); return; }
    const job = res.data.job;
    const today = new Date().toISOString().slice(0, 10);

    let commodityFull = '';
    if (Array.isArray(job.line_items) && job.line_items.length) {
      commodityFull = job.line_items.map(li =>
        [li.quantity ? li.quantity + ' \u00d7' : '', li.part_number || '', li.description || '']
          .filter(Boolean).join(' ')
      ).join('\n');
    }
    const piecesGuess = Array.isArray(job.line_items)
      ? job.line_items.reduce((sum, li) => sum + (Number(li.quantity) || 0), 0)
      : '';

    const loadCount = Math.max(1, Number(job.load_count) || 1);
    const base = {
      commodityDescription: commodityFull,
      commodityDescriptionFull: commodityFull,
      commodityDescriptionNoDims: commodityFull,
      totalStacks: '', totalPieces: piecesGuess || '', totalWeight: '',
      customerSource: 'job', customerId: null, jobId: job.id,
      shipToCompany: job.ship_to_company || job.customer || '',
      shipToAttention: job.ship_to_attention || '',
      shipToStreet: job.ship_to_street || '',
      shipToStreet2: job.ship_to_street2 || '',
      shipToCity: job.ship_to_city || (job.location || '').split(',')[0]?.trim() || '',
      shipToState: job.ship_to_state || (job.location || '').split(',')[1]?.trim() || '',
      shipToZip: job.ship_to_zip || '',
      contactName: job.contact_name || '', contactPhone: job.contact_phone || '',
      carrierName: job.carrier || '',
      poNumber: job.po_number || '', deliveryTime: job.delivery_time || '',
      date: job.ship_date || today,
      freightTerms: 'prepaid', specialInstructions: '', carryOver: true,
    };

    const trailerData = [];
    for (let i = 0; i < loadCount; i++) {
      trailerData.push(Object.assign({}, base, {
        trailerIndex: i,
        trailerLabel: loadCount > 1 ? ('Load ' + (i + 1) + ' of ' + loadCount) : 'BOL',
        invNumber: i === 0 ? (job.invoice_number || '') : '',
      }));
    }

    BolCompose.open({
      trailerData,
      trailerCount: loadCount,
      trailers: [],
      prefillJobData: job,
      trailerInvNumbers: trailerData.map(t => t.invNumber || ''),
      buildAppendBytes: null,
    });
  } catch (e) {
    console.error('openBolModalForJob failed:', e);
    alert('Could not open the BOL generator.');
  }
}
```

---

## Step 5 — Validation
- `logistics/bol-compose.js` is a standalone `.js`: run `node --check logistics/bol-compose.js`.
- `logistics/index.html` has inline `<script>` blocks: extract each with `re.findall` to **real temp files** (do NOT pipe via `/dev/stdin`), then `node --check` each. Delete temp files after. Confirm clean.

---

## Step 6 — Manual sanity (notes for Steve, no action by Claude Code)
- On the logistics dashboard, "Generate BOL" on a job with no BOL now opens the in-page modal (not the old page). A job with `load_count > 1` opens paginated "Load 1 of N".
- Ship-to / carrier / PO / commodity pre-fill from the job; Pieces/Stacks/Weight are editable and start blank (Pieces seeded from line-item qty when available).
- Generating saves the BOL(s) and (via P170) links a multi-load set with a shared group id.
- Load-builder's "Generate BOL" is unchanged except the quantities are now editable too.

---

## What NOT to change
- Do NOT modify `generateAll()`, `generateBolPdf`, `generateCombinedCopies`, `reviewRecords`, or the save/worker path (P170 owns linking).
- Do NOT delete or rewrite `bol-generator.html` — it stays as a direct-link fallback.
- Do NOT touch `bol-shared.js`, `load-builder.html`'s `trailerData`/`BolCompose.open` call, the auto-pack algorithm, or `STORAGE_KEY`.
- Do NOT add a migration or permission key.
- Do NOT reflow unrelated code.

## Deliverables summary
- `logistics/bol-compose.js` — editable QUANTITIES panel in `render()`.
- `logistics/index.html` — load `bol-compose.js`; repoint "Generate BOL"; add `openBolModalForJob()`.
- `bol-compose.js` passes `node --check`; `logistics/index.html` inline scripts pass `node --check` via temp-file extraction.
