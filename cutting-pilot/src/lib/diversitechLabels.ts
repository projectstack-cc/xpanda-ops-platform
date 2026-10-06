// src/lib/diversitechLabels.ts
// jb-04 — DiversiTech bag/bundle label PDF generator for the v2 board. Ported verbatim (in logic
// and geometry) from legacy `jobs/diversitech-labels.js` (P421 + P444), whose layout is extracted
// 1:1 from the Labelife source (H1840.aml). Geometry is 1:1 — do not adjust.
//
// Every x/y/w/h and font size is the source file's own mm value converted to pt at 72/25.4
// pt-per-mm, not a proportional estimate. Page size is the file's own labelHeight/labelWidth
// (151.892mm x 102.108mm -> 430.56 x 289.44pt, ~5.98"x4.02"), not a rounded 6"x4". Font is
// StandardFonts.Helvetica/HelveticaBold (CG Triumvirate/Agency FB, the source's real fonts, are
// proprietary and not in the repo) — bold vs regular weight is otherwise preserved exactly as the
// source file has it: only the header and the SIZE row's value are bold.
//
// Legacy's `printDiversiTechLabels` (window.open path) is intentionally NOT ported — v2 renders
// the PDF in-app via the shared PdfViewer (DiversiTechLabelsModal).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";

export interface DiversiTechLineItem {
  part_number?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  dimensions?: string | null;
  density?: string | null;
  sort_order?: number | null;
}

export interface DiversiTechJob {
  ship_date: string | null;
}

const DIVERSITECH_LOGO_URL = "/logo/xpanda-panda-600.png";
const DIVERSITECH_BATCH = "42E36164Z";
const DIVERSITECH_HEADER = "DiversiTech Corporation";
const DIVERSITECH_BUNDLE_SIZE = 5;

// H1840.aml labelWidth=102.108mm / labelHeight=151.892mm, isPrintHorizontal=1 (the design's
// x-axis, bounded by labelHeight, becomes the printed width; its y-axis, bounded by
// labelWidth, becomes the printed height, top-down). mm -> pt at 72/25.4.
const DIVERSITECH_PAGE_W = 430.56;
const DIVERSITECH_PAGE_H = 289.44;

// Every box below is [x, y, w, h] in pt, already converted to pdf-lib's bottom-left
// origin, taken directly from H1840.aml's own per-object x/y/width/height (mm -> pt).
const DIVERSITECH_LAYOUT = {
  header: { x: 24.17, y: 243.42, w: 378.17, h: 33.77, fontSize: 23 },
  product: { x: 19.56, y: 203.08, w: 366.97, h: 48.19, fontSize: 31 },
  spec: { x: 24.17, y: 64.46, w: 382.23, h: 126.12, labelColW: 123.64, fontSize: 20 },
  qty: { x: 26.35, y: 10.33, w: 147.46, h: 44.52, fontSize: 20 },
  bundle: { x: 203.05, y: 11.37, w: 94.67, h: 42.84, fontSize: 31.64 },
  logo: { x: 348.27, y: 4.89, w: 56.1, h: 59.57 },
};

/** Case-sensitive prefix check, exactly as legacy's `customer.startsWith('DiversiTech')`. */
export function isDiversiTechCustomer(customer: string | null): boolean {
  return !!customer && customer.startsWith("DiversiTech");
}

function diversiTechFormatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso).trim());
  if (!m) return "";
  return `${m[2]}/${m[3]}/${m[1]}`;
}

export function diversiTechProductLabel(li: DiversiTechLineItem): string {
  const partNumber = (li.part_number || "").trim();
  if (partNumber) return `FOAM - ${partNumber}`;
  return (li.description || "").trim();
}

interface DiversiTechBundle {
  lineItem: DiversiTechLineItem;
  bundleNumber: number;
  pieces: number;
}

// Bundle numbering resets per SKU; last bundle of each SKU carries the remainder.
function diversiTechComputeBundles(lineItems: DiversiTechLineItem[]): DiversiTechBundle[] {
  const sorted = lineItems.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const bundles: DiversiTechBundle[] = [];
  for (const li of sorted) {
    const qty = Number(li.quantity) || 0;
    const bundleCount = Math.ceil(qty / DIVERSITECH_BUNDLE_SIZE);
    for (let i = 1; i <= bundleCount; i++) {
      const isLast = i === bundleCount;
      const pieces = isLast ? qty % DIVERSITECH_BUNDLE_SIZE || DIVERSITECH_BUNDLE_SIZE : DIVERSITECH_BUNDLE_SIZE;
      bundles.push({ lineItem: li, bundleNumber: i, pieces });
    }
  }
  return bundles;
}

function diversiTechFitSize(font: PDFFont, text: string, maxWidth: number, maxSize: number, minSize: number): number {
  let size = maxSize;
  while (size > minSize && font.widthOfTextAtSize(text, size) > maxWidth) size -= 1;
  return size;
}

function diversiTechCenteredText(
  page: PDFPage, text: string, font: PDFFont, size: number, color: RGB,
  boxX: number, boxY: number, boxW: number, boxH: number,
) {
  const w = font.widthOfTextAtSize(text, size);
  const x = boxX + (boxW - w) / 2;
  const y = boxY + (boxH - size) / 2 + size * 0.22;
  page.drawText(text, { x, y, size, font, color });
}

// Header is top-aligned in the source (verAlignment=0), unlike every other element
// (verAlignment=1/center) — small top padding rather than vertical centering.
function diversiTechTopAlignedText(
  page: PDFPage, text: string, font: PDFFont, size: number, color: RGB,
  boxX: number, boxY: number, boxW: number, boxH: number,
) {
  const w = font.widthOfTextAtSize(text, size);
  const x = boxX + (boxW - w) / 2;
  const y = boxY + boxH - size * 0.95;
  page.drawText(text, { x, y, size, font, color });
}

function diversiTechDrawBox(page: PDFPage, x: number, y: number, w: number, h: number, color: RGB) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: color, borderWidth: 1 });
}

interface DiversiTechLabelData {
  productText: string;
  size: string;
  date: string;
  density: string;
  qty: string;
  bundleNumber: number;
}

function diversiTechDrawLabel(
  page: PDFPage, fontBold: PDFFont, fontRegular: PDFFont, black: RGB,
  logoImg: PDFImage | null, data: DiversiTechLabelData,
) {
  const L = DIVERSITECH_LAYOUT;

  // 1) Header — bold, top-aligned, no border (source's Text-level borderDisplay=1 flag
  // doesn't correspond to a visible box on the real printed label — confirmed by Steve)
  diversiTechTopAlignedText(page, DIVERSITECH_HEADER, fontBold, L.header.fontSize, black, L.header.x, L.header.y, L.header.w, L.header.h);

  // 2) Product box — regular weight (source: fontStyleIsBlod=0), shrink-to-fit
  diversiTechDrawBox(page, L.product.x, L.product.y, L.product.w, L.product.h, black);
  const productSize = diversiTechFitSize(fontRegular, data.productText, L.product.w - 16, L.product.fontSize, 12);
  diversiTechCenteredText(page, data.productText, fontRegular, productSize, black, L.product.x, L.product.y, L.product.w, L.product.h);

  // 3) Spec table — 2 cols x 4 rows: SIZE / DATE / DENSITY / BATCH. Only the SIZE row's
  // value is bold (source: fontStyleIsBlod=1 on that one cell, 0 everywhere else);
  // BATCH is a normal row here even though the source renders it as two floating text
  // objects layered over the table's structurally-blank 4th row — same visual result.
  const rowH = L.spec.h / 4;
  const valueColW = L.spec.w - L.spec.labelColW;
  const rows: [string, string, boolean][] = [
    ["SIZE", data.size, true],
    ["DATE", data.date, false],
    ["DENSITY", data.density, false],
    ["BATCH", DIVERSITECH_BATCH, false],
  ];
  rows.forEach(([label, value, valueBold], i) => {
    const rowY = L.spec.y + L.spec.h - rowH * (i + 1);
    diversiTechDrawBox(page, L.spec.x, rowY, L.spec.w, rowH, black);
    page.drawLine({ start: { x: L.spec.x + L.spec.labelColW, y: rowY }, end: { x: L.spec.x + L.spec.labelColW, y: rowY + rowH }, thickness: 1, color: black });
    diversiTechCenteredText(page, label, fontRegular, 10, black, L.spec.x, rowY, L.spec.labelColW, rowH);
    const valueFont = valueBold ? fontBold : fontRegular;
    const valueSize = diversiTechFitSize(valueFont, String(value || ""), valueColW - 16, L.spec.fontSize, 8);
    diversiTechCenteredText(page, String(value || ""), valueFont, valueSize, black, L.spec.x + L.spec.labelColW, rowY, valueColW, rowH);
  });

  // 4) Bottom row — QTY (label|value side by side, one row) | bundle number | logo
  const qtyColW = L.qty.w / 2;
  diversiTechDrawBox(page, L.qty.x, L.qty.y, L.qty.w, L.qty.h, black);
  page.drawLine({ start: { x: L.qty.x + qtyColW, y: L.qty.y }, end: { x: L.qty.x + qtyColW, y: L.qty.y + L.qty.h }, thickness: 1, color: black });
  diversiTechCenteredText(page, "QTY", fontRegular, L.qty.fontSize, black, L.qty.x, L.qty.y, qtyColW, L.qty.h);
  const qtySize = diversiTechFitSize(fontRegular, data.qty, qtyColW - 16, L.qty.fontSize, 10);
  diversiTechCenteredText(page, data.qty, fontRegular, qtySize, black, L.qty.x + qtyColW, L.qty.y, qtyColW, L.qty.h);

  // Bundle number box
  diversiTechDrawBox(page, L.bundle.x, L.bundle.y, L.bundle.w, L.bundle.h, black);
  const bundleText = String(data.bundleNumber);
  const bundleSize = diversiTechFitSize(fontRegular, bundleText, L.bundle.w - 24, L.bundle.fontSize, 14);
  diversiTechCenteredText(page, bundleText, fontRegular, bundleSize, black, L.bundle.x, L.bundle.y, L.bundle.w, L.bundle.h);

  // Logo — no border (matches the header's real, borderless printed appearance)
  if (logoImg) {
    const pad = 6;
    const maxW = L.logo.w - pad * 2;
    const maxH = L.logo.h - pad * 2;
    const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height);
    const drawW = logoImg.width * scale;
    const drawH = logoImg.height * scale;
    page.drawImage(logoImg, {
      x: L.logo.x + (L.logo.w - drawW) / 2,
      y: L.logo.y + (L.logo.h - drawH) / 2,
      width: drawW,
      height: drawH,
    });
  }
}

export async function buildDiversiTechLabelsPdf(job: DiversiTechJob, lineItems: DiversiTechLineItem[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const black = rgb(0, 0, 0);

  let logoImg: PDFImage | null = null;
  try {
    const logoBytes = await fetch(DIVERSITECH_LOGO_URL).then((r) => r.arrayBuffer());
    logoImg = await doc.embedPng(logoBytes);
  } catch (e) {
    console.error("DiversiTech labels: logo embed failed", e);
  }

  const dateStr = diversiTechFormatDate(job.ship_date);
  const bundles = diversiTechComputeBundles(lineItems);

  for (const b of bundles) {
    const page = doc.addPage([DIVERSITECH_PAGE_W, DIVERSITECH_PAGE_H]);
    diversiTechDrawLabel(page, fontBold, fontRegular, black, logoImg, {
      productText: diversiTechProductLabel(b.lineItem),
      size: b.lineItem.dimensions || "",
      date: dateStr,
      density: (b.lineItem.density && String(b.lineItem.density).trim()) || "1.0 RC",
      qty: String(b.pieces).padStart(2, "0") + "pcs",
      bundleNumber: b.bundleNumber,
    });
  }

  return doc.save();
}
