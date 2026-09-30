// src/lib/logistics/loadingSheet.ts
// lgx-loadsheet-01: printable loading sheet — the loading-dock equivalent of the cut list. ONE pdf-lib
// document for one or many orders (each order starts on a fresh page). Page chrome mirrors
// lib/cutList.ts exactly (margin 40, US Letter portrait, Helvetica/HelveticaBold, same colors, same
// logo embed, same drawRight/hr helpers). cutList.ts itself is pixel-parity locked to legacy and is
// NOT modified — its two exported formatters are imported; its file-local helpers are copied below.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { formatCutListAddress, formatCutListDims, type CutListJob } from "@/lib/cutList";

export interface LoadingSheetLineItem {
  part_number: string | null;
  description: string | null;
  quantity: number | string | null;
  dimensions: string | null;
}

export interface LoadingSheetLoad {
  load_number: number | null;
  trailer_number: string | null;
  bay_number: string | number | null;
  bol_number: string | number | null;
}

export interface LoadingSheetOrder {
  job_id: string;
  invoice_number: string | null;
  ship_date: string | null;
  customer: string | null;
  carrier: string | null;
  delivery_time: string | null;
  notes: string | null;
  ship_to_company: string | null;
  ship_to_attention: string | null;
  ship_to_street: string | null;
  ship_to_street2: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  line_items: LoadingSheetLineItem[];
  loads: LoadingSheetLoad[];
}

// Copied verbatim from lib/cutList.ts (file-local there). See BACKLOG: hoist shared pdf-lib helpers.
function formatShipDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

// Copied verbatim from lib/cutList.ts's buildCutListPdf (file-local there, P395). See BACKLOG:
// hoist shared pdf-lib helpers.
const wrapText = (text: string | null | undefined, f: PDFFont, size: number, maxWidth: number): string[] => {
  const s = String(text ?? '');
  if (!s.trim()) return [];
  const lines: string[] = [];
  for (const rawLine of s.split('\n')) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    let line = '';
    for (const w of words) {
      if (f.widthOfTextAtSize(w, size) <= maxWidth) {
        const trial = line ? line + ' ' + w : w;
        if (f.widthOfTextAtSize(trial, size) <= maxWidth) { line = trial; }
        else { if (line) lines.push(line); line = w; }
      } else {
        // token longer than the column: flush current line, then hard-break by characters
        if (line) { lines.push(line); line = ''; }
        let chunk = '';
        for (const ch of w) {
          if (chunk && f.widthOfTextAtSize(chunk + ch, size) > maxWidth) { lines.push(chunk); chunk = ch; }
          else { chunk += ch; }
        }
        line = chunk;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
};

function formatLoadLine(ld: LoadingSheetLoad): string {
  const has = (v: unknown) => v != null && String(v).trim() !== "";
  return [
    has(ld.load_number) ? `Load ${ld.load_number}` : null,
    has(ld.bay_number) ? `Bay ${ld.bay_number}` : null,
    has(ld.trailer_number) ? `Trailer ${ld.trailer_number}` : null,
    has(ld.bol_number) ? `BOL ${ld.bol_number}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function buildLoadingSheetPdf(orders: LoadingSheetOrder[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0.06, 0.09, 0.16);
  const gray = rgb(0.45, 0.48, 0.52);
  const rule = rgb(0.82, 0.84, 0.87);
  const margin = 40;
  const pageW = 612;
  const pageH = 792; // US Letter portrait (points)
  const right = pageW - margin;
  const colDimsX = 330;
  const colQtyRight = 510;
  const colRightX = 330; // right column of the customer/loads block

  const MIN_Y_FOR_TOTAL = 70; // same rule as cutList.ts
  const LH_PART = 13; // line height for wrapped part-label lines (size 11)
  const LH_DESC = 11; // line height for wrapped description lines (size 9)
  const LH_NOTES = 13; // line height for wrapped notes lines (size 10)
  const NOTES_MIN_H = 48;
  const NOTES_PAD = 8;
  const BOX = 11; // LOADED checkbox side
  const BOTTOM = margin + 6; // lowest y a row is allowed to occupy

  const drawRight = (page: PDFPage, text: string, size: number, f: PDFFont, color: ReturnType<typeof rgb>, yPos: number) => {
    page.drawText(text, { x: right - f.widthOfTextAtSize(text, size), y: yPos, size, font: f, color });
  };
  const drawRightAt = (page: PDFPage, text: string, size: number, f: PDFFont, color: ReturnType<typeof rgb>, xRight: number, yPos: number) => {
    page.drawText(text, { x: xRight - f.widthOfTextAtSize(text, size), y: yPos, size, font: f, color });
  };
  const hr = (page: PDFPage, yPos: number) =>
    page.drawLine({ start: { x: margin, y: yPos }, end: { x: right, y: yPos }, thickness: 1, color: rule });

  // Fetched + embedded once per document, not per order. Non-fatal, same as the cut list.
  let logoImg: PDFImage | null = null;
  try {
    const logoBytes = await fetch("/logo/xpanda.png").then((r) => r.arrayBuffer());
    logoImg = await doc.embedPng(logoBytes);
  } catch (e) {
    console.error("Loading sheet: logo embed failed", e);
  }

  const loadedHeaderW = fontBold.widthOfTextAtSize("LOADED", 9);
  const boxX = right - loadedHeaderW / 2 - BOX / 2; // checkbox centered under the LOADED header

  const drawColumnHeader = (page: PDFPage, yStart: number) => {
    let y = yStart;
    page.drawText("ITEM", { x: margin, y, size: 9, font: fontBold, color: gray });
    page.drawText("DIMENSIONS", { x: colDimsX, y, size: 9, font: fontBold, color: gray });
    drawRightAt(page, "QTY", 9, fontBold, gray, colQtyRight, y);
    drawRight(page, "LOADED", 9, fontBold, gray, y);
    y -= 8;
    hr(page, y);
    y -= 17;
    return y;
  };

  for (const order of orders) {
    const inv = order.invoice_number || "";

    const drawPage1Header = (page: PDFPage) => {
      let y = pageH - margin;
      if (logoImg) {
        const logoH = 34;
        const logoW = logoImg.width * (logoH / logoImg.height);
        page.drawImage(logoImg, { x: margin, y: y - logoH, width: logoW, height: logoH });
      }
      drawRight(page, "Loading sheet", 18, fontBold, black, y - 15);
      drawRight(page, `Inv #${inv}`, 11, font, gray, y - 33);
      drawRight(page, `Ship date: ${formatShipDate(order.ship_date)}`, 11, font, gray, y - 47);
      drawRight(page, `Ship via: ${order.carrier || ""}`, 11, font, gray, y - 61);
      y -= 76;
      hr(page, y);
      y -= 18;

      // Two-column block: customer/ship-to (left), delivery + loads (right). Advance by the taller.
      let ly = y;
      page.drawText("CUSTOMER", { x: margin, y: ly, size: 9, font: fontBold, color: gray });
      ly -= 15;
      page.drawText(order.customer || "", { x: margin, y: ly, size: 12, font: fontBold, color: black });
      ly -= 16;
      // formatCutListAddress only reads the ship_to_* fields, which LoadingSheetOrder carries.
      for (const line of formatCutListAddress(order as unknown as CutListJob)) {
        page.drawText(line, { x: margin, y: ly, size: 10, font, color: gray });
        ly -= 13;
      }

      let ry = y;
      const rightW = right - colRightX;
      if (order.delivery_time && String(order.delivery_time).trim()) {
        for (const l of wrapText(`Delivery: ${order.delivery_time}`, font, 10, rightW)) {
          page.drawText(l, { x: colRightX, y: ry, size: 10, font, color: black });
          ry -= 13;
        }
      }
      const loads = Array.isArray(order.loads) ? order.loads : [];
      if (!loads.length) {
        page.drawText("No trailer assigned", { x: colRightX, y: ry, size: 10, font, color: gray });
        ry -= 13;
      } else {
        for (const ld of loads) {
          const text = formatLoadLine(ld);
          if (!text) continue;
          for (const l of wrapText(text, font, 10, rightW)) {
            page.drawText(l, { x: colRightX, y: ry, size: 10, font, color: black });
            ry -= 13;
          }
        }
      }

      y = Math.min(ly, ry);
      y -= 6;
      hr(page, y);
      y -= 18;
      // Sign-off (page 1 only) — same geometry as cutList.ts's operator initials/date line.
      page.drawText("All quantities loaded and counted?", { x: margin, y, size: 11, font: fontBold, color: black });
      y -= 26;
      const soByLabel = "Loaded by:";
      page.drawText(soByLabel, { x: margin, y, size: 10, font, color: black });
      const soByX = margin + font.widthOfTextAtSize(soByLabel, 10) + 6;
      page.drawLine({ start: { x: soByX, y: y - 2 }, end: { x: soByX + 90, y: y - 2 }, thickness: 0.75, color: black });
      const soDateLabel = "Date:";
      const soDateLabelX = soByX + 90 + 30;
      page.drawText(soDateLabel, { x: soDateLabelX, y, size: 10, font, color: black });
      const soDateX = soDateLabelX + font.widthOfTextAtSize(soDateLabel, 10) + 6;
      page.drawLine({ start: { x: soDateX, y: y - 2 }, end: { x: soDateX + 110, y: y - 2 }, thickness: 0.75, color: black });
      y -= 14;
      hr(page, y);
      y -= 18;
      return drawColumnHeader(page, y);
    };

    // Continuation pages: compact title only — no logo, no customer block.
    const drawContTitle = (page: PDFPage) => {
      const y = pageH - margin;
      page.drawText(`Loading sheet — Inv #${inv} (cont.)`, { x: margin, y: y - 13, size: 13, font: fontBold, color: black });
      return y - 30;
    };
    const drawContHeader = (page: PDFPage) => {
      const y = drawContTitle(page);
      hr(page, y);
      return drawColumnHeader(page, y - 18);
    };

    // Measured-height row (same approach as cutList.ts's P395 renderRow/rowHeight): page=null
    // measures only. Returns the y after the row.
    const renderRow = (page: PDFPage | null, li: LoadingSheetLineItem, yStart: number): number => {
      let y = yStart;
      const partLabel = (li.part_number && String(li.part_number).trim()) || "Foam";
      const partLines = wrapText(partLabel, fontBold, 11, colDimsX - margin - 8);
      const plines = partLines.length ? partLines : [partLabel];
      const dlines = li.description ? wrapText(li.description, font, 9, colDimsX - margin - 8) : [];
      if (page) {
        page.drawText(formatCutListDims(li.dimensions), { x: colDimsX, y, size: 10, font, color: black });
        drawRightAt(page, String(Number(li.quantity) || 0), 10, font, black, colQtyRight, y);
        page.drawRectangle({ x: boxX, y: y - 2, width: BOX, height: BOX, borderColor: black, borderWidth: 0.75 });
      }
      for (const pl of plines) {
        if (page) page.drawText(pl, { x: margin, y, size: 11, font: fontBold, color: black });
        y -= LH_PART;
      }
      if (dlines.length) {
        y -= 4;
        for (const dl of dlines) {
          if (page) page.drawText(dl, { x: margin, y, size: 9, font, color: gray });
          y -= LH_DESC;
        }
      }
      y -= 9; // trailing gap before the row separator
      return y;
    };
    const rowHeight = (li: LoadingSheetLineItem): number => -renderRow(null, li, 0);

    const notesLines = wrapText(order.notes, font, 10, right - margin - NOTES_PAD * 2);
    const notesBoxH = Math.max(NOTES_MIN_H, notesLines.length * LH_NOTES + NOTES_PAD * 2);
    // Height consumed below the last row by total + NOTES label + box (see drawTail).
    const tailHeight = 3 + 16 + 24 + 14 + notesBoxH;

    const drawTail = (page: PDFPage, yStart: number, totalQty: number) => {
      let y = yStart - 3;
      hr(page, y);
      y -= 16;
      page.drawText("Total pieces", { x: colDimsX, y, size: 10, font: fontBold, color: black });
      drawRightAt(page, String(totalQty), 11, fontBold, black, colQtyRight, y);
      y -= 24;
      page.drawText("NOTES", { x: margin, y, size: 9, font: fontBold, color: gray });
      y -= 14;
      const boxTop = y + 4;
      page.drawRectangle({
        x: margin,
        y: boxTop - notesBoxH,
        width: right - margin,
        height: notesBoxH,
        borderColor: rule,
        borderWidth: 1,
      });
      let ny = boxTop - NOTES_PAD - 9;
      for (const nl of notesLines) {
        page.drawText(nl, { x: margin + NOTES_PAD, y: ny, size: 10, font, color: black });
        ny -= LH_NOTES;
      }
    };

    const items = Array.isArray(order.line_items) ? order.line_items : [];
    const totalQty = items.reduce((sum, li) => sum + (Number(li.quantity) || 0), 0);

    let page = doc.addPage([pageW, pageH]);
    let y = drawPage1Header(page);
    let isFirstRowOnPage = true;
    for (const li of items) {
      if (y - rowHeight(li) < BOTTOM) {
        page = doc.addPage([pageW, pageH]);
        y = drawContHeader(page);
        isFirstRowOnPage = true;
      }
      if (!isFirstRowOnPage) hr(page, y + 8);
      y = renderRow(page, li, y);
      isFirstRowOnPage = false;
    }

    // Total + notes stay together; if they won't fit above the bottom, they go to a trailing page
    // for this order (same intent as cutList.ts's MIN_Y_FOR_TOTAL rule, extended for the notes box).
    if (y >= MIN_Y_FOR_TOTAL && y - tailHeight >= BOTTOM) {
      drawTail(page, y, totalQty);
    } else {
      const tailPage = doc.addPage([pageW, pageH]);
      drawTail(tailPage, drawContTitle(tailPage), totalQty);
    }
  }

  return await doc.save();
}
