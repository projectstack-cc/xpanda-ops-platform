window.BolShared = (function() {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════
  // COORDS — Single source of truth for PDF text placement
  // Copied exactly from bol-generator.html (the authoritative source)
  // If coords need updating, update ONLY this file going forward.
  // ═══════════════════════════════════════════════════════════════════

  const COORDS = {
    // Delivery time — top-right, bold red
    deliveryTime:  { x: 390, y: 758, size: 20 },

    // Top-right block
    date:          { x: 346, y: 712, size: 10 },
    bolNumber:     { x: 404, y: 693, size: 14, bold: true },
    carrierName:   { x: 389, y: 648, size: 10 },
    trailerNo:     { x: 365, y: 622, size: 10 },

    // Ship-to address (4 lines, indented under label)
    shipLine1:     { x: 95,  y: 615, size: 10 },
    shipLine2:     { x: 95,  y: 601, size: 10 },
    shipLine3:     { x: 95,  y: 587, size: 10 },
    shipLine4:     { x: 95,  y: 573, size: 10 },

    // Special Instructions
    specialInstr:  { x: 315, y: 585, size: 9, lineH: 12, maxW: 255 },

    // Contact Info
    contactInfo:   { x: 315, y: 525, size: 11, lineH: 12, maxW: 255 },

    // PO / Invoice Number
    poNumber:      { x: 315, y: 498, size: 11, lineH: 12, maxW: 255 },

    // Scrap Pick Up checkboxes
    scrapYes:      { x: 110, y: 513, size: 10 },
    scrapNo:       { x: 110, y: 497, size: 10 },

    // Commodity description
    commodity:     { x: 55,  y: 410, size: 13, lineH: 28, maxW: 510 },
  };

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

    const templateResp = await fetch('/logistics/assets/BLANK_BOL_Xpanda.pdf');
    if (!templateResp.ok) throw new Error('BOL template not found at /logistics/assets/BLANK_BOL_Xpanda.pdf');
    const templateBytes = await templateResp.arrayBuffer();

    const combinedPdf = await PDFDocument.create();

    for (const bol of bolRecords) {
      const templateDoc = await PDFDocument.load(templateBytes);
      const page = templateDoc.getPages()[0];
      const font = await templateDoc.embedFont(StandardFonts.Helvetica);
      const fontBold = await templateDoc.embedFont(StandardFonts.HelveticaBold);
      const black = rgb(0, 0, 0);

      const drawText = (text, coord, overrides = {}) => {
        if (!text && text !== 0) return;
        const o = {
          x:    overrides.x || coord.x,
          y:    overrides.y || coord.y,
          size: overrides.size || coord.size || 10,
          font: (coord.bold || overrides.bold) ? fontBold : font,
          color: overrides.color || black,
        };
        if (overrides.maxWidth || coord.maxW) o.maxWidth = overrides.maxWidth || coord.maxW;
        page.drawText(String(text), o);
      };

      const drawMultiline = (text, coord) => {
        if (!text) return;
        const size = coord.size || 10;
        const lineH = coord.lineH || 12;
        const maxW = coord.maxW || 250;
        const wrappedLines = wrapText(String(text), font, size, maxW);
        wrappedLines.forEach((line, i) => {
          page.drawText(line, {
            x: coord.x,
            y: coord.y - (i * lineH),
            size,
            font,
            color: black,
            maxWidth: maxW,
          });
        });
      };

      // ── Delivery time (bold red, top right) ──
      if (bol.delivery_time) {
        page.drawText(String(bol.delivery_time), {
          x: COORDS.deliveryTime.x, y: COORDS.deliveryTime.y,
          size: COORDS.deliveryTime.size,
          font: fontBold,
          color: rgb(1, 0, 0),
        });
      }

      // ── Standard fields ──
      drawText(bol.date, COORDS.date);
      drawText(String(bol.bol_number || ''), COORDS.bolNumber);
      drawText(bol.carrier_name, COORDS.carrierName);
      drawText(bol.trailer_no, COORDS.trailerNo);

      // ── Ship-to address (up to 4 lines) ──
      const shipLines = buildShipToLines(bol);
      const shipCoords = [COORDS.shipLine1, COORDS.shipLine2, COORDS.shipLine3, COORDS.shipLine4];
      shipLines.forEach((line, i) => { if (shipCoords[i]) drawText(line, shipCoords[i]); });

      // ── Special Instructions ──
      drawMultiline(bol.special_instructions, COORDS.specialInstr);

      // ── Contact Info ──
      // Accept either contact_info (BOL generator) or contact_name/contact_phone (load builder)
      const contactStr = bol.contact_info || [
        bol.contact_name ? ('POC: ' + bol.contact_name) : '',
        bol.contact_phone || '',
      ].filter(Boolean).join(' ');
      if (contactStr) drawMultiline(contactStr, COORDS.contactInfo);

      // ── PO / Invoice Number ──
      const poStr = bol.po_number || bol.poNumber || '';
      if (poStr) drawMultiline('PO: ' + poStr, COORDS.poNumber);

      // ── Scrap Pick Up ──
      if (bol.is_scrap_pickup === 1 || bol.is_scrap_pickup === true || bol.is_scrap_pickup === '1') {
        drawText('X', COORDS.scrapYes);
      } else {
        drawText('X', COORDS.scrapNo);
      }

      // ── Commodity description ──
      drawMultiline(bol.commodity_description, COORDS.commodity);

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
    if (bol.ship_to_attention) lines.push('attn: ' + bol.ship_to_attention);
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
    generatePdf,
    openPdf,
    buildShipToLines,
    wrapText,
    confirmNoBolNumber,
  };

})();
