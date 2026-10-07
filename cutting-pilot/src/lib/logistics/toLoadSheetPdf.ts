// src/lib/logistics/toLoadSheetPdf.ts
// tls-01: printable 1st / 2nd shift To-Load sheet (tls-02: retitled Load Verification Sheet, per-load
// checkbox column, Marina Foam exclusion line, sign-off block; tls-03: on both shifts; tls-04: Notes block on both shifts). One pdf-lib document, rows already selected and
// ordered by lib/logistics/toLoadSheet.ts. Page chrome mirrors lib/logistics/loadingSheet.ts (margin 40,
// US Letter portrait, Helvetica/HelveticaBold, same colors, same non-fatal logo embed); its file-local
// drawRight/hr helpers are copied below — loadingSheet.ts and cutList.ts are NOT modified.
// StandardFonts are WinAnsi: no ✓/⚠ — Loaded prints YES/LOADING, early pickup prints a `*` + footnote.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { isLoaded, nextShipDay, rowGroup, shipDayLabel, type ToLoadRow, type ToLoadSheet } from "@/lib/logistics/toLoadSheet";

type ColKey = "check" | "bay" | "inv" | "customer" | "pickup" | "delivery" | "city" | "loaded";
interface Col {
  key: ColKey;
  label: string;
  x: number;
  w: number;
}

export async function buildToLoadSheetPdf(
  sheet: ToLoadSheet,
  printedAtEt: string,
  excludedSister = 0
): Promise<Uint8Array> {
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

  const ROW_H = 14;
  const ROW_SIZE = 10;
  const HEAD_SIZE = 8;
  const CELL_PAD = 6;
  const BOTTOM = margin + 26; // lowest y a row may occupy; footnote + page number sit below

  const drawRight = (page: PDFPage, text: string, size: number, f: PDFFont, color: ReturnType<typeof rgb>, yPos: number) => {
    page.drawText(text, { x: right - f.widthOfTextAtSize(text, size), y: yPos, size, font: f, color });
  };
  const hr = (page: PDFPage, yPos: number, thickness = 1) =>
    page.drawLine({ start: { x: margin, y: yPos }, end: { x: right, y: yPos }, thickness, color: rule });

  // Fit on one line, ending in "..." when too wide. Never wraps.
  const fit = (text: string, f: PDFFont, size: number, maxW: number): string => {
    const s = String(text ?? "");
    if (f.widthOfTextAtSize(s, size) <= maxW) return s;
    const ell = "...";
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (f.widthOfTextAtSize(s.slice(0, mid).trimEnd() + ell, size) <= maxW) lo = mid;
      else hi = mid - 1;
    }
    return lo > 0 ? s.slice(0, lo).trimEnd() + ell : "";
  };

  let logoImg: PDFImage | null = null;
  try {
    const logoBytes = await fetch("/logo/xpanda.png").then((r) => r.arrayBuffer());
    logoImg = await doc.embedPng(logoBytes);
  } catch (e) {
    console.error("Load verification sheet: logo embed failed", e);
  }

  const buildCols = (withLoaded: boolean): Col[] => {
    const fixed: Array<[ColKey, string, number]> = [
      ["check", "", 20],
      ["bay", "BAY", 34],
      ["inv", "INV #", 66],
      ["customer", "CUSTOMER", 0],
      ["pickup", "SUGGESTED PICKUP", 92],
      ["delivery", "DELIVERY", 78],
      ["city", "CITY", withLoaded ? 92 : 120],
    ];
    if (withLoaded) fixed.push(["loaded", "LOADED", 60]);
    const used = fixed.reduce((s, [, , w]) => s + w, 0);
    const cols: Col[] = [];
    let x = margin;
    for (const [key, label, w0] of fixed) {
      const w = w0 || right - margin - used;
      cols.push({ key, label, x, w });
      x += w;
    }
    return cols;
  };

  const shiftLabel = sheet.shift === 1 ? "1ST SHIFT" : "2ND SHIFT";
  const forDay = sheet.shift === 1 ? nextShipDay(sheet.printedOn) : sheet.printedOn;

  const earlyPages = new Set<PDFPage>();
  let page: PDFPage = doc.addPage([pageW, pageH]);
  let y: number;

  // Page 1 header.
  {
    let top = pageH - margin;
    if (logoImg) {
      const logoH = 34;
      const logoW = logoImg.width * (logoH / logoImg.height);
      page.drawImage(logoImg, { x: margin, y: top - logoH, width: logoW, height: logoH });
    }
    drawRight(page, `LOAD VERIFICATION SHEET — ${shiftLabel}`, 16, fontBold, black, top - 14);
    drawRight(page, `For ${shipDayLabel(forDay)}`, 11, font, black, top - 31);
    const snap = `Printed ${printedAtEt} ET — status as of print time. Live status: TV loading board.`;
    drawRight(page, fit(snap, font, 9, right - margin), 9, font, gray, top - 45);
    if (excludedSister > 0) {
      const ex = `Excludes ${excludedSister} Marina Foam order(s) — sister-company delivery, not truck-loaded.`;
      drawRight(page, fit(ex, font, 9, right - margin), 9, font, gray, top - 57);
      top -= 12;
    }
    top -= 56;
    hr(page, top);
    y = top - 20;
  }

  let activeCols: Col[] | null = null;

  const drawColumnHeader = () => {
    if (!activeCols) return;
    for (const c of activeCols) {
      page.drawText(fit(c.label, fontBold, HEAD_SIZE, c.w - CELL_PAD), { x: c.x, y, size: HEAD_SIZE, font: fontBold, color: gray });
    }
    y -= 5;
    hr(page, y);
    y -= ROW_H - 2;
  };

  const newPage = () => {
    page = doc.addPage([pageW, pageH]);
    const top = pageH - margin;
    page.drawText(`Load verification sheet — ${sheet.shift === 1 ? "1st" : "2nd"} shift (cont.)`, {
      x: margin, y: top - 13, size: 13, font: fontBold, color: black,
    });
    hr(page, top - 22);
    y = top - 40;
    drawColumnHeader();
  };

  // Ensure `h` points fit above BOTTOM; otherwise break the page (column header repeats).
  const ensure = (h: number) => {
    if (y - h < BOTTOM) newPage();
  };

  const subheader = (text: string, size: number) => {
    ensure(size + 6 + ROW_H);
    page.drawText(text, { x: margin, y, size, font: fontBold, color: black });
    y -= size + 6;
  };

  const invLabel = (r: ToLoadRow): string => {
    const inv = r.invoice_number || "—";
    return (r.load_count ?? 0) > 1 ? `${inv} (${r.load_number}/${r.load_count})` : inv;
  };
  const loadedLabel = (r: ToLoadRow): string =>
    isLoaded(r.loading_status) ? "YES" : r.loading_status === "loading" ? "LOADING" : "";

  const drawRow = (r: ToLoadRow) => {
    ensure(ROW_H);
    const cols = activeCols as Col[];
    for (const c of cols) {
      let text = "";
      let f = font;
      switch (c.key) {
        case "check":
          page.drawRectangle({ x: c.x + 2, y: y - 1, width: 10, height: 10, borderColor: black, borderWidth: 1 });
          continue;
        case "bay":
          text = r.location === "yard" ? "Yard" : r.bay_number != null ? String(r.bay_number) : "—";
          f = fontBold;
          break;
        case "inv": text = invLabel(r); break;
        case "customer": text = r.customer || ""; break;
        case "pickup":
          text = r.pickup_label ?? "—";
          if (r.pickup_early) { f = fontBold; earlyPages.add(page); }
          break;
        case "delivery": text = r.delivery_label || "—"; break;
        case "city": text = r.city_label || ""; break;
        case "loaded": text = loadedLabel(r); f = fontBold; break;
      }
      const s = fit(text, f, ROW_SIZE, c.w - CELL_PAD);
      if (s) page.drawText(s, { x: c.x, y, size: ROW_SIZE, font: f, color: black });
    }
    hr(page, y - 4, 0.5);
    y -= ROW_H;
  };

  const drawDayRows = (rows: ToLoadRow[]) => {
    const groups: Array<[0 | 1 | 2, string | null]> = [[0, null], [1, "Yard"], [2, "Unassigned"]];
    for (const [g, label] of groups) {
      const gRows = rows.filter((r) => rowGroup(r) === g);
      if (!gRows.length) continue;
      if (label) {
        y -= 2;
        subheader(label, 10);
      }
      for (const r of gRows) drawRow(r);
    }
  };

  sheet.sections.forEach((section, idx) => {
    activeCols = null;
    if (idx > 0) y -= 12;
    ensure(16 + 2 * ROW_H + 12);
    page.drawText(section.title, { x: margin, y, size: 13, font: fontBold, color: black });
    y -= 20;

    const hasRows = section.days.some((d) => d.rows.length);
    if (hasRows) {
      activeCols = buildCols(section.kind === "pickups");
      drawColumnHeader();
      for (const day of section.days) {
        if (section.kind === "to_load") {
          y -= 2;
          subheader(shipDayLabel(day.shipDay), 11);
        }
        drawDayRows(day.rows);
      }
    }
    activeCols = null;

    const msg = section.note ?? (hasRows ? null : "No loads.");
    if (msg) {
      ensure(ROW_H);
      y -= hasRows ? 4 : 0;
      page.drawText(fit(msg, font, ROW_SIZE, right - margin), { x: margin, y, size: ROW_SIZE, font, color: gray });
      y -= ROW_H;
    }

    // tls-02/tls-03: sign-off block. 1st shift: between Load Verification and To load. 2nd shift: after its
    // only section (end of sheet). ensure() keeps it on one page.
    if ((sheet.shift === 1 && idx === 0) || (sheet.shift === 2 && idx === sheet.sections.length - 1)) {
      ensure(54);
      y -= 4;
      hr(page, y);
      y -= 18;
      page.drawText("Load verification sign-off", { x: margin, y, size: 11, font: fontBold, color: black });
      y -= 22;
      let x = margin;
      for (const [label, lineW] of [["Verified by:", 150], ["Date:", 80], ["Time:", 80]] as const) {
        page.drawText(label, { x, y, size: 10, font, color: black });
        x += font.widthOfTextAtSize(label, 10) + 4;
        page.drawLine({ start: { x, y: y - 2 }, end: { x: x + lineW, y: y - 2 }, thickness: 0.75, color: black });
        x += lineW + 18;
      }
      y -= 12;
    }
  });

  // tls-04: Notes block — last thing on the sheet (both shifts). Bold label, then ruled handwriting lines
  // filling the rest of the last page down to BOTTOM; min NOTES_MIN_LINES, else the block starts a new page.
  {
    const NOTES_LINE_GAP = 20;
    const NOTES_MIN_LINES = 4;
    activeCols = null; // no column header on a notes-only page
    y -= 8;
    ensure(18 + NOTES_MIN_LINES * NOTES_LINE_GAP);
    hr(page, y);
    y -= 18;
    page.drawText("Notes", { x: margin, y, size: 11, font: fontBold, color: black });
    y -= NOTES_LINE_GAP;
    while (y >= BOTTOM) {
      page.drawLine({ start: { x: margin, y }, end: { x: right, y }, thickness: 0.5, color: gray });
      y -= NOTES_LINE_GAP;
    }
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `Page ${i + 1} of ${pages.length}`;
    p.drawText(label, { x: right - font.widthOfTextAtSize(label, 9), y: margin - 14, size: 9, font, color: gray });
    if (earlyPages.has(p)) {
      p.drawText("* Suggested pickup falls before the ship date.", { x: margin, y: margin, size: 9, font, color: black });
    }
  });

  return await doc.save();
}
