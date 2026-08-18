// src/lib/cutList.ts
// Ported verbatim (in logic) from jobs/index.html's buildCutListPdf/printCutList (prompt 328/329)
// for the v2 order-detail modal's "Print cut list" button. Do NOT change the PDF layout or
// coordinates — this must stay pixel-parity with the legacy generator.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface CutListLineItem {
  part_number: string | null;
  description: string | null;
  quantity: number | string | null;
  dimensions: string | null;
  density: string | null;
}

export interface CutListJob {
  id: string;
  invoice_number: string | null;
  ship_date: string | null;
  customer: string | null;
  ship_to_company: string | null;
  ship_to_attention: string | null;
  ship_to_street: string | null;
  ship_to_street2: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  carrier: string | null;
  line_items: CutListLineItem[];
  hb_chunk_breakdown?: string | null;
}

function formatShipDate(dateStr: string | null): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

export function formatCutListDims(dimStr: string | null): string {
  if (!dimStr || !String(dimStr).trim()) return "";
  const [l = "", w = "", h = ""] = String(dimStr)
    .replace(/[×xX]/g, "x")
    .split(/\s*x\s*/i)
    .map((p) => p.replace(/["'\s]/g, ""));
  return `${[l, w, h].join(" × ").trimEnd()} in`;
}

export function formatCutListAddress(job: CutListJob): string[] {
  return [
    job.ship_to_company,
    job.ship_to_attention,
    job.ship_to_street,
    job.ship_to_street2,
    [job.ship_to_city, job.ship_to_state, job.ship_to_zip].filter(Boolean).join(", "),
  ].filter((v): v is string => !!v && String(v).trim() !== "");
}

export async function buildCutListPdf(job: CutListJob): Promise<Uint8Array> {
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
  const colDensityX = 300;
  const colDimsX = 380;

  // Fixed row-capacity constants (not measured) — sized conservatively for Letter portrait so
  // rows never run past the bottom margin. ROWS_PAGE_1 assumes a worst-case 5-line ship-to
  // address under the full header; ROWS_PAGE_CONT assumes the shorter compact header. Both leave
  // clean bottom margin even when the final page also needs to carry the total-pieces block.
  const ROWS_PAGE_1 = 14;
  const ROWS_PAGE_CONT = 20;
  const MIN_Y_FOR_TOTAL = 70; // below this, push the total-pieces block to its own trailing page

  const drawRight = (page: PDFPage, text: string, size: number, f: PDFFont, color: ReturnType<typeof rgb>, yPos: number) => {
    page.drawText(text, { x: right - f.widthOfTextAtSize(text, size), y: yPos, size, font: f, color });
  };
  const hr = (page: PDFPage, yPos: number) =>
    page.drawLine({ start: { x: margin, y: yPos }, end: { x: right, y: yPos }, thickness: 1, color: rule });

  let logoImg = null;
  try {
    const logoBytes = await fetch("/logo/xpanda.png").then((r) => r.arrayBuffer());
    logoImg = await doc.embedPng(logoBytes);
  } catch (e) {
    console.error("Cut list: logo embed failed", e);
  }

  const drawColumnHeader = (page: PDFPage, yStart: number) => {
    let y = yStart;
    page.drawText("ITEM", { x: margin, y, size: 9, font: fontBold, color: gray });
    page.drawText("DENSITY", { x: colDensityX, y, size: 9, font: fontBold, color: gray });
    page.drawText("DIMENSIONS", { x: colDimsX, y, size: 9, font: fontBold, color: gray });
    drawRight(page, "QTY", 9, fontBold, gray, y);
    y -= 8;
    hr(page, y);
    y -= 17;
    return y;
  };

  // Page 1: unchanged full header — logo, title block, customer/ship-to address.
  const drawPage1Header = (page: PDFPage) => {
    let y = pageH - margin;
    if (logoImg) {
      const logoH = 34;
      const logoW = logoImg.width * (logoH / logoImg.height);
      page.drawImage(logoImg, { x: margin, y: y - logoH, width: logoW, height: logoH });
    }
    drawRight(page, "Cut list", 18, fontBold, black, y - 15);
    drawRight(page, `Inv #${job.invoice_number || ""}`, 11, font, gray, y - 33);
    drawRight(page, `Ship date: ${formatShipDate(job.ship_date)}`, 11, font, gray, y - 47);
    drawRight(page, `Ship Via: ${job.carrier || ""}`, 11, font, gray, y - 61);
    y -= 76;
    hr(page, y);
    y -= 18;
    page.drawText("CUSTOMER", { x: margin, y, size: 9, font: fontBold, color: gray });
    y -= 15;
    page.drawText(job.customer || "", { x: margin, y, size: 12, font: fontBold, color: black });
    y -= 16;
    for (const line of formatCutListAddress(job)) {
      page.drawText(line, { x: margin, y, size: 10, font, color: gray });
      y -= 13;
    }
    y -= 6;
    hr(page, y);
    y -= 18;
    return drawColumnHeader(page, y);
  };

  // Page 2+: compact single-line header — no logo, no customer block.
  const drawContTitle = (page: PDFPage) => {
    const y = pageH - margin;
    page.drawText(`Cut list — Inv #${job.invoice_number || ""} (cont.)`, {
      x: margin,
      y: y - 13,
      size: 13,
      font: fontBold,
      color: black,
    });
    return y - 30;
  };
  const drawContHeader = (page: PDFPage) => {
    const y = drawContTitle(page);
    hr(page, y);
    return drawColumnHeader(page, y - 18);
  };

  const drawRow = (page: PDFPage, li: CutListLineItem, yStart: number) => {
    let y = yStart;
    const partLabel = (li.part_number && String(li.part_number).trim()) || "Foam";
    page.drawText(partLabel, { x: margin, y, size: 11, font: fontBold, color: black });
    page.drawText(li.density ? String(li.density) : "", { x: colDensityX, y, size: 10, font, color: black });
    page.drawText(formatCutListDims(li.dimensions), { x: colDimsX, y, size: 10, font, color: black });
    drawRight(page, String(Number(li.quantity) || 0), 10, font, black, y);
    y -= 13;
    if (li.description) {
      page.drawText(String(li.description), { x: margin, y, size: 9, font, color: gray });
    }
    y -= 17;
    return y;
  };

  const drawTotal = (page: PDFPage, yStart: number, totalQty: number) => {
    let y = yStart - 3;
    hr(page, y);
    y -= 16;
    page.drawText("Total pieces", { x: colDimsX, y, size: 10, font: fontBold, color: black });
    drawRight(page, String(totalQty), 11, fontBold, black, y);
  };

  const items = Array.isArray(job.line_items) ? job.line_items : [];
  const totalQty = items.reduce((sum, li) => sum + (Number(li.quantity) || 0), 0);

  let idx = 0;
  let pageCount = 0;
  let lastPage: PDFPage | null = null;
  let lastY = 0;
  while (idx < items.length || pageCount === 0) {
    const page = doc.addPage([pageW, pageH]);
    pageCount += 1;
    let y = pageCount === 1 ? drawPage1Header(page) : drawContHeader(page);
    const cap = pageCount === 1 ? ROWS_PAGE_1 : ROWS_PAGE_CONT;
    let isFirstRowOnPage = true;
    for (const li of items.slice(idx, idx + cap)) {
      if (!isFirstRowOnPage) hr(page, y + 8);
      y = drawRow(page, li, y);
      isFirstRowOnPage = false;
    }
    idx += cap;
    lastPage = page;
    lastY = y;
  }

  if (lastPage && lastY >= MIN_Y_FOR_TOTAL) {
    drawTotal(lastPage, lastY, totalQty);
  } else {
    const page = doc.addPage([pageW, pageH]);
    const y = drawContTitle(page);
    drawTotal(page, y, totalQty);
  }

  // P386: Holey Board chunk breakdown — GROUPED by identical chunk composition (recipe → count),
  // replacing the per-chunk listing that produced one row per chunk (e.g. 339 rows for Inv 4272).
  if (job.hb_chunk_breakdown) {
    let parsed: any = null;
    try { parsed = JSON.parse(job.hb_chunk_breakdown); } catch (e) {}
    if (parsed && Array.isArray(parsed.breakdown) && parsed.breakdown.length) {
      const groups = new Map();
      parsed.breakdown.forEach((ch: any, i: number) => {
        const tally: any = {};
        for (const t of ch.boards) { const k = String(t); tally[k] = (tally[k] || 0) + 1; }
        const sig = Object.keys(tally).map(Number).sort((a, b) => b - a)
          .map(k => `${tally[String(k)]}× ${k}"`).join('   +   ');
        const g = groups.get(sig);
        if (g) g.count++; else groups.set(sig, { count: 1, sig, order: i });
      });
      const rows = Array.from(groups.values()).sort((a: any, b: any) => a.order - b.order);

      let p = doc.addPage([pageW, pageH]);
      let y = pageH - margin;
      p.drawText('CHUNK BREAKDOWN', { x: margin, y, size: 12, font: fontBold, color: black });
      y -= 6; hr(p, y); y -= 18;
      p.drawText(`${parsed.chunks_required} chunk${parsed.chunks_required === 1 ? '' : 's'} · 48×24×${parsed.height}" · ${parsed.kerf}" kerf · ${parsed.avg_util}% avg fill`,
        { x: margin, y, size: 10, font, color: gray });
      y -= 8; hr(p, y); y -= 18;
      p.drawText('CHUNKS', { x: margin, y, size: 9, font: fontBold, color: gray });
      p.drawText('CUT EACH INTO', { x: margin + 70, y, size: 9, font: fontBold, color: gray });
      y -= 16;
      for (const r of rows as any[]) {
        if (y < MIN_Y_FOR_TOTAL) { p = doc.addPage([pageW, pageH]); y = pageH - margin; }
        p.drawText(`${r.count}×`, { x: margin, y, size: 11, font: fontBold, color: black });
        p.drawText(r.sig, { x: margin + 70, y, size: 10, font, color: black });
        y -= 16;
      }
    }
  }

  return await doc.save();
}
