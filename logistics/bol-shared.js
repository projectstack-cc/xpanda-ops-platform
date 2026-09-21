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
  // Shared by the render path (layoutBol/layoutField, closed over real pdf-lib fonts — see the
  // LAYOUT ENGINE section below, bol-wysiwyg-01) and the pure measureStyledField() editors call for
  // overflow warnings (closed over getLayoutFonts()'s cache or an approximate measurer) so both
  // stay in lockstep. Mirror this block byte-identical into bolShared.ts.
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
  // bol-wysiwyg-01: thin wrapper over layoutField (see LAYOUT ENGINE section below) — measures
  // against real embedded Helvetica metrics once getLayoutFonts() has been awaited by the caller
  // (both editors do so before first paint, same as they already await pdf.js), falling back to
  // the approximate ratio measurer below until then. Return shape and the shipTo/zoneCol/unknown-
  // fieldKey special cases are UNCHANGED — every existing bol-style-02/03 caller keeps working.
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

    const fonts = _layoutFontsCache || _approxFontsFallback();
    const { runs, box } = layoutField(fieldKey, text, style, fonts, {
      fieldKey, x: 0, y: 0, baseCoord, maxW: maxW || 1e9, wrap: !!maxW,
    });
    const lineCount = runs.length;
    const totalHeight = box.h;

    let overflow = totalHeight > heightBudget;
    if (!overflow && maxW) {
      // A single word that still can't fit maxW even at the minimum size (6pt) is an overflow no
      // amount of wrapping fixes — wrapText only breaks on whitespace, never mid-word. Deliberately
      // always the approximate measurer here (unchanged from before layoutField existed) — this is
      // a conservative absolute-floor sanity check, not a rendering measurement.
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
  // LAYOUT ENGINE (bol-wysiwyg-01) — the single source of truth for where BOL text lands, shared by
  // generatePdf (real per-document embedded fonts) and every WYSIWYG editor (bol-wysiwyg-02/03, via
  // getLayoutFonts()'s cached scratch fonts). Fixes the four render/editor mismatches the editors'
  // old COORDS-only `positionAll` had: commodity/zone-column tier sizing, centering, box origin, and
  // wrapping metrics — see the bol-wysiwyg-01 prompt's "Why" section. Pure: no DOM, no page object.
  // ═══════════════════════════════════════════════════════════════════

  function _fontKeyFor(bold, italic) {
    if (bold && italic) return 'boldItalic';
    if (bold) return 'bold';
    if (italic) return 'italic';
    return 'regular';
  }

  // Fallback WidthMeasurer set for measureStyledField before getLayoutFonts() has resolved (mirrors
  // the pre-bol-wysiwyg-01 approximation, which only ever varied by bold, never italic).
  function _approxFontsFallback() {
    return {
      regular: _approxMeasurer(false),
      bold: _approxMeasurer(true),
      italic: _approxMeasurer(false),
      boldItalic: _approxMeasurer(true),
    };
  }

  // Cached once per page load: a scratch PDFDocument's embedded Helvetica family, used purely for
  // width/wrap measurement by editors (never drawn — the editor's own canvas overlay draws glyphs
  // with `ctx.font`; only the metrics need to match generatePdf's real embedded fonts, which they do
  // exactly since Helvetica metrics are identical across any PDFDocument that embeds them).
  let _layoutFontsCache = null;
  async function getLayoutFonts() {
    if (_layoutFontsCache) return _layoutFontsCache;
    const { PDFDocument, StandardFonts } = PDFLib;
    const scratch = await PDFDocument.create();
    const regular = await scratch.embedFont(StandardFonts.Helvetica);
    const bold = await scratch.embedFont(StandardFonts.HelveticaBold);
    const italic = await scratch.embedFont(StandardFonts.HelveticaOblique);
    const boldItalic = await scratch.embedFont(StandardFonts.HelveticaBoldOblique);
    _layoutFontsCache = { regular, bold, italic, boldItalic };
    return _layoutFontsCache;
  }

  /**
   * Pure layout primitive for one styleable field's text: resolves per-source-line `_style` (via
   * resolveFieldLineStyle) and wraps each source line (unless `geom.wrap===false` — zone-column
   * lines are pre-fit to their column and must never re-wrap, matching generatePdf's zone-column
   * draw loop, which never calls wrapText either), returning drawable runs plus the field's
   * on-canvas box. Mirrors drawMultiline's exact geometry: centering, `maxWidth` presence (only
   * legacy quirk preserved on purpose — deliveryTime never set it; see `setMaxWidth`), and blank-
   * line handling (drawMultiline always draws a blank wrapped line; the zone-column loop skips it —
   * see `drawEmptyLines`), so render and editor can never drift.
   * @param {string|null} styleKey - `_style` lookup key; null skips style resolution entirely
   *   (matches drawText's un-styleable callers — scrap 'X').
   * @param {string} text - already-joined source text (may contain \n; NOT pre-wrapped)
   * @param {Object|undefined} fieldStyle - `_style[styleKey]`, already looked up by the caller
   * @param {Object} fonts - { regular, bold, italic, boldItalic } — WidthMeasurer-shaped; real
   *   PDFFont objects for the render path, getLayoutFonts()'s cache (or the approximate fallback)
   *   for editors/measureStyledField.
   * @param {Object} geom - { fieldKey, x, y, baseCoord, maxW, center, color, wrap, setMaxWidth,
   *   drawEmptyLines, boxWidth }. `wrap`/`setMaxWidth`/`drawEmptyLines` default true; `color`
   *   defaults to 'black' (a tag — generatePdf maps it to a real rgb() color).
   * @returns {{ runs: Array<{fieldKey,srcLineIdx,text,x,y,size,fontKey,color,underline,width,
   *   maxWidth,box}>, box: {x:number,y:number,w:number,h:number} }}
   */
  function layoutField(styleKey, text, fieldStyle, fonts, geom) {
    const wrap = geom.wrap !== false;
    const setMaxWidth = geom.setMaxWidth !== false;
    const drawEmptyLines = geom.drawEmptyLines !== false;
    const color = geom.color || 'black';
    const sourceLines = String(text == null ? '' : text).split('\n');
    const runs = [];
    let y = geom.y;
    let firstSize = null;
    let totalHeight = 0;

    sourceLines.forEach((srcLine, srcIdx) => {
      const style = resolveFieldLineStyle(fieldStyle, styleKey == null ? null : srcIdx, geom.baseCoord);
      const fontKey = _fontKeyFor(style.bold, style.italic);
      const measurer = fonts[fontKey];
      const lines = wrap ? wrapText(srcLine, measurer, style.size, geom.maxW) : [srcLine];
      lines.forEach((line) => {
        if (firstSize == null) firstSize = style.size;
        const centeredHere = !!(geom.center && line);
        if (line || drawEmptyLines) {
          let x = geom.x;
          if (centeredHere) {
            const lineWidth = measurer.widthOfTextAtSize(line, style.size);
            x = geom.x + (geom.maxW - lineWidth) / 2;
          }
          runs.push({
            fieldKey: geom.fieldKey,
            srcLineIdx: srcIdx,
            text: line,
            x, y,
            size: style.size,
            fontKey,
            color,
            underline: !!(style.underline && line),
            width: line ? measurer.widthOfTextAtSize(line, style.size) : 0,
            maxWidth: (setMaxWidth && !centeredHere) ? geom.maxW : undefined,
          });
        }
        totalHeight += style.lineH;
        y -= style.lineH;
      });
    });

    const box = {
      x: geom.x,
      y: geom.y + (firstSize != null ? firstSize : (geom.baseCoord.size || 10)),
      w: geom.boxWidth != null ? geom.boxWidth : geom.maxW,
      h: totalHeight,
    };
    return { runs, box };
  }

  /**
   * Pure per-BOL layout: resolves `_overrides`/`_pos`/`_style` and produces the exact set of
   * drawable runs generatePdf renders, plus every editable field's on-canvas box — the single
   * source of truth both the PDF renderer and the WYSIWYG editors (bol-wysiwyg-02/03) read from.
   * `fonts` must be real embedded pdf-lib fonts for the render path (byte-identity depends on it);
   * editors pass getLayoutFonts()'s cached scratch fonts. `bol._overrides` must already be
   * hydrated (generatePdf does this once per record before calling in).
   * shipperSignature/shipperDate/the QR code are intentionally NOT included — none are in
   * FIELD_MAP (not editable/positionable), so generatePdf still draws them directly, unchanged.
   * @returns {{ runs: Array, boxes: Object<string, {x,y,w,h}>, displayDate: string }}
   */
  function layoutBol(bol, fonts) {
    const runs = [];
    const boxes = {};
    const _ov = bol._overrides || {};
    const _pos = _ov._pos || {};
    const off = (key, coord) => {
      const p = _pos[key];
      if (!p) return coord;
      return { ...coord, x: coord.x + (p.dx || 0), y: coord.y + (p.dy || 0) };
    };
    const _style = _ov._style || {};

    // ── Delivery time (bold red; multiline-capable via override) ──
    const _deliveryTimeVal = ('deliveryTime' in _ov)
      ? (Array.isArray(_ov.deliveryTime) ? _ov.deliveryTime.join('\n') : _ov.deliveryTime)
      : bol.delivery_time;
    {
      const dc = off('deliveryTime', { ...COORDS.deliveryTime, bold: true });
      const { runs: r, box } = layoutField('deliveryTime', _deliveryTimeVal || '', _style.deliveryTime, fonts, {
        fieldKey: 'deliveryTime', x: dc.x, y: dc.y, baseCoord: dc, maxW: dc.maxW || 200,
        color: 'red', setMaxWidth: false,
      });
      boxes.deliveryTime = box;
      if (_deliveryTimeVal) runs.push(...r);
    }

    // ── Single fields: date, bolNumber, carrierName, trailerNo ──
    function layoutSingle(fieldKey, text, coord) {
      const c = off(fieldKey, coord);
      const hasText = !(!text && text !== 0);
      const style = resolveFieldLineStyle(_style[fieldKey], undefined, c);
      const fontKey = _fontKeyFor(style.bold, style.italic);
      boxes[fieldKey] = { x: c.x, y: c.y + style.size, w: PAGE.width - c.x - 10, h: style.size + 6 };
      if (!hasText) return;
      runs.push({
        fieldKey, srcLineIdx: null, text: String(text),
        x: c.x, y: c.y, size: style.size, fontKey, color: 'black',
        underline: !!style.underline,
        width: fonts[fontKey].widthOfTextAtSize(String(text), style.size),
        maxWidth: c.maxW ? c.maxW : undefined,
      });
    }

    const _rawDate = 'date' in _ov ? _ov.date : bol.date;
    const displayDate = 'date' in _ov ? String(_rawDate) : formatBolDate(_rawDate);
    layoutSingle('date', displayDate, COORDS.date);
    layoutSingle('bolNumber', 'bolNumber' in _ov ? _ov.bolNumber : String(bol.bol_number || ''), COORDS.bolNumber);
    layoutSingle('carrierName', 'carrierName' in _ov ? _ov.carrierName : bol.carrier_name, COORDS.carrierName);
    layoutSingle('trailerNo', 'trailerNo' in _ov ? _ov.trailerNo : bol.trailer_no, COORDS.trailerNo);

    // ── Ship-to address (up to 4 fixed lines; never wrapped — matches drawText's un-maxWidth'd
    // shipLine coords) ──
    {
      const shipLines = Array.isArray(_ov.shipTo) ? _ov.shipTo : buildShipToLines(bol);
      const shipCoords = [COORDS.shipLine1, COORDS.shipLine2, COORDS.shipLine3, COORDS.shipLine4];
      const c1 = off('shipTo', shipCoords[0]);
      const c4 = off('shipTo', shipCoords[3]);
      let maxLineW = 0;
      shipLines.forEach((line, i) => {
        if (!shipCoords[i]) return;
        const c = off('shipTo', shipCoords[i]);
        const style = resolveFieldLineStyle(_style.shipTo, i, c);
        const fontKey = _fontKeyFor(style.bold, style.italic);
        const hasText = !(!line && line !== 0);
        if (!hasText) return;
        const w = fonts[fontKey].widthOfTextAtSize(String(line), style.size);
        if (w > maxLineW) maxLineW = w;
        runs.push({
          fieldKey: 'shipTo', srcLineIdx: i, text: String(line),
          x: c.x, y: c.y, size: style.size, fontKey, color: 'black',
          underline: !!style.underline, width: w, maxWidth: undefined,
        });
      });
      // Real PDF never wraps/clips ship-to (no maxW on its COORDS) — the box width reflects the
      // actual widest line instead of the old hardcoded 210pt guess (bol-wysiwyg-01 Why item #4),
      // floored at 210 so a short/empty address still gets a reasonably wide edit box.
      boxes.shipTo = {
        x: c1.x,
        y: c1.y + (shipCoords[0].size || 10),
        w: Math.max(210, maxLineW),
        h: (c1.y + (shipCoords[0].size || 10)) - (c4.y - (shipCoords[3].size || 10)),
      };
    }

    // Shared by specialInstr/contactInfo/poNumber(array)/commodity — the standard drawMultiline
    // shape (wraps, draws even blank wrapped lines, box always computed even with no text so the
    // editor has somewhere to click even on a currently-empty field).
    function multilineFieldLayout(fieldKey, text, coord, fieldOpts) {
      fieldOpts = fieldOpts || {};
      const c = off(fieldKey, coord);
      const maxW = c.maxW || 250;
      const { runs: r, box } = layoutField(fieldKey, text || '', _style[fieldKey], fonts, {
        fieldKey, x: c.x, y: c.y, baseCoord: c, maxW,
        center: !!fieldOpts.center, color: fieldOpts.color || 'black',
      });
      boxes[fieldKey] = box;
      if (text) runs.push(...r);
    }

    // ── Special Instructions ──
    multilineFieldLayout('specialInstr',
      Array.isArray(_ov.specialInstr) ? _ov.specialInstr.join('\n') : bol.special_instructions,
      COORDS.specialInstr);

    // ── Contact Info (accepts contact_info OR contact_name/contact_phone; override draws verbatim,
    // no 'POC: ' prefix added) ──
    multilineFieldLayout('contactInfo',
      Array.isArray(_ov.contactInfo) ? _ov.contactInfo.join('\n') : (bol.contact_info || [
        bol.contact_name ? ('POC: ' + bol.contact_name) : '',
        bol.contact_phone || '',
      ].filter(Boolean).join(' ')),
      COORDS.contactInfo);

    // ── PO / Invoice Number (override draws verbatim; default path renders a fixed-bold "PO:"
    // label + the resolved-style number as two runs on one unwrapped line) ──
    if (Array.isArray(_ov.poNumber)) {
      multilineFieldLayout('poNumber', _ov.poNumber.join('\n'), COORDS.poNumber);
    } else {
      const poNum = bol.po_number || bol.poNumber || '';
      const c = off('poNumber', COORDS.poNumber);
      const poStyle = resolveFieldLineStyle(_style.poNumber, 0, c);
      const poFontKey = _fontKeyFor(poStyle.bold, poStyle.italic);
      const poLabel = 'PO:';
      const poLabelW = fonts.bold.widthOfTextAtSize(poLabel + ' ', poStyle.size);
      boxes.poNumber = { x: c.x, y: c.y + poStyle.size, w: c.maxW || 255, h: poStyle.lineH };
      if (poNum) {
        runs.push({
          fieldKey: 'poNumber', srcLineIdx: 0, text: poLabel,
          x: c.x, y: c.y, size: poStyle.size, fontKey: 'bold', color: 'black',
          underline: false, width: fonts.bold.widthOfTextAtSize(poLabel, poStyle.size), maxWidth: undefined,
        });
        runs.push({
          fieldKey: 'poNumber', srcLineIdx: 0, text: String(poNum),
          x: c.x + poLabelW, y: c.y, size: poStyle.size, fontKey: poFontKey, color: 'black',
          underline: !!poStyle.underline,
          width: fonts[poFontKey].widthOfTextAtSize(String(poNum), poStyle.size), maxWidth: undefined,
        });
      }
    }

    // ── Scrap Pick Up (not styleable — no `_style` lookup, matches drawText's un-keyed call) ──
    {
      const isScrap = typeof _ov.scrap === 'boolean' ? _ov.scrap
        : (bol.is_scrap_pickup === 1 || bol.is_scrap_pickup === true || bol.is_scrap_pickup === '1');
      const coord = isScrap ? COORDS.scrapYes : COORDS.scrapNo;
      const c = off('scrap', coord);
      const style = resolveFieldLineStyle(undefined, undefined, c);
      const fontKey = _fontKeyFor(style.bold, style.italic);
      boxes.scrap = { x: c.x - 35, y: c.y + style.size, w: 45, h: style.size + 6 };
      runs.push({
        fieldKey: 'scrap', srcLineIdx: null, text: 'X',
        x: c.x, y: c.y, size: style.size, fontKey, color: 'black',
        underline: false, width: fonts[fontKey].widthOfTextAtSize('X', style.size), maxWidth: undefined,
      });
    }

    // ── Commodity description / Zone columns (a zoned truck's zoneColumns REPLACES commodity
    // entirely, never alongside it — absence of _ov.zoneColumns takes the untouched else branch) ──
    {
      const _zc = _ov.zoneColumns;
      const _zcHasData = _zc && ((Array.isArray(_zc.items) && _zc.items.length) || (Array.isArray(_zc.zoneData) && _zc.zoneData.length));
      if (_zcHasData) {
        const _zcColW = COORDS.zoneColumns.maxW / COORDS.zoneColumns.cols;
        const _zcItems = (Array.isArray(_zc.items) && _zc.items.length) ? _zc.items : buildZoneColumns(_zc.zoneData, fonts.regular).items;
        _zcItems.forEach((item, itemIdx) => {
          const _zcFieldKey = 'zoneCol' + itemIdx;
          const _zcLines = String(item.text || '').split('\n');
          const _zcFieldStyle = _style[_zcFieldKey];
          const _zcHasBoxSize = _zcFieldStyle && _zcFieldStyle.size != null;
          const _zcTier = _zcHasBoxSize ? { size: 10, lineH: 12 } : pickZoneColumnTier(_zcLines, fonts.regular, _zcColW);
          const _zcBaseCoord = { size: _zcTier.size, lineH: _zcTier.lineH };
          const { runs: r, box } = layoutField(_zcFieldKey, item.text || '', _zcFieldStyle, fonts, {
            fieldKey: _zcFieldKey, x: item.x, y: item.y, baseCoord: _zcBaseCoord, maxW: _zcColW,
            wrap: false, drawEmptyLines: false, setMaxWidth: false,
          });
          boxes[_zcFieldKey] = box;
          runs.push(...r);
        });
      } else {
        let _commodityText = Array.isArray(_ov.commodity) ? _ov.commodity.join('\n') : bol.commodity_description;
        if (_commodityText && bol.siplast) {
          // Siplast products: prefix the SKU inside parens, e.g. (HB-10) -> (Siplast HB-10)
          _commodityText = String(_commodityText).replace(/\(([^)]+)\)/g, '(Siplast $1)');
        }
        const _commodityHasBoxSize = _style.commodity && _style.commodity.size != null;
        const _commodityCoord = _commodityHasBoxSize
          ? { ...COORDS.commodity }
          : (() => { const _tier = pickCommodityTier(String(_commodityText || ''), fonts.regular); return { ...COORDS.commodity, size: _tier.size, lineH: _tier.lineH }; })();
        multilineFieldLayout('commodity', _commodityText, _commodityCoord, { center: true });
      }
    }

    return { runs, boxes, displayDate };
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
      let cursive = null;
      if (scriptFontBytes && window.fontkit) {
        try {
          templateDoc.registerFontkit(window.fontkit);
          cursive = await templateDoc.embedFont(scriptFontBytes);
        } catch (_fe) { cursive = null; }
      }
      const black = rgb(0, 0, 0);
      const red = rgb(1, 0, 0);
      const colorFor = (tag) => (tag === 'red' ? red : black);
      const fontsByKey = { regular: font, bold: fontBold, italic: fontItalic, boldItalic: fontBoldItalic };

      const drawUnderline = (text, x, y, size, drawFont, color) => {
        const w = drawFont.widthOfTextAtSize(String(text), size);
        const uy = y - Math.max(1, size * 0.12);
        const thickness = Math.max(0.5, size * 0.06);
        page.drawLine({ start: { x, y: uy }, end: { x: x + w, y: uy }, thickness, color });
      };

      // ── Every editable field (bol-wysiwyg-01): layoutBol is the single source of truth for
      // placement, tier sizing, wrapping and style resolution — the WYSIWYG editors (bol-wysiwyg-
      // 02/03) call the exact same function to draw their overlay and size their edit boxes, so the
      // PDF and the editor can never drift apart again. ──
      const { runs, displayDate: _displayDate } = layoutBol(bol, fontsByKey);
      runs.forEach((run) => {
        const runFont = fontsByKey[run.fontKey];
        const color = colorFor(run.color);
        const o = { x: run.x, y: run.y, size: run.size, font: runFont, color };
        if (run.maxWidth !== undefined) o.maxWidth = run.maxWidth;
        page.drawText(run.text, o);
        if (run.underline) drawUnderline(run.text, o.x, o.y, run.size, runFont, color);
      });

      // ── Shipper signature (cursive, all copies) — not in FIELD_MAP (not editable), so this stays
      // outside layoutBol and draws directly, unchanged. ──
      if (bol.shipper_name && cursive) {
        page.drawText(String(bol.shipper_name), {
          x: COORDS.shipperSignature.x,
          y: COORDS.shipperSignature.y,
          size: COORDS.shipperSignature.size || 22,
          font: cursive,
          color: black,
        });
      }

      // ── Ship date next to shipper signature (auto-populated; regular font; not in FIELD_MAP) ──
      if (_displayDate) page.drawText(_displayDate, { x: COORDS.shipperDate.x, y: COORDS.shipperDate.y, size: COORDS.shipperDate.size, font, color: black });

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

  // Formats an ISO 'YYYY-MM-DD' date as 'MM/DD/YYYY'; passes through anything else unchanged.
  // Hoisted to module scope (bol-wysiwyg-01) so layoutBol can reuse it for the shipper-date line —
  // previously an inline arrow re-declared on every generatePdf() call. Mirrors bolShared.ts's
  // already-top-level export of the same name.
  function formatBolDate(iso) {
    if (!iso) return '';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[2]}/${m[3]}/${m[1]}` : String(iso);
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
    getLayoutFonts,
    layoutField,
    layoutBol,
    generatePdf,
    openPdf,
    buildShipToLines,
    wrapText,
    formatBolDate,
    confirmNoBolNumber,
  };

})();
