# Prompt 125 — BOL re-unification, Phase 2 of 3: move the BOL modal into BolCompose
## Track context
Phase 2 of the BOL extraction (P123 shipped the scaffold). This moves the **modal UI + state** (`openBolModal`/`renderBolModal`) out of `load-builder.html` and into `BolCompose`. The module now owns the modal state (`BM`, formerly `state.bolModal`) and renders it. **Generate/save/review stay in `load-builder.html` for now** (Phase 3 / P126 moves them); they're bridged through a small `ctx = { bm, render }` the module hands to the `onGenerateAll` callback. **Zero behavior change** — the BOL modal must look and act exactly as before.

## Agent setup
Read **both** `AGENTS.md` and `xpanda-ops-agents.md`. Assume the **logistics-agent**. No migration, no `_worker.js` change.

## DO NOT TOUCH
The auto-pack/packing engine, `STORAGE_KEY` (`foam_trailer_loader_v31`), `bol-shared.js`, `bol-editor.js`, `bol-generator.html`, the trailerData-building lines at the top of `openBolModal` (keep them — only its tail changes), `buildPackingList`/`buildLoadingDiagramPdfBytes`/`getDims` (stay in load-builder), the static `#bol-review-*` HTML (stays this phase), the `state.bolModal` literal in the `state = { … }` object (leave it — harmless, removed in P126).

---

## Deliverable 1 — OVERWRITE `/logistics/bol-compose.js`
Replace the entire file (the P123 scaffold) with this validated content. It keeps the injected CSS + `h()`, adds an internal `_debounce`, owns the modal state `BM` and options `OPTS`, and exposes `open(opts)` + `render()`:

```javascript
window.BolCompose = (function () {
  'use strict';

  // ── Self-contained DOM helper (copy of load-builder's h()) ──
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

  function _debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }

  // ── Modal styles, lifted verbatim from load-builder.html (P123). Injected once. ──
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

  // ── Modal state (owned by this module; was load-builder's state.bolModal) ──
  let BM   = null;
  let OPTS = null;

  // open(opts):
  //   opts.trailerData       — prebuilt array of per-trailer BOL field objects (caller builds it)
  //   opts.trailerCount      — number of trailers
  //   opts.trailers          — raw packed-trailer array (passed through for the generate step)
  //   opts.prefillJobData    — job object or null (drives "Include packing slip" visibility)
  //   opts.trailerInvNumbers — array reference; INV# edits write back into it
  //   opts.onGenerateAll(ctx)— called when "GENERATE ALL BOLs" is clicked; ctx = { bm, render }
  function open(opts) {
    OPTS = opts;
    BM = {
      open: true, currentPage: 0, trailerCount: opts.trailerCount, trailerData: opts.trailerData,
      trailers: opts.trailers,
      bolError: '', generating: false, generateProgress: [], bolSuccess: null,
      searchQuery: '', searchResults: [], searchLoading: false, searchConfirm: '',
      includePacking: false,
      includeLoadingDiagram: false,
    };
    render();
  }

  function render() {
    const existing = document.getElementById('bol-modal-backdrop');
    if (existing) existing.remove();
    if (!BM || !BM.open) return;

    const bm = BM;
    const td = bm.trailerData[bm.currentPage];

    const backdrop = h('div', {
      id: 'bol-modal-backdrop', className: 'bol-backdrop',
    });
    const modal = h('div', { className: 'bol-modal', onClick: e => e.stopPropagation() });

    // Header
    const header = h('div', { className: 'bol-modal-header' });
    const hdrRow = h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } });
    const hdrLeft = h('div');
    hdrLeft.appendChild(h('div', { style: { color: 'var(--accent)', fontWeight: 900, fontSize: '18px' } }, `GENERATE BOL — Trailer ${bm.currentPage + 1} of ${bm.trailerCount}`));
    hdrLeft.appendChild(h('div', { style: { fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 600 } }, `${td.trailerLabel} \xb7 ${td.totalPieces} pcs \xb7 ${td.totalStacks} stacks`));
    hdrRow.appendChild(hdrLeft);
    hdrRow.appendChild(h('button', { className: 'btn btn-white', style: { padding: '6px 12px' }, onClick: () => { BM.open = false; render(); } }, '✕'));
    header.appendChild(hdrRow);
    modal.appendChild(header);

    const body = h('div', { className: 'bol-modal-body' });

    // Success view
    if (bm.bolSuccess) {
      body.appendChild(h('div', { style: { textAlign: 'center', marginBottom: '20px' } },
        h('div', { style: { fontSize: '22px', fontWeight: 900, color: 'var(--green)' } }, '✓ BOLs Generated Successfully')
      ));
      const ul = h('ul', { className: 'bol-success-list' });
      bm.bolSuccess.forEach((bol, i) => { ul.appendChild(h('li', {}, `Trailer ${i + 1} → ${bol.bol_number ? `BOL #${bol.bol_number}` : 'BOL'} — ${bol.ship_to_company || ''}`)); });
      body.appendChild(ul);
      if (bm.bolError) {
        body.appendChild(h('div', { style: { color: 'var(--warn-text)', fontSize: '14px', fontWeight: 600, marginTop: '8px' } }, bm.bolError));
      } else {
        body.appendChild(h('div', { style: { fontSize: '14px', color: 'var(--text-muted)', marginTop: '12px' } }, 'PDF opened in new tab.'));
      }
      body.appendChild(h('button', { className: 'btn btn-dark', style: { marginTop: '16px' }, onClick: () => { BM.open = false; render(); } }, 'Close'));
      modal.appendChild(body);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      return;
    }

    // Generating view
    if (bm.generating) {
      body.appendChild(h('div', { style: { fontWeight: 800, fontSize: '16px', marginBottom: '16px' } }, 'Generating BOLs...'));
      const ul = h('ul', { className: 'bol-progress-list' });
      bm.generateProgress.forEach(p => {
        ul.appendChild(h('li', { style: { color: p.done ? 'var(--green)' : p.pending ? 'var(--text-ghost)' : 'var(--text)' } }, p.text));
      });
      body.appendChild(ul);
      if (bm.bolError) body.appendChild(h('div', { style: { color: 'var(--red-dark)', fontSize: '14px', fontWeight: 600, marginTop: '12px' } }, bm.bolError));
      modal.appendChild(body);
      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      return;
    }

    // Error banner
    if (bm.bolError) {
      body.appendChild(h('div', { style: { marginBottom: '14px', color: 'var(--red-dark)', fontSize: '13px', border: '1px solid var(--red-border)', background: 'var(--red-bg)', padding: '10px 12px', borderRadius: 'var(--radius)', fontWeight: 600 } }, bm.bolError));
    }

    // Commodity description
    const commPanel = h('div', { className: 'panel', style: { marginBottom: '14px' } });
    commPanel.appendChild(h('div', { className: 'panel-title' }, 'COMMODITY DESCRIPTION'));
    const commTA = h('textarea', { className: 'inp', style: { height: '90px', resize: 'vertical', fontFamily: 'var(--mono)', fontSize: '13px', lineHeight: '1.6' } });
    commTA.value = td.commodityDescription || '';
    commTA.addEventListener('input', e => {
      td.commodityDescription = e.target.value;
      if (!hideDimsCheck.checked) {
        td.commodityDescriptionFull = e.target.value;
      } else {
        td.commodityDescriptionNoDims = e.target.value;
      }
    });
    commPanel.appendChild(commTA);

    const hideDimsLabel = h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#6b7280', cursor: 'pointer', marginTop: '6px' } });
    const hideDimsCheck = h('input', { type: 'checkbox' });
    hideDimsCheck.addEventListener('change', e => {
      const hide = e.target.checked;
      td.commodityDescription = hide ? td.commodityDescriptionNoDims : td.commodityDescriptionFull;
      commTA.value = td.commodityDescription;
    });
    hideDimsLabel.appendChild(hideDimsCheck);
    hideDimsLabel.appendChild(document.createTextNode('Part # and qty only (hide dimensions)'));
    commPanel.appendChild(hideDimsLabel);

    body.appendChild(commPanel);

    // Carry-over checkbox (pages 2+)
    if (bm.currentPage > 0) {
      const carryWrap = h('div', { style: { marginBottom: '14px' } });
      const carryLabel = h('label', { style: { display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 } });
      const carryChk = h('input', { type: 'checkbox' });
      carryChk.checked = td.carryOver;
      carryChk.addEventListener('change', e => {
        td.carryOver = e.target.checked;
        if (e.target.checked) {
          const prev = bm.trailerData[bm.currentPage - 1];
          td.customerId = prev.customerId; td.customerSource = prev.customerSource;
          td.shipToCompany = prev.shipToCompany; td.shipToAttention = prev.shipToAttention;
          td.shipToStreet = prev.shipToStreet; td.shipToStreet2 = prev.shipToStreet2;
          td.shipToCity = prev.shipToCity; td.shipToState = prev.shipToState; td.shipToZip = prev.shipToZip;
          td.contactName = prev.contactName; td.contactPhone = prev.contactPhone;
          td.carrierName = prev.carrierName; td.freightTerms = prev.freightTerms;
          td.specialInstructions = prev.specialInstructions;
          td.poNumber = prev.poNumber; td.deliveryTime = prev.deliveryTime;
          td.invNumber = prev.invNumber;
        }
        render();
      });
      carryLabel.appendChild(carryChk);
      carryLabel.appendChild(document.createTextNode(`Carry over address from Trailer ${bm.currentPage}`));
      carryWrap.appendChild(carryLabel);
      body.appendChild(carryWrap);
    }

    // Customer source tabs
    const sourceTabs = h('div', { className: 'bol-source-tabs' });
    [['job', 'Pull from Job'], ['customer', 'Search Customers'], ['manual', 'Manual Entry']].forEach(([val, lbl]) => {
      sourceTabs.appendChild(h('button', {
        className: `btn ${td.customerSource === val ? 'btn-dark' : 'btn-white'}`,
        style: { fontSize: '13px', padding: '8px 14px' },
        onClick: () => { td.customerSource = val; bm.searchQuery = ''; bm.searchResults = []; bm.searchLoading = false; bm.searchConfirm = ''; render(); },
      }, lbl));
    });
    body.appendChild(sourceTabs);

    // Search UI for job and customer tabs
    if (td.customerSource === 'job' || td.customerSource === 'customer') {
      const isJob = td.customerSource === 'job';
      const debouncedSearch = _debounce(async (q) => {
        if (!q.trim()) { bm.searchResults = []; bm.searchLoading = false; render(); return; }
        bm.searchLoading = true; render();
        try {
          const url = isJob ? `/api/jobs?search=${encodeURIComponent(q)}` : `/api/bol-customers?search=${encodeURIComponent(q)}`;
          const res = await api.get(url);
          if (!res.ok) throw new Error(res.error || 'Search failed');
          const data = res.data;
          bm.searchResults = isJob ? (data.jobs || []) : (data.customers || []);
        } catch (_) { bm.searchResults = []; }
        bm.searchLoading = false; render();
      }, 300);

      const searchWrap = h('div', { style: { position: 'relative', marginBottom: '14px' } });
      const searchInp = h('input', { className: 'inp', placeholder: isJob ? 'Search by customer, PO, or invoice #...' : 'Search saved customers...' });
      searchInp.value = bm.searchQuery || '';
      searchInp.addEventListener('input', e => { bm.searchQuery = e.target.value; debouncedSearch(e.target.value); });
      searchWrap.appendChild(searchInp);

      if (bm.searchLoading) {
        searchWrap.appendChild(h('div', { className: 'bol-search-results' }, h('div', { className: 'bol-search-item', style: { color: 'var(--text-faint)' } }, 'Searching...')));
      } else if (bm.searchResults.length) {
        const dropdown = h('div', { className: 'bol-search-results' });
        bm.searchResults.forEach(item => {
          const row = h('div', { className: 'bol-search-item' });
          if (isJob) {
            row.appendChild(h('div', { style: { fontWeight: 700 } }, item.customer || '(no customer)'));
            const details = [];
            if (item.ship_date) { const d = new Date(item.ship_date + 'T12:00:00'); details.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })); }
            if (item.po_number || item.invoice_number) details.push(`PO/Inv: ${item.po_number || item.invoice_number}`);
            if (item.status) details.push(item.status);
            if (details.length) row.appendChild(h('div', { style: { fontSize: '12px', color: 'var(--text-faint)', marginTop: '2px' } }, details.join(' \xb7 ')));
            row.addEventListener('click', async () => {
              try {
                const res = await api.get(`/api/jobs/${item.id}`);
                const data = res.data;
                const job = data.job || data;
                td.jobId = job.id; td.shipToCompany = job.customer || '';
                if (job.location) { const p = job.location.split(',').map(s => s.trim()); td.shipToCity = p[0] || ''; td.shipToState = p[1] || ''; }
                td.carrierName = job.carrier || ''; td.poNumber = job.po_number || job.invoice_number || '';
                td.deliveryTime = job.delivery_time || ''; td.contactName = job.contact_name || ''; td.contactPhone = job.contact_phone || '';
                try {
                  const cr = await api.get(`/api/bol-customers?search=${encodeURIComponent(job.customer || '')}`);
                  const cd = cr.data;
                  const custs = cd.customers || [];
                  if (custs.length === 1) {
                    const c = custs[0]; td.customerId = c.id;
                    td.shipToCompany = c.company || td.shipToCompany; td.shipToAttention = c.attention || '';
                    td.shipToStreet = c.street || ''; td.shipToStreet2 = c.street2 || '';
                    td.shipToCity = c.city || td.shipToCity; td.shipToState = c.state || td.shipToState;
                    td.shipToZip = c.zip || ''; td.contactName = c.contact_name || td.contactName; td.contactPhone = c.phone || td.contactPhone;
                  }
                } catch (_) {}
                if (bm.currentPage > 0) td.carryOver = false;
                bm.searchResults = []; bm.searchQuery = ''; bm.searchConfirm = `✓ Loaded from job: ${job.customer || ''}`;
                render();
              } catch (_) { bm.searchConfirm = 'Error loading job details.'; render(); }
            });
          } else {
            row.appendChild(h('div', { style: { fontWeight: 700 } }, item.company || ''));
            const det = [[item.city, item.state].filter(Boolean).join(', '), item.contact_name].filter(Boolean).join(' \xb7 ');
            if (det) row.appendChild(h('div', { style: { fontSize: '12px', color: 'var(--text-faint)', marginTop: '2px' } }, det));
            row.addEventListener('click', () => {
              td.customerId = item.id; td.shipToCompany = item.company || ''; td.shipToAttention = item.attention || '';
              td.shipToStreet = item.street || ''; td.shipToStreet2 = item.street2 || '';
              td.shipToCity = item.city || ''; td.shipToState = item.state || ''; td.shipToZip = item.zip || '';
              td.contactName = item.contact_name || ''; td.contactPhone = item.phone || '';
              if (bm.currentPage > 0) td.carryOver = false;
              bm.searchResults = []; bm.searchQuery = ''; bm.searchConfirm = `✓ Using saved address: ${item.company || ''}`;
              render();
            });
          }
          dropdown.appendChild(row);
        });
        searchWrap.appendChild(dropdown);
      }
      body.appendChild(searchWrap);
      if (bm.searchConfirm) body.appendChild(h('div', { className: 'bol-confirm-msg' }, bm.searchConfirm));
    }

    // Form fields
    const fg = (label, el) => { const g = h('div', { className: 'bol-form-group' }); g.appendChild(h('div', { className: 'form-label' }, label)); g.appendChild(el); return g; };
    const inp = (field, type = 'text', ph = '') => {
      const el = h('input', { type, className: 'inp', placeholder: ph });
      el.value = td[field] || '';
      el.addEventListener('input', e => {
        td[field] = e.target.value;
        if (field === 'invNumber') {
          OPTS.trailerInvNumbers[bm.currentPage] = e.target.value;
          if (bm.currentPage === 0) {
            const val = td.invNumber.trim();
            const match = val.match(/^(.+-)(\d+)$/);
            if (match) {
              const prefix = match[1], startNum = parseInt(match[2], 10);
              for (let j = 1; j < bm.trailerData.length; j++) {
                const nextTd = bm.trailerData[j];
                if (!nextTd.invNumber || nextTd._invAutoFilled) {
                  const suffix = String(startNum + j).padStart(match[2].length, '0');
                  nextTd.invNumber = prefix + suffix;
                  nextTd._invAutoFilled = true;
                  OPTS.trailerInvNumbers[j] = nextTd.invNumber;
                }
              }
            }
          }
        }
      });
      return el;
    };

    body.appendChild(fg('BOL Date', inp('date', 'date')));
    body.appendChild(fg('Company', inp('shipToCompany')));
    body.appendChild(fg('Attention', inp('shipToAttention')));
    body.appendChild(fg('Street', inp('shipToStreet')));
    body.appendChild(fg('Street 2', inp('shipToStreet2')));

    const cityWrap = h('div', { className: 'bol-form-group' });
    cityWrap.appendChild(h('div', { className: 'form-label' }, 'City / State / Zip'));
    const cityRow = h('div', { className: 'bol-city-row' });
    ['shipToCity', 'shipToState', 'shipToZip'].forEach((f, i) => {
      const el = h('input', { type: 'text', className: 'inp', placeholder: ['City', 'ST', 'Zip'][i] });
      el.value = td[f] || ''; el.addEventListener('input', e => { td[f] = e.target.value; });
      cityRow.appendChild(el);
    });
    cityWrap.appendChild(cityRow);
    body.appendChild(cityWrap);

    body.appendChild(fg('Contact Name', inp('contactName')));
    body.appendChild(fg('Contact Phone', inp('contactPhone')));
    body.appendChild(fg('Carrier', inp('carrierName')));
    body.appendChild(fg('PO Number', inp('poNumber')));
    body.appendChild(fg('INV #', inp('invNumber')));
    body.appendChild(fg('Delivery Time', inp('deliveryTime')));

    const ftWrap = h('div', { className: 'bol-form-group' });
    ftWrap.appendChild(h('div', { className: 'form-label' }, 'Freight Terms'));
    const ftRow = h('div', { className: 'bol-freight-row' });
    [['prepaid', 'Prepaid'], ['collect', 'Collect'], ['3rd_party', '3rd Party']].forEach(([val, lbl]) => {
      const lbl_el = h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' } });
      const radio = h('input', { type: 'radio', name: `bol-freight-${bm.currentPage}`, value: val });
      radio.checked = td.freightTerms === val;
      radio.addEventListener('change', () => { td.freightTerms = val; });
      lbl_el.appendChild(radio); lbl_el.appendChild(document.createTextNode(lbl));
      ftRow.appendChild(lbl_el);
    });
    ftWrap.appendChild(ftRow);
    body.appendChild(ftWrap);

    const siTA = h('textarea', { className: 'inp', style: { minHeight: '70px', resize: 'vertical' } });
    siTA.value = td.specialInstructions || '';
    siTA.addEventListener('input', e => { td.specialInstructions = e.target.value; });
    body.appendChild(fg('Special Instructions', siTA));

    modal.appendChild(body);

    // Footer
    const footer = h('div', { className: 'bol-modal-footer' });
    footer.appendChild(h('button', { className: 'btn btn-white', onClick: () => { BM.open = false; render(); } }, 'Cancel'));
    if (OPTS.prefillJobData?.id) {
      const packingLabel = h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', cursor: 'pointer', color: 'var(--text-muted)' } });
      const packingChk = h('input', { type: 'checkbox' });
      packingChk.checked = BM.includePacking;
      packingChk.addEventListener('change', e => { BM.includePacking = e.target.checked; });
      packingLabel.appendChild(packingChk);
      packingLabel.appendChild(document.createTextNode('Include packing slip'));
      footer.appendChild(packingLabel);
    }
    {
      const diagramLabel = h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', cursor: 'pointer', color: 'var(--text-muted)' } });
      const diagramChk = h('input', { type: 'checkbox' });
      diagramChk.checked = BM.includeLoadingDiagram;
      diagramChk.addEventListener('change', e => { BM.includeLoadingDiagram = e.target.checked; });
      diagramLabel.appendChild(diagramChk);
      diagramLabel.appendChild(document.createTextNode('Include Loading Diagram'));
      footer.appendChild(diagramLabel);
    }
    const navRight = h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } });
    const prevBtn = h('button', { className: 'btn btn-white', disabled: bm.currentPage === 0 });
    prevBtn.textContent = '← Prev';
    prevBtn.addEventListener('click', () => { bm.currentPage--; bm.searchQuery = ''; bm.searchResults = []; bm.searchConfirm = ''; render(); });
    navRight.appendChild(prevBtn);
    navRight.appendChild(h('span', { style: { fontSize: '14px', fontWeight: 700, color: 'var(--text-muted)' } }, `${bm.currentPage + 1}/${bm.trailerCount}`));
    const isLastPage = bm.currentPage === bm.trailerCount - 1;
    if (isLastPage) {
      const genBtn = h('button', { className: 'btn btn-dark' });
      genBtn.textContent = 'GENERATE ALL BOLs';
      genBtn.addEventListener('click', () => OPTS.onGenerateAll({ bm: BM, render }));
      navRight.appendChild(genBtn);
    } else {
      const nextBtn = h('button', { className: 'btn btn-dark' });
      nextBtn.textContent = 'Next →';
      nextBtn.addEventListener('click', () => { bm.currentPage++; bm.searchQuery = ''; bm.searchResults = []; bm.searchConfirm = ''; render(); });
      navRight.appendChild(nextBtn);
    }
    footer.appendChild(navRight);
    modal.appendChild(footer);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
  }

  return { open, render, _h: h, _injectStyles: injectStyles };

})();
```

## Deliverable 2 — edit `/logistics/load-builder.html`
Apply each replacement below. Every FIND is unique in the file.

### 2.1 — central render() loop now drives the module-owned modal
FIND:
```javascript
  document.querySelectorAll('.tab-content').forEach(el => el.classList.toggle('active', el.id === 'tab' + state.tab.charAt(0).toUpperCase() + state.tab.slice(1)));
  renderBolModal();
}
```
REPLACE:
```javascript
  document.querySelectorAll('.tab-content').forEach(el => el.classList.toggle('active', el.id === 'tab' + state.tab.charAt(0).toUpperCase() + state.tab.slice(1)));
  BolCompose.render();
}
```

### 2.2 — openBolModal tail: hand the built trailerData to the module instead of setting state.bolModal
FIND:
```javascript
  state.bolModal = {
    open: true, currentPage: 0, trailerCount: result.trailers.length, trailerData,
    trailers: result.trailers,
    bolError: '', generating: false, generateProgress: [], bolSuccess: null,
    searchQuery: '', searchResults: [], searchLoading: false, searchConfirm: '',
    includePacking: false,
    includeLoadingDiagram: false,
  };
  renderBolModal();
}
```
REPLACE:
```javascript
  BolCompose.open({
    trailerData,
    trailerCount: result.trailers.length,
    trailers: result.trailers,
    prefillJobData: state.prefillJobData,
    trailerInvNumbers: state.trailerInvNumbers,
    onGenerateAll: generateAllBols,
  });
}
```

### 2.3 — DELETE the entire renderBolModal() function (it now lives in bol-compose.js). Remove the whole block below (and its surrounding blank lines).
**DELETE** this entire function (it now lives in `bol-compose.js`). Remove the whole block, leaving no replacement:
```javascript
function renderBolModal() {
  const existing = document.getElementById('bol-modal-backdrop');
  if (existing) existing.remove();
  if (!state.bolModal.open) return;

  const bm = state.bolModal;
  const td = bm.trailerData[bm.currentPage];

  const backdrop = h('div', {
    id: 'bol-modal-backdrop', className: 'bol-backdrop',
  });
  const modal = h('div', { className: 'bol-modal', onClick: e => e.stopPropagation() });

  // Header
  const header = h('div', { className: 'bol-modal-header' });
  const hdrRow = h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } });
  const hdrLeft = h('div');
  hdrLeft.appendChild(h('div', { style: { color: 'var(--accent)', fontWeight: 900, fontSize: '18px' } }, `GENERATE BOL — Trailer ${bm.currentPage + 1} of ${bm.trailerCount}`));
  hdrLeft.appendChild(h('div', { style: { fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: 600 } }, `${td.trailerLabel} \xb7 ${td.totalPieces} pcs \xb7 ${td.totalStacks} stacks`));
  hdrRow.appendChild(hdrLeft);
  hdrRow.appendChild(h('button', { className: 'btn btn-white', style: { padding: '6px 12px' }, onClick: () => { state.bolModal.open = false; renderBolModal(); } }, '✕'));
  header.appendChild(hdrRow);
  modal.appendChild(header);

  const body = h('div', { className: 'bol-modal-body' });

  // Success view
  if (bm.bolSuccess) {
    body.appendChild(h('div', { style: { textAlign: 'center', marginBottom: '20px' } },
      h('div', { style: { fontSize: '22px', fontWeight: 900, color: 'var(--green)' } }, '✓ BOLs Generated Successfully')
    ));
    const ul = h('ul', { className: 'bol-success-list' });
    bm.bolSuccess.forEach((bol, i) => { ul.appendChild(h('li', {}, `Trailer ${i + 1} → ${bol.bol_number ? `BOL #${bol.bol_number}` : 'BOL'} — ${bol.ship_to_company || ''}`)); });
    body.appendChild(ul);
    if (bm.bolError) {
      body.appendChild(h('div', { style: { color: 'var(--warn-text)', fontSize: '14px', fontWeight: 600, marginTop: '8px' } }, bm.bolError));
    } else {
      body.appendChild(h('div', { style: { fontSize: '14px', color: 'var(--text-muted)', marginTop: '12px' } }, 'PDF opened in new tab.'));
    }
    body.appendChild(h('button', { className: 'btn btn-dark', style: { marginTop: '16px' }, onClick: () => { state.bolModal.open = false; renderBolModal(); } }, 'Close'));
    modal.appendChild(body);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    return;
  }

  // Generating view
  if (bm.generating) {
    body.appendChild(h('div', { style: { fontWeight: 800, fontSize: '16px', marginBottom: '16px' } }, 'Generating BOLs...'));
    const ul = h('ul', { className: 'bol-progress-list' });
    bm.generateProgress.forEach(p => {
      ul.appendChild(h('li', { style: { color: p.done ? 'var(--green)' : p.pending ? 'var(--text-ghost)' : 'var(--text)' } }, p.text));
    });
    body.appendChild(ul);
    if (bm.bolError) body.appendChild(h('div', { style: { color: 'var(--red-dark)', fontSize: '14px', fontWeight: 600, marginTop: '12px' } }, bm.bolError));
    modal.appendChild(body);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    return;
  }

  // Error banner
  if (bm.bolError) {
    body.appendChild(h('div', { style: { marginBottom: '14px', color: 'var(--red-dark)', fontSize: '13px', border: '1px solid var(--red-border)', background: 'var(--red-bg)', padding: '10px 12px', borderRadius: 'var(--radius)', fontWeight: 600 } }, bm.bolError));
  }

  // Commodity description
  const commPanel = h('div', { className: 'panel', style: { marginBottom: '14px' } });
  commPanel.appendChild(h('div', { className: 'panel-title' }, 'COMMODITY DESCRIPTION'));
  const commTA = h('textarea', { className: 'inp', style: { height: '90px', resize: 'vertical', fontFamily: 'var(--mono)', fontSize: '13px', lineHeight: '1.6' } });
  commTA.value = td.commodityDescription || '';
  commTA.addEventListener('input', e => {
    td.commodityDescription = e.target.value;
    if (!hideDimsCheck.checked) {
      td.commodityDescriptionFull = e.target.value;
    } else {
      td.commodityDescriptionNoDims = e.target.value;
    }
  });
  commPanel.appendChild(commTA);

  const hideDimsLabel = h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#6b7280', cursor: 'pointer', marginTop: '6px' } });
  const hideDimsCheck = h('input', { type: 'checkbox' });
  hideDimsCheck.addEventListener('change', e => {
    const hide = e.target.checked;
    td.commodityDescription = hide ? td.commodityDescriptionNoDims : td.commodityDescriptionFull;
    commTA.value = td.commodityDescription;
  });
  hideDimsLabel.appendChild(hideDimsCheck);
  hideDimsLabel.appendChild(document.createTextNode('Part # and qty only (hide dimensions)'));
  commPanel.appendChild(hideDimsLabel);

  body.appendChild(commPanel);

  // Carry-over checkbox (pages 2+)
  if (bm.currentPage > 0) {
    const carryWrap = h('div', { style: { marginBottom: '14px' } });
    const carryLabel = h('label', { style: { display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 } });
    const carryChk = h('input', { type: 'checkbox' });
    carryChk.checked = td.carryOver;
    carryChk.addEventListener('change', e => {
      td.carryOver = e.target.checked;
      if (e.target.checked) {
        const prev = bm.trailerData[bm.currentPage - 1];
        td.customerId = prev.customerId; td.customerSource = prev.customerSource;
        td.shipToCompany = prev.shipToCompany; td.shipToAttention = prev.shipToAttention;
        td.shipToStreet = prev.shipToStreet; td.shipToStreet2 = prev.shipToStreet2;
        td.shipToCity = prev.shipToCity; td.shipToState = prev.shipToState; td.shipToZip = prev.shipToZip;
        td.contactName = prev.contactName; td.contactPhone = prev.contactPhone;
        td.carrierName = prev.carrierName; td.freightTerms = prev.freightTerms;
        td.specialInstructions = prev.specialInstructions;
        td.poNumber = prev.poNumber; td.deliveryTime = prev.deliveryTime;
        td.invNumber = prev.invNumber;
      }
      renderBolModal();
    });
    carryLabel.appendChild(carryChk);
    carryLabel.appendChild(document.createTextNode(`Carry over address from Trailer ${bm.currentPage}`));
    carryWrap.appendChild(carryLabel);
    body.appendChild(carryWrap);
  }

  // Customer source tabs
  const sourceTabs = h('div', { className: 'bol-source-tabs' });
  [['job', 'Pull from Job'], ['customer', 'Search Customers'], ['manual', 'Manual Entry']].forEach(([val, lbl]) => {
    sourceTabs.appendChild(h('button', {
      className: `btn ${td.customerSource === val ? 'btn-dark' : 'btn-white'}`,
      style: { fontSize: '13px', padding: '8px 14px' },
      onClick: () => { td.customerSource = val; bm.searchQuery = ''; bm.searchResults = []; bm.searchLoading = false; bm.searchConfirm = ''; renderBolModal(); },
    }, lbl));
  });
  body.appendChild(sourceTabs);

  // Search UI for job and customer tabs
  if (td.customerSource === 'job' || td.customerSource === 'customer') {
    const isJob = td.customerSource === 'job';
    const debouncedSearch = debounce(async (q) => {
      if (!q.trim()) { bm.searchResults = []; bm.searchLoading = false; renderBolModal(); return; }
      bm.searchLoading = true; renderBolModal();
      try {
        const url = isJob ? `/api/jobs?search=${encodeURIComponent(q)}` : `/api/bol-customers?search=${encodeURIComponent(q)}`;
        const res = await api.get(url);
        if (!res.ok) throw new Error(res.error || 'Search failed');
        const data = res.data;
        bm.searchResults = isJob ? (data.jobs || []) : (data.customers || []);
      } catch (_) { bm.searchResults = []; }
      bm.searchLoading = false; renderBolModal();
    }, 300);

    const searchWrap = h('div', { style: { position: 'relative', marginBottom: '14px' } });
    const searchInp = h('input', { className: 'inp', placeholder: isJob ? 'Search by customer, PO, or invoice #...' : 'Search saved customers...' });
    searchInp.value = bm.searchQuery || '';
    searchInp.addEventListener('input', e => { bm.searchQuery = e.target.value; debouncedSearch(e.target.value); });
    searchWrap.appendChild(searchInp);

    if (bm.searchLoading) {
      searchWrap.appendChild(h('div', { className: 'bol-search-results' }, h('div', { className: 'bol-search-item', style: { color: 'var(--text-faint)' } }, 'Searching...')));
    } else if (bm.searchResults.length) {
      const dropdown = h('div', { className: 'bol-search-results' });
      bm.searchResults.forEach(item => {
        const row = h('div', { className: 'bol-search-item' });
        if (isJob) {
          row.appendChild(h('div', { style: { fontWeight: 700 } }, item.customer || '(no customer)'));
          const details = [];
          if (item.ship_date) { const d = new Date(item.ship_date + 'T12:00:00'); details.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })); }
          if (item.po_number || item.invoice_number) details.push(`PO/Inv: ${item.po_number || item.invoice_number}`);
          if (item.status) details.push(item.status);
          if (details.length) row.appendChild(h('div', { style: { fontSize: '12px', color: 'var(--text-faint)', marginTop: '2px' } }, details.join(' \xb7 ')));
          row.addEventListener('click', async () => {
            try {
              const res = await api.get(`/api/jobs/${item.id}`);
              const data = res.data;
              const job = data.job || data;
              td.jobId = job.id; td.shipToCompany = job.customer || '';
              if (job.location) { const p = job.location.split(',').map(s => s.trim()); td.shipToCity = p[0] || ''; td.shipToState = p[1] || ''; }
              td.carrierName = job.carrier || ''; td.poNumber = job.po_number || job.invoice_number || '';
              td.deliveryTime = job.delivery_time || ''; td.contactName = job.contact_name || ''; td.contactPhone = job.contact_phone || '';
              try {
                const cr = await api.get(`/api/bol-customers?search=${encodeURIComponent(job.customer || '')}`);
                const cd = cr.data;
                const custs = cd.customers || [];
                if (custs.length === 1) {
                  const c = custs[0]; td.customerId = c.id;
                  td.shipToCompany = c.company || td.shipToCompany; td.shipToAttention = c.attention || '';
                  td.shipToStreet = c.street || ''; td.shipToStreet2 = c.street2 || '';
                  td.shipToCity = c.city || td.shipToCity; td.shipToState = c.state || td.shipToState;
                  td.shipToZip = c.zip || ''; td.contactName = c.contact_name || td.contactName; td.contactPhone = c.phone || td.contactPhone;
                }
              } catch (_) {}
              if (bm.currentPage > 0) td.carryOver = false;
              bm.searchResults = []; bm.searchQuery = ''; bm.searchConfirm = `✓ Loaded from job: ${job.customer || ''}`;
              renderBolModal();
            } catch (_) { bm.searchConfirm = 'Error loading job details.'; renderBolModal(); }
          });
        } else {
          row.appendChild(h('div', { style: { fontWeight: 700 } }, item.company || ''));
          const det = [[item.city, item.state].filter(Boolean).join(', '), item.contact_name].filter(Boolean).join(' \xb7 ');
          if (det) row.appendChild(h('div', { style: { fontSize: '12px', color: 'var(--text-faint)', marginTop: '2px' } }, det));
          row.addEventListener('click', () => {
            td.customerId = item.id; td.shipToCompany = item.company || ''; td.shipToAttention = item.attention || '';
            td.shipToStreet = item.street || ''; td.shipToStreet2 = item.street2 || '';
            td.shipToCity = item.city || ''; td.shipToState = item.state || ''; td.shipToZip = item.zip || '';
            td.contactName = item.contact_name || ''; td.contactPhone = item.phone || '';
            if (bm.currentPage > 0) td.carryOver = false;
            bm.searchResults = []; bm.searchQuery = ''; bm.searchConfirm = `✓ Using saved address: ${item.company || ''}`;
            renderBolModal();
          });
        }
        dropdown.appendChild(row);
      });
      searchWrap.appendChild(dropdown);
    }
    body.appendChild(searchWrap);
    if (bm.searchConfirm) body.appendChild(h('div', { className: 'bol-confirm-msg' }, bm.searchConfirm));
  }

  // Form fields
  const fg = (label, el) => { const g = h('div', { className: 'bol-form-group' }); g.appendChild(h('div', { className: 'form-label' }, label)); g.appendChild(el); return g; };
  const inp = (field, type = 'text', ph = '') => {
    const el = h('input', { type, className: 'inp', placeholder: ph });
    el.value = td[field] || '';
    el.addEventListener('input', e => {
      td[field] = e.target.value;
      if (field === 'invNumber') {
        state.trailerInvNumbers[bm.currentPage] = e.target.value;
        if (bm.currentPage === 0) {
          const val = td.invNumber.trim();
          const match = val.match(/^(.+-)(\d+)$/);
          if (match) {
            const prefix = match[1], startNum = parseInt(match[2], 10);
            for (let j = 1; j < bm.trailerData.length; j++) {
              const nextTd = bm.trailerData[j];
              if (!nextTd.invNumber || nextTd._invAutoFilled) {
                const suffix = String(startNum + j).padStart(match[2].length, '0');
                nextTd.invNumber = prefix + suffix;
                nextTd._invAutoFilled = true;
                state.trailerInvNumbers[j] = nextTd.invNumber;
              }
            }
          }
        }
      }
    });
    return el;
  };

  body.appendChild(fg('BOL Date', inp('date', 'date')));
  body.appendChild(fg('Company', inp('shipToCompany')));
  body.appendChild(fg('Attention', inp('shipToAttention')));
  body.appendChild(fg('Street', inp('shipToStreet')));
  body.appendChild(fg('Street 2', inp('shipToStreet2')));

  const cityWrap = h('div', { className: 'bol-form-group' });
  cityWrap.appendChild(h('div', { className: 'form-label' }, 'City / State / Zip'));
  const cityRow = h('div', { className: 'bol-city-row' });
  ['shipToCity', 'shipToState', 'shipToZip'].forEach((f, i) => {
    const el = h('input', { type: 'text', className: 'inp', placeholder: ['City', 'ST', 'Zip'][i] });
    el.value = td[f] || ''; el.addEventListener('input', e => { td[f] = e.target.value; });
    cityRow.appendChild(el);
  });
  cityWrap.appendChild(cityRow);
  body.appendChild(cityWrap);

  body.appendChild(fg('Contact Name', inp('contactName')));
  body.appendChild(fg('Contact Phone', inp('contactPhone')));
  body.appendChild(fg('Carrier', inp('carrierName')));
  body.appendChild(fg('PO Number', inp('poNumber')));
  body.appendChild(fg('INV #', inp('invNumber')));
  body.appendChild(fg('Delivery Time', inp('deliveryTime')));

  const ftWrap = h('div', { className: 'bol-form-group' });
  ftWrap.appendChild(h('div', { className: 'form-label' }, 'Freight Terms'));
  const ftRow = h('div', { className: 'bol-freight-row' });
  [['prepaid', 'Prepaid'], ['collect', 'Collect'], ['3rd_party', '3rd Party']].forEach(([val, lbl]) => {
    const lbl_el = h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '14px' } });
    const radio = h('input', { type: 'radio', name: `bol-freight-${bm.currentPage}`, value: val });
    radio.checked = td.freightTerms === val;
    radio.addEventListener('change', () => { td.freightTerms = val; });
    lbl_el.appendChild(radio); lbl_el.appendChild(document.createTextNode(lbl));
    ftRow.appendChild(lbl_el);
  });
  ftWrap.appendChild(ftRow);
  body.appendChild(ftWrap);

  const siTA = h('textarea', { className: 'inp', style: { minHeight: '70px', resize: 'vertical' } });
  siTA.value = td.specialInstructions || '';
  siTA.addEventListener('input', e => { td.specialInstructions = e.target.value; });
  body.appendChild(fg('Special Instructions', siTA));

  modal.appendChild(body);

  // Footer
  const footer = h('div', { className: 'bol-modal-footer' });
  footer.appendChild(h('button', { className: 'btn btn-white', onClick: () => { state.bolModal.open = false; renderBolModal(); } }, 'Cancel'));
  if (state.prefillJobData?.id) {
    const packingLabel = h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', cursor: 'pointer', color: 'var(--text-muted)' } });
    const packingChk = h('input', { type: 'checkbox' });
    packingChk.checked = state.bolModal.includePacking;
    packingChk.addEventListener('change', e => { state.bolModal.includePacking = e.target.checked; });
    packingLabel.appendChild(packingChk);
    packingLabel.appendChild(document.createTextNode('Include packing slip'));
    footer.appendChild(packingLabel);
  }
  {
    const diagramLabel = h('label', { style: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', cursor: 'pointer', color: 'var(--text-muted)' } });
    const diagramChk = h('input', { type: 'checkbox' });
    diagramChk.checked = state.bolModal.includeLoadingDiagram;
    diagramChk.addEventListener('change', e => { state.bolModal.includeLoadingDiagram = e.target.checked; });
    diagramLabel.appendChild(diagramChk);
    diagramLabel.appendChild(document.createTextNode('Include Loading Diagram'));
    footer.appendChild(diagramLabel);
  }
  const navRight = h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } });
  const prevBtn = h('button', { className: 'btn btn-white', disabled: bm.currentPage === 0 });
  prevBtn.textContent = '← Prev';
  prevBtn.addEventListener('click', () => { bm.currentPage--; bm.searchQuery = ''; bm.searchResults = []; bm.searchConfirm = ''; renderBolModal(); });
  navRight.appendChild(prevBtn);
  navRight.appendChild(h('span', { style: { fontSize: '14px', fontWeight: 700, color: 'var(--text-muted)' } }, `${bm.currentPage + 1}/${bm.trailerCount}`));
  const isLastPage = bm.currentPage === bm.trailerCount - 1;
  if (isLastPage) {
    const genBtn = h('button', { className: 'btn btn-dark' });
    genBtn.textContent = 'GENERATE ALL BOLs';
    genBtn.addEventListener('click', generateAllBols);
    navRight.appendChild(genBtn);
  } else {
    const nextBtn = h('button', { className: 'btn btn-dark' });
    nextBtn.textContent = 'Next →';
    nextBtn.addEventListener('click', () => { bm.currentPage++; bm.searchQuery = ''; bm.searchResults = []; bm.searchConfirm = ''; renderBolModal(); });
    navRight.appendChild(nextBtn);
  }
  footer.appendChild(navRight);
  modal.appendChild(footer);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
}
```

### 2.4 — generateAllBols: take a ctx { bm, render } from the module instead of reading state.bolModal
FIND:
```javascript
async function generateAllBols() {
  const bm = state.bolModal;
```
REPLACE:
```javascript
async function generateAllBols(ctx) {
  const bm = ctx.bm;
```

### 2.5 — validation render 1
FIND:
```javascript
if (!td.date) { bm.currentPage = i; bm.bolError = `Trailer ${i + 1}: Date is required.`; renderBolModal(); return; }
```
REPLACE:
```javascript
if (!td.date) { bm.currentPage = i; bm.bolError = `Trailer ${i + 1}: Date is required.`; ctx.render(); return; }
```

### 2.6 — validation render 2
FIND:
```javascript
if (!td.shipToCompany.trim()) { bm.currentPage = i; bm.bolError = `Trailer ${i + 1}: Company is required.`; renderBolModal(); return; }
```
REPLACE:
```javascript
if (!td.shipToCompany.trim()) { bm.currentPage = i; bm.bolError = `Trailer ${i + 1}: Company is required.`; ctx.render(); return; }
```

### 2.7 — progress render 1
FIND:
```javascript
  bm.generateProgress = bm.trailerData.map((_, i) => ({ text: `Trailer ${i + 1} — waiting...`, done: false, pending: true }));
  renderBolModal();
```
REPLACE:
```javascript
  bm.generateProgress = bm.trailerData.map((_, i) => ({ text: `Trailer ${i + 1} — waiting...`, done: false, pending: true }));
  ctx.render();
```

### 2.8 — progress render 2
FIND:
```javascript
    bm.generateProgress[i] = { text: `⏳ Trailer ${i + 1} — saving...`, done: false, pending: false };
    renderBolModal();
```
REPLACE:
```javascript
    bm.generateProgress[i] = { text: `⏳ Trailer ${i + 1} — saving...`, done: false, pending: false };
    ctx.render();
```

### 2.9 — progress render 3
FIND:
```javascript
      bm.generateProgress[i] = { text: `✓ Trailer ${i + 1} — ${data.bol.bol_number ? `BOL #${data.bol.bol_number}` : 'BOL'} saved`, done: true, pending: false };
      renderBolModal();
```
REPLACE:
```javascript
      bm.generateProgress[i] = { text: `✓ Trailer ${i + 1} — ${data.bol.bol_number ? `BOL #${data.bol.bol_number}` : 'BOL'} saved`, done: true, pending: false };
      ctx.render();
```

### 2.10 — save-loop catch render
FIND:
```javascript
    } catch (e) { bm.generating = false; bm.bolError = `Trailer ${i + 1}: ${e.message}`; renderBolModal(); return; }
```
REPLACE:
```javascript
    } catch (e) { bm.generating = false; bm.bolError = `Trailer ${i + 1}: ${e.message}`; ctx.render(); return; }
```

### 2.11 — pdf-step render
FIND:
```javascript
  bm.generateProgress.push({ text: 'Generating PDF...', done: false, pending: false });
  renderBolModal();
```
REPLACE:
```javascript
  bm.generateProgress.push({ text: 'Generating PDF...', done: false, pending: false });
  ctx.render();
```

### 2.12 — pass bm into generateBolPdf + ctx into review
FIND:
```javascript
    const blobUrl = await generateBolPdf(savedBols);
    bm.generating = false;
    renderBolModal();
    showBolReviewLB(blobUrl, savedBols);
```
REPLACE:
```javascript
    const blobUrl = await generateBolPdf(savedBols, bm);
    bm.generating = false;
    ctx.render();
    showBolReviewLB(blobUrl, savedBols, ctx);
```

### 2.13 — pdf-error render
FIND:
```javascript
      : e.message.includes('template') ? 'BOL PDF template not found. Contact admin.' : `PDF error: ${e.message}`;
    renderBolModal();
  }
}
```
REPLACE:
```javascript
      : e.message.includes('template') ? 'BOL PDF template not found. Contact admin.' : `PDF error: ${e.message}`;
    ctx.render();
  }
}
```

### 2.14 — generateBolPdf: receive bm; null-tolerant
FIND:
```javascript
async function generateBolPdf(bolRecords) {
```
REPLACE:
```javascript
async function generateBolPdf(bolRecords, bm) {
```

### 2.15 — packing flag from bm
FIND:
```javascript
  if (state.bolModal.includePacking && state.prefillJobData?.id) {
```
REPLACE:
```javascript
  if (bm && bm.includePacking && state.prefillJobData?.id) {
```

### 2.16 — diagram flag from bm
FIND:
```javascript
  if (state.bolModal.includeLoadingDiagram) {
```
REPLACE:
```javascript
  if (bm && bm.includeLoadingDiagram) {
```

### 2.17 — currentPage/trailers from bm
FIND:
```javascript
      const idx = state.bolModal.currentPage;
      const trailer = state.bolModal.trailers[idx];
```
REPLACE:
```javascript
      const idx = bm.currentPage;
      const trailer = bm.trailers[idx];
```

### 2.18 — add lbCtx module var
FIND:
```javascript
let lbPendingBlobUrl    = null;
let lbPendingBols       = null;
let lbReviewBols        = [];
let lbReviewActiveIndex = 0;
```
REPLACE:
```javascript
let lbPendingBlobUrl    = null;
let lbPendingBols       = null;
let lbReviewBols        = [];
let lbReviewActiveIndex = 0;
let lbCtx               = null;
```

### 2.19 — showBolReviewLB: accept + store ctx
FIND:
```javascript
function showBolReviewLB(blobUrl, savedBols) {
  lbPendingBlobUrl    = blobUrl;
```
REPLACE:
```javascript
function showBolReviewLB(blobUrl, savedBols, ctx) {
  lbCtx               = ctx;
  lbPendingBlobUrl    = blobUrl;
```

### 2.20 — approve handler drives the module-owned modal
FIND:
```javascript
    const bols = [...lbReviewBols];
    closeBolReviewLB();
    state.bolModal.bolSuccess = bols;
    renderBolModal();
```
REPLACE:
```javascript
    const bols = [...lbReviewBols];
    closeBolReviewLB();
    lbCtx.bm.bolSuccess = bols;
    lbCtx.render();
```

### 2.21 — lbEditorOnApply passes flags via lbCtx.bm
FIND:
```javascript
    const newBlobUrl = await generateBolPdf(lbReviewBols);
```
REPLACE:
```javascript
    const newBlobUrl = await generateBolPdf(lbReviewBols, lbCtx ? lbCtx.bm : null);
```

---

## Verify
- `node --check logistics/bol-compose.js` passes.
- No `state.bolModal` or `renderBolModal` reference remains anywhere in `load-builder.html` (grep both — expect zero).
- Load builder: build a single-trailer load → GENERATE BOLs → modal identical (commodity box, hide-dims, source tabs, search, all fields, freight radios, special instructions, footer checkboxes). Generate → progress list → review modal → Edit (inline editor) → Approve & Save → success view. Then a multi-trailer load: pagination, carry-over checkbox, INV# auto-fill across trailers, GENERATE ALL — all unchanged.
- Open and close the modal without generating (✕ / Cancel) — closes cleanly. Reopen — fresh state.

## Deploy
```
git add logistics/bol-compose.js logistics/load-builder.html
git commit -m "P125: BOL re-unification phase 2 — move BOL modal (open/render/state) into BolCompose; generate/review bridged via ctx; zero behavior change"
git push
```
