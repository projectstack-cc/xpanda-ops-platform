/**
 * packing-slip-parser.js
 * Client-side parser for XPanda Foam packing slip PDFs (generated from QuickBooks).
 * Uses pdf.js (loaded from CDN) to extract positioned text, then reconstructs
 * a layout-aware representation for field extraction.
 *
 * Usage:
 *   const result = await window.PackingSlipParser.parse(fileObject);
 *   if (result.success) { ... result.data ... }
 *   else { ... result.error ... }
 */

window.PackingSlipParser = (function () {

  const PDF_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs';
  const WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs';

  let _pdfjs = null;

  async function loadPdfJs() {
    if (_pdfjs) return _pdfjs;
    const mod = await import(PDF_JS_URL);
    mod.GlobalWorkerOptions.workerSrc = WORKER_URL;
    _pdfjs = mod;
    return _pdfjs;
  }

  // ─── Text layout reconstruction ──────────────────────────────────────────

  /**
   * Group raw text items by y-coordinate within a tolerance window.
   * Items on the "same line" have y values within `tol` units of each other.
   */
  function groupByY(items, tol) {
    const groups = [];
    for (const item of items) {
      let matched = false;
      for (const g of groups) {
        if (Math.abs(g.y - item.y) <= tol) {
          g.items.push(item);
          matched = true;
          break;
        }
      }
      if (!matched) groups.push({ y: item.y, items: [item] });
    }
    return groups;
  }

  /**
   * Reconstruct a text line from left-to-right sorted items.
   * Spaces between items are proportional to the x-gap, approximating
   * the layout produced by `pdftotext -layout`.
   */
  function reconstructLine(sortedItems) {
    if (!sortedItems.length) return '';
    let result = sortedItems[0].text;
    let prevRight = sortedItems[0].x + (sortedItems[0].width || sortedItems[0].text.length * 5.5);
    for (let i = 1; i < sortedItems.length; i++) {
      const gap = sortedItems[i].x - prevRight;
      const spaces = gap > 5 ? Math.max(2, Math.min(40, Math.round(gap / 5))) : 1;
      result += ' '.repeat(spaces) + sortedItems[i].text;
      prevRight = sortedItems[i].x + (sortedItems[i].width || sortedItems[i].text.length * 5.5);
    }
    return result;
  }

  // ─── Dimension detection ─────────────────────────────────────────────────

  // QuickBooks PDFs encode the inch mark as U+201D (right double quotation mark),
  // not standard ASCII U+0022. Both are accepted here for robustness.
  const INCH_RE = '[""]';

  // Matches patterns like: 54-3/4" x 90-3/4" x 8" (with either " variant)
  const DIM_PATTERN = new RegExp(`\\d[\\d\\-\\/]*${INCH_RE}(\\s*[xX×]\\s*\\d[\\d\\-\\/]*${INCH_RE})+`);

  function isDimensionLine(text) {
    return DIM_PATTERN.test(text);
  }

  // ─── Address block parsers ────────────────────────────────────────────────

  function parseCityStateLine(text, obj) {
    const m = text.match(/^(.+?),?\s+([A-Z]{2})\s*$/);
    if (m) { obj.city = m[1].trim(); obj.state = m[2]; }
    else obj.city = text.trim();
  }

  /**
   * Parse an ordered array of text rows (one string per line, top-to-bottom)
   * representing the BILL TO column into a structured object.
   */
  function parseBillTo(rows) {
    const bt = { company: '', street: '', city: '', state: '', zip: '' };
    const r = rows.filter(t => t && !/^BILL\s+TO$/i.test(t.trim()));
    let i = 0;
    if (i < r.length) bt.company = r[i++].trim();
    if (i < r.length) bt.street  = r[i++].trim();
    if (i < r.length) parseCityStateLine(r[i++], bt);
    if (i < r.length && /^\d{5}(-\d{4})?$/.test(r[i].trim())) bt.zip = r[i].trim();
    return bt;
  }

  /**
   * Parse an ordered array of text rows representing the SHIP TO column.
   * Works backwards from city/state/zip to handle multi-line building names
   * and "Attn:" appearing mid-block.
   */
  function parseShipTo(rows) {
    const st = { company: '', attention: '', street: '', city: '', state: '', zip: '' };
    const r = rows.filter(t => t && !/^SHIP\s+TO$/i.test(t.trim()));
    if (!r.length) return st;

    // Step 1: Find the city/state/zip line (work backwards from the bottom)
    let cityStateIdx = -1;
    let zipIdx = -1;

    for (let i = r.length - 1; i >= 0; i--) {
      const line = r[i].trim();
      if (/^\d{5}(-\d{4})?$/.test(line)) {
        zipIdx = i;
        st.zip = line;
        continue;
      }
      const csz = line.match(/^(.+?),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
      if (csz) {
        cityStateIdx = i;
        st.city = csz[1].trim();
        st.state = csz[2];
        st.zip = csz[3];
        break;
      }
      const cs = line.match(/^(.+?),?\s+([A-Z]{2})$/);
      if (cs && cs[1].length > 1) {
        cityStateIdx = i;
        st.city = cs[1].trim();
        st.state = cs[2];
        break;
      }
    }

    // Step 2: Find the street address line (the line before city/state, that looks like a street)
    const endIdx = cityStateIdx >= 0 ? cityStateIdx : (zipIdx >= 0 ? zipIdx : r.length);
    let streetIdx = -1;

    for (let i = endIdx - 1; i >= 0; i--) {
      const line = r[i].trim();
      if (/^\d+\s/.test(line) || /\b(St|Rd|Ave|Blvd|Dr|Ln|Lane|Ct|Way|Pkwy|Terrace|Circle|Place|Highway|Hwy)\b/i.test(line)) {
        streetIdx = i;
        st.street = line;
        break;
      }
    }

    // Step 3: Find Attn line
    let attnIdx = -1;
    for (let i = 0; i < endIdx; i++) {
      if (/^Attn:/i.test(r[i].trim())) {
        attnIdx = i;
        let attnText = r[i].replace(/^Attn:\s*/i, '').trim();
        if (i + 1 < endIdx && i + 1 !== streetIdx && /^[&a-zA-Z]/.test(r[i + 1].trim()) && !/^\d/.test(r[i + 1].trim())) {
          attnText += ' ' + r[i + 1].trim();
          attnIdx = i + 1;
        }
        st.attention = attnText;
        break;
      }
    }

    // Step 4: Everything before Attn (or before street if no Attn) is the company name
    let compEndIdx = endIdx;
    const firstAttnIdx = r.findIndex(l => /^Attn:/i.test(l.trim()));
    if (firstAttnIdx >= 0) compEndIdx = Math.min(compEndIdx, firstAttnIdx);
    if (streetIdx >= 0) compEndIdx = Math.min(compEndIdx, streetIdx);

    const companyLines = r.slice(0, Math.max(1, compEndIdx)).map(l => l.trim());
    st.company = companyLines.join(' ').trim();

    if (!st.zip && cityStateIdx < 0) {
      const lastLine = r[r.length - 1].trim();
      const zipMatch = lastLine.match(/(\d{5}(-\d{4})?)$/);
      if (zipMatch) st.zip = zipMatch[1];
    }

    return st;
  }

  // ─── Line item parsing ────────────────────────────────────────────────────

  /**
   * A line is a "product category header" when its rightmost item is a pure
   * integer (the quantity, possibly with commas) with a large x-gap separating
   * it from the description.
   */
  function isItemHeader(sortedItems) {
    if (sortedItems.length < 2) return false;
    const last = sortedItems[sortedItems.length - 1];
    const qtyText = last.text.trim().replace(/,/g, '');
    if (!/^\d+$/.test(qtyText)) return false;
    const prev = sortedItems[sortedItems.length - 2];
    const gap = last.x - (prev.x + (prev.width || prev.text.length * 5.5));
    return gap > 50;
  }

  /**
   * Parse all line items from groups below the DESCRIPTION/QTY header line.
   * Handles diverse product types: Block Foam, Laminates, Holey Board, Plugs, etc.
   * Filters out "notes" pseudo-items and zero-quantity items.
   */
  // Extract a Holey Board thickness (the trailing inch value) from an item's text.
  // Strips parenthetical footprints like (24" x 48") first, then takes the LAST
  // `x <num>"` token. Requires an inch mark (straight/curly/double-prime) so foot
  // marks (2' x 4') are ignored. Returns a number or null.
  function extractThickness(text) {
    if (!text) return null;
    const stripped = String(text).replace(/\([^)]*\)/g, ' ');
    const m = [...stripped.matchAll(/(\d+(?:\.\d+)?)\s*["\u201C\u201D\u2033]/g)];
    if (!m.length) return null;
    const t = parseFloat(m[m.length - 1][1]);
    return isNaN(t) ? null : t;
  }

  // ─── Page-break reassembly ────────────────────────────────────────────────

  // A packing-slip row's description and its trailing QTY column can land on opposite sides
  // of a PDF page break: pdf.js renders them as two separate y-groups (the QTY re-flows onto
  // the next page as a lone row containing just the integer). Detect that pattern — a
  // non-header row immediately followed by a row that is nothing but a bare 1-4 digit number —
  // and splice the bare quantity back onto the description row as its trailing QTY item so the
  // normal isItemHeader() detection picks the merged row up as one logical line item.
  function reassemblePageBreaks(rows) {
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const sorted = [...row.items].sort((a, b) => a.x - b.x);
      const text = reconstructLine(sorted).trim();

      // Require the description row to actually look like a piece line (has a thickness
      // token) before considering the next row for a merge — otherwise a stray page-number
      // row after ordinary prose (both single-item, non-header rows) would be merged into a
      // fabricated line item with a bogus quantity.
      if (text && extractThickness(text) != null && !isItemHeader(sorted) && i + 1 < rows.length) {
        const nextSorted = [...rows[i + 1].items].sort((a, b) => a.x - b.x);
        const nextText = reconstructLine(nextSorted).trim().replace(/,/g, '');
        const isBareQty = nextSorted.length === 1 && /^\d{1,4}$/.test(nextText);

        if (isBareQty) {
          const last = sorted[sorted.length - 1];
          const lastRight = last.x + (last.width || last.text.length * 5.5);
          out.push({
            y: row.y,
            items: [...row.items, { ...nextSorted[0], x: lastRight + 60 }],
          });
          i++; // consume the bare-qty row — it has been merged into this row
          continue;
        }
      }

      out.push(row);
    }
    return out;
  }

  // ─── Offload zone detection ───────────────────────────────────────────────
  // lbz-parse-01: some customer packing slips break a job into delivery "zones" — pieces must
  // be offloaded/labeled in a specific sequence per drop area. Two real wordings are known
  // (see Prompts/lbz-parse-01.md); add a new one as a single entry in each list below rather
  // than special-casing it elsewhere.
  const ZONE_ORDINAL_WORDS = { FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6 };

  const ZONE_ORDINAL_PATTERNS = [
    /OFFLOAD\s+(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH)\b/i,
    /(FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH)\s+TO\s+DELIVER/i,
  ];

  const ZONE_LABEL_PATTERNS = [
    /Label\s*&\s*segregate\s+as:\s*(.+)/i,
    /LABEL\s+as\s+(.+)/i,
  ];

  // A zone-density group's piece count can be embedded in the packing slip as "{27 pieces}" —
  // real slips have also been seen with a stray ")" closing the brace instead of "}".
  const ZONE_BRACE_PIECES_RE = /\{\s*(\d+)\s*pieces?\s*[\}\)]/i;

  // 2' x 4' holey board = 8 board-feet per inch of thickness (the only board size these slips
  // use for zoned Holey Board orders).
  const BDFT_PER_INCH_2X4 = 8;

  function extractZoneOrdinal(text) {
    if (!text) return null;
    for (const re of ZONE_ORDINAL_PATTERNS) {
      const m = text.match(re);
      if (m) {
        const n = ZONE_ORDINAL_WORDS[m[1].toUpperCase()];
        if (n) return n;
      }
    }
    return null;
  }

  // Trim, strip a trailing run of "-"/">"/whitespace (format A ends labels with "-"; format
  // B's ordinal markers use ">" and the label capture is greedy enough to matter if a variant
  // ever puts one after the label), collapse internal whitespace. Key = uppercase of the same
  // normalized string, so "Ambulance Canopy" / "AMBULANCE CANOPY -" map to one zone.
  function normalizeZoneLabel(raw) {
    return String(raw || '')
      .replace(/[\s\-–—>]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractZoneLabel(text) {
    if (!text) return null;
    for (const re of ZONE_LABEL_PATTERNS) {
      const m = text.match(re);
      if (m) {
        const display = normalizeZoneLabel(m[1]);
        if (display) return { display, key: display.toUpperCase() };
      }
    }
    return null;
  }

  function extractBracePieceCount(text) {
    if (!text) return null;
    const m = text.match(ZONE_BRACE_PIECES_RE);
    return m ? parseInt(m[1], 10) : null;
  }

  function extractDensityValue(text) {
    if (!text) return null;
    const m = String(text).match(/(\d+(?:\.\d+)?)\s*#/);
    return m ? parseFloat(m[1]) : null;
  }

  /**
   * Walk the parsed line items in document order, detecting "OFFLOAD <ordinal> ... Label &
   * segregate as: <ZONE> -" / "<ordinal> TO DELIVER > ... LABEL as <ZONE>" marker rows, the
   * BDFT-total row that (usually) follows, and the per-thickness piece rows that follow that.
   * Tags each piece row with offload_seq / zone_label / zone_bdft, drops the marker and
   * BDFT-total declaration rows (neither is a real line item), and returns per-zone-density-
   * group checksum warnings plus a warning for any zone whose ordinal was never stated. Items
   * outside any zone context pass through completely unchanged — a slip with no OFFLOAD/LABEL
   * wording anywhere produces identical items to before this function existed.
   */
  function tagOffloadZones(items) {
    const zoneInfo = new Map();   // key -> { display, seq }
    const warnings = [];
    const tagged   = [];

    let pending         = null;   // { key, display } — zone currently open
    let awaitingSummary = false;  // next no-thickness row may declare this group's BDFT total
    let group            = null;  // { baseline, sum } — open BDFT-total group awaiting checksum

    function closeGroup() {
      if (group && group.baseline != null && Math.round(group.sum) !== Math.round(group.baseline)) {
        warnings.push({
          type: 'checksum_mismatch',
          zone_label: pending ? pending.display : null,
          expected_bdft: group.baseline,
          computed_bdft: group.sum,
        });
      }
      group = null;
    }

    for (const item of items) {
      const headerText = item.category || '';
      const ord = extractZoneOrdinal(headerText);
      const lbl = extractZoneLabel(headerText);

      if (ord != null || lbl != null) {
        closeGroup();
        const key = lbl ? lbl.key : (pending ? pending.key : null);
        if (key) {
          const display = lbl ? lbl.display : pending.display;
          pending = { key, display };
          const info = zoneInfo.get(key) || { display, seq: null };
          if (!info.display) info.display = display;
          if (ord != null && info.seq == null) info.seq = ord;
          zoneInfo.set(key, info);
        }
        awaitingSummary = true;
        continue; // marker rows aren't real line items
      }

      if (!pending) { tagged.push(item); continue; } // not inside any zone context

      const wasAwaitingSummary = awaitingSummary;
      awaitingSummary = false;

      const thk   = extractThickness(item._rawText);
      const brace = extractBracePieceCount(item._rawText);

      if (thk != null) {
        // Piece row.
        if (brace != null) {
          // Self-contained: the row's own QTY column is the BDFT for this single row; the
          // real piece count is the {N pieces} brace.
          const bdft = item.quantity;
          const expected = thk * brace * BDFT_PER_INCH_2X4;
          if (Math.round(expected) !== Math.round(bdft)) {
            warnings.push({
              type: 'checksum_mismatch', zone_label: pending.display,
              expected_bdft: bdft, computed_bdft: expected,
            });
          }
          item.quantity  = brace;
          item.zone_bdft = bdft;
        } else if (group) {
          group.sum += thk * item.quantity * BDFT_PER_INCH_2X4;
          item.zone_bdft = group.baseline;
        } else {
          // Single-line density group with no separate BDFT-total row (e.g. format A's 2.0#
          // "6" pieces" line) — QTY is already the real piece count; nothing to check.
          item.zone_bdft = null;
        }
        item.thickness   = thk;
        item.offload_seq = zoneInfo.get(pending.key).seq;
        item.zone_label  = pending.display;
        item._zoneKey    = pending.key;
        tagged.push(item);
        continue;
      }

      // No thickness: a BDFT-total declaration row if we just saw a marker, else an unrelated
      // description line (passes through untouched).
      if (wasAwaitingSummary) {
        group = { baseline: item.quantity, sum: 0 };
        continue; // BDFT-total rows aren't real line items
      }

      tagged.push(item);
    }

    closeGroup();

    for (const info of zoneInfo.values()) {
      if (info.seq == null) warnings.push({ type: 'missing_ordinal', zone_label: info.display });
    }

    // Final pass: resolve every tagged piece row's seq/label from zoneInfo. A zone's ordinal
    // can be stated on any of its density groups (format B states it only on the first); this
    // makes the resolved seq authoritative regardless of which group it was seen on.
    for (const item of tagged) {
      if (item._zoneKey) {
        const info = zoneInfo.get(item._zoneKey);
        item.offload_seq = info.seq;
        item.zone_label  = info.display;
        delete item._zoneKey;
      }
    }

    return { items: tagged, zonesFound: zoneInfo.size, warnings };
  }

  // Flags a line whose category density ("Holey Board:2.0#") disagrees with the density
  // stated in its own description text ("Holey Board 1.0#") — both wordings appear on real
  // slips and, when they disagree, the correct density needs a human call before job create.
  function tagDensityConflicts(items) {
    for (const item of items) {
      const catDensity  = extractDensityValue(item.category);
      const descDensity = extractDensityValue(item.description);
      if (catDensity != null && descDensity != null && Math.abs(catDensity - descDensity) > 1e-9) {
        item.density_conflict = { category_density: catDensity, description_density: descDensity };
      }
    }
    return items;
  }

  function parseLineItems(groups, descriptionY) {
    const items = [];
    let current = null;

    const relevant = groups
      .filter(lg => lg.y < descriptionY)
      .sort((a, b) => b.y - a.y);

    const reassembled = reassemblePageBreaks(relevant);

    for (const lg of reassembled) {
      const sorted = [...lg.items].sort((a, b) => a.x - b.x);
      const lineText = reconstructLine(sorted).trim();
      if (!lineText) continue;

      // Skip repeated DESCRIPTION/QTY headers on subsequent pages
      if (/^\s*DESCRIPTION\b/i.test(lineText) && /\bQTY\b/i.test(lineText)) continue;

      // Stop at boilerplate/legal sections at page bottom
      if (/Commodities requiring/i.test(lineText)) break;
      if (/NOTE:\s*Liability/i.test(lineText)) break;
      if (/Customer acknowledges/i.test(lineText)) break;
      if (/certify that/i.test(lineText)) break;
      if (/Carrier Signature/i.test(lineText)) break;
      if (/Shipper Signature/i.test(lineText)) break;

      if (isItemHeader(sorted)) {
        if (current) items.push(current);
        const qty = parseInt(sorted[sorted.length - 1].text.replace(/,/g, ''), 10);
        const category = reconstructLine(sorted.slice(0, -1)).trim();
        const isNotes = /^notes\b/i.test(category);

        current = {
          category,
          description: '',
          label: '',
          dimensions: '',
          quantity: qty,
          _isNotes: isNotes,
          _descLines: [],
        };

      } else if (current) {
        if (current._isNotes) continue;

        // Extract dimensions if not yet found
        const dimMatch = lineText.match(/(\d[\d.\/\-]*)\s*[""”]?\s*[xX×]\s*(\d[\d.\/\-]*)\s*[""”]?\s*[xX×]\s*(\d[\d.\/\-]*)\s*[""”]?/);
        if (dimMatch && !current.dimensions) {
          current.dimensions = dimMatch[0].trim();
        }

        // Collect description lines (skip bundle info and label instructions)
        if (!/^\d+\s*pieces?\s*per\s*bundle/i.test(lineText) &&
            !/^LABEL\s+AS\s+INDICATED/i.test(lineText) &&
            !/^NO\s+LABEL/i.test(lineText)) {
          current._descLines.push(lineText);
        }

        // Detect specific product description patterns
        if (!current.description) {
          if (/Foam Block/i.test(lineText)) {
            current.description = lineText;
          } else if (/Laminate/i.test(lineText) && !/specify Laminate type/i.test(lineText)) {
            current.description = lineText;
          } else if (/Holey Board/i.test(lineText)) {
            current.description = lineText;
          } else if (/Insulperm/i.test(lineText)) {
            current.description = lineText;
          }
        }
      }
    }

    if (current) items.push(current);

    return items
      .filter(item => {
        if (item._isNotes) return false;
        if (/credit card|processing fee/i.test((item.category || '') + ' ' + (item._descLines || []).join(' ') + ' ' + (item.description || ''))) return false;
        if (!item.quantity || item.quantity <= 0) return false;
        return true;
      })
      .map(item => {
        if (!item.description && item._descLines.length) {
          item.description = item._descLines
            .filter(l => !/^\d+\s*pieces?\s*per/i.test(l))
            .join(' — ')
            .slice(0, 200);
        }
        item.qty_unit = /BDFT\s*per\s*piece/i.test(item._descLines.join(' ')) ? 'bdft' : 'pcs';
        // Holey Board / Insulperm: capture trailing thickness for height-keyed part matching.
        const _thkSrc = [item.category, item.description, ...(item._descLines || [])].join(' ');
        if (/holey board|insulperm/i.test(_thkSrc)) {
          const _thk = extractThickness(_thkSrc);
          if (_thk != null) item.thickness = _thk;
        }
        // lbz-parse-01: full row text for offload-zone / density-conflict detection — consumed
        // and deleted by tagOffloadZones()/parseDoc() below, never reaches the caller.
        item._rawText = _thkSrc;
        delete item._isNotes;
        delete item._descLines;
        return item;
      });
  }

  // ─── Main document parser ─────────────────────────────────────────────────

  function parseDoc(rawItems) {
    const data = {
      invoice_number: '',
      date: '',
      bill_to:       { company: '', street: '', city: '', state: '', zip: '' },
      ship_to:       { company: '', attention: '', street: '', city: '', state: '', zip: '' },
      ship_date:     '',
      ship_via:      '',
      contact_name:  '',
      contact_phone: '',
      po_number:     '',
      line_items:    [],
    };

    const groups = groupByY(rawItems, 3);
    groups.sort((a, b) => b.y - a.y);
    for (const g of groups) g.items.sort((a, b) => a.x - b.x);

    const lines = groups.map(g => ({
      y: g.y,
      items: g.items,
      text: reconstructLine(g.items),
    }));

    // ── Locate key section boundaries ────────────────────────────────────────

    let billToIdx      = -1;
    let shipDateHdrIdx = -1;
    let descriptionIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].text;
      if (/BILL\s+TO/i.test(t) && /SHIP\s+TO/i.test(t)) billToIdx = i;
      if (/SHIP\s+DATE/i.test(t) && (/SHIP\s+VIA/i.test(t) || /SHIPMENT\s+CONTACT/i.test(t) || /PHONE/i.test(t))) shipDateHdrIdx = i;
      if (/^\s*DESCRIPTION\b/i.test(t) && /\bQTY\b/i.test(t) && descriptionIdx < 0) descriptionIdx = i;
    }

    // ── Invoice number (right side of BILL TO header line) ────────────────────

    if (billToIdx >= 0) {
      const m = lines[billToIdx].text.match(/INVOICE\s*#\s*(\S+)/i);
      if (m) data.invoice_number = m[1].trim();
    }

    // ── Invoice date (line immediately below BILL TO header) ─────────────────

    if (billToIdx >= 0 && billToIdx + 1 < lines.length) {
      const m = lines[billToIdx + 1].text.match(/DATE\s+(\d{2}\/\d{2}\/\d{4})/i);
      if (m) data.date = m[1].trim();
    }

    // ── Ship date, ship via, contact name/phone, PO number ───────────────────

    if (shipDateHdrIdx >= 0) {
      const hdrLine = lines[shipDateHdrIdx];
      const valIdx  = shipDateHdrIdx + 1;

      let contactHdrX = null;
      let poHdrX      = null;

      for (const it of hdrLine.items) {
        if (/PHONE/i.test(it.text) && contactHdrX === null) contactHdrX = it.x;
        if (/PURCHASE/i.test(it.text) && poHdrX === null) poHdrX = it.x;
      }

      if (valIdx < lines.length) {
        const valItems = [...lines[valIdx].items].sort((a, b) => a.x - b.x);

        // Ship date: find item matching date pattern
        for (const it of valItems) {
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(it.text.trim())) {
            data.ship_date = it.text.trim();
            break;
          }
        }

        if (contactHdrX !== null && poHdrX !== null) {
          const contactPoMid = (contactHdrX + poHdrX) / 2;
          const shipViaParts = [];
          const contactParts = [];
          const poParts      = [];

          for (const it of valItems.slice(1)) {
            if (it.x < contactHdrX - 20) {
              shipViaParts.push(it.text.trim());
            } else if (it.x < contactPoMid) {
              contactParts.push(it.text.trim());
            } else {
              poParts.push(it.text.trim());
            }
          }

          data.ship_via     = shipViaParts.join(' ').trim();
          data.contact_name = contactParts.join(' ').trim();
          data.po_number    = poParts.join(' ').trim();

        } else {
          if (valItems.length >= 2) data.ship_via = valItems[1].text.trim();
          if (valItems.length >= 4) {
            data.po_number    = valItems[valItems.length - 1].text.trim();
            data.contact_name = valItems.slice(2, -1).map(it => it.text.trim()).join(' ').trim();
          } else if (valItems.length === 3) {
            data.po_number = valItems[2].text.trim();
          }
        }

        // Contact phone: next line, in the contact column area
        if (valIdx + 1 < lines.length) {
          const phoneLine = lines[valIdx + 1];
          if (contactHdrX !== null) {
            const phoneItems = phoneLine.items.filter(it =>
              it.x >= contactHdrX - 30 && it.x < (poHdrX || Infinity)
            );
            data.contact_phone = phoneItems.map(it => it.text.trim()).join('').trim();
          } else {
            for (const it of phoneLine.items) {
              if (/[\d(][\d\/\-().ext\s]{6,}/.test(it.text)) { data.contact_phone = it.text.trim(); break; }
            }
          }
        }

        // Fallback PO extraction: rightmost non-phone, non-date item on the value line
        if (!data.po_number && valItems.length >= 2) {
          for (let vi = valItems.length - 1; vi >= 1; vi--) {
            const t = valItems[vi].text.trim();
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) continue;
            if (/^\d{3}[\-\/]\d{3}[\-\/]\d{4}/.test(t)) continue;
            if (/^CARRIER$/i.test(t)) continue;
            data.po_number = t;
            break;
          }
        }
      }
    }

    // ── Post-process contact name/phone ──────────────────────────────────────

    if (data.contact_name && data.contact_phone) {
      const trailingPhone = data.contact_name.match(/\s+([\d(]+[\d\-\/()]{0,5})$/);
      if (trailingPhone) {
        data.contact_phone = trailingPhone[1] + data.contact_phone;
        data.contact_name = data.contact_name.slice(0, -trailingPhone[0].length).trim();
      }
    }

    if (data.contact_name && !data.contact_phone) {
      const phoneInName = data.contact_name.match(/\s*(\(?\w?\)?\s*\d{3}[\-\/\.\s]\d{3}[\-\/\.\s]\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?)\s*$/i);
      if (phoneInName) {
        data.contact_phone = phoneInName[1].trim();
        data.contact_name = data.contact_name.slice(0, -phoneInName[0].length).trim();
      }
    }

    if (data.contact_phone) {
      data.contact_phone = data.contact_phone.replace(/\//g, '-').replace(/^\(c\)/i, '').trim();
    }

    // ── Bill to / Ship to address blocks ─────────────────────────────────────

    if (billToIdx >= 0) {
      const hdrItems = [...lines[billToIdx].items].sort((a, b) => a.x - b.x);
      let billToX = null, shipToX = null, invoiceX = null;

      for (const it of hdrItems) {
        if (/BILL/i.test(it.text) && billToX === null)    billToX  = it.x;
        if (/SHIP/i.test(it.text) && it.x > (billToX || -1) && shipToX === null) shipToX = it.x;
        if (/INVOICE/i.test(it.text) && invoiceX === null) invoiceX = it.x;
      }

      if (billToX !== null && shipToX !== null) {
        const mid            = (billToX + shipToX) / 2;
        const shipRightBound = invoiceX !== null ? invoiceX - 5 : Infinity;
        const startY         = lines[billToIdx].y;

        const addrEndLine = lines.find(l =>
          l.y < startY && (/SHIPMENT\s+CONTACT/i.test(l.text) || /SHIP\s+DATE/i.test(l.text))
        );
        const endY = addrEndLine ? addrEndLine.y : -Infinity;

        const billRows = [];
        const shipRows = [];

        const addrGroups = groups
          .filter(g => g.y < startY && g.y > endY)
          .sort((a, b) => b.y - a.y);

        for (const g of addrGroups) {
          const billItems = g.items.filter(it => it.x <= mid).sort((a, b) => a.x - b.x);
          const shipItems = g.items.filter(it => it.x > mid && it.x < shipRightBound).sort((a, b) => a.x - b.x);
          if (billItems.length) billRows.push(billItems.map(it => it.text).join(' ').trim());
          if (shipItems.length) shipRows.push(shipItems.map(it => it.text).join(' ').trim());
        }

        data.bill_to = parseBillTo(billRows);
        data.ship_to = parseShipTo(shipRows);
      }
    }

    // ── Line items ────────────────────────────────────────────────────────────

    if (descriptionIdx >= 0) {
      data.line_items = parseLineItems(groups, lines[descriptionIdx].y);
    }

    // lbz-parse-01: offload-zone detection (OFFLOAD <ordinal>/Label & segregate as: ... and
    // <ordinal> TO DELIVER >/LABEL as ... wordings) + density-conflict flagging. A slip with no
    // zone wording found leaves zoneResult.items === the input array untouched and
    // offload_zones_enabled === 0.
    const zoneResult = tagOffloadZones(data.line_items || []);
    data.line_items = zoneResult.items;
    data.offload_zones_enabled = zoneResult.zonesFound > 0 ? 1 : 0;
    data.offload_warnings = zoneResult.warnings;
    tagDensityConflicts(data.line_items);
    data.line_items.forEach(li => { delete li._rawText; });

    data.line_items = (data.line_items || []).filter(li => {
      const qty = parseFloat(li.quantity);
      return qty && qty > 0;
    });

    return data;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  return {
    /**
     * Parse a packing slip PDF File object.
     * @param {File} file - PDF file from an <input type="file"> element
     * @returns {Promise<{success: boolean, data?: object, error?: string}>}
     */
    parse: async function (file) {
      try {
        const lib = await loadPdfJs();
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await lib.getDocument({ data: arrayBuffer }).promise;
        const numPages = pdf.numPages;
        let rawItems = [];

        for (let p = 1; p <= numPages; p++) {
          const page = await pdf.getPage(p);
          const tc   = await page.getTextContent();
          const vp   = page.getViewport({ scale: 1 });
          const pageHeight = vp.height;
          const yOffset = (p - 1) * pageHeight;

          const pageItems = tc.items
            .filter(item => item.str.trim())
            .map(item => ({
              text:  item.str,
              x:     item.transform[4],
              y:     item.transform[5] - yOffset,
              width: item.width || 0,
              page:  p,
            }));

          rawItems = rawItems.concat(pageItems);
        }

        const data = parseDoc(rawItems);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: err.message || 'Could not extract text from PDF' };
      }
    },

    // lbz-parse-01: exposes parseDoc() (takes raw {text,x,y,width} items directly, skipping
    // pdf.js/file loading) plus the offload-zone helpers for the node test harness — there are
    // no reference PDF fixtures in the repo yet. Not used by any page at runtime.
    _internal: {
      parseDoc, tagOffloadZones, tagDensityConflicts, reassemblePageBreaks,
      extractZoneOrdinal, extractZoneLabel, normalizeZoneLabel, extractBracePieceCount,
      extractDensityValue, extractThickness, isItemHeader, reconstructLine,
    },
  };

})();
