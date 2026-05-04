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
  const INCH_RE = '["”]';

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
   * Handles optional ATTN line before the street address.
   */
  function parseShipTo(rows) {
    const st = { company: '', attention: '', street: '', city: '', state: '', zip: '' };
    const r = rows.filter(t => t && !/^SHIP\s+TO$/i.test(t.trim()));
    let i = 0;
    if (i < r.length && /^ATTN:/i.test(r[i])) {
      st.attention = r[i++].replace(/^ATTN:\s*/i, '').trim();
    } else {
      st.company = (r[i++] || '').trim();
      if (i < r.length && /^ATTN:/i.test(r[i])) {
        st.attention = r[i++].replace(/^ATTN:\s*/i, '').trim();
      }
    }
    if (i < r.length) st.street = r[i++].trim();
    if (i < r.length) parseCityStateLine(r[i++], st);
    if (i < r.length && /^\d{5}(-\d{4})?$/.test(r[i].trim())) st.zip = r[i].trim();
    return st;
  }

  // ─── Line item parsing ────────────────────────────────────────────────────

  /**
   * A line is a "product category header" when its rightmost item is a pure
   * integer (the quantity) with a large x-gap separating it from the description.
   * This mimics the right-aligned QTY column in the packing slip layout.
   */
  function isItemHeader(sortedItems) {
    if (sortedItems.length < 2) return false;
    const last = sortedItems[sortedItems.length - 1];
    if (!/^\d+$/.test(last.text.trim())) return false;
    const prev = sortedItems[sortedItems.length - 2];
    const gap = last.x - (prev.x + (prev.width || prev.text.length * 5.5));
    return gap > 50;
  }

  /**
   * Parse all line items from groups below the DESCRIPTION/QTY header line.
   * Each item spans 2–3 lines: category+qty, description, LABEL±dimensions.
   */
  function parseLineItems(groups, descriptionY) {
    const items = [];
    let current = null;

    // Only process lines that appear below the DESCRIPTION header (lower y in PDF coords)
    const relevant = groups
      .filter(lg => lg.y < descriptionY)
      .sort((a, b) => b.y - a.y); // top-to-bottom

    for (const lg of relevant) {
      const sorted = [...lg.items].sort((a, b) => a.x - b.x);
      const lineText = reconstructLine(sorted).trim();
      if (!lineText) continue;

      if (isItemHeader(sorted)) {
        // Start a new line item
        if (current) items.push(current);
        const qty = parseInt(sorted[sorted.length - 1].text, 10);
        const category = reconstructLine(sorted.slice(0, -1)).trim();
        current = { category, description: '', label: '', dimensions: '', quantity: qty };

      } else if (current) {
        if (!current.description && /Foam Block/i.test(lineText)) {
          current.description = lineText;

        } else if (/^NO\s+LABEL\s*-/i.test(lineText)) {
          // "NO LABEL - 54-3/4" x 90-3/4" x 7""
          const m = lineText.match(/^NO\s+LABEL\s*-\s*(.*)/i);
          if (m) { current.label = 'NO LABEL'; current.dimensions = m[1].trim(); }

        } else if (/LABEL\s*[–\-]/i.test(lineText)) {
          // "LABEL – LabelName - Dimensions"
          // The en dash (U+2013) separates LABEL from the label name.
          // The label name and dimensions are always on the same line, separated by " - ".
          const m = lineText.match(/LABEL\s*[–\-]\s*(.*)/i);
          if (m) {
            const rest = m[1].trim();
            // Split on " - " before the dimension number (e.g. "Stock - 54-3/4"...")
            const split = rest.match(/^(.+?)\s+-\s+(\d.*)/);
            if (split) {
              current.label      = split[1].trim();
              current.dimensions = split[2].trim();
            } else if (isDimensionLine(rest)) {
              // No label name prefix — dimensions only
              current.dimensions = rest;
            } else {
              // Label name only; dimensions expected on next line (fallback)
              current.label = rest.replace(/\s*-\s*$/, '').trim();
            }
          }

        } else if (current.label && !current.dimensions && isDimensionLine(lineText)) {
          // Dimensions on their own line (fallback for unusual layouts)
          current.dimensions = lineText;
        }
      }
    }

    if (current) items.push(current);
    return items;
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

    // Group items into lines, sort top-to-bottom, sort items within each line left-to-right
    const groups = groupByY(rawItems, 3);
    groups.sort((a, b) => b.y - a.y);
    for (const g of groups) g.items.sort((a, b) => a.x - b.x);

    const lines = groups.map(g => ({
      y: g.y,
      items: g.items,
      text: reconstructLine(g.items),
    }));

    // ── Locate key section boundaries ────────────────────────────────────────

    let billToIdx      = -1; // "BILL TO / SHIP TO / INVOICE #" header line
    let shipDateHdrIdx = -1; // "SHIP DATE / SHIP VIA / WITH PHONE # / PURCHASE ORDER" header
    let descriptionIdx = -1; // "DESCRIPTION / QTY" header line

    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].text;
      if (/BILL\s+TO/i.test(t) && /SHIP\s+TO/i.test(t)) billToIdx = i;
      if (/SHIP\s+DATE/i.test(t) && /SHIP\s+VIA/i.test(t)) shipDateHdrIdx = i;
      if (/^\s*DESCRIPTION\b/i.test(t) && /\bQTY\b/i.test(t)) descriptionIdx = i;
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
    //
    // Header row:  SHIP DATE   SHIP VIA   WITH PHONE #   PURCHASE ORDER
    // Value row:   05/12/2026  carrier    Trish Nicholson  AD050426-4
    // Phone row:                          954/785-7557

    if (shipDateHdrIdx >= 0) {
      const hdrLine = lines[shipDateHdrIdx];
      const valIdx  = shipDateHdrIdx + 1;

      // Locate x positions of column headers for positional extraction
      let contactHdrX = null;
      let poHdrX      = null;

      for (const it of hdrLine.items) {
        if (/PHONE/i.test(it.text) && contactHdrX === null) contactHdrX = it.x;
        if (/PURCHASE/i.test(it.text) && poHdrX === null) poHdrX = it.x;
      }

      if (valIdx < lines.length) {
        const valItems = [...lines[valIdx].items].sort((a, b) => a.x - b.x);

        // Ship date: leftmost item
        if (valItems.length >= 1) data.ship_date = valItems[0].text.trim();

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
          // Fallback: use position in item list
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
              if (/[\d\/]{7,}/.test(it.text)) { data.contact_phone = it.text.trim(); break; }
            }
          }
        }
      }
    }

    // ── Bill to / Ship to address blocks ─────────────────────────────────────
    //
    // Both columns appear in lines below the "BILL TO / SHIP TO" header.
    // We split items by x position: left of mid → bill_to, right of mid → ship_to.
    // Items on the same y are merged per-column before being passed to address parsers.

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

        // Address section ends just above the SHIPMENT CONTACT or SHIP DATE header
        const addrEndLine = lines.find(l =>
          l.y < startY && (/SHIPMENT\s+CONTACT/i.test(l.text) || /SHIP\s+DATE/i.test(l.text))
        );
        const endY = addrEndLine ? addrEndLine.y : -Infinity;

        // Collect per-line text for each column (merge items on the same y per column)
        const billRows = [];
        const shipRows = [];

        const addrGroups = groups
          .filter(g => g.y < startY && g.y > endY)
          .sort((a, b) => b.y - a.y); // top-to-bottom

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
        const pdf  = await lib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        const tc   = await page.getTextContent();

        const rawItems = tc.items
          .filter(item => item.str.trim())
          .map(item => ({
            text:  item.str,
            x:     item.transform[4],
            y:     item.transform[5],
            width: item.width || 0,
          }));

        const data = parseDoc(rawItems);
        return { success: true, data };
      } catch (err) {
        return { success: false, error: err.message || 'Could not extract text from PDF' };
      }
    },
  };

})();
