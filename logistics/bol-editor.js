window.BolEditor = (function () {
  'use strict';

  const PDF_JS_URL  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
  const WORKER_URL  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';
  const BASELINE_FUDGE = 0; // px added to every input's top — nudge all fields uniformly after visual check

  let _pdfjs = null;

  async function loadPdfJs() {
    if (_pdfjs) return _pdfjs;
    const mod = await import(PDF_JS_URL);
    mod.GlobalWorkerOptions.workerSrc = WORKER_URL;
    _pdfjs = mod;
    return _pdfjs;
  }

  // ── Derive a field's current value from bol, matching generatePdf's derivation ──

  function deriveValue(bol, field) {
    const k  = field.overrideKey;
    const ov = bol._overrides || {};

    if (field.type === 'single') {
      const colMap = {
        date:         'date',
        bolNumber:    'bol_number',
        carrierName:  'carrier_name',
        trailerNo:    'trailer_no',
      };
      return k in ov ? String(ov[k]) : String(bol[colMap[k]] || '');
    }

    if (field.type === 'shipto') {
      return k in ov ? ov[k].join('\n') : BolShared.buildShipToLines(bol).join('\n');
    }

    if (field.type === 'multiline') {
      if (k in ov) return Array.isArray(ov[k]) ? ov[k].join('\n') : String(ov[k]);
      if (k === 'deliveryTime') return bol.delivery_time || '';
      if (k === 'specialInstr') return bol.special_instructions || '';
      if (k === 'contactInfo')  return bol.contact_info || [
        bol.contact_name  ? ('POC: ' + bol.contact_name) : '',
        bol.contact_phone || '',
      ].filter(Boolean).join(' ');
      if (k === 'poNumber') {
        const v = bol.po_number || bol.poNumber || '';
        return v ? 'PO: ' + v : '';
      }
      if (k === 'commodity') return bol.commodity_description || '';
    }

    if (field.type === 'scrap') {
      if (typeof ov[k] === 'boolean') return ov[k];
      return bol.is_scrap_pickup === 1 || bol.is_scrap_pickup === true || bol.is_scrap_pickup === '1';
    }

    return '';
  }

  // ── Derive a field's pristine base value, ignoring bol._overrides entirely.
  //    Used by the Apply handler to diff against the true original, not against
  //    whatever override happened to be in effect when the editor opened. ──

  function deriveBaseValue(bol, field) {
    const k = field.overrideKey;

    if (field.type === 'single') {
      const colMap = {
        date:         'date',
        bolNumber:    'bol_number',
        carrierName:  'carrier_name',
        trailerNo:    'trailer_no',
      };
      return String(bol[colMap[k]] || '');
    }

    if (field.type === 'shipto') {
      return BolShared.buildShipToLines(bol).join('\n');
    }

    if (field.type === 'multiline') {
      if (k === 'deliveryTime') return bol.delivery_time || '';
      if (k === 'specialInstr') return bol.special_instructions || '';
      if (k === 'contactInfo')  return bol.contact_info || [
        bol.contact_name  ? ('POC: ' + bol.contact_name) : '',
        bol.contact_phone || '',
      ].filter(Boolean).join(' ');
      if (k === 'poNumber') {
        const v = bol.po_number || bol.poNumber || '';
        return v ? 'PO: ' + v : '';
      }
      if (k === 'commodity') return bol.commodity_description || '';
    }

    if (field.type === 'scrap') {
      return bol.is_scrap_pickup === 1 || bol.is_scrap_pickup === true || bol.is_scrap_pickup === '1';
    }

    return '';
  }

  // ── Yes/No scrap toggle ──

  function buildScrapToggle(initVal) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;display:flex;flex-direction:column;gap:2px;';
    wrap.dataset.scrapValue = String(initVal);

    function setState(val) {
      wrap.dataset.scrapValue = String(val);
      wrap.querySelectorAll('button').forEach(b => {
        const active = (b.dataset.scrapOption === 'yes') === val;
        b.style.background = active ? '#1e293b' : 'var(--card-bg,#fff)';
        b.style.color      = active ? '#fff'    : 'var(--text,#111827)';
      });
    }

    for (const [label, val] of [['Yes', true], ['No', false]]) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.dataset.scrapOption = val ? 'yes' : 'no';
      btn.style.cssText = 'padding:2px 8px;border-radius:4px;cursor:pointer;font-weight:600;border:1px solid var(--border,#d1d5db);';
      btn.style.background = (val === initVal) ? '#1e293b' : 'var(--card-bg,#fff)';
      btn.style.color      = (val === initVal) ? '#fff'    : 'var(--text,#111827)';
      btn.addEventListener('click', () => setState(val));
      wrap.appendChild(btn);
    }
    return wrap;
  }

  // ── Entry point ──

  async function open(bol, mountEl, { onApply, onCancel }) {
    // lbz-bol-01: a bol fresh from POST /api/bols (e.g. zoneColumns data set at create time) can
    // carry render_overrides as a JSON string with no _overrides yet. Hydrate it onto the SAME
    // object reference so callers holding this bol (lbReviewBols[i], etc.) see it too — mirrors
    // the equivalent hydration in BolShared.generatePdf, kept separate/untouched there so that
    // existing rendering path stays zero-risk.
    if (!bol._overrides && bol.render_overrides) {
      let _parsed = null;
      if (typeof bol.render_overrides === 'object') {
        _parsed = bol.render_overrides;
      } else if (typeof bol.render_overrides === 'string' && bol.render_overrides.trim()) {
        try { _parsed = JSON.parse(bol.render_overrides); } catch (_e) { _parsed = null; }
      }
      if (_parsed && typeof _parsed === 'object') bol._overrides = _parsed;
    }

    mountEl.innerHTML = '';
    mountEl.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    const loadingEl = document.createElement('div');
    loadingEl.style.cssText = 'flex:1;display:flex;align-items:center;justify-content:center;color:var(--muted,#4b5563);font-size:14px;';
    loadingEl.textContent = 'Loading editor…';
    mountEl.appendChild(loadingEl);

    let pdfPage;
    try {
      const pdfjs = await loadPdfJs();
      const resp  = await fetch('/logistics/assets/BLANK_BOL_Xpanda.pdf');
      if (!resp.ok) throw new Error('BOL template not found');
      const bytes = await resp.arrayBuffer();
      const doc   = await pdfjs.getDocument({ data: bytes }).promise;
      pdfPage     = await doc.getPage(1);
    } catch (e) {
      loadingEl.textContent = 'Editor failed to load: ' + (e.message || String(e));
      return;
    }
    loadingEl.remove();

    // ── Build DOM ──

    const scrollArea = document.createElement('div');
    scrollArea.style.cssText = 'flex:1;overflow:auto;display:flex;justify-content:center;align-items:flex-start;padding:12px;background:var(--bg,#f0f2f5);';
    mountEl.appendChild(scrollArea);

    const canvasWrap = document.createElement('div');
    canvasWrap.style.cssText = 'position:relative;display:inline-block;box-shadow:0 2px 8px rgba(0,0,0,0.15);';
    scrollArea.appendChild(canvasWrap);

    const canvas = document.createElement('canvas');
    canvasWrap.appendChild(canvas);

    const actionBar = document.createElement('div');
    actionBar.style.cssText = 'flex-shrink:0;display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border,#d1d5db);background:var(--card-bg,#fff);';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:8px 20px;border-radius:8px;border:1px solid var(--border,#d1d5db);background:var(--card-bg,#fff);cursor:pointer;font-size:14px;font-weight:600;color:var(--text,#111827);';

    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply Changes';
    applyBtn.style.cssText = 'padding:8px 20px;border-radius:8px;border:none;background:#1e293b;color:#fff;cursor:pointer;font-size:14px;font-weight:600;';

    actionBar.appendChild(cancelBtn);
    actionBar.appendChild(applyBtn);
    mountEl.appendChild(actionBar);

    // ── Build input elements ──

    const inputEls      = {}; // overrideKey → DOM element
    const handleEls     = {}; // overrideKey → drag-handle element
    const initialValues = {}; // overrideKey → string | boolean

    // P122: live working copy of position overrides (PDF-point deltas), seeded from saved _pos
    const _savedPos = (bol._overrides && bol._overrides._pos) || {};
    const posOverrides = {}; // overrideKey → { dx, dy }
    for (const _k in _savedPos) {
      if (_savedPos[_k]) posOverrides[_k] = { dx: _savedPos[_k].dx || 0, dy: _savedPos[_k].dy || 0 };
    }

    // lbz-bol-01: zone columns are N boxes (one per zone), not the FIELD_MAP's 1-per-field model,
    // so their data is read here (sync) and their DOM/positioning is built separately below — see
    // the two `continue`s in the loop right after this. `zcZoneData` also gates skipping the
    // regular 'commodity' box, which the zone columns replace entirely on a zoned bol.
    let zcZoneData   = null; // frozen snapshot this BOL's zone columns were built from (→ Reset)
    let zcSourceHash = null; // hash of the job's zone assignment at generation time (stale guard)
    let zcItems      = null; // live working copy of [{label,text,x,y}], or null = not yet built
    {
      const _zc0 = bol._overrides && bol._overrides.zoneColumns;
      if (_zc0 && Array.isArray(_zc0.zoneData) && _zc0.zoneData.length) {
        zcZoneData   = _zc0.zoneData;
        zcSourceHash = _zc0.sourceHash || null;
        if (Array.isArray(_zc0.items) && _zc0.items.length) zcItems = _zc0.items.map(it => ({ ...it }));
      }
    }

    for (const field of BolShared.FIELD_MAP) {
      if (field.type === 'zonecolumns') continue; // handled separately below (N boxes, not 1)
      if (field.overrideKey === 'commodity' && zcZoneData) continue; // zone columns replace this field entirely on a zoned bol
      const k       = field.overrideKey;
      const initVal = deriveValue(bol, field);
      initialValues[k] = initVal;

      let el;
      if (field.type === 'scrap') {
        el = buildScrapToggle(initVal);
      } else if (field.type === 'single') {
        el = document.createElement('input');
        el.type  = 'text';
        el.value = initVal;
        el.style.cssText = 'position:absolute;box-sizing:border-box;background:rgba(255,255,255,0.88);border:1.5px solid var(--border,#d1d5db);border-radius:4px;padding:1px 4px;font-family:Helvetica,Arial,sans-serif;color:var(--text,#111827);';
      } else {
        el = document.createElement('textarea');
        el.value = initVal;
        el.style.cssText = 'position:absolute;box-sizing:border-box;background:rgba(255,255,255,0.88);border:1.5px solid var(--border,#d1d5db);border-radius:4px;padding:2px 4px;font-family:Helvetica,Arial,sans-serif;color:var(--text,#111827);resize:none;overflow:hidden;';
        el.addEventListener('input', function () {
          this.style.height = 'auto';
          this.style.height = this.scrollHeight + 'px';
        });
      }

      inputEls[k] = el;
      canvasWrap.appendChild(el);

      // P122: per-field drag handle (drag to move; double-click to reset position)
      const handle = document.createElement('div');
      handle.title = 'Drag to move · double-click to reset';
      handle.style.cssText = 'position:absolute;width:16px;height:16px;border-radius:4px;'
        + 'background:#1e293b;color:#fff;font-size:11px;line-height:16px;text-align:center;'
        + 'cursor:grab;z-index:5;box-shadow:0 1px 2px rgba(0,0,0,0.3);touch-action:none;user-select:none;';
      handle.textContent = '✥';
      attachDragHandle(handle, k);
      handleEls[k] = handle;
      canvasWrap.appendChild(handle);
    }

    // ── Render + position ──

    let _renderTask = null;
    let _scale = 1; // px-per-PDF-point, updated each reflow; used to convert drag deltas

    // P122: pointer-drag a field's box; commits a {dx,dy} point-delta into posOverrides
    function attachDragHandle(handle, k) {
      let startX = 0, startY = 0, baseDx = 0, baseDy = 0, dragging = false;

      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        handle.setPointerCapture(e.pointerId);
        handle.style.cursor = 'grabbing';
        startX = e.clientX;
        startY = e.clientY;
        const cur = posOverrides[k] || { dx: 0, dy: 0 };
        baseDx = cur.dx; baseDy = cur.dy;
      });

      handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const s = _scale || 1;
        // screen px → PDF points; PDF y grows upward, screen y grows downward
        const dx = baseDx + (e.clientX - startX) / s;
        const dy = baseDy - (e.clientY - startY) / s;
        posOverrides[k] = { dx: Math.round(dx), dy: Math.round(dy) };
        positionAll(_scale);
      });

      const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
        handle.style.cursor = 'grab';
        if (posOverrides[k] && posOverrides[k].dx === 0 && posOverrides[k].dy === 0) delete posOverrides[k];
      };
      handle.addEventListener('pointerup', endDrag);
      handle.addEventListener('pointercancel', endDrag);

      // double-click → reset this field to its default coord
      handle.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        delete posOverrides[k];
        positionAll(_scale);
      });
    }

    function reflow() {
      if (_renderTask) { try { _renderTask.cancel(); } catch (_) {} _renderTask = null; }

      const logicalW = Math.max(200, scrollArea.clientWidth - 24);
      const logicalH = Math.round(logicalW * BolShared.PAGE.height / BolShared.PAGE.width);
      const s        = logicalW / BolShared.PAGE.width;
      _scale = s;
      const dpr      = window.devicePixelRatio || 1;

      canvas.width        = Math.round(logicalW * dpr);
      canvas.height       = Math.round(logicalH * dpr);
      canvas.style.width  = logicalW + 'px';
      canvas.style.height = logicalH + 'px';
      canvasWrap.style.width  = logicalW + 'px';
      canvasWrap.style.height = logicalH + 'px';

      const ctx = canvas.getContext('2d');
      const vp  = pdfPage.getViewport({ scale: s * dpr });
      _renderTask = pdfPage.render({ canvasContext: ctx, viewport: vp });
      _renderTask.promise.then(() => { _renderTask = null; }).catch(() => {});

      positionAll(s);
      positionZc(s); // lbz-bol-01
    }

    function positionAll(s) {
      const H = BolShared.PAGE.height;
      for (const field of BolShared.FIELD_MAP) {
        const k  = field.overrideKey;
        const el = inputEls[k];
        if (!el) continue;

        if (field.type === 'single') {
          const c = field.coord;
          el.style.left       = Math.round(c.x * s) + 'px';
          el.style.top        = Math.round((H - c.y) * s - c.size * s + BASELINE_FUDGE) + 'px';
          el.style.fontSize   = (c.size * s) + 'px';
          el.style.height     = Math.round((c.size + 6) * s) + 'px';
          el.style.lineHeight = Math.round((c.size + 4) * s) + 'px';
          el.style.width      = Math.round((BolShared.PAGE.width - c.x - 10) * s) + 'px';

        } else if (field.type === 'multiline') {
          const c     = field.coord;
          const lineH = c.lineH || 14;
          const lc    = Math.max(2, (el.value || '').split('\n').length);
          el.style.left       = Math.round(c.x * s) + 'px';
          el.style.top        = Math.round((H - c.y) * s - c.size * s + BASELINE_FUDGE) + 'px';
          el.style.fontSize   = (c.size * s) + 'px';
          el.style.width      = Math.round(c.maxW * s) + 'px';
          el.style.height     = Math.round(lc * lineH * s + 8 * s) + 'px';
          el.style.lineHeight = Math.round(lineH * s) + 'px';

        } else if (field.type === 'shipto') {
          // shipLine1 y=615, shipLine2 y=601, shipLine3 y=587, shipLine4 y=573 — 14pt spacing
          const c1 = field.coords[0];
          const c4 = field.coords[3];
          const topPx    = Math.round((H - c1.y) * s - c1.size * s + BASELINE_FUDGE);
          const bottomPx = Math.round((H - c4.y) * s + c4.size * s);
          el.style.left       = Math.round(c1.x * s) + 'px';
          el.style.top        = topPx + 'px';
          el.style.fontSize   = (c1.size * s) + 'px';
          el.style.width      = Math.round(210 * s) + 'px'; // ship-to block is ~210pt wide
          el.style.height     = (bottomPx - topPx) + 'px';
          el.style.lineHeight = Math.round(14 * s) + 'px'; // 14pt line spacing

        } else if (field.type === 'scrap') {
          const c = field.coords.yes;
          el.style.left     = Math.round((c.x - 35) * s) + 'px';
          el.style.top      = Math.round((H - c.y) * s - c.size * s + BASELINE_FUDGE) + 'px';
          el.style.fontSize = (c.size * s) + 'px';
          el.querySelectorAll('button').forEach(b => {
            b.style.fontSize = Math.round(c.size * s * 0.75) + 'px';
          });
        }

        // P122: apply drag offset (PDF points → px; y inverted) then pin the handle
        const _p = posOverrides[k];
        if (_p) {
          el.style.left = (parseFloat(el.style.left) + _p.dx * s) + 'px';
          el.style.top  = (parseFloat(el.style.top)  - _p.dy * s) + 'px';
        }
        const _hx = parseFloat(el.style.left);
        const _hy = parseFloat(el.style.top);
        const _handle = handleEls[k];
        if (_handle) {
          _handle.style.left = Math.max(0, _hx - 2) + 'px';
          _handle.style.top  = Math.max(0, _hy - 18) + 'px';
        }
      }
    }

    // ── Zone columns (lbz-bol-01) ──────────────────────────────────────────

    const ZC_COORD         = BolShared.COORDS.zoneColumns;
    const ZC_COL_W         = ZC_COORD.maxW / ZC_COORD.cols;
    const ZC_PREVIEW_SIZE  = 11; // editor-only preview size; the real PDF tier is recomputed from
    const ZC_PREVIEW_LINEH = 13; // final text at generatePdf time, so this never needs to match it

    const zcInputEls  = [];
    const zcHandleEls = [];

    // Also used by the "Reset columns" button and the stale-guard's "Regenerate" action. Needs a
    // pdf-lib font purely for text-width measurement — fails open (no boxes) if PDFLib is missing
    // rather than throwing out of open() and breaking every other field's editing.
    async function buildDefaultZcItems() {
      if (!zcZoneData) return [];
      try {
        if (!window.PDFLib) return [];
        const _mdoc = await PDFLib.PDFDocument.create();
        const _font = await _mdoc.embedFont(PDFLib.StandardFonts.Helvetica);
        return BolShared.buildZoneColumns(zcZoneData, _font).items;
      } catch (_e) { return []; }
    }

    function attachZcDragHandle(handle, idx) {
      let startX = 0, startY = 0, baseX = 0, baseY = 0, dragging = false;
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        dragging = true;
        handle.setPointerCapture(e.pointerId);
        handle.style.cursor = 'grabbing';
        startX = e.clientX; startY = e.clientY;
        baseX = zcItems[idx].x; baseY = zcItems[idx].y;
      });
      handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const s = _scale || 1;
        zcItems[idx].x = Math.round(baseX + (e.clientX - startX) / s);
        zcItems[idx].y = Math.round(baseY - (e.clientY - startY) / s);
        positionZc(_scale);
      });
      const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
        handle.style.cursor = 'grab';
      };
      handle.addEventListener('pointerup', endDrag);
      handle.addEventListener('pointercancel', endDrag);
    }

    function buildZcBoxes() {
      zcInputEls.forEach(el => el.remove());
      zcHandleEls.forEach(el => el.remove());
      zcInputEls.length = 0; zcHandleEls.length = 0;
      (zcItems || []).forEach((item, idx) => {
        const el = document.createElement('textarea');
        el.value = item.text;
        el.title = item.label || '';
        el.style.cssText = 'position:absolute;box-sizing:border-box;background:rgba(255,255,255,0.88);border:1.5px solid var(--border,#d1d5db);border-radius:4px;padding:2px 4px;font-family:Helvetica,Arial,sans-serif;color:var(--text,#111827);resize:none;overflow:hidden;';
        el.addEventListener('input', function () {
          zcItems[idx].text = this.value;
          this.style.height = 'auto';
          this.style.height = this.scrollHeight + 'px';
        });
        canvasWrap.appendChild(el);
        zcInputEls.push(el);

        const handle = document.createElement('div');
        handle.title = 'Drag to move';
        handle.style.cssText = 'position:absolute;width:16px;height:16px;border-radius:4px;'
          + 'background:#1e293b;color:#fff;font-size:11px;line-height:16px;text-align:center;'
          + 'cursor:grab;z-index:5;box-shadow:0 1px 2px rgba(0,0,0,0.3);touch-action:none;user-select:none;';
        handle.textContent = '✥';
        attachZcDragHandle(handle, idx);
        canvasWrap.appendChild(handle);
        zcHandleEls.push(handle);
      });
    }

    function positionZc(s) {
      const H = BolShared.PAGE.height;
      (zcItems || []).forEach((item, idx) => {
        const el = zcInputEls[idx]; if (!el) return;
        const lc = Math.max(2, (el.value || '').split('\n').length);
        el.style.left       = Math.round(item.x * s) + 'px';
        el.style.top        = Math.round((H - item.y) * s - ZC_PREVIEW_SIZE * s + BASELINE_FUDGE) + 'px';
        el.style.fontSize   = (ZC_PREVIEW_SIZE * s) + 'px';
        el.style.width      = Math.round(ZC_COL_W * s) + 'px';
        el.style.height     = Math.round(lc * ZC_PREVIEW_LINEH * s + 8 * s) + 'px';
        el.style.lineHeight = Math.round(ZC_PREVIEW_LINEH * s) + 'px';
        const handle = zcHandleEls[idx];
        if (handle) {
          handle.style.left = Math.max(0, parseFloat(el.style.left) - 2) + 'px';
          handle.style.top  = Math.max(0, parseFloat(el.style.top) - 18) + 'px';
        }
      });
    }

    // Stale guard (§4): compares the job's CURRENT zone assignment against sourceHash. Fails
    // open — a network hiccup here must never block the rest of the editor from loading.
    let staleBannerEl = null;
    function hideStaleBanner() {
      if (staleBannerEl) { staleBannerEl.remove(); staleBannerEl = null; }
    }
    function showStaleBanner() {
      if (staleBannerEl) return;
      staleBannerEl = document.createElement('div');
      staleBannerEl.style.cssText = 'width:100%;max-width:680px;margin:0 auto 10px;padding:10px 14px;border-radius:8px;background:#fef3c7;border:1px solid #f59e0b;color:#78350f;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;';
      const msg = document.createElement('span');
      msg.textContent = 'Load changed since this BOL was edited — zone quantities may be stale.';
      staleBannerEl.appendChild(msg);
      const btnWrap = document.createElement('div');
      btnWrap.style.cssText = 'display:flex;gap:8px;';
      const regenBtn = document.createElement('button');
      regenBtn.textContent = 'Regenerate';
      regenBtn.style.cssText = 'padding:6px 14px;border-radius:6px;border:none;background:#78350f;color:#fff;cursor:pointer;font-size:13px;font-weight:600;';
      regenBtn.addEventListener('click', async () => {
        zcItems = await buildDefaultZcItems();
        buildZcBoxes();
        positionZc(_scale);
        hideStaleBanner();
      });
      const keepBtn = document.createElement('button');
      keepBtn.textContent = 'Keep edits';
      keepBtn.style.cssText = 'padding:6px 14px;border-radius:6px;border:1px solid #78350f;background:transparent;color:#78350f;cursor:pointer;font-size:13px;font-weight:600;';
      keepBtn.addEventListener('click', hideStaleBanner);
      btnWrap.appendChild(regenBtn); btnWrap.appendChild(keepBtn);
      staleBannerEl.appendChild(btnWrap);
      mountEl.insertBefore(staleBannerEl, scrollArea);
    }

    if (zcZoneData) {
      if (!zcItems) zcItems = await buildDefaultZcItems();
      buildZcBoxes();

      const resetZcBtn = document.createElement('button');
      resetZcBtn.textContent = 'Reset columns';
      resetZcBtn.style.cssText = 'padding:8px 20px;border-radius:8px;border:1px solid var(--border,#d1d5db);background:var(--card-bg,#fff);cursor:pointer;font-size:14px;font-weight:600;color:var(--text,#111827);';
      resetZcBtn.addEventListener('click', async () => {
        zcItems = await buildDefaultZcItems();
        buildZcBoxes();
        positionZc(_scale);
        hideStaleBanner();
      });
      actionBar.insertBefore(resetZcBtn, applyBtn);

      if (zcSourceHash && bol.job_id) {
        try {
          const _jr = await fetch('/api/jobs/' + encodeURIComponent(bol.job_id));
          if (_jr.ok) {
            const _jd  = await _jr.json();
            const _job = _jd.job || _jd;
            if (_job && Array.isArray(_job.line_items) && BolShared.hashJobZoneData(_job.line_items) !== zcSourceHash) {
              showStaleBanner();
            }
          }
        } catch (_e) { /* fail open — never block the editor on a network hiccup */ }
      }
    }

    // ── Apply ──

    applyBtn.addEventListener('click', () => {
      const overrides = {};

      for (const field of BolShared.FIELD_MAP) {
        const k  = field.overrideKey;
        const el = inputEls[k];
        if (!el) continue;

        if (field.type === 'single') {
          const val = el.value; // no trim — keep parity with deriveValue's String(col || '')
          if (val !== deriveBaseValue(bol, field)) overrides[k] = val;

        } else if (field.type === 'shipto') {
          const lines = el.value.split('\n').map(l => l.trimEnd()).filter(l => l.trim()).slice(0, 4);
          const base  = deriveBaseValue(bol, field).split('\n').map(l => l.trimEnd()).filter(l => l.trim()).slice(0, 4);
          if (lines.join('\n') !== base.join('\n')) overrides[k] = lines;

        } else if (field.type === 'multiline') {
          const lines = el.value.split('\n').map(l => l.trimEnd());
          while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
          const base = deriveBaseValue(bol, field).split('\n').map(l => l.trimEnd());
          while (base.length && !base[base.length - 1].trim()) base.pop();
          if (lines.join('\n') !== base.join('\n')) overrides[k] = lines;

        } else if (field.type === 'scrap') {
          const val = el.dataset.scrapValue === 'true';
          if (val !== deriveBaseValue(bol, field)) overrides[k] = val;
        }
      }

      // P122: attach position deltas (skip zero entries)
      const _posOut = {};
      for (const pk in posOverrides) {
        const pv = posOverrides[pk];
        if (pv && (pv.dx || pv.dy)) _posOut[pk] = { dx: pv.dx, dy: pv.dy };
      }
      if (Object.keys(_posOut).length > 0) overrides._pos = _posOut;

      // lbz-bol-01: persist the WHOLE zoneColumns container (items + zoneData + sourceHash) —
      // Apply replaces `overrides` wholesale (see below), so omitting zoneData/sourceHash here
      // would silently break "Reset columns" and the stale guard on every subsequently-edited BOL.
      if (zcZoneData) {
        overrides.zoneColumns = {
          items: (zcItems || []).map(it => ({ ...it })),
          zoneData: zcZoneData,
          sourceHash: zcSourceHash,
        };
      }

      if (Object.keys(overrides).length > 0) {
        bol._overrides = overrides;
      } else {
        delete bol._overrides;
      }

      cleanup();
      onApply(bol);
    });

    // ── Cancel ──

    cancelBtn.addEventListener('click', () => { cleanup(); onCancel(); });

    // ── Cleanup ──

    function cleanup() {
      if (_renderTask) { try { _renderTask.cancel(); } catch (_) {} _renderTask = null; }
      if (mountEl._ro) { mountEl._ro.disconnect(); delete mountEl._ro; }
      mountEl.innerHTML = '';
      mountEl.style.cssText = '';
    }

    // ── Kick off ──

    const ro = new ResizeObserver(reflow);
    ro.observe(scrollArea);
    mountEl._ro = ro;

    requestAnimationFrame(reflow);
  }

  return { open };

})();
