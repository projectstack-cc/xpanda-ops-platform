// src/lib/loadingDiagramPdf.ts
// lb-ui-08: standalone loading-diagram PDF builder. Sprint step 4 of 7.
//
// Step 0 findings (load-builder.html):
// - buildTopViewSVG (:1054, on-screen) and buildPrintSvg (:1113, print) ARE the same top-down
//   projection TrailerDiagram.tsx already uses — both key off row.posFromFront/rowLength and
//   column.posY/colWidth scaled against dims.length/dims.width, rear-at-origin, front at the far
//   edge. buildPrintSvg's only real differences are print-only: a fitScale that caps total width to
//   SVG_PRINT_MAX_WIDTH (fit-to-page), plain white/black boxes with dense multi-line stack labels
//   (getStackPrintLines) instead of on-screen color tinting, and heavier stroke/text weights for
//   print legibility. Both carried forward here: layoutColumnRects below is the same percentage-of-
//   self math TrailerDiagram.tsx uses (verified against that file directly), and the PDF page size
//   is fixed (not auto-scaled) the same way buildPrintSvg fits within one bound.
// - printPackingSlip (:1174, popup + window.print()) and buildLoadingDiagramPdfBytes (:1182) are two
//   OUTPUT PATHS for the exact same content (buildLoadingDiagramInnerHtml, :1166): the popup writes
//   that HTML directly for browser printing; the PDF path renders the SAME html off-screen,
//   rasterizes it with html2canvas, and embeds the resulting PNG as a single full-page image via
//   pdf-lib. **Deliberate divergence from legacy here**: this prompt's Design Decisions lock a
//   native vector PDF (pdf-lib draws text/rects directly, matching bolShared.ts's own approach) —
//   no html2canvas dependency, no raster step, sharper output, smaller files. One builder only (no
//   separate "print path"): the PDF opens directly in a new tab, and the browser's own print dialog
//   handles printing a PDF natively — legacy's popup+document.write dance is not needed.
// - Confirmed per-trailer, not whole-plan: printPackingSlip/buildLoadingDiagramPdfBytes both take a
//   single `trailer` + `trailerNumber`; the call site (:2261) is inside the per-trailer row loop.
//   No combined multi-trailer export exists in legacy. Matched here.
// - Content set (buildLoadingDiagramInnerHtml): title + trailer-type/inv# subtitle, the diagram, a
//   pieces table (swatch + name + count, from trailer.skuBreakdown), a stack breakdown table (stack
//   count + per-layer size pattern, from trailer.stackPatterns), and a runner-dunnage warning when
//   state.runnerHeight > 0. v2 has no precomputed skuBreakdown/stackPatterns equivalent on
//   PackTrailer, so buildPiecesTable/buildStackBreakdown below derive the same two tables directly
//   from trailer.rows[].columns[].layers[] — genuinely pure logic, tested in the selfcheck rather
//   than trusted by inspection.
//
// Signature note: the prompt's starting-point signature is (trailer, trailerIndex, dims, skus).
// Surfacing "PackPlan.warnings has anything relevant to this trailer" (a locked Design Decision)
// needs plan-level warnings the base four params can't carry, and the runner-dunnage note needs
// options.runnerHeight (also not in that signature — packEngine.ts has no dedicated runner-dunnage
// warning string; legacy's own note is driven straight off state.runnerHeight, not a warnings-array
// lookup, confirmed by grep). Extended with one trailing optional params object rather than widening
// the first four — a minimal, additive extension, not a rewrite of the given shape.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Dimensions, PackColumn, PackRow, PackTrailer, PackSku } from "./packEngine";

// --- pure helpers (exported for loadingDiagramPdf.selfcheck.ts) ---

/** Mirrors legacy's getStackPrintLines (load-builder.html:1044) for v2's column shape. v2 columns
 * always have a populated layers[] (unlike legacy's column, which could be several older shapes),
 * so only that one branch applies here — still worth naming/testing since it's the one piece of
 * text-formatting logic the diagram and the stack-breakdown table both depend on. */
export function formatStackLines(column: PackColumn): string[] {
  return column.layers.map((l) => `${fmtNum(l.unitHeight)}"-${l.count}`);
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/** Mirrors legacy's remaining-footage caption (load-builder.html:1071-1076): feet+inches when the
 * remainder is at least a foot, inches-only otherwise. Returns null when nothing is left (nothing
 * to caption), matching legacy's own `emptyW > 2` gate in spirit. */
export function formatRemainingLabel(dims: Dimensions, trailer: PackTrailer): string | null {
  const remainingInches = Math.round(dims.length - (trailer.usedLength || 0));
  if (remainingInches <= 0) return null;
  const feet = Math.floor(remainingInches / 12);
  const inches = remainingInches % 12;
  return feet > 0 ? `${feet}' ${inches}" remaining` : `${inches}" remaining`;
}

export interface PieceTableRow {
  skuId: string;
  name: string;
  color: string;
  pieces: number;
  dimsLabel: string;
}

/** Formats a SKU's NATIVE L×W×H (from the parts-library record, not the as-placed orientation) —
 * deliberate: buildPiecesTable aggregates one row per SKU, and a SKU placed in different
 * orientations across columns has no single as-placed footprint to print, while the native
 * dimensions are unambiguous and match what the parts library itself shows. */
function formatSkuDims(sku: PackSku | undefined): string {
  if (!sku) return "—";
  return `${fmtNum(sku.length)}"×${fmtNum(sku.width)}"×${fmtNum(sku.height)}"`;
}

/** Aggregates every layer's count by SKU across the whole trailer — the pieces table (SKU, count,
 * dimensions per the prompt's Content decision). Mirrors legacy's per-trailer skuBreakdown
 * (name-sorted), derived here directly from rows/columns/layers since v2's PackTrailer has no
 * precomputed equivalent; dimensions come from the `skus` record, not from skuName parsing. */
export function buildPiecesTable(trailer: PackTrailer, skus: PackSku[]): PieceTableRow[] {
  const skuById = new Map(skus.map((s) => [s.id, s]));
  const bySku = new Map<string, PieceTableRow>();
  for (const row of trailer.rows) {
    for (const column of row.columns) {
      for (const layer of column.layers) {
        const existing = bySku.get(layer.skuId);
        if (existing) {
          existing.pieces += layer.count;
        } else {
          bySku.set(layer.skuId, {
            skuId: layer.skuId,
            name: layer.skuName,
            color: layer.color,
            pieces: layer.count,
            dimsLabel: formatSkuDims(skuById.get(layer.skuId)),
          });
        }
      }
    }
  }
  return Array.from(bySku.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export interface StackBreakdownRow {
  pattern: string;
  stacks: number;
}

/** Groups columns by their layer-size signature ("10"-4" for a single-layer stack, "10"-4 · 8"-1"
 * for a topped-off one) and counts how many columns share it — the stack breakdown table. Mirrors
 * legacy's stackPatterns (stacks-descending sort). */
export function buildStackBreakdown(trailer: PackTrailer): StackBreakdownRow[] {
  const byPattern = new Map<string, number>();
  for (const row of trailer.rows) {
    for (const column of row.columns) {
      const pattern = formatStackLines(column).join(" · ");
      byPattern.set(pattern, (byPattern.get(pattern) ?? 0) + 1);
    }
  }
  return Array.from(byPattern.entries())
    .map(([pattern, stacks]) => ({ pattern, stacks }))
    .sort((a, b) => b.stacks - a.stacks);
}

/** Trailer-scoped subset of PackPlan.warnings — packEngine.ts's applyStabilityWarnings writes
 * `trailer ${ti} row ${ri} column ${ci}: stability: ...` (verified by grep, packEngine.ts:907);
 * this pulls out only the lines for one trailer index rather than dumping the whole plan's
 * warnings onto every trailer's diagram. */
export function filterTrailerWarnings(warnings: string[], trailerIndex: number): string[] {
  const prefix = `trailer ${trailerIndex} `;
  return warnings.filter((w) => w.startsWith(prefix));
}

export interface LayoutRect {
  rowIndex: number;
  columnIndex: number;
  x: number;
  y: number; // pdf-lib coordinates: bottom-left corner
  width: number;
  height: number;
}

interface DiagramBox {
  x: number;
  yTop: number; // pdf-lib y of the box's TOP edge (pdf-lib's origin is bottom-left)
  width: number;
  height: number;
}

/** Same percentage-of-self geometry TrailerDiagram.tsx uses on screen (rowWidthPct =
 * rowLength/dims.length, heightPct = colWidth/dims.width, topPct = posY/dims.width, widthPct =
 * colLength/rowLength, flush to the row's near/rear edge) — ported from CSS percentages (top-down,
 * origin top-left) into pdf-lib points (origin bottom-left), not re-derived. Pure and deterministic:
 * the one piece of layout math worth isolating and testing per Part C, since a transposed axis here
 * would silently draw a diagram that doesn't match what the planner saw on screen. */
export function layoutColumnRects(trailer: PackTrailer, dims: Dimensions, box: DiagramBox): LayoutRect[] {
  const rects: LayoutRect[] = [];
  trailer.rows.forEach((row: PackRow, rowIndex) => {
    const rowXFrac = dims.length > 0 ? row.posFromFront / dims.length : 0;
    const rowWFrac = dims.length > 0 ? row.rowLength / dims.length : 0;
    const rowX = box.x + rowXFrac * box.width;
    const rowW = rowWFrac * box.width;
    row.columns.forEach((column: PackColumn, columnIndex) => {
      const topFrac = dims.width > 0 ? column.posY / dims.width : 0;
      const heightFrac = dims.width > 0 ? column.colWidth / dims.width : 0;
      const widthFrac = row.rowLength > 0 ? column.colLength / row.rowLength : 1;
      const colX = rowX; // flush to the row's near (rear) edge, matching TrailerDiagram's left-0
      const colW = widthFrac * rowW;
      const colH = heightFrac * box.height;
      const colTopY = box.yTop - topFrac * box.height;
      const colY = colTopY - colH;
      rects.push({ rowIndex, columnIndex, x: colX, y: colY, width: colW, height: colH });
    });
  });
  return rects;
}

// --- PDF assembly ---

const PAGE_WIDTH = 792; // US Letter landscape, points — matches bolShared.ts's template convention
const PAGE_HEIGHT = 612;
const MARGIN = 36;

const INK = rgb(0.06, 0.09, 0.15); // ~#0f172a, matches legacy's print body color
const LINE = rgb(0.2, 0.24, 0.33); // ~#334155, matches legacy's print stroke color
const MUTED = rgb(0.4, 0.45, 0.55); // ~#64748b
const WARN = rgb(0.57, 0.25, 0.02); // ~#92400e, matches legacy's runner-note color

export interface BuildLoadingDiagramPdfOptions {
  /** Drives the runner-dunnage note, exactly like legacy's `state.runnerHeight > 0` gate — not a
   * packEngine.ts warnings-array entry (there isn't one). */
  runnerHeight?: number;
  /** Plan-level warnings; only entries naming this trailer are shown (filterTrailerWarnings). */
  warnings?: string[];
  /** Optional per-trailer invoice number (legacy: state.trailerInvNumbers[ti]), shown in the
   * subtitle when present. */
  invoiceNumber?: string;
}

/** Builds one trailer's loading-diagram PDF: the top-down layout, a pieces table, a stack
 * breakdown, and any relevant warnings — pdf-lib only (StandardFonts, drawText/drawRectangle), no
 * DOM, no canvas, no fetch. Returns bytes from a standalone PDFDocument (via .save()), the same
 * loadable/copyPages-able shape bolShared.ts's own packingSlipPdfBytes merge path already consumes
 * (bolShared.ts:570-578) — lb-ui-09 wires that merge; this prompt only produces the bytes. */
export async function buildLoadingDiagramPdf(
  trailer: PackTrailer,
  trailerIndex: number,
  dims: Dimensions,
  skus: PackSku[],
  options: BuildLoadingDiagramPdfOptions = {}
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  let cursorY = PAGE_HEIGHT - MARGIN;

  // Title + subtitle
  page.drawText(`Trailer ${trailerIndex + 1} Loading Diagram`, { x: MARGIN, y: cursorY - 20, size: 20, font: fontBold, color: INK });
  cursorY -= 26;
  const invSuffix = options.invoiceNumber ? ` · INV# ${options.invoiceNumber}` : "";
  page.drawText(`${dims.length}"L × ${dims.width}"W × ${dims.height}"H${invSuffix}`, { x: MARGIN, y: cursorY - 12, size: 12, font, color: MUTED });
  cursorY -= 22;

  // Runner-dunnage note (legacy: runner-height gate, not a warnings-array lookup)
  if ((options.runnerHeight ?? 0) > 0) {
    page.drawText(`RUNNERS: ${options.runnerHeight}" dunnage required under all stacks`, { x: MARGIN, y: cursorY - 12, size: 11, font: fontBold, color: WARN });
    cursorY -= 20;
  }

  // Trailer-scoped stability warnings — one compact summary line, never one line per violation.
  // A dense load can carry dozens of per-column stability notes (found during manual PDF review:
  // an early draft printed each one verbatim and pushed the diagram off the bottom of the page for
  // a 32-warning trailer); this stays a single fixed-height line regardless of count, matching
  // legacy's own single-notice style for the runner-dunnage warning rather than a growing list.
  const trailerWarnings = filterTrailerWarnings(options.warnings ?? [], trailerIndex);
  if (trailerWarnings.length > 0) {
    const summary = `${trailerWarnings.length} stack${trailerWarnings.length === 1 ? "" : "s"} flagged for stability — see the on-screen detail panel for specifics`;
    page.drawText(summary, { x: MARGIN, y: cursorY - 12, size: 10, font: fontBold, color: WARN });
    cursorY -= 20;
  }
  cursorY -= 6;

  // Diagram
  const diagramHeight = 190;
  const diagramTop = cursorY;
  const box: DiagramBox = { x: MARGIN + 30, yTop: diagramTop, width: PAGE_WIDTH - MARGIN * 2 - 60, height: diagramHeight };
  drawDiagram(page, font, fontBold, trailer, dims, box);
  cursorY = diagramTop - diagramHeight - 34;

  // Two-column tables: pieces (left) / stack breakdown (right)
  const tableTop = cursorY;
  const colGap = 16;
  const colWidth = (PAGE_WIDTH - MARGIN * 2 - colGap) / 2;
  drawPiecesTable(page, font, fontBold, buildPiecesTable(trailer, skus), { x: MARGIN, yTop: tableTop, width: colWidth });
  drawStackTable(page, font, fontBold, buildStackBreakdown(trailer), { x: MARGIN + colWidth + colGap, yTop: tableTop, width: colWidth });

  return doc.save();
}

function drawDiagram(page: PDFPage, font: PDFFont, fontBold: PDFFont, trailer: PackTrailer, dims: Dimensions, box: DiagramBox) {
  const boxBottomY = box.yTop - box.height;

  // Outer trailer boundary
  page.drawRectangle({ x: box.x, y: boxBottomY, width: box.width, height: box.height, borderColor: LINE, borderWidth: 2, color: rgb(1, 1, 1) });

  // Row R{n} labels + dashed row-boundary lines
  trailer.rows.forEach((row, rowIndex) => {
    const rowXFrac = dims.length > 0 ? row.posFromFront / dims.length : 0;
    const rowWFrac = dims.length > 0 ? row.rowLength / dims.length : 0;
    const rowX = box.x + rowXFrac * box.width;
    const rowW = rowWFrac * box.width;
    const label = `R${rowIndex + 1}`;
    const labelWidth = fontBold.widthOfTextAtSize(label, 9);
    page.drawText(label, { x: rowX + rowW / 2 - labelWidth / 2, y: box.yTop + 4, size: 9, font: fontBold, color: MUTED });
    if (rowIndex > 0) {
      page.drawLine({ start: { x: rowX, y: box.yTop }, end: { x: rowX, y: boxBottomY }, thickness: 0.75, color: MUTED, dashArray: [3, 2] });
    }
  });

  // Column rects + stack-size labels
  for (const rect of layoutColumnRects(trailer, dims, box)) {
    const column = trailer.rows[rect.rowIndex].columns[rect.columnIndex];
    page.drawRectangle({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, borderColor: LINE, borderWidth: 1.2, color: rgb(1, 1, 1) });
    const lines = formatStackLines(column).filter(Boolean);
    if (lines.length && rect.width > 14 && rect.height > 10) {
      const size = Math.max(6, Math.min(11, rect.height / (lines.length + 0.6), rect.width / 6));
      const lineGap = size + 1.5;
      let ty = rect.y + rect.height / 2 + ((lines.length - 1) * lineGap) / 2;
      for (const line of lines) {
        const w = fontBold.widthOfTextAtSize(line, size);
        if (w <= rect.width - 2) {
          page.drawText(line, { x: rect.x + rect.width / 2 - w / 2, y: ty - size / 2.6, size, font: fontBold, color: INK });
        }
        ty -= lineGap;
      }
    }
  }

  // REAR / FRONT + dims caption
  page.drawText("REAR", { x: box.x - 28, y: boxBottomY - 12, size: 10, font: fontBold, color: MUTED });
  page.drawText("FRONT", { x: box.x + box.width + 6, y: box.yTop - box.height / 2 - 4, size: 10, font: fontBold, color: rgb(0.85, 0.55, 0.02) });
  const remaining = formatRemainingLabel(dims, trailer);
  const caption = remaining ? `${dims.length}"L × ${dims.width}"W — ${remaining}` : `${dims.length}"L × ${dims.width}"W`;
  const capW = font.widthOfTextAtSize(caption, 10);
  page.drawText(caption, { x: box.x + box.width / 2 - capW / 2, y: boxBottomY - 24, size: 10, font, color: MUTED });
}

function drawPiecesTable(page: PDFPage, font: PDFFont, fontBold: PDFFont, rows: PieceTableRow[], area: { x: number; yTop: number; width: number }) {
  page.drawText("PIECES", { x: area.x, y: area.yTop, size: 11, font: fontBold, color: INK });
  let y = area.yTop - 16;
  const rowH = 14;
  const countColW = 26;
  const dimsColW = 70;
  for (const r of rows) {
    const swatch = parseHexColor(r.color);
    page.drawRectangle({ x: area.x, y: y - 8, width: 9, height: 9, color: swatch });
    page.drawText(r.name, { x: area.x + 14, y: y - 7, size: 9.5, font, color: INK, maxWidth: area.width - 14 - countColW - dimsColW });
    const dimsW = font.widthOfTextAtSize(r.dimsLabel, 8.5);
    page.drawText(r.dimsLabel, { x: area.x + area.width - countColW - dimsW - 8, y: y - 7, size: 8.5, font, color: MUTED });
    const countText = String(r.pieces);
    const countW = font.widthOfTextAtSize(countText, 9.5);
    page.drawText(countText, { x: area.x + area.width - countW, y: y - 7, size: 9.5, font: fontBold, color: INK });
    y -= rowH;
  }
  if (rows.length === 0) {
    page.drawText("No pieces placed.", { x: area.x, y: y - 7, size: 9.5, font, color: MUTED });
  }
}

function drawStackTable(page: PDFPage, font: PDFFont, fontBold: PDFFont, rows: StackBreakdownRow[], area: { x: number; yTop: number; width: number }) {
  page.drawText("STACK BREAKDOWN", { x: area.x, y: area.yTop, size: 11, font: fontBold, color: INK });
  let y = area.yTop - 16;
  const rowH = 14;
  for (const r of rows) {
    const countText = String(r.stacks);
    page.drawText(countText, { x: area.x, y: y - 7, size: 9.5, font: fontBold, color: INK });
    page.drawText(r.pattern, { x: area.x + 24, y: y - 7, size: 9.5, font, color: INK, maxWidth: area.width - 24 });
    y -= rowH;
  }
  if (rows.length === 0) {
    page.drawText("No stacks placed.", { x: area.x, y: y - 7, size: 9.5, font, color: MUTED });
  }
}

function parseHexColor(hex: string): ReturnType<typeof rgb> {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return MUTED;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
