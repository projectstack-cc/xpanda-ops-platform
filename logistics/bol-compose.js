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

  // ── Review modal markup (lifted from load-builder.html, P126). Injected once. ──
  const REVIEW_ID = 'bol-review-backdrop';
  const REVIEW_HTML = String.raw`
<!-- BOL Review Modal -->
<div id="bol-review-backdrop" style="
  position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;
  display:none;align-items:center;justify-content:center;
">
  <div style="
    background:#fff;border-radius:12px;width:95%;max-width:800px;
    height:85vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,0.2);
  ">
    <div style="
      display:flex;justify-content:space-between;align-items:center;
      padding:16px 20px;border-bottom:1px solid #e5e7eb;
    ">
      <h3 style="margin:0;font-size:16px;font-weight:700;color:#111827;">Review BOL</h3>
      <div style="display:flex;gap:8px;">
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
        <button id="bol-review-edit" style="
          padding:8px 20px;border-radius:8px;border:1px solid #d1d5db;
          background:#fff;cursor:pointer;font-size:14px;font-weight:600;color:#111827;
        ">Make Changes</button>
        <button id="bol-review-approve" style="
          padding:8px 20px;border-radius:8px;border:none;
          background:#1e293b;color:#fff;cursor:pointer;font-size:14px;font-weight:600;
        ">Approve</button>
      </div>
    </div>
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
    <iframe id="bol-review-iframe" style="
      flex:1;border:none;border-radius:0 0 12px 12px;
    "></iframe>
    <div id="bol-review-editor-host-lb" style="display:none; flex:1; overflow:auto; background:#f9fafb; flex-direction:column;">
      <div id="bol-review-editor-mount-lb" style="position:relative; flex:1; min-width:0; width:100%;"></div>
    </div>
  </div>
</div>
`;
  function injectReviewModal() {
    if (document.getElementById(REVIEW_ID)) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = REVIEW_HTML;
    while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
  }

  // ── Modal state (owned by this module; was load-builder's state.bolModal) ──
  let BM   = null;
  let OPTS = null;

  // open(opts):
  //   opts.trailerData       — prebuilt array of per-trailer BOL field objects (caller builds it)
  //   opts.trailerCount      — number of trailers
  //   opts.trailers          — raw packed-trailer array (passed through for the generate step)
  //   opts.prefillJobData    — job object or null (drives "Include packing slip" visibility)
  //   opts.trailerInvNumbers — array reference; INV# edits write back into it
  //   opts.buildAppendBytes(bm) — async; returns extra PDF bytes to append (packing slip / loading diagram) or null
  function open(opts) {
    injectReviewModal();
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
      genBtn.addEventListener('click', generateAll);
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


  // ── Generate + review (moved from load-builder, P126) ──
  let lbPendingBlobUrl    = null;
  let lbPendingBols       = null;
  let lbReviewBols        = [];
  let lbReviewActiveIndex = 0;

  async function generateAll() {
    const bm = BM;
    bm.bolError = '';
    for (let i = 0; i < bm.trailerData.length; i++) {
      const td = bm.trailerData[i];
      if (!td.date) { bm.currentPage = i; bm.bolError = `Trailer ${i + 1}: Date is required.`; render(); return; }
      if (!td.shipToCompany.trim()) { bm.currentPage = i; bm.bolError = `Trailer ${i + 1}: Company is required.`; render(); return; }
    }
    const missingNumbers = bm.trailerData.some(td => !(td.invNumber || '').trim());
    if (missingNumbers) {
      const proceed = await BolShared.confirmNoBolNumber();
      if (!proceed) return;
    }
    bm.generating = true; bm.bolError = '';
    bm.generateProgress = bm.trailerData.map((_, i) => ({ text: `Trailer ${i + 1} — waiting...`, done: false, pending: true }));
    render();
    const savedBols = [];
    // Link a multi-load BOL set with a shared group id so the trailers of one
    // shipment are queryable/displayable as a set. Singles get no group id.
    const bolGroupId = bm.trailerData.length > 1
      ? ((typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : ('grp-' + Date.now() + '-' + Math.random().toString(36).slice(2)))
      : null;
    for (let i = 0; i < bm.trailerData.length; i++) {
      const td = bm.trailerData[i];
      bm.generateProgress[i] = { text: `⏳ Trailer ${i + 1} — saving...`, done: false, pending: false };
      render();
      try {
        const payload = {
          bol_number: td.invNumber || null,
          date: td.date, customer_id: td.customerId || null,
          ship_to_company: td.shipToCompany, ship_to_attention: td.shipToAttention,
          ship_to_street: td.shipToStreet, ship_to_street2: td.shipToStreet2,
          ship_to_city: td.shipToCity, ship_to_state: td.shipToState, ship_to_zip: td.shipToZip,
          location_no: '', carrier_id: null, carrier_name: td.carrierName,
          trailer_no: '', seal_number: '', scac: '', pro_no: '',
          freight_terms: td.freightTerms, is_scrap_pickup: 0, third_party_bill_to: '',
          special_instructions: td.specialInstructions,
          contact_info: [td.contactName ? ('POC: ' + td.contactName) : '', td.contactPhone || ''].filter(Boolean).join(' '),
          po_number: td.poNumber || '',
          is_master_bol: 0,
          bol_group_id: bolGroupId,
          load_number: i + 1,
          load_count: bm.trailerData.length,
          commodity_description: td.commodityDescription,
          handling_unit_qty: String(td.totalStacks), handling_unit_type: 'stacks',
          package_qty: String(td.totalPieces), package_type: 'pcs',
          weight: String(td.totalWeight), delivery_time: td.deliveryTime,
          job_id: td.jobId || null, notes: '',
        };
        const res = await api.post('/api/bols', payload);
        if (!res.ok) { throw new Error(res.error || `HTTP ${res.status}`); }
        const data = res.data;
        if (td.poNumber) data.bol.po_number = data.bol.po_number || td.poNumber;
        savedBols.push(data.bol);
        bm.generateProgress[i] = { text: `✓ Trailer ${i + 1} — ${data.bol.bol_number ? `BOL #${data.bol.bol_number}` : 'BOL'} saved`, done: true, pending: false };
        render();
      } catch (e) { bm.generating = false; bm.bolError = `Trailer ${i + 1}: ${e.message}`; render(); return; }
    }
    bm.generateProgress.push({ text: 'Generating PDF...', done: false, pending: false });
    render();
    try {
      const blobUrl = await generateBolPdf(savedBols, bm);
      bm.generating = false;
      render();
      showReview(blobUrl, savedBols);
    } catch (e) {
      bm.generating = false; bm.bolSuccess = savedBols;
      bm.bolError = e.popupBlocked ? 'PDF was generated but your browser blocked the popup. Please allow popups for this site.'
        : e.message.includes('template') ? 'BOL PDF template not found. Contact admin.' : `PDF error: ${e.message}`;
      render();
    }
  }

  // ONE combined PDF with all three copies per BOL — original, driver, customer — then the packing
  // slip once. Single source of truth so bol-generator and load-builder produce identical output.
  async function generateCombinedCopies(records, append) {
    const { PDFDocument } = PDFLib;
    const out = await PDFDocument.create();
    for (const copyType of [undefined, 'driver', 'customer']) {
      const r = await BolShared.generatePdf(records, { previewOnly: true, copyType });
      try { URL.revokeObjectURL(r.blobUrl); } catch (_e) {}
      const src = await PDFDocument.load(r.pdfBytes);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach(p => out.addPage(p));
    }
    if (append) {
      const ap = await PDFDocument.load(append);
      const apages = await out.copyPages(ap, ap.getPageIndices());
      apages.forEach(p => out.addPage(p));
    }
    const pdfBytes = await out.save();
    const blobUrl = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
    return { blobUrl, pdfBytes };
  }

  async function generateBolPdf(bolRecords, bm) {
    const append = (OPTS && OPTS.buildAppendBytes) ? await OPTS.buildAppendBytes(bm) : null;
    const { blobUrl } = await generateCombinedCopies(bolRecords, append);
    return blobUrl;
  }

  function showReview(blobUrl, savedBols) {
    lbPendingBlobUrl    = blobUrl;
    lbPendingBols       = savedBols;
    lbReviewBols        = [...savedBols];
    lbReviewActiveIndex = 0;

    const backdrop = document.getElementById('bol-review-backdrop');
    const iframe = document.getElementById('bol-review-iframe');
    iframe.src = blobUrl;
    iframe.style.display = '';
    document.getElementById('bol-review-editor-host-lb').style.display = 'none';
    backdrop.style.display = 'flex';

    const approveBtn = document.getElementById('bol-review-approve');
    const editBtn    = document.getElementById('bol-review-edit');
    const closeBtn   = document.getElementById('bol-review-close-lb');

    const newApprove = approveBtn.cloneNode(true);
    approveBtn.parentNode.replaceChild(newApprove, approveBtn);
    newApprove.addEventListener('click', async () => {
      for (const bol of lbReviewBols) {
        if (bol._overrides) {
          try {
            await api.put(`/api/bols/${bol.id}`, { ...bol, render_overrides: bol._overrides });
          } catch (e) { console.error('Failed to save overrides for BOL', bol.id, e); }
        }
      }
      // Trigger an actual download of the approved BOL (the review modal already showed the preview).
      const dlUrl  = lbPendingBlobUrl;
      const dlName = (lbReviewBols.length === 1 && lbReviewBols[0] && lbReviewBols[0].bol_number)
        ? `BOL-${lbReviewBols[0].bol_number}.pdf` : 'BOL.pdf';
      const dlA = document.createElement('a');
      dlA.href = dlUrl; dlA.download = dlName;
      document.body.appendChild(dlA); dlA.click(); dlA.remove();
      setTimeout(() => { try { URL.revokeObjectURL(dlUrl); } catch (e) {} }, 30000);
      lbPendingBlobUrl = null;
      const bols = [...lbReviewBols];
      closeReview();
      BM.bolSuccess = bols;
      render();
    });

    const newEdit = editBtn.cloneNode(true);
    editBtn.parentNode.replaceChild(newEdit, editBtn);
    newEdit.addEventListener('click', handleReviewEdit);

    if (closeBtn) {
      const newClose = closeBtn.cloneNode(true);
      closeBtn.parentNode.replaceChild(newClose, closeBtn);
      newClose.addEventListener('click', closeReview);
    }
  }

  function closeReview() {
    const backdrop = document.getElementById('bol-review-backdrop');
    backdrop.style.display = 'none';
    document.getElementById('bol-review-iframe').src = '';
    document.getElementById('bol-review-iframe').style.display = '';
    document.getElementById('bol-review-editor-host-lb').style.display = 'none';
    document.getElementById('bol-review-picker-lb').style.display = 'none';
    if (lbPendingBlobUrl) {
      URL.revokeObjectURL(lbPendingBlobUrl);
      lbPendingBlobUrl = null;
    }
    lbReviewBols        = [];
    lbReviewActiveIndex = 0;
  }

  async function editorOnApply(updatedBol) {
    lbReviewBols[lbReviewActiveIndex] = updatedBol;
    const editorHost = document.getElementById('bol-review-editor-host-lb');
    const iframe     = document.getElementById('bol-review-iframe');
    try {
      const newBlobUrl = await generateBolPdf(lbReviewBols, BM);
      if (lbPendingBlobUrl) URL.revokeObjectURL(lbPendingBlobUrl);
      lbPendingBlobUrl = newBlobUrl;
      iframe.src = newBlobUrl;
      editorHost.style.display = 'none';
      iframe.style.display = '';
      document.getElementById('bol-review-picker-lb').style.display = 'none';
    } catch (e) {
      console.error('Failed to regenerate BOL preview:', e);
    }
  }

  function editorOnCancel() {
    document.getElementById('bol-review-editor-host-lb').style.display = 'none';
    document.getElementById('bol-review-iframe').style.display = '';
    document.getElementById('bol-review-picker-lb').style.display = 'none';
  }

  function handleReviewEdit() {
    const iframe     = document.getElementById('bol-review-iframe');
    const editorHost = document.getElementById('bol-review-editor-host-lb');
    iframe.style.display     = 'none';
    editorHost.style.display = 'flex';
    document.getElementById('bol-review-picker-lb').style.display = 'flex';

    const sel = document.getElementById('bol-review-picker-select-lb');
    sel.innerHTML = '';
    lbReviewBols.forEach((b, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      const label = b.ship_to_company || b.bol_number || `BOL ${i + 1}`;
      opt.textContent = `BOL ${i + 1} of ${lbReviewBols.length} — ${label}`;
      sel.appendChild(opt);
    });
    sel.value = String(lbReviewActiveIndex);

    const newSel = sel.cloneNode(true);
    sel.parentNode.replaceChild(newSel, sel);
    newSel.addEventListener('change', (e) => {
      lbReviewActiveIndex = Number(e.target.value) || 0;
      requestAnimationFrame(() => {
        BolEditor.open(lbReviewBols[lbReviewActiveIndex],
          document.getElementById('bol-review-editor-mount-lb'),
          { onApply: editorOnApply, onCancel: editorOnCancel });
      });
    });

    requestAnimationFrame(() => {
      BolEditor.open(lbReviewBols[lbReviewActiveIndex],
        document.getElementById('bol-review-editor-mount-lb'),
        { onApply: editorOnApply, onCancel: editorOnCancel });
    });
  }

  // ── Standalone review surface (P127) ─────────────────────────────────────────
  // For consumers that own persistence (e.g. bol-generator). Reuses the injected
  // review modal + BolEditor; approve is DELEGATED via opts.onApprove, then the
  // module opens the PDF and closes. Does not touch the authoring (open/BM) path.
  //   reviewRecords(records, { buildAppendBytes, onApprove, onError }):
  //     buildAppendBytes() -> async; extra PDF bytes to append, or null
  //     onApprove(records) -> async; caller persists the (possibly edited) records
  //     onError(err)       -> optional
  let RR = null;

  async function reviewRecords(records, opts) {
    const _me = (window.__xpandaUser && window.__xpandaUser.displayName) || '';
    const prepared = records.map(r => {
      const rec = r.access_token ? r : { ...r, access_token: crypto.randomUUID() };
      return rec.shipper_name ? rec : { ...rec, shipper_name: _me };
    });
    RR = { records: prepared, idx: 0, blobUrl: null, opts: opts || {} };
    await rrRegenerate();
    rrShow();
  }

  async function rrRegenerate() {
    const append = RR.opts.buildAppendBytes ? await RR.opts.buildAppendBytes() : null;
    const result = await generateCombinedCopies(RR.records, append);
    if (RR.blobUrl) URL.revokeObjectURL(RR.blobUrl);
    RR.blobUrl = result.blobUrl;
  }

  function rrShow() {
    injectReviewModal();
    const backdrop = document.getElementById('bol-review-backdrop');
    const iframe   = document.getElementById('bol-review-iframe');
    iframe.src = RR.blobUrl; iframe.style.display = '';
    document.getElementById('bol-review-editor-host-lb').style.display = 'none';
    document.getElementById('bol-review-picker-lb').style.display = 'none';
    backdrop.style.display = 'flex';

    const approveBtn = document.getElementById('bol-review-approve');
    const editBtn    = document.getElementById('bol-review-edit');
    const closeBtn   = document.getElementById('bol-review-close-lb');
    const a = approveBtn.cloneNode(true); approveBtn.parentNode.replaceChild(a, approveBtn);
    a.addEventListener('click', rrApprove);
    const e = editBtn.cloneNode(true); editBtn.parentNode.replaceChild(e, editBtn);
    e.addEventListener('click', rrEdit);
    if (closeBtn) { const c = closeBtn.cloneNode(true); closeBtn.parentNode.replaceChild(c, closeBtn); c.addEventListener('click', rrClose); }
  }

  async function rrApprove() {
    const btn = document.getElementById('bol-review-approve');
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (RR.opts.onApprove) await RR.opts.onApprove(RR.records);
      if (RR.blobUrl) { BolShared.openPdf(RR.blobUrl); RR.blobUrl = null; }
      rrClose();
    } catch (err) {
      if (RR.opts.onError) RR.opts.onError(err); else console.error(err);
      btn.disabled = false; btn.textContent = label;
    }
  }

  function rrClose() {
    const backdrop = document.getElementById('bol-review-backdrop');
    if (backdrop) backdrop.style.display = 'none';
    const iframe = document.getElementById('bol-review-iframe');
    if (iframe) { iframe.src = ''; iframe.style.display = ''; }
    const host = document.getElementById('bol-review-editor-host-lb'); if (host) host.style.display = 'none';
    const picker = document.getElementById('bol-review-picker-lb'); if (picker) picker.style.display = 'none';
    if (RR && RR.blobUrl) { URL.revokeObjectURL(RR.blobUrl); RR.blobUrl = null; }
    RR = null;
  }

  function rrEdit() {
    const iframe     = document.getElementById('bol-review-iframe');
    const editorHost = document.getElementById('bol-review-editor-host-lb');
    iframe.style.display = 'none';
    editorHost.style.display = 'flex';
    const picker = document.getElementById('bol-review-picker-lb');
    if (RR.records.length > 1) {
      picker.style.display = 'flex';
      const sel = document.getElementById('bol-review-picker-select-lb');
      sel.innerHTML = '';
      RR.records.forEach((b, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = `BOL ${i + 1} of ${RR.records.length} — ${b.ship_to_company || b.bol_number || ('BOL ' + (i + 1))}`;
        sel.appendChild(opt);
      });
      sel.value = String(RR.idx);
      const ns = sel.cloneNode(true); sel.parentNode.replaceChild(ns, sel);
      ns.addEventListener('change', (ev) => { RR.idx = Number(ev.target.value) || 0; rrOpenEditor(); });
    } else {
      picker.style.display = 'none';
    }
    rrOpenEditor();
  }

  function rrOpenEditor() {
    requestAnimationFrame(() => {
      BolEditor.open(RR.records[RR.idx], document.getElementById('bol-review-editor-mount-lb'),
        { onApply: rrEditorApply, onCancel: rrEditorCancel });
    });
  }

  async function rrEditorApply(updatedBol) {
    RR.records[RR.idx] = updatedBol;
    try {
      await rrRegenerate();
      document.getElementById('bol-review-editor-host-lb').style.display = 'none';
      document.getElementById('bol-review-picker-lb').style.display = 'none';
      const iframe = document.getElementById('bol-review-iframe');
      iframe.src = RR.blobUrl; iframe.style.display = '';
    } catch (e) { console.error('Failed to regenerate BOL preview:', e); }
  }

  function rrEditorCancel() {
    document.getElementById('bol-review-editor-host-lb').style.display = 'none';
    document.getElementById('bol-review-picker-lb').style.display = 'none';
    document.getElementById('bol-review-iframe').style.display = '';
  }

  return { open, render, reviewRecords, _h: h, _injectStyles: injectStyles };

})();
