window.BolEditor = (function () {
  'use strict';

  const PDF_JS_URL  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
  const WORKER_URL  = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

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
      if (k === 'date') return k in ov ? String(ov[k]) : BolShared.formatBolDate(bol.date);
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
  //    Used by computeOverrides() to diff against the true original, not against
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
      if (k === 'date') return BolShared.formatBolDate(bol.date);
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

  // ── Canvas overlay glyph rendering (bol-wysiwyg-02) ──

  function fontCss(fontKey, sizePx) {
    const bold = fontKey === 'bold' || fontKey === 'boldItalic';
    const italic = fontKey === 'italic' || fontKey === 'boldItalic';
    return (italic ? 'italic ' : '') + (bold ? '700 ' : '400 ') + sizePx + 'px Helvetica, Arial, sans-serif';
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
    let fonts;
    try {
      const pdfjs = await loadPdfJs();
      const resp  = await fetch('/logistics/assets/BLANK_BOL_Xpanda.pdf');
      if (!resp.ok) throw new Error('BOL template not found');
      const bytes = await resp.arrayBuffer();
      const doc   = await pdfjs.getDocument({ data: bytes }).promise;
      pdfPage     = await doc.getPage(1);
      // bol-wysiwyg-01/02: real embedded Helvetica metrics — the SAME metrics generatePdf uses —
      // so layoutBol's placement here matches the PDF exactly, not an approximation.
      fonts = await BolShared.getLayoutFonts();
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
    canvas.style.cssText = 'position:absolute;top:0;left:0;';
    canvasWrap.appendChild(canvas);

    // bol-wysiwyg-02: transparent overlay canvas — the actual WYSIWYG text layer, drawn from
    // BolShared.layoutBol runs (or the real generatePdf output when "Exact preview" is on). Sits
    // above the template render, below the (now-invisible) edit inputs/handles/toolbar.
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
    canvasWrap.appendChild(overlayCanvas);

    const actionBar = document.createElement('div');
    actionBar.style.cssText = 'flex-shrink:0;display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--border,#d1d5db);background:var(--card-bg,#fff);';

    const exactPreviewLabel = document.createElement('label');
    exactPreviewLabel.style.cssText = 'display:flex;align-items:center;gap:6px;margin-right:auto;font-size:13px;font-weight:600;color:var(--text,#111827);cursor:pointer;user-select:none;';
    const exactPreviewCheckbox = document.createElement('input');
    exactPreviewCheckbox.type = 'checkbox';
    exactPreviewCheckbox.style.cssText = 'width:18px;height:18px;cursor:pointer;';
    // Disabled until the first reflow() sizes the canvases/sets _scale — clicking before that would
    // render the exact preview into a still-default-sized (300x150) canvas. See reflow() below.
    exactPreviewCheckbox.disabled = true;
    exactPreviewLabel.appendChild(exactPreviewCheckbox);
    exactPreviewLabel.appendChild(document.createTextNode('Exact preview'));
    exactPreviewLabel.title = 'Renders the actual PDF output (ground truth) instead of the fast approximation';
    actionBar.appendChild(exactPreviewLabel);

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

    // ── Text style overrides (bol-style-02) — working copy seeded from bol._overrides._style,
    // mirroring how _savedPos seeds posOverrides above. fieldKey -> {size?,bold?,italic?,underline?,
    // lines?: {srcLineIdx: {...}}}. `zoneCol0`, `zoneCol1`, … key the zone-column boxes by item
    // index (there's no FIELD_MAP entry for them individually — see the zone-columns section). ──
    const _savedStyle = (bol._overrides && bol._overrides._style) || {};
    const styleOverrides = {};
    for (const _fk in _savedStyle) {
      if (_savedStyle[_fk]) styleOverrides[_fk] = JSON.parse(JSON.stringify(_savedStyle[_fk]));
    }
    const prevLines = {}; // fieldKey -> source lines array as of the last input event (line-index integrity)
    let activeFieldKey = null;
    let activeScope = 'box'; // 'box' | 'line' — user-controlled per toolbar session
    let lastBoxes = {}; // fieldKey -> box, from the most recent layoutBol call
    let lastRuns = []; // runs from the most recent layoutBol call, for exact-preview's failure fallback

    // Base/"Auto" size used only by the style toolbar's stepper and "Auto(N)" label — reflects the
    // REAL tier/coord default (dynamically recomputed for commodity/zone-columns, unlike the old
    // static COORDS-only approximation this replaces).
    function baseCoordForField(fieldKey) {
      if (/^zoneCol\d+$/.test(fieldKey)) {
        const idx = parseInt(fieldKey.slice(7), 10);
        const el = zcInputEls[idx];
        const lines = ((el && el.value) || '').split('\n');
        const tier = BolShared.pickZoneColumnTier(lines, fonts.regular, ZC_COL_W);
        return { size: tier.size, lineH: tier.lineH };
      }
      const field = BolShared.FIELD_MAP.find(f => f.overrideKey === fieldKey);
      if (!field) return { size: 10, lineH: 12 };
      if (field.type === 'shipto') return field.coords[0];
      if (fieldKey === 'commodity' && !zcZoneData) {
        const tier = BolShared.pickCommodityTier(currentTextValue('commodity') || '', fonts.regular);
        return { size: tier.size, lineH: tier.lineH };
      }
      return field.coord;
    }
    function fieldSupportsLines(fieldKey) {
      if (/^zoneCol\d+$/.test(fieldKey)) return true;
      const field = BolShared.FIELD_MAP.find(f => f.overrideKey === fieldKey);
      return !!field && (field.type === 'multiline' || field.type === 'shipto');
    }
    function currentTextValue(fieldKey) {
      if (/^zoneCol\d+$/.test(fieldKey)) {
        const idx = parseInt(fieldKey.slice(7), 10);
        return (zcInputEls[idx] && zcInputEls[idx].value) || '';
      }
      const el = inputEls[fieldKey];
      return el ? String(el.value != null ? el.value : '') : '';
    }
    function fieldElFor(fieldKey) {
      if (/^zoneCol\d+$/.test(fieldKey)) {
        const idx = parseInt(fieldKey.slice(7), 10);
        return zcInputEls[idx] || null;
      }
      return inputEls[fieldKey] || null;
    }
    function caretLineIndex(el) {
      if (!el || typeof el.selectionStart !== 'number') return 0;
      const before = el.value.slice(0, el.selectionStart);
      return before.split('\n').length - 1;
    }

    // Line-index integrity (bol-style-02 §5): when lines are inserted/deleted in a field, shift
    // that field's `lines` map keys so overrides stay on the same text line; drop entries whose
    // line was removed. Assumes a single contiguous insert/delete region (true for normal typing).
    function shiftLineKeys(fieldKey, oldLines, newLines) {
      const fs = styleOverrides[fieldKey];
      if (!fs || !fs.lines || !Object.keys(fs.lines).length) return;
      const oldLen = oldLines.length, newLen = newLines.length;
      if (oldLen === newLen) return;
      let start = 0;
      while (start < Math.min(oldLen, newLen) && oldLines[start] === newLines[start]) start++;
      let oldEnd = oldLen - 1, newEnd = newLen - 1;
      while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) { oldEnd--; newEnd--; }
      const delta = newLen - oldLen;
      const shifted = {};
      for (const key in fs.lines) {
        const idx = parseInt(key, 10);
        if (idx < start) shifted[key] = fs.lines[key];
        else if (idx > oldEnd) shifted[String(idx + delta)] = fs.lines[key];
        // idx within [start, oldEnd] -> its line was replaced/removed; drop the override
      }
      fs.lines = shifted;
    }

    // ── computeOverrides(): the single source of truth for "what would be saved right now" —
    // used both by the live WYSIWYG preview (relayoutNow, called on every edit/drag/style change)
    // and by Apply. This guarantees the preview always shows EXACTLY what re-rendering the
    // about-to-be-saved BOL would produce — an untouched field still falls through to its real
    // default render path (e.g. PO's bold "PO:" label) instead of always taking the override path.
    function computeOverrides() {
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

      // bol-style-02: prune empty style objects and write overrides._style only if non-empty, next
      // to _pos. Deliberately its OWN pass (not gated by any field's text-unchanged check above) —
      // a style survives even when the field's text reverts to its base value.
      const _styleOut = {};
      for (const _fk in styleOverrides) {
        const _fs = styleOverrides[_fk];
        if (!_fs) continue;
        const _out = {};
        if (_fs.size != null) _out.size = _fs.size;
        if (_fs.bold != null) _out.bold = _fs.bold;
        if (_fs.italic != null) _out.italic = _fs.italic;
        if (_fs.underline != null) _out.underline = _fs.underline;
        if (_fs.lines) {
          const _linesOut = {};
          for (const _li in _fs.lines) {
            const _l = _fs.lines[_li];
            if (!_l) continue;
            const _lo = {};
            if (_l.size != null) _lo.size = _l.size;
            if (_l.bold != null) _lo.bold = _l.bold;
            if (_l.italic != null) _lo.italic = _l.italic;
            if (_l.underline != null) _lo.underline = _l.underline;
            if (Object.keys(_lo).length) _linesOut[_li] = _lo;
          }
          if (Object.keys(_linesOut).length) _out.lines = _linesOut;
        }
        if (Object.keys(_out).length) _styleOut[_fk] = _out;
      }
      if (Object.keys(_styleOut).length > 0) overrides._style = _styleOut;

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

      return overrides;
    }

    // ── Style toolbar (bol-style-02): one shared floating panel, shown near whichever styleable
    // field is currently active. Box | This line scope switch (multiline-capable fields only),
    // size stepper (6–36 + Auto), B/I/U toggles, Reset field. Touch targets ≥44px, tokens only. ──

    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'position:absolute;display:none;align-items:center;gap:6px;padding:6px;'
      + 'border-radius:10px;background:var(--card-bg,#fff);border:1px solid var(--border,#d1d5db);'
      + 'box-shadow:0 4px 16px rgba(0,0,0,0.22);z-index:30;flex-wrap:wrap;max-width:320px;';
    canvasWrap.appendChild(toolbar);

    const scopeWrap = document.createElement('div');
    scopeWrap.style.cssText = 'display:flex;gap:2px;';
    const boxScopeBtn = document.createElement('button');
    const lineScopeBtn = document.createElement('button');
    [[boxScopeBtn, 'Box', 'box'], [lineScopeBtn, 'Line', 'line']].forEach(([btn, label, scope]) => {
      btn.type = 'button';
      btn.textContent = label;
      btn.style.cssText = 'min-height:44px;padding:4px 10px;border-radius:6px;border:1px solid var(--border,#d1d5db);'
        + 'cursor:pointer;font-size:12px;font-weight:600;background:var(--card-bg,#fff);color:var(--text,#111827);';
      btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus on the input
      btn.addEventListener('click', () => { activeScope = scope; refreshToolbar(); });
      scopeWrap.appendChild(btn);
    });
    toolbar.appendChild(scopeWrap);

    const sizeWrap = document.createElement('div');
    sizeWrap.style.cssText = 'display:flex;align-items:center;gap:2px;';
    const sizeMinusBtn = document.createElement('button');
    const sizeValueEl = document.createElement('span');
    const sizePlusBtn = document.createElement('button');
    const autoBtn = document.createElement('button');
    [sizeMinusBtn, sizePlusBtn, autoBtn].forEach(btn => {
      btn.type = 'button';
      btn.style.cssText = 'min-width:44px;min-height:44px;border-radius:6px;border:1px solid var(--border,#d1d5db);'
        + 'cursor:pointer;font-size:14px;font-weight:700;background:var(--card-bg,#fff);color:var(--text,#111827);';
      btn.addEventListener('mousedown', (e) => e.preventDefault());
    });
    sizeMinusBtn.textContent = '−';
    sizePlusBtn.textContent = '+';
    autoBtn.textContent = 'Auto';
    autoBtn.style.minWidth = '52px';
    autoBtn.title = 'Reset size to the box default';
    sizeValueEl.style.cssText = 'min-width:28px;text-align:center;font-size:13px;font-weight:600;color:var(--text,#111827);';
    sizeMinusBtn.addEventListener('click', () => stepSize(-1));
    sizePlusBtn.addEventListener('click', () => stepSize(1));
    autoBtn.addEventListener('click', () => { setStyleProp('size', undefined); });
    sizeWrap.appendChild(sizeMinusBtn); sizeWrap.appendChild(sizeValueEl); sizeWrap.appendChild(sizePlusBtn); sizeWrap.appendChild(autoBtn);
    toolbar.appendChild(sizeWrap);

    const bibuWrap = document.createElement('div');
    bibuWrap.style.cssText = 'display:flex;gap:2px;';
    const boldBtn = document.createElement('button');
    const italicBtn = document.createElement('button');
    const underlineBtn = document.createElement('button');
    [[boldBtn, 'B', 'bold', 'font-weight:800;'], [italicBtn, 'I', 'italic', 'font-style:italic;'], [underlineBtn, 'U', 'underline', 'text-decoration:underline;']]
      .forEach(([btn, label, prop, extraCss]) => {
        btn.type = 'button';
        btn.textContent = label;
        btn.style.cssText = 'min-width:44px;min-height:44px;border-radius:6px;border:1px solid var(--border,#d1d5db);'
          + 'cursor:pointer;font-size:14px;background:var(--card-bg,#fff);color:var(--text,#111827);' + extraCss;
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => {
          const cur = getEffectiveStyleValue(prop);
          setStyleProp(prop, !cur);
        });
        bibuWrap.appendChild(btn);
      });
    toolbar.appendChild(bibuWrap);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = 'Reset field';
    resetBtn.style.cssText = 'min-height:44px;padding:4px 10px;border-radius:6px;border:1px solid var(--border,#d1d5db);'
      + 'cursor:pointer;font-size:12px;font-weight:600;background:var(--card-bg,#fff);color:var(--text,#111827);';
    resetBtn.addEventListener('mousedown', (e) => e.preventDefault());
    resetBtn.addEventListener('click', () => {
      if (!activeFieldKey) return;
      delete styleOverrides[activeFieldKey];
      refreshToolbar();
      scheduleRelayout();
    });
    toolbar.appendChild(resetBtn);

    // `undefined` clears the property (falls through to the next precedence level).
    function setStyleProp(prop, value) {
      if (!activeFieldKey) return;
      const fk = activeFieldKey;
      if (!styleOverrides[fk]) styleOverrides[fk] = {};
      const fs = styleOverrides[fk];
      let target = fs;
      if (activeScope === 'line' && fieldSupportsLines(fk)) {
        const li = caretLineIndex(fieldElFor(fk));
        if (!fs.lines) fs.lines = {};
        if (!fs.lines[String(li)]) fs.lines[String(li)] = {};
        target = fs.lines[String(li)];
      }
      if (value === undefined) delete target[prop];
      else target[prop] = value;
      // Prune empty containers so an all-cleared field doesn't linger as {}.
      if (activeScope === 'line' && fs.lines) {
        const li = caretLineIndex(fieldElFor(fk));
        if (fs.lines[String(li)] && Object.keys(fs.lines[String(li)]).length === 0) delete fs.lines[String(li)];
        if (Object.keys(fs.lines).length === 0) delete fs.lines;
      }
      if (Object.keys(fs).length === 0) delete styleOverrides[fk];
      refreshToolbar();
      scheduleRelayout();
    }

    function stepSize(delta) {
      if (!activeFieldKey) return;
      const baseCoord = baseCoordForField(activeFieldKey);
      const cur = getEffectiveStyleValue('size');
      const base = cur != null ? cur : (baseCoord.size || 10);
      const next = Math.max(6, Math.min(36, Math.round(base) + delta));
      setStyleProp('size', next);
    }

    // Reads the CURRENTLY EDITED scope's raw value for `prop` (box or the active caret line) —
    // undefined means "not set at this scope", used to decide toggle state / Auto vs explicit size.
    function getEffectiveStyleValue(prop) {
      if (!activeFieldKey) return undefined;
      const fs = styleOverrides[activeFieldKey];
      if (!fs) return undefined;
      if (activeScope === 'line' && fieldSupportsLines(activeFieldKey)) {
        const li = caretLineIndex(fieldElFor(activeFieldKey));
        const ls = fs.lines && fs.lines[String(li)];
        return ls ? ls[prop] : undefined;
      }
      return fs[prop];
    }

    function refreshToolbar() {
      if (!activeFieldKey) { toolbar.style.display = 'none'; return; }
      const supportsLines = fieldSupportsLines(activeFieldKey);
      scopeWrap.style.display = supportsLines ? 'flex' : 'none';
      if (!supportsLines) activeScope = 'box';
      [boxScopeBtn, lineScopeBtn].forEach((btn, i) => {
        const on = (i === 0 ? 'box' : 'line') === activeScope;
        btn.style.background = on ? '#1e293b' : 'var(--card-bg,#fff)';
        btn.style.color = on ? '#fff' : 'var(--text,#111827)';
      });
      const baseCoord = baseCoordForField(activeFieldKey);
      const sizeVal = getEffectiveStyleValue('size');
      sizeValueEl.textContent = sizeVal != null ? String(sizeVal) : 'Auto(' + (baseCoord.size || 10) + ')';
      [[boldBtn, 'bold'], [italicBtn, 'italic'], [underlineBtn, 'underline']].forEach(([btn, prop]) => {
        const on = !!getEffectiveStyleValue(prop);
        btn.style.background = on ? '#1e293b' : 'var(--card-bg,#fff)';
        btn.style.color = on ? '#fff' : 'var(--text,#111827)';
      });
      positionToolbar();
    }

    // Anchors above the field when there's room; otherwise falls back to below it, so the toolbar
    // never sits on top of the box the operator is trying to click into. Also clamps inside
    // canvasWrap on both axes.
    function positionToolbar() {
      const el = fieldElFor(activeFieldKey);
      if (!el) { toolbar.style.display = 'none'; return; }
      toolbar.style.display = 'flex';
      const left = parseFloat(el.style.left) || 0;
      const top = parseFloat(el.style.top) || 0;
      const fieldH = parseFloat(el.style.height) || 0;
      const gap = 8;
      const tbH = toolbar.offsetHeight || 56;
      const tbW = toolbar.offsetWidth || 0;
      const wrapW = canvasWrap.clientWidth || 0;
      const wrapH = canvasWrap.clientHeight || 0;
      const fieldBottom = top + fieldH;

      let toolbarTop = (top - gap - tbH >= 0) ? (top - gap - tbH) : (fieldBottom + gap);
      toolbarTop = Math.max(0, Math.min(toolbarTop, Math.max(0, wrapH - tbH)));
      const toolbarLeft = Math.max(0, Math.min(left, Math.max(0, wrapW - tbW)));

      toolbar.style.top = toolbarTop + 'px';
      toolbar.style.left = toolbarLeft + 'px';
    }

    function activateField(fieldKey) {
      activeFieldKey = fieldKey;
      refreshToolbar();
    }
    function deactivateFieldIfMatches(fieldKey) {
      // A short delay lets a toolbar button's click land before the input's blur would hide it —
      // the buttons themselves call preventDefault() on mousedown, so focus never actually leaves.
      setTimeout(() => { if (activeFieldKey === fieldKey && document.activeElement !== fieldElFor(fieldKey)) { activeFieldKey = null; toolbar.style.display = 'none'; } }, 0);
    }

    // ── Overflow warning: amber outline only (bol-wysiwyg-02 removes the separate per-line preview
    // strip — the WYSIWYG canvas layer now shows per-line styles in place). Driven by
    // BolShared.measureStyledField, which is itself now a layoutField-backed real-metric check. ──

    function updateFieldOverflow(fieldKey) {
      const el = fieldElFor(fieldKey);
      if (!el || !fieldSupportsLines(fieldKey)) return;
      const text = currentTextValue(fieldKey);
      const measured = BolShared.measureStyledField(fieldKey, text, styleOverrides[fieldKey]);
      if (measured.overflow) {
        el.style.boxShadow = '0 0 0 2px #f59e0b';
        el.title = fieldKey === 'shipTo' ? 'Only the first 4 non-blank lines will be saved' : 'May overflow the box';
      } else {
        el.style.boxShadow = 'none';
        el.title = '';
      }
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

    // Transparent, borderless edit surface (bol-wysiwyg-02 §2): the canvas overlay is the visual
    // source of truth; inputs/textareas exist only to host the caret/selection/typing, positioned
    // and sized entirely from layoutBol's boxes (no COORDS geometry, no padding/border offset).
    const EDIT_SURFACE_CSS = 'position:absolute;box-sizing:border-box;background:transparent;'
      + 'border:none;outline:1px dashed rgba(30,41,59,0.35);padding:0;margin:0;'
      + 'font-family:Helvetica,Arial,sans-serif;color:transparent;caret-color:var(--text,#111827);resize:none;overflow:hidden;';

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
        el.style.cssText = EDIT_SURFACE_CSS;
      } else {
        el = document.createElement('textarea');
        el.value = initVal;
        el.style.cssText = EDIT_SURFACE_CSS;
        if (k === 'commodity') el.style.textAlign = 'center';
      }

      inputEls[k] = el;
      canvasWrap.appendChild(el);

      // bol-style-02: 'scrap' is NOT styleable (spec) — every other field gets the toolbar +
      // live style visuals + line-index-integrity tracking on its input/textarea.
      if (field.type !== 'scrap') {
        prevLines[k] = currentTextValue(k).split('\n');
        el.addEventListener('focus', () => activateField(k));
        el.addEventListener('blur', () => deactivateFieldIfMatches(k));
        el.addEventListener('click', () => { if (activeFieldKey === k) refreshToolbar(); });
        el.addEventListener('keyup', () => { if (activeFieldKey === k) refreshToolbar(); });
        el.addEventListener('input', () => {
          const newLines = el.value.split('\n');
          shiftLineKeys(k, prevLines[k], newLines);
          prevLines[k] = newLines;
          if (activeFieldKey === k) refreshToolbar();
          scheduleRelayout();
        });
      } else {
        el.addEventListener('click', () => scheduleRelayout());
      }

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
    let _relayoutTimer = null; // ~120ms throttle shared by edits/drag/style changes

    // P122/bol-wysiwyg-02: pointer-drag a field's box; commits a {dx,dy} point-delta into
    // posOverrides, snapped to 0.5pt (was whole-point).
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
        posOverrides[k] = { dx: Math.round(dx * 2) / 2, dy: Math.round(dy * 2) / 2 };
        scheduleRelayout();
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
        scheduleRelayout();
      });
    }

    function reflow() {
      if (_renderTask) { try { _renderTask.cancel(); } catch (_) {} _renderTask = null; }

      const logicalW = Math.max(200, scrollArea.clientWidth - 24);
      const logicalH = Math.round(logicalW * BolShared.PAGE.height / BolShared.PAGE.width);
      const s        = logicalW / BolShared.PAGE.width;
      _scale = s;
      const dpr      = window.devicePixelRatio || 1;

      [canvas, overlayCanvas].forEach((c) => {
        c.width        = Math.round(logicalW * dpr);
        c.height       = Math.round(logicalH * dpr);
        c.style.width  = logicalW + 'px';
        c.style.height = logicalH + 'px';
      });
      canvasWrap.style.width  = logicalW + 'px';
      canvasWrap.style.height = logicalH + 'px';

      const ctx = canvas.getContext('2d');
      const vp  = pdfPage.getViewport({ scale: s * dpr });
      _renderTask = pdfPage.render({ canvasContext: ctx, viewport: vp });
      _renderTask.promise.then(() => { _renderTask = null; }).catch(() => {});

      relayoutNow();
      exactPreviewCheckbox.disabled = false;
    }

    // ── The WYSIWYG core (bol-wysiwyg-02): one function computes the live layout from the CURRENT
    // editing state (via computeOverrides()) and drives both the edit-surface boxes and the canvas
    // overlay text from the exact same BolShared.layoutBol call generatePdf itself would make. ──

    function relayoutNow() {
      const liveBol = { ...bol, _overrides: computeOverrides() };
      const { runs, boxes } = BolShared.layoutBol(liveBol, fonts);
      lastBoxes = boxes;
      lastRuns = runs;
      positionAll(_scale, boxes);
      positionZc(_scale, boxes);
      if (exactPreviewOn) {
        scheduleExactPreview();
      } else {
        drawOverlay(runs, _scale);
      }
      if (activeFieldKey) refreshToolbar();
    }

    function scheduleRelayout() {
      if (_relayoutTimer) return; // already scheduled — fires at a steady ~120ms cadence during
      // continuous activity (typing, dragging) rather than only once activity stops.
      _relayoutTimer = setTimeout(() => { _relayoutTimer = null; relayoutNow(); }, 120);
    }

    function drawOverlay(runs, s) {
      const octx = overlayCanvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      octx.scale(dpr, dpr);
      octx.textBaseline = 'alphabetic';
      const H = BolShared.PAGE.height;
      runs.forEach((run) => {
        if (!run.text) return;
        const x = run.x * s;
        const y = (H - run.y) * s;
        octx.font = fontCss(run.fontKey, run.size * s);
        octx.fillStyle = run.color === 'red' ? '#ff0000' : '#000000';
        octx.fillText(run.text, x, y);
        if (run.underline) {
          const uy = y + Math.max(1, run.size * 0.12) * s;
          octx.strokeStyle = octx.fillStyle;
          octx.lineWidth = Math.max(0.5, run.size * 0.06) * s;
          octx.beginPath();
          octx.moveTo(x, uy);
          octx.lineTo(x + run.width * s, uy);
          octx.stroke();
        }
      });
    }

    // ── "Exact preview" (bol-wysiwyg-02 §5, recommended): renders the ACTUAL generatePdf output
    // via pdf.js into the overlay canvas — the ground-truth check, debounced 400ms since it's a
    // real PDF render (fonts + template fetch) rather than a cheap canvas fillText pass. ──
    let exactPreviewOn = false;
    let _exactTimer = null;
    let _exactRenderTask = null;

    function scheduleExactPreview() {
      if (_exactTimer) return;
      _exactTimer = setTimeout(async () => {
        _exactTimer = null;
        if (!exactPreviewOn) return;
        try {
          const liveBol = { ...bol, _overrides: computeOverrides() };
          const { pdfBytes } = await BolShared.generatePdf([liveBol], { previewOnly: true });
          const pdfjs = await loadPdfJs();
          const doc = await pdfjs.getDocument({ data: pdfBytes }).promise;
          const p = await doc.getPage(1);
          const dpr = window.devicePixelRatio || 1;
          const vp = p.getViewport({ scale: _scale * dpr });
          const octx = overlayCanvas.getContext('2d');
          octx.setTransform(1, 0, 0, 1, 0, 0);
          octx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
          if (_exactRenderTask) { try { _exactRenderTask.cancel(); } catch (_) {} }
          _exactRenderTask = p.render({ canvasContext: octx, viewport: vp });
          await _exactRenderTask.promise;
          _exactRenderTask = null;
        } catch (_e) {
          // Best-effort ground-truth preview; never blocks editing on a render hiccup — but never
          // leave the operator staring at a blank form either, so fall back to the approximation.
          console.warn('[bol-editor] exact preview render failed, falling back to approximation:', _e);
          drawOverlay(lastRuns, _scale);
        }
      }, 400);
    }

    exactPreviewCheckbox.addEventListener('change', () => {
      exactPreviewOn = exactPreviewCheckbox.checked;
      if (exactPreviewOn) {
        scheduleExactPreview();
      } else {
        if (_exactRenderTask) { try { _exactRenderTask.cancel(); } catch (_) {} _exactRenderTask = null; }
        relayoutNow();
      }
    });

    function positionAll(s, boxes) {
      const H = BolShared.PAGE.height;
      for (const field of BolShared.FIELD_MAP) {
        if (field.type === 'zonecolumns') continue;
        const k = field.overrideKey;
        if (k === 'commodity' && zcZoneData) continue;
        const el = inputEls[k];
        const box = boxes[k];
        if (!el || !box) continue;

        el.style.left   = Math.round(box.x * s) + 'px';
        el.style.top    = Math.round((H - box.y) * s) + 'px';
        el.style.width  = Math.round(box.w * s) + 'px';
        el.style.height = Math.round(box.h * s) + 'px';

        if (field.type === 'scrap') {
          el.querySelectorAll('button').forEach((b) => {
            b.style.fontSize = Math.max(10, Math.round(box.h * s * 0.55)) + 'px';
          });
        } else {
          // The overlay canvas draws the visible glyphs; this element only hosts the (invisible)
          // caret/selection. Without an explicit font-size/line-height it renders at the browser's
          // default, so the caret shows up small and offset from where the visible text actually
          // sits — most noticeable on small fields like date/deliveryTime.
          const srcLineIdx = field.type === 'single' ? undefined : 0;
          const _resolved = BolShared.resolveFieldLineStyle(styleOverrides[k], srcLineIdx, baseCoordForField(k));
          el.style.fontSize   = Math.max(1, _resolved.size * s) + 'px';
          el.style.lineHeight = Math.max(1, _resolved.lineH * s) + 'px';
        }

        const hx = parseFloat(el.style.left);
        const hy = parseFloat(el.style.top);
        const handle = handleEls[k];
        if (handle) {
          handle.style.left = Math.max(0, hx - 2) + 'px';
          handle.style.top  = Math.max(0, hy - 18) + 'px';
        }

        if (field.type !== 'scrap') updateFieldOverflow(k);
      }
      if (activeFieldKey) refreshToolbar();
    }

    // ── Zone columns (lbz-bol-01) ──────────────────────────────────────────

    const ZC_COORD = BolShared.COORDS.zoneColumns;
    const ZC_COL_W = ZC_COORD.maxW / ZC_COORD.cols;

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
        zcItems[idx].x = Math.round((baseX + (e.clientX - startX) / s) * 2) / 2;
        zcItems[idx].y = Math.round((baseY - (e.clientY - startY) / s) * 2) / 2;
        scheduleRelayout();
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
        el.style.cssText = EDIT_SURFACE_CSS;
        const fieldKey = 'zoneCol' + idx;
        prevLines[fieldKey] = item.text.split('\n');
        el.addEventListener('input', function () {
          zcItems[idx].text = this.value;
          const newLines = this.value.split('\n');
          shiftLineKeys(fieldKey, prevLines[fieldKey], newLines);
          prevLines[fieldKey] = newLines;
          if (activeFieldKey === fieldKey) refreshToolbar();
          scheduleRelayout();
        });
        el.addEventListener('focus', () => activateField(fieldKey));
        el.addEventListener('blur', () => deactivateFieldIfMatches(fieldKey));
        el.addEventListener('click', () => { if (activeFieldKey === fieldKey) refreshToolbar(); });
        el.addEventListener('keyup', () => { if (activeFieldKey === fieldKey) refreshToolbar(); });
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

    function positionZc(s, boxes) {
      const H = BolShared.PAGE.height;
      (zcItems || []).forEach((item, idx) => {
        const el = zcInputEls[idx]; if (!el) return;
        const fieldKey = 'zoneCol' + idx;
        const box = boxes[fieldKey];
        if (!box) return;
        el.style.left   = Math.round(box.x * s) + 'px';
        el.style.top    = Math.round((H - box.y) * s) + 'px';
        el.style.width  = Math.round(box.w * s) + 'px';
        el.style.height = Math.round(box.h * s) + 'px';
        const handle = zcHandleEls[idx];
        if (handle) {
          handle.style.left = Math.max(0, parseFloat(el.style.left) - 2) + 'px';
          handle.style.top  = Math.max(0, parseFloat(el.style.top) - 18) + 'px';
        }
        updateFieldOverflow(fieldKey);
      });
      if (activeFieldKey && /^zoneCol\d+$/.test(activeFieldKey)) refreshToolbar();
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
        relayoutNow();
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
        relayoutNow();
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
      const overrides = computeOverrides();

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
      if (_relayoutTimer) { clearTimeout(_relayoutTimer); _relayoutTimer = null; }
      if (_exactTimer) { clearTimeout(_exactTimer); _exactTimer = null; }
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
