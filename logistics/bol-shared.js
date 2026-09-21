window.BolShared = (function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  // COORDS — Single source of truth for PDF text placement
  // Copied exactly from bol-generator.html (the authoritative source)
  // If coords need updating, update ONLY this file going forward.
  // ═══════════════════════════════════════════════════════════════════

  const COORDS = {
    // Delivery time — top-right, bold red (multiline-capable via editor override; P122)
    deliveryTime:  { x: 390, y: 758, size: 24, lineH: 28, maxW: 200 },

    // Top-right block
    date:          { x: 346, y: 712, size: 10 },
    bolNumber:     { x: 408, y: 690, size: 22, bold: true },
    carrierName:   { x: 389, y: 648, size: 10 },
    trailerNo:     { x: 365, y: 622, size: 12, bold: true },

    // Ship-to address (4 lines, indented under label)
    shipLine1:     { x: 95,  y: 615, size: 10 },
    shipLine2:     { x: 95,  y: 601, size: 10 },
    shipLine3:     { x: 95,  y: 587, size: 10 },
    shipLine4:     { x: 95,  y: 573, size: 10 },

    // Special Instructions
    specialInstr:  { x: 315, y: 585, size: 9, lineH: 12, maxW: 255 },

    // Contact Info
    contactInfo:   { x: 315, y: 525, size: 12, lineH: 13, maxW: 255 },

    // PO / Invoice Number
    poNumber:      { x: 315, y: 468, size: 12, lineH: 13, maxW: 255 },

    // Scrap Pick Up checkboxes
    scrapYes:      { x: 109, y: 512, size: 13 },
    scrapNo:       { x: 109, y: 496, size: 13 },

    // Commodity description (size/lineH set dynamically — see commodity render block)
    commodity:     { x: 55,  y: 380, size: 13, lineH: 28, maxW: 510, center: true },

    // QR code — driver tracking link (P82). Drawn only when bol.access_token exists.
    qrCode:        { x: 40, y: 222, size: 60 },
    // Shipper signature — cursive (FRSCRIPT), auto-signed with the generating user's display name.
    // PLACEHOLDER coords; tune in bol-test (#3).
    shipperSignature: { x: 37, y: 48, size: 22 },
    shipperDate:      { x: 157, y: 48, size: 8 },
  };

  // Zone columns (lbz-bol-01): rendered INSIDE the existing commodity region, replacing it
  // entirely on a zoned truck. Up to 3 columns left→right in ASCENDING delivery order. Column 0's
  // height budget is capped short of the QR code (x 40–100, y 222–282), which sits partly under
  // column 0's x-range (55–225) — column 0 stops at y=285 (95pt) to never overlap it; columns 1
  // and 2 are clear of the QR entirely and reuse pickCommodityTier's own largest-tier ceiling
  // (216pt = 18 lines @ size 10/lineH 12), already proven safe for this region.
  // lbz-bol-02: mirror these exact numbers into bolShared.ts.
  COORDS.zoneColumns = {
    x: COORDS.commodity.x, y: COORDS.commodity.y, maxW: COORDS.commodity.maxW,
    cols: 3, colMaxH: [95, 216, 216],
  };

  const PAGE = { width: 612, height: 792 }; // template is fixed US Letter

  const COPY_ORDER = ['driver', 'customer', undefined]; // Driver, Customer, then remaining/original

  // Field map — single source of truth for what is editable and how it renders.
  // type: 'single' | 'multiline' | 'shipto' | 'scrap'
  const FIELD_MAP = [
    { key: 'deliveryTime',  type: 'multiline', coord: COORDS.deliveryTime, overrideKey: 'deliveryTime' },
    { key: 'date',          type: 'single',    coord: COORDS.date,         overrideKey: 'date' },
    { key: 'bolNumber',     type: 'single',    coord: COORDS.bolNumber,    overrideKey: 'bolNumber' },
    { key: 'carrierName',   type: 'single',    coord: COORDS.carrierName,  overrideKey: 'carrierName' },
    { key: 'trailerNo',     type: 'single',    coord: COORDS.trailerNo,    overrideKey: 'trailerNo' },
    { key: 'shipTo',        type: 'shipto',    coords: [COORDS.shipLine1, COORDS.shipLine2, COORDS.shipLine3, COORDS.shipLine4], overrideKey: 'shipTo' },
    { key: 'specialInstr',  type: 'multiline', coord: COORDS.specialInstr, overrideKey: 'specialInstr' },
    { key: 'contactInfo',   type: 'multiline', coord: COORDS.contactInfo,  overrideKey: 'contactInfo' },
    { key: 'poNumber',      type: 'multiline', coord: COORDS.poNumber,     overrideKey: 'poNumber' },
    { key: 'commodity',     type: 'multiline', coord: COORDS.commodity,    overrideKey: 'commodity' },
    { key: 'zoneColumns',   type: 'zonecolumns', coord: COORDS.zoneColumns, overrideKey: 'zoneColumns' },
    { key: 'scrap',         type: 'scrap',     coords: { yes: COORDS.scrapYes, no: COORDS.scrapNo }, overrideKey: 'scrap' },
  ];

  // Picks the commodity size tier from text + pdf-lib font. Shared by both the
  // un-overridden (Prompt 66) and override render paths so they stay in sync.
  // NOTE: spec suggests pickCommodityTier(lineCount) but lineCount depends on
  // font size per tier, so (text, pdfFont) is the correct signature.
  function pickCommodityTier(text, pdfFont) {
    const tiers = [
      { size: 26, lineH: 32, maxLines: 2 },
      { size: 22, lineH: 28, maxLines: 4 },
      { size: 18, lineH: 22, maxLines: 7 },
      { size: 15, lineH: 18, maxLines: 11 },
      { size: 12, lineH: 14, maxLines: 18 },
      { size: 10, lineH: 12, maxLines: Infinity },
    ];
    for (const t of tiers) {
      if (wrapText(String(text), pdfFont, t.size, COORDS.commodity.maxW).length <= t.maxLines) {
        return { size: t.size, lineH: t.lineH };
      }
    }
    return { size: 10, lineH: 12 };
  }

  // ═══════════════════════════════════════════════════════════════════
  // ZONE COLUMNS (lbz-bol-01)
  // ═══════════════════════════════════════════════════════════════════

  // Duplicated from pickCommodityTier's tier table on purpose: pickCommodityTier's existing
  // body/signature is a hard regression boundary (non-zone commodity rendering must stay
  // byte-for-byte identical), so zone columns get their own copy tuned against COLUMN width
  // instead of full commodity width. Keep the two lists in sync by eye if tiers ever change.
  const ZONE_COLUMN_TIERS = [
    { size: 26, lineH: 32, maxLines: 2 },
    { size: 22, lineH: 28, maxLines: 4 },
    { size: 18, lineH: 22, maxLines: 7 },
    { size: 15, lineH: 18, maxLines: 11 },
    { size: 12, lineH: 14, maxLines: 18 },
    { size: 10, lineH: 12, maxLines: Infinity },
  ];

  // Picks the largest tier whose wrapped line count fits, against an arbitrary column width.
  // `lines` is an array of PRE-WRAP raw lines (e.g. one BolShared.buildZoneColumnLines() output);
  // each gets independently wrapped and the counts summed. The last tier's maxLines is Infinity,
  // so this always returns.
  function pickZoneColumnTier(lines, pdfFont, colW) {
    for (const t of ZONE_COLUMN_TIERS) {
      const wrapped = (lines || []).reduce((n, l) => n + wrapText(String(l), pdfFont, t.size, colW).length, 0);
      if (wrapped <= t.maxLines) return { size: t.size, lineH: t.lineH, lineCount: wrapped };
    }
    /* istanbul ignore next -- unreachable: last tier's maxLines is Infinity */
    return { size: 10, lineH: 12, lineCount: (lines || []).length };
  }

  // Treats a density string as "base/standard" (no suffix shown) when its leading numeric value
  // is ~1.0 (matches free-text job_line_items.density values like "1.0 RC", "1.0#", "1"). Blank
  // or unparsable values are ALSO treated as base — never show a density suffix we can't back
  // with a clearly non-base reading (never guess).
  function isBaseDensity(density) {
    if (!density) return true;
    const m = String(density).match(/-?\d+(\.\d+)?/);
    if (!m) return true;
    return Math.abs(parseFloat(m[0]) - 1.0) < 0.05;
  }

  // Builds the raw (pre-wrap) text lines for one zone column, per the confirmed manual-BOL format:
  //   --"LABEL"--
  //   *unload 1st*                 (only the truck's earliest-delivery zone — isFirst)
  //   10" - 1 pcs                  (base-density lines, thickness DESCENDING)
  //   9" - 13 pcs
  //   6" - 27 pcs (2.0# density)   (non-base-density lines, thickness descending, at the BOTTOM)
  // No base-product footer line — do not add one. Each `entry` is one BolShared.buildZoneColumns()
  // skuBreakdown item: { skuId, name, sku, color, pieces, height, density }. Entries whose height
  // couldn't be resolved fall back to their name/sku so nothing silently disappears.
  function buildZoneColumnLines(seg, isFirst) {
    const lines = [`--"${seg.label}"--`];
    if (isFirst) lines.push('*unload 1st*');
    const entries = Object.values(seg.skuBreakdown || {});
    const byHeightDesc = (a, b) => (b.height || 0) - (a.height || 0);
    const base    = entries.filter(e => isBaseDensity(e.density)).sort(byHeightDesc);
    const nonBase = entries.filter(e => !isBaseDensity(e.density)).sort(byHeightDesc);
    const lineFor = (e) => {
      const h = (e.height != null && e.height !== '') ? `${e.height}"` : (e.name || e.sku || '');
      let l = `${h} - ${e.pieces} pcs`;
      if (!isBaseDensity(e.density)) l += ` (${e.density} density)`;
      return l;
    };
    base.forEach(e => lines.push(lineFor(e)));
    nonBase.forEach(e => lines.push(lineFor(e)));
    return lines;
  }

  /**
   * Default zone-column layout. Places each zone's text into one of COORDS.zoneColumns.cols
   * columns inside the commodity region, left→right in ASCENDING delivery order (offloadSeq) —
   * independent of the trailer diagram's nose→door physical placement, which lbz-pack-01
   * deliberately reverses. First-fit bin-packing: each zone goes into the first (leftmost) column
   * with enough remaining vertical room, so a zone can land under an EARLIER column if a later one
   * is already full — this produces the "4th zone sits under the 2nd" layout confirmed against the
   * manual BOL. Reuses pickCommodityTier's approach (same tier list, per-column width) via
   * pickZoneColumnTier; when even the smallest tier doesn't fit, renders at min size anyway and
   * flags needsAttention — never clips.
   * @param {Array} zoneSegments — [{ offloadSeq, label, color, pieces, skuBreakdown }]
   * @param {*} pdfFont — pdf-lib font used only for width measurement
   * @returns {{ items: Array<{label,text,x,y}>, needsAttention: boolean }}
   */
  function buildZoneColumns(zoneSegments, pdfFont) {
    const C = COORDS.zoneColumns;
    const colW = C.maxW / C.cols;
    const sorted = [...(zoneSegments || [])].sort((a, b) => (a.offloadSeq ?? Infinity) - (b.offloadSeq ?? Infinity));
    const colUsed = new Array(C.cols).fill(0);
    const items = [];
    let needsAttention = false;

    sorted.forEach((seg, i) => {
      const lines = buildZoneColumnLines(seg, i === 0);
      const tier = pickZoneColumnTier(lines, pdfFont, colW);
      const renderH = tier.lineCount * tier.lineH;

      let target = -1;
      for (let c = 0; c < C.cols; c++) {
        const maxH = C.colMaxH[c] != null ? C.colMaxH[c] : 216;
        if (maxH - colUsed[c] >= renderH) { target = c; break; }
      }
      if (target === -1) {
        // Never clip: nothing has room at this tier — fall back to the least-full column anyway.
        target = colUsed.indexOf(Math.min(...colUsed));
      }
      const targetMaxH = C.colMaxH[target] != null ? C.colMaxH[target] : 216;
      const segNeedsAttention = renderH > (targetMaxH - colUsed[target]);

      items.push({
        label: seg.label,
        text: lines.join('\n'),
        x: C.x + target * colW,
        y: C.y - colUsed[target],
      });
      colUsed[target] += renderH;
      if (segNeedsAttention) needsAttention = true;
    });

    return { items, needsAttention };
  }

  // Small deterministic, non-cryptographic hash (FNV-1a) for change-detection only — never used
  // for security. Returns an 8-char hex string.
  function _fnv1aHex(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // Stale-guard input (lbz-bol-01 §4): hashes the EDITABLE zone-assignment fields on a job's line
  // items — offload_seq / zone_label / density / quantity / part — which is exactly what the
  // manual zone editor (lbz-parse-02) can change after a BOL was generated. Hashing these (rather
  // than the packed per-truck piece counts, which aren't independently reconstructable without
  // re-running the untouched auto-pack algorithm) lets a later BolEditor.open() detect "this job's
  // zones changed since this BOL was made" with a single fresh GET /api/jobs/:id.
  function hashJobZoneData(lineItems) {
    const norm = (lineItems || [])
      .map(li => ({
        id: String(li.id || ''),
        part_id: li.part_id || null,
        quantity: li.quantity || 0,
        offload_seq: li.offload_seq ?? null,
        zone_label: (li.zone_label || '').trim(),
        density: (li.density || '').trim(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return _fnv1aHex(JSON.stringify(norm));
  }

  // ═══════════════════════════════════════════════════════════════════
  // TEXT STYLING (bol-style-01) — render_overrides._style contract.
  // Precedence per property: line → box → existing COORD/tier default. Absent `_style` (every
  // existing BOL) must resolve to exactly the pre-bol-style-01 defaults — see resolveFieldLineStyle.
  // Shared by the render path (resolveStyle in generatePdf, closed over real pdf-lib fonts) and the
  // pure measureStyledField() editors call for overflow warnings (closed over an approximate
  // measurer) so both stay in lockstep. Mirror this block byte-identical into bolShared.ts.
  // ═══════════════════════════════════════════════════════════════════

  // fieldKey -> approximate available box height in PDF points, for overflow warnings only (never
  // affects rendering — BOL text is never clipped). Derived from the vertical gap to the next field
  // below in COORDS, except `commodity` which reuses pickCommodityTier's own proven ceiling (its
  // smallest tier: 18 lines @ lineH 12 = 216pt). zoneCol0..N use COORDS.zoneColumns.colMaxH instead
  // (real data, not a gap estimate) — see measureStyledField.
  const FIELD_HEIGHT_BUDGET = {
    deliveryTime: 46, date: 20, bolNumber: 20, carrierName: 20, trailerNo: 20,
    specialInstr: 60, contactInfo: 57, poNumber: 88, commodity: 216,
  };
  const SHIP_TO_LINE_GAP = 14;
  const SHIP_TO_MAX_LINES = 4;
  // Average-advance-width approximation (Helvetica regular ≈0.50em, bold ≈0.56em) — used only by
  // measureStyledField so it stays a synchronous, pure function (no pdf-lib font embedding). The
  // render path always measures with the real embedded font; this is a warning-only heuristic.
  const AVG_CHAR_WIDTH_RATIO = { regular: 0.5, bold: 0.56 };
  function _approxMeasurer(bold) {
    const ratio = bold ? AVG_CHAR_WIDTH_RATIO.bold : AVG_CHAR_WIDTH_RATIO.regular;
    return { widthOfTextAtSize: (t, s) => String(t).length * s * ratio };
  }

  /**
   * Resolves the effective {size, bold, italic, underline, lineH} for one SOURCE line of one
   * styleable field, given that field's `_style` entry (or undefined for "no style set"). Pure —
   * no font/page dependency. `baseCoord` supplies the pre-style default (its `size`/`lineH`/`bold`).
   */
  function resolveFieldLineStyle(fieldStyle, srcLineIdx, baseCoord) {
    const baseSize = baseCoord.size || 10;
    const lineStyle = (fieldStyle && fieldStyle.lines && srcLineIdx != null) ? fieldStyle.lines[String(srcLineIdx)] : undefined;
    const pick = (prop, fallback) => {
      if (lineStyle && lineStyle[prop] !== undefined) return lineStyle[prop];
      if (fieldStyle && fieldStyle[prop] !== undefined) return fieldStyle[prop];
      return fallback;
    };
    let size = pick('size', baseSize);
    size = Math.max(6, Math.min(36, size));
    const bold = pick('bold', !!baseCoord.bold);
    const italic = pick('italic', false);
    const underline = pick('underline', false);
    const lineH = baseCoord.lineH ? Math.round(baseCoord.lineH * size / baseSize) : Math.round(size * 1.2);
    return { size, bold, italic, underline, lineH };
  }

  /**
   * Pure helper for the editors (bol-style-02/03): measures a field's text under a candidate
   * `_style` entry and reports whether it would overflow the field's available box. Never used by
   * the render path itself (which never clips — see generatePdf). `fieldKey` also accepts the
   * dynamic `zoneCol0`, `zoneCol1`, … keys (item index in a zoned BOL's zoneColumns.items).
   * @returns {{ lines: number, height: number, overflow: boolean }}
   */
  function measureStyledField(fieldKey, text, style) {
    const sourceLines = String(text || '').split('\n');

    if (fieldKey === 'shipTo') {
      return {
        lines: sourceLines.length,
        height: sourceLines.length * SHIP_TO_LINE_GAP,
        overflow: sourceLines.length > SHIP_TO_MAX_LINES,
      };
    }

    const zoneMatch = /^zoneCol(\d+)$/.exec(fieldKey || '');
    let baseCoord, maxW, heightBudget;
    if (zoneMatch) {
      const idx = parseInt(zoneMatch[1], 10);
      const colMaxH = COORDS.zoneColumns.colMaxH || [];
      baseCoord = { size: 10, lineH: 12 };
      maxW = COORDS.zoneColumns.maxW / COORDS.zoneColumns.cols;
      heightBudget = colMaxH[idx] != null ? colMaxH[idx] : 216;
    } else if (COORDS[fieldKey]) {
      baseCoord = COORDS[fieldKey];
      maxW = baseCoord.maxW || null;
      heightBudget = FIELD_HEIGHT_BUDGET[fieldKey] != null ? FIELD_HEIGHT_BUDGET[fieldKey] : 40;
    } else {
      return { lines: 0, height: 0, overflow: false };
    }

    let lineCount = 0;
    let totalHeight = 0;
    sourceLines.forEach((srcLine, srcIdx) => {
      const r = resolveFieldLineStyle(style, srcIdx, baseCoord);
      if (maxW) {
        const wrapped = wrapText(srcLine, _approxMeasurer(r.bold), r.size, maxW);
        const n = wrapped.length || 1;
        lineCount += n;
        totalHeight += n * r.lineH;
      } else {
        lineCount += 1;
        totalHeight += r.lineH;
      }
    });

    let overflow = totalHeight > heightBudget;
    if (!overflow && maxW) {
      // A single word that still can't fit maxW even at the minimum size (6pt) is an overflow no
      // amount of wrapping fixes — wrapText only breaks on whitespace, never mid-word.
      const minMeasurer = _approxMeasurer(false);
      outer: for (const srcLine of sourceLines) {
        for (const w of srcLine.split(/\s+/).filter(Boolean)) {
          if (minMeasurer.widthOfTextAtSize(w, 6) > maxW) { overflow = true; break outer; }
        }
      }
    }

    return { lines: lineCount, height: totalHeight, overflow };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PDF GENERATION
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Generate a BOL PDF for one or more BOL records and open it.
   * @param {Array} bolRecords — array of saved BOL objects from the API
   * @param {Object} opts — { packingSlipPdfBytes?: ArrayBuffer }
   */
  async function generatePdf(bolRecords, opts = {}) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;

    const TEMPLATE_BY_COPY = {
      driver:   '/logistics/assets/BLANK_BOL_Xpanda_driver.pdf',
      customer: '/logistics/assets/BLANK_BOL_Xpanda_customer.pdf',
    };
    const templateUrl = TEMPLATE_BY_COPY[opts.copyType] || '/logistics/assets/BLANK_BOL_Xpanda.pdf';
    const templateResp = await fetch(templateUrl);
    if (!templateResp.ok) throw new Error(`BOL template not found at ${templateUrl}`);
    const templateBytes = await templateResp.arrayBuffer();

    // Cursive font for the shipper signature, embedded via fontkit. Fetched once; null-safe.
    // Path is CASE-SENSITIVE on Cloudflare Pages — the asset is FRSCRIPT.TTF (uppercase). A wrong
    // path returns the HTML app-shell at HTTP 200, so an "ok" response is NOT enough: require a real
    // font signature before trusting the bytes, or embedFont() would crash every BOL.
    let scriptFontBytes = null;
    try {
      const _ffResp = await fetch('/logistics/assets/FRSCRIPT.TTF');
      const _ct = (_ffResp.headers.get('content-type') || '').toLowerCase();
      if (_ffResp.ok && _ct.indexOf('text/html') === -1) {
        const _buf = await _ffResp.arrayBuffer();
        const _b = new Uint8Array(_buf.slice(0, 4));
        const _tag = String.fromCharCode(_b[0], _b[1], _b[2], _b[3]);
        const _isFont = (_b[0] === 0x00 && _b[1] === 0x01 && _b[2] === 0x00 && _b[3] === 0x00) // TrueType
          || _tag === 'OTTO' || _tag === 'true' || _tag === 'ttcf' || _tag === 'wOFF' || _tag === 'wOF2';
        if (_isFont) scriptFontBytes = _buf;
      }
    } catch (_e) { scriptFontBytes = null; }

    const combinedPdf = await PDFDocument.create();

    for (const _bolRaw of bolRecords) {
      // Hydrate persisted overrides. The approve path passes `_overrides` already as an object;
      // the stored-view path passes a DB row whose `render_overrides` is a JSON STRING and has no
      // `_overrides`. Every render funnels through here, so this one step fixes all view callers
      // (viewBolForJob in logistics/index.html, logistics/loading.html, jobs/index.html) without
      // touching any of them. Fail safe to base fields on malformed JSON; never clobber an
      // already-present object; bind a per-iteration local so repeated passes stay idempotent.
      let bol = _bolRaw;
      if (!bol._overrides && bol.render_overrides) {
        let _parsed = null;
        if (typeof bol.render_overrides === 'object') {
          _parsed = bol.render_overrides;
        } else if (typeof bol.render_overrides === 'string' && bol.render_overrides.trim()) {
          try { _parsed = JSON.parse(bol.render_overrides); } catch (_e) { _parsed = null; }
        }
        if (_parsed && typeof _parsed === 'object') {
          bol = Object.assign({}, bol, { _overrides: _parsed });
        }
      }
      const templateDoc = await PDFDocument.load(templateBytes);
      const page = templateDoc.getPages()[0];
      const font = await templateDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await templateDoc.embedFont(StandardFonts.HelveticaBold);
      const fontItalic = await templateDoc.embedFont(StandardFonts.HelveticaOblique);
      const fontBoldItalic = await templateDoc.embedFont(StandardFonts.HelveticaBoldOblique);
      const pickFont = ({ bold, italic }) => {
        if (bold && italic) return fontBoldItalic;
        if (bold) return fontBold;
        if (italic) return fontItalic;
        return font;
      };
      let cursive = null;
      if (scriptFontBytes && window.fontkit) {
        try {
          templateDoc.registerFontkit(window.fontkit);
          cursive = await templateDoc.embedFont(scriptFontBytes);
        } catch (_fe) { cursive = null; }
      }
      const black = rgb(0, 0, 0);

      // `overrides.fieldKey` (+ `overrides.lineIdx` for shipTo) routes a field through the style
      // resolver (bol-style-01); omitted for the two non-styleable drawText callers (scrap 'X',
      // shipperDate) which fall back to exactly their pre-bol-style-01 behavior.
      const drawText = (text, coord, overrides = {}) => {
        if (!text && text !== 0) return;
        const style = resolveStyle(overrides.fieldKey, overrides.lineIdx, coord);
        const o = {
          x: coord.x,
          y: coord.y,
          size: style.size,
          font: style.font,
          color: black,
        };
        if (coord.maxW) o.maxWidth = coord.maxW;
        page.drawText(String(text), o);
        if (style.underline) drawUnderline(String(text), o.x, o.y, style.size, style.font, black);
      };

      // Wraps per SOURCE line (text split on \n, BEFORE wrapping) so each source line can carry its
      // own resolved style; a wrapped continuation inherits its source line's style. y advances by
      // each output line's own resolved lineH (constant when no `_style` — same result as before).
      const drawMultiline = (text, coord, fieldKey) => {
        if (!text) return;
        const maxW = coord.maxW || 250;
        const sourceLines = String(text).split('\n');
        let y = coord.y;
        sourceLines.forEach((srcLine, srcIdx) => {
          const style = resolveStyle(fieldKey, srcIdx, coord);
          const wrapped = wrapText(srcLine, style.font, style.size, maxW);
          wrapped.forEach((line) => {
            const opts = { x: coord.x, y, size: style.size, font: style.font, color: black };
            if (coord.center && line) {
              const lineWidth = style.font.widthOfTextAtSize(line, style.size);
              opts.x = coord.x + (maxW - lineWidth) / 2;
            } else {
              opts.maxWidth = maxW;
            }
            page.drawText(line, opts);
            if (style.underline && line) drawUnderline(line, opts.x, y, style.size, style.font, black);
            y -= style.lineH;
          });
        });
      };

      const _ov = bol._overrides || {};

      // ── Position overrides (P122 free-drag): per-field {dx,dy} deltas in PDF points ──
      const _pos = (_ov && _ov._pos) || {};
      const off = (key, coord) => {
        const p = _pos[key];
        if (!p) return coord;
        return { ...coord, x: coord.x + (p.dx || 0), y: coord.y + (p.dy || 0) };
      };

      // ── Text style overrides (bol-style-01): render_overrides._style, resolved against real
      // embedded fonts. `fieldKey` undefined (or absent from `_style`) resolves to exactly the
      // pre-bol-style-01 default — see resolveFieldLineStyle. ──
      const _style = _ov._style || {};
      const resolveStyle = (fieldKey, srcLineIdx, baseCoord) => {
        const fieldStyle = fieldKey ? _style[fieldKey] : undefined;
        const r = resolveFieldLineStyle(fieldStyle, srcLineIdx, baseCoord);
        return { size: r.size, font: pickFont({ bold: r.bold, italic: r.italic }), underline: r.underline, lineH: r.lineH };
      };
      const drawUnderline = (text, x, y, size, drawFont, color) => {
        const w = drawFont.widthOfTextAtSize(String(text), size);
        const uy = y - Math.max(1, size * 0.12);
        const thickness = Math.max(0.5, size * 0.06);
        page.drawLine({ start: { x, y: uy }, end: { x: x + w, y: uy }, thickness, color });
      };

      // ── Delivery time (bold red, top right; multiline-capable via override — P122) ──
      // COORDS.deliveryTime has no literal `bold: true`, but this field always rendered bold before
      // bol-style-01 — synthesize it as the resolver's base default so `bold: false` can now opt out.
      const _deliveryTimeVal = ('deliveryTime' in _ov)
        ? (Array.isArray(_ov.deliveryTime) ? _ov.deliveryTime.join('\n') : _ov.deliveryTime)
        : bol.delivery_time;
      if (_deliveryTimeVal) {
        const _dc = off('deliveryTime', { ...COORDS.deliveryTime, bold: true });
        const _dSourceLines = String(_deliveryTimeVal).split('\n');
        let _dy = _dc.y;
        _dSourceLines.forEach((srcLine, srcIdx) => {
          const _dStyle = resolveStyle('deliveryTime', srcIdx, _dc);
          const _dWrapped = wrapText(srcLine, _dStyle.font, _dStyle.size, _dc.maxW || 200);
          _dWrapped.forEach((line) => {
            page.drawText(line, { x: _dc.x, y: _dy, size: _dStyle.size, font: _dStyle.font, color: rgb(1, 0, 0) });
            if (_dStyle.underline && line) drawUnderline(line, _dc.x, _dy, _dStyle.size, _dStyle.font, rgb(1, 0, 0));
            _dy -= _dStyle.lineH;
          });
        });
      }

      // ── Standard fields ──
      const formatBolDate = (iso) => {
        if (!iso) return '';
        const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return m ? `${m[2]}/${m[3]}/${m[1]}` : String(iso);
      };
      const _rawDate = 'date' in _ov ? _ov.date : bol.date;
      const _displayDate = 'date' in _ov ? String(_rawDate) : formatBolDate(_rawDate);
      drawText(_displayDate,                                                           off('date', COORDS.date), { fieldKey: 'date' });
      drawText('bolNumber' in _ov   ? _ov.bolNumber   : String(bol.bol_number || ''), off('bolNumber', COORDS.bolNumber), { fieldKey: 'bolNumber' });
      drawText('carrierName' in _ov ? _ov.carrierName : bol.carrier_name,             off('carrierName', COORDS.carrierName), { fieldKey: 'carrierName' });
      drawText('trailerNo' in _ov   ? _ov.trailerNo   : bol.trailer_no,               off('trailerNo', COORDS.trailerNo), { fieldKey: 'trailerNo' });

      // ── Ship-to address (up to 4 lines) ──
      const shipLines = Array.isArray(_ov.shipTo) ? _ov.shipTo : buildShipToLines(bol);
      const shipCoords = [COORDS.shipLine1, COORDS.shipLine2, COORDS.shipLine3, COORDS.shipLine4];
      shipLines.forEach((line, i) => { if (shipCoords[i]) drawText(line, off('shipTo', shipCoords[i]), { fieldKey: 'shipTo', lineIdx: i }); });

      // ── Special Instructions ──
      drawMultiline(
        Array.isArray(_ov.specialInstr) ? _ov.specialInstr.join('\n') : bol.special_instructions,
        off('specialInstr', COORDS.specialInstr), 'specialInstr');

      // ── Contact Info ──
      // Accept either contact_info (BOL generator) or contact_name/contact_phone (load builder).
      // Override arrives as literal lines — draw verbatim (no 'POC: ' prefix added).
      const _contactVal = Array.isArray(_ov.contactInfo)
        ? _ov.contactInfo.join('\n')
        : (bol.contact_info || [
            bol.contact_name ? ('POC: ' + bol.contact_name) : '',
            bol.contact_phone || '',
          ].filter(Boolean).join(' '));
      if (_contactVal) drawMultiline(_contactVal, off('contactInfo', COORDS.contactInfo), 'contactInfo');

      // ── PO / Invoice Number ──
      // Override arrives as literal lines — draw verbatim (no 'PO: ' prefix added).
      // Default path: bold "PO:" label, regular PO number offset by the label width. The `_style`
      // box applies to the NUMBER portion only; the label stays bold but follows the box size.
      if (Array.isArray(_ov.poNumber)) {
        const _poVal = _ov.poNumber.join('\n');
        if (_poVal) drawMultiline(_poVal, off('poNumber', COORDS.poNumber), 'poNumber');
      } else {
        const _poNum = bol.po_number || bol.poNumber || '';
        if (_poNum) {
          const _pc = off('poNumber', COORDS.poNumber);
          const _poStyle = resolveStyle('poNumber', 0, _pc);
          const _poLabel = 'PO:';
          page.drawText(_poLabel, { x: _pc.x, y: _pc.y, size: _poStyle.size, font: fontBold, color: black });
          const _poLabelW = fontBold.widthOfTextAtSize(_poLabel + ' ', _poStyle.size);
          page.drawText(String(_poNum), { x: _pc.x + _poLabelW, y: _pc.y, size: _poStyle.size, font: _poStyle.font, color: black });
          if (_poStyle.underline) drawUnderline(String(_poNum), _pc.x + _poLabelW, _pc.y, _poStyle.size, _poStyle.font, black);
        }
      }

      // ── Scrap Pick Up ──
      const _isScrap = typeof _ov.scrap === 'boolean' ? _ov.scrap
        : (bol.is_scrap_pickup === 1 || bol.is_scrap_pickup === true || bol.is_scrap_pickup === '1');
      drawText('X', off('scrap', _isScrap ? COORDS.scrapYes : COORDS.scrapNo));

      // ── Commodity description (centered, auto-sized by wrapped line count) ──
      // lbz-bol-01: a zoned truck's render_overrides.zoneColumns REPLACES this block entirely
      // (rendered inside the same region, never alongside it). Absence of _ov.zoneColumns — every
      // bol before this change, and every non-zoned bol going forward — takes the untouched
      // `else` branch below with zero behavior change.
      const _zc = _ov.zoneColumns;
      const _zcHasData = _zc && ((Array.isArray(_zc.items) && _zc.items.length) || (Array.isArray(_zc.zoneData) && _zc.zoneData.length));
      if (_zcHasData) {
        const _zcColW = COORDS.zoneColumns.maxW / COORDS.zoneColumns.cols;
        const _zcItems = (Array.isArray(_zc.items) && _zc.items.length) ? _zc.items : buildZoneColumns(_zc.zoneData, font).items;
        _zcItems.forEach((item, itemIdx) => {
          // Styleable as `zoneCol<itemIdx>` (item index in zoneColumns.items). A box `size` REPLACES
          // pickZoneColumnTier for this column, same rule as commodity vs pickCommodityTier below.
          const _zcFieldKey = 'zoneCol' + itemIdx;
          const _zcLines = String(item.text || '').split('\n');
          const _zcHasBoxSize = _style[_zcFieldKey] && _style[_zcFieldKey].size != null;
          const _zcTier = _zcHasBoxSize ? { size: 10, lineH: 12 } : pickZoneColumnTier(_zcLines, font, _zcColW);
          const _zcBaseCoord = { size: _zcTier.size, lineH: _zcTier.lineH };
          let _zcY = item.y;
          _zcLines.forEach((line, li) => {
            const _zcStyle = resolveStyle(_zcFieldKey, li, _zcBaseCoord);
            if (line) {
              page.drawText(line, { x: item.x, y: _zcY, size: _zcStyle.size, font: _zcStyle.font, color: black });
              if (_zcStyle.underline) drawUnderline(line, item.x, _zcY, _zcStyle.size, _zcStyle.font, black);
            }
            _zcY -= _zcStyle.lineH;
          });
        });
      } else {
        let _commodityText = Array.isArray(_ov.commodity) ? _ov.commodity.join('\n') : bol.commodity_description;
        if (_commodityText && bol.siplast) {
          // Siplast products: prefix the SKU inside parens, e.g. (HB-10) -> (Siplast HB-10)
          _commodityText = String(_commodityText).replace(/\(([^)]+)\)/g, '(Siplast $1)');
        }
        if (_commodityText) {
          // A `_style.commodity` box `size` REPLACES pickCommodityTier entirely for this BOL;
          // per-line sizes without a box size ride on top of the auto-picked tier.
          const _commodityHasBoxSize = _style.commodity && _style.commodity.size != null;
          const _commodityCoord = _commodityHasBoxSize
            ? { ...COORDS.commodity }
            : (() => { const _tier = pickCommodityTier(String(_commodityText), font); return { ...COORDS.commodity, size: _tier.size, lineH: _tier.lineH }; })();
          drawMultiline(_commodityText, off('commodity', _commodityCoord), 'commodity');
        }
      }

      // ── Shipper signature (cursive, all copies) ──
      if (bol.shipper_name && cursive) {
        page.drawText(String(bol.shipper_name), {
          x: COORDS.shipperSignature.x,
          y: COORDS.shipperSignature.y,
          size: COORDS.shipperSignature.size || 22,
          font: cursive,
          color: black,
        });
      }

      // ── Ship date next to shipper signature (auto-populated; regular font) ──
      if (_displayDate) drawText(_displayDate, COORDS.shipperDate);

      // ── QR code (driver tracking link) ──
      if (opts.copyType !== 'customer' && !opts.hideQr && bol.access_token && typeof qrcode === 'function') {
        const trackingUrl = `${window.location.origin}/track/${bol.access_token}`;
        // Type 0 = auto-select smallest version that fits; 'M' = medium error correction.
        const qr = qrcode(0, 'M');
        qr.addData(trackingUrl);
        qr.make();
        const modules = qr.getModuleCount();
        const cellSize = COORDS.qrCode.size / modules;
        for (let r = 0; r < modules; r++) {
          for (let c = 0; c < modules; c++) {
            if (qr.isDark(r, c)) {
              page.drawRectangle({
                x: COORDS.qrCode.x + c * cellSize,
                y: COORDS.qrCode.y + (modules - 1 - r) * cellSize, // flip Y (pdf-lib origin is bottom-left)
                width: cellSize,
                height: cellSize,
                color: black,
              });
            }
          }
        }
      }

      // ── Copy page into combined PDF ──
      const [copiedPage] = await combinedPdf.copyPages(templateDoc, [0]);
      combinedPdf.addPage(copiedPage);
    }

    // Append packing slip PDF if provided
    if (opts.packingSlipPdfBytes) {
      try {
        const packingDoc = await PDFDocument.load(opts.packingSlipPdfBytes);
        const packingPages = await combinedPdf.copyPages(packingDoc, packingDoc.getPageIndices());
        packingPages.forEach(p => combinedPdf.addPage(p));
      } catch (e) {
        console.error('Failed to append packing slip:', e);
      }
    }

    const pdfBytes = await combinedPdf.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const blobUrl = URL.createObjectURL(blob);

    if (opts.previewOnly) {
      return { blobUrl, pdfBytes };
    }

    // Open in new tab (no auto-download)
    const win = window.open(blobUrl, '_blank');
    if (!win) {
      const err = new Error('PDF was generated but your browser blocked the popup. Please allow popups for this site.');
      err.popupBlocked = true;
      throw err;
    }

    // Clean up blob URL after delay
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  }

  function openPdf(blobUrl) {
    const win = window.open(blobUrl, '_blank');
    if (!win) {
      alert('Your browser blocked the popup. Please allow popups for this site.');
      return;
    }
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  }

  // ═══════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════

  function buildShipToLines(bol) {
    const lines = [];
    if (bol.ship_to_company)   lines.push(bol.ship_to_company);
    if (bol.ship_to_attention) lines.push(bol.ship_to_attention);
    const streetLine = [bol.ship_to_street, bol.ship_to_street2].filter(Boolean).join(', ');
    if (streetLine) lines.push(streetLine);
    const cityStateZip = [bol.ship_to_city, bol.ship_to_state, bol.ship_to_zip].filter(Boolean).join(', ');
    if (cityStateZip) lines.push(cityStateZip);
    return lines.slice(0, 4);
  }

  function wrapText(text, font, fontSize, maxWidth) {
    const lines = [];
    const paragraphs = text.split('\n');
    for (const para of paragraphs) {
      if (!para.trim()) { lines.push(''); continue; }
      const words = para.split(/\s+/);
      let currentLine = '';
      for (const word of words) {
        const testLine = currentLine ? currentLine + ' ' + word : word;
        try {
          const width = font.widthOfTextAtSize(testLine, fontSize);
          if (width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
          } else {
            currentLine = testLine;
          }
        } catch {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);
    }
    return lines;
  }

  /**
   * Show a toast confirmation when BOL number is blank.
   * Returns a Promise: true = continue without number, false = cancel.
   */
  function confirmNoBolNumber() {
    return new Promise((resolve) => {
      const backdrop = document.createElement('div');
      backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:10000;display:flex;align-items:center;justify-content:center;';

      const card = document.createElement('div');
      card.style.cssText = 'background:#fff;border-radius:12px;padding:24px;max-width:360px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.15);text-align:center;';
      card.innerHTML = `
        <div style="font-size:15px;font-weight:600;margin-bottom:16px;color:#111827;">No BOL/INV # entered.<br>Continue without one?</div>
        <div style="display:flex;gap:10px;justify-content:center;">
          <button id="bol-toast-cancel" style="padding:10px 20px;border-radius:8px;border:1px solid #d1d5db;background:#fff;cursor:pointer;font-size:14px;font-weight:600;color:#111827;">Cancel</button>
          <button id="bol-toast-continue" style="padding:10px 20px;border-radius:8px;border:none;background:#334155;color:#fff;cursor:pointer;font-size:14px;font-weight:600;">Continue</button>
        </div>
      `;
      backdrop.appendChild(card);
      document.body.appendChild(backdrop);

      const cleanup = (result) => { backdrop.remove(); resolve(result); };
      card.querySelector('#bol-toast-continue').addEventListener('click', () => cleanup(true));
      card.querySelector('#bol-toast-cancel').addEventListener('click', () => cleanup(false));
      backdrop.addEventListener('click', (e) => { if (e.target === backdrop) cleanup(false); });
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════

  return {
    COORDS,
    PAGE,
    COPY_ORDER,
    FIELD_MAP,
    pickCommodityTier,
    pickZoneColumnTier,
    isBaseDensity,
    buildZoneColumnLines,
    buildZoneColumns,
    hashJobZoneData,
    resolveFieldLineStyle,
    measureStyledField,
    generatePdf,
    openPdf,
    buildShipToLines,
    wrapText,
    confirmNoBolNumber,
  };

})();
