// src/lib/bagLabels.ts
// Bag label printing (P413, reworked to portrait per P417) for the Block Calculator
// (/v2/blocks). Pure module (no DOM, no React) mirroring src/lib/cutList.ts's shape/patterns:
// pdf-lib for client-side PDF generation, printed on the floor's Omezizy D520BT (standard
// 203-DPI direct-thermal, 4x6" pages through the normal OS print dialog — no driver/protocol
// work in scope).
//
// One page per bag, 4x6" PORTRAIT (288x432pt @ 72pt/in — P417 supersedes P413's landscape
// layout). Bagging: 4 pcs/bag, remainder in the last bag of each line; no SKU shares a bag; bag
// numbering is sequential across the whole loaded PO in grid order (array order = PO
// top-to-bottom).
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { SkuLine } from "./blockTypes";

export interface BagLabelOptions {
  customer?: string;
}

export interface BagLabel {
  item: string;
  sizeStr: string;
  densityStr: string;
  piecesInBag: number;
  bagNumber: number;
  totalBags: number;
}

export class UnparsedRowsError extends Error {
  rows: { item: string; raw: string }[];
  constructor(rows: { item: string; raw: string }[]) {
    super("PO has unparsed/incomplete rows that must be corrected before printing bag labels");
    this.name = "UnparsedRowsError";
    this.rows = rows;
  }
}

const DEFAULT_CUSTOMER = "Core Covers";
const PIECES_PER_BAG = 4;

// --- Formatting helpers (pure, unit-friendly) ---

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function sizeString(line: Pick<SkuLine, "width" | "tlo" | "thi" | "length">): string {
  return `${fmtNum(line.width)} × (${fmtNum(line.tlo)}×${fmtNum(line.thi)}) × ${fmtNum(line.length)}`;
}

export function densityString(line: Pick<SkuLine, "density">): string {
  return `${fmtNum(line.density)}#`;
}

export function qtyString(piecesInBag: number): string {
  return `${String(piecesInBag).padStart(2, "0")}pcs`;
}

export function dateString(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

export function fitSize(
  text: string,
  font: PDFFont,
  maxWidth: number,
  startSize: number,
  floorSize: number
): number {
  let size = startSize;
  while (size > floorSize && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 1;
  }
  return size;
}

// --- Unparsed-row guard (defense in depth — the UI checks first, this checks again) ---

function findUnparsedRows(lines: SkuLine[]): { item: string; raw: string }[] {
  return lines
    .filter((l) => !l.parsed || (l.qty > 0 && l.density <= 0))
    .map((l) => ({ item: l.item, raw: l.raw }));
}

// --- Bagging logic (pure, no PDF — the unit-testable core) ---

export function computeBags(lines: SkuLine[]): BagLabel[] {
  const usable = lines.filter((l) => l.qty > 0);
  const perLine = usable.map((line) => {
    const bagCount = Math.ceil(line.qty / PIECES_PER_BAG);
    const pieces: number[] = [];
    for (let i = 0; i < bagCount; i++) {
      pieces.push(i === bagCount - 1 ? line.qty - PIECES_PER_BAG * (bagCount - 1) : PIECES_PER_BAG);
    }
    return { line, pieces };
  });

  const totalBags = perLine.reduce((sum, p) => sum + p.pieces.length, 0);

  const out: BagLabel[] = [];
  let n = 0;
  for (const { line, pieces } of perLine) {
    const sizeStr = sizeString(line);
    const densityStr = densityString(line);
    for (const piecesInBag of pieces) {
      n += 1;
      out.push({
        item: line.item,
        sizeStr,
        densityStr,
        piecesInBag,
        bagNumber: n,
        totalBags,
      });
    }
  }
  return out;
}

// --- PDF rendering ---

const PAGE_W = 288; // 4in @ 72pt/in, portrait by dimension
const PAGE_H = 432; // 6in
const MARGIN = 13;
const RULE_WIDTH = 2;
const HEADER_H = 40;
const PRODUCT_BOX_H = 68;
const TABLE_ROW_H = 45;
const BOTTOM_ROW_H = 68;
const GAP = 16;
const BOTTOM_GAP = 8;
const TABLE_LABEL_COL_W = 97;
const QTY_LABEL_COL_W = 68;
const QTY_VALUE_COL_W = 83;
const QTY_BLOCK_W = QTY_LABEL_COL_W + QTY_VALUE_COL_W;

export async function buildBagLabelsPdf(lines: SkuLine[], opts?: BagLabelOptions): Promise<Uint8Array> {
  const customer = opts?.customer ?? DEFAULT_CUSTOMER;

  const offending = findUnparsedRows(lines);
  if (offending.length) throw new UnparsedRowsError(offending);

  const bags = computeBags(lines);

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0.06, 0.09, 0.16);

  let logoImg = null;
  try {
    const logoBytes = await fetch("/logo/xpanda-panda-600.png").then((r) => r.arrayBuffer());
    logoImg = await doc.embedPng(logoBytes);
  } catch (e) {
    console.error("Bag labels: logo embed failed", e);
  }

  const date = dateString();

  for (const bag of bags) {
    const page = doc.addPage([PAGE_W, PAGE_H]);
    drawLabelPage(page, font, fontBold, black, logoImg, customer, date, bag);
  }

  return await doc.save();
}

function drawCentered(
  page: PDFPage,
  text: string,
  font: PDFFont,
  size: number,
  baselineY: number,
  color: ReturnType<typeof rgb>
) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (PAGE_W - w) / 2, y: baselineY, size, font, color });
}

function drawLabelValueBlock(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  labelColW: number,
  label: string,
  value: string,
  font: PDFFont,
  fontBold: PDFFont,
  black: ReturnType<typeof rgb>,
  labelSize = 13,
  valueStartSize = 22,
  valueFloorSize = 10
) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: black, borderWidth: RULE_WIDTH });
  page.drawLine({
    start: { x: x + labelColW, y },
    end: { x: x + labelColW, y: y + h },
    thickness: RULE_WIDTH,
    color: black,
  });
  page.drawText(label, { x: x + 6, y: y + h / 2 - labelSize * 0.35, size: labelSize, font: fontBold, color: black });
  const valueMaxW = w - labelColW - 12;
  const valueSize = fitSize(value, font, valueMaxW, valueStartSize, valueFloorSize);
  page.drawText(value, {
    x: x + labelColW + 6,
    y: y + h / 2 - valueSize * 0.35,
    size: valueSize,
    font,
    color: black,
  });
}

function drawLabelPage(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  black: ReturnType<typeof rgb>,
  logoImg: Awaited<ReturnType<PDFDocument["embedPng"]>> | null,
  customer: string,
  date: string,
  bag: BagLabel
) {
  const contentW = PAGE_W - 2 * MARGIN;
  let cursorY = PAGE_H - MARGIN;

  // 1. Header — constant customer string, centered, bold, no border.
  const headerSize = fitSize(customer, fontBold, contentW - 16, 32, 14);
  drawCentered(page, customer, fontBold, headerSize, cursorY - HEADER_H + 12, black);
  cursorY -= HEADER_H + GAP;

  // 2. Product box — bordered, SKU centered, auto-shrunk.
  const boxY = cursorY - PRODUCT_BOX_H;
  page.drawRectangle({
    x: MARGIN,
    y: boxY,
    width: contentW,
    height: PRODUCT_BOX_H,
    borderColor: black,
    borderWidth: RULE_WIDTH,
  });
  const itemSize = fitSize(bag.item, fontBold, contentW - 16, 32, 14);
  drawCentered(page, bag.item, fontBold, itemSize, boxY + PRODUCT_BOX_H / 2 - itemSize * 0.35, black);
  cursorY = boxY - GAP;

  // 3. 4-row spec table (SIZE, DATE, DENSITY, BAG — BAG is the 4th row, not part of the bottom row).
  const specRows: Array<[string, string]> = [
    ["SIZE", bag.sizeStr],
    ["DATE", date],
    ["DENSITY", bag.densityStr],
    ["BAG", `${bag.bagNumber} of ${bag.totalBags}`],
  ];
  for (const [label, value] of specRows) {
    const rowY = cursorY - TABLE_ROW_H;
    drawLabelValueBlock(page, MARGIN, rowY, contentW, TABLE_ROW_H, TABLE_LABEL_COL_W, label, value, font, fontBold, black);
    cursorY = rowY;
  }
  cursorY -= GAP;

  // 4. Bottom row — QTY (pieces in this bag) on the left, panda logo bottom-right.
  const bottomY = cursorY - BOTTOM_ROW_H;
  drawLabelValueBlock(
    page,
    MARGIN,
    bottomY,
    QTY_BLOCK_W,
    BOTTOM_ROW_H,
    QTY_LABEL_COL_W,
    "QTY",
    qtyString(bag.piecesInBag),
    font,
    fontBold,
    black,
    14,
    24,
    11
  );

  if (logoImg) {
    // Clamp on BOTH axes — the logo area right of the QTY block is narrow, so a wide/tall logo
    // sized by only one axis could overflow into the QTY block or past the page margin. Scale by
    // whichever axis (available height vs. available width) is tighter; never hardcode a square —
    // width is always derived from the embedded image's real aspect ratio.
    const logoAreaX = MARGIN + QTY_BLOCK_W + BOTTOM_GAP;
    const logoAreaW = PAGE_W - MARGIN - logoAreaX;
    const maxLogoH = BOTTOM_ROW_H - 12;
    const scale = Math.min(maxLogoH / logoImg.height, logoAreaW / logoImg.width);
    const logoW = logoImg.width * scale;
    const logoH = logoImg.height * scale;
    const logoX = PAGE_W - MARGIN - logoW;
    page.drawImage(logoImg, { x: logoX, y: bottomY + (BOTTOM_ROW_H - logoH) / 2, width: logoW, height: logoH });
  }
}
