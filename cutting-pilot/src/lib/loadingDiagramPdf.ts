// src/lib/loadingDiagramPdf.ts
// lb-ui-08: standalone loading-diagram PDF builder. Sprint step 4 of 7.
//
// Step 0 findings (load-builder.html):
// - buildTopViewSVG (:1054, on-screen) and buildPrintSvg (:1113, print) ARE the same top-down
//   projection TrailerDiagram.tsx originally used — both key off row.posFromFront/rowLength and
//   column.posY/colWidth scaled against dims.length/dims.width, rear-at-origin, front at the far
//   edge. **Steve, 2026-09-16: v2 no longer matches this** — row order is mirrored to nose-left/
//   doors-right, see layoutColumnRects' own header comment. buildPrintSvg's only real differences
//   are print-only: a fitScale that caps total width to SVG_PRINT_MAX_WIDTH (fit-to-page), plain
//   white/black boxes with dense multi-line stack labels (getStackPrintLines) instead of on-screen
//   color tinting, and heavier stroke/text weights for print legibility. Both carried forward here:
//   layoutColumnRects below is the same percentage-of-
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
// - Content set (buildLoadingDiagramInnerHtml): title (+ BOL # on the right, lb-diag-02) +
//   trailer-type/inv# subtitle, the diagram, a
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
//
// lbr-05: same colors as the screen. Each column is filled with its base layer's thicknessColor
// (thicknessPalette.ts — the one place diagram data colors live) and labelled in its fg; a topped
// stack draws its top-off as a band in the top layer's color above a dashed separator, exactly as
// TrailerDiagram.tsx does. Black-and-white safe: labels always print, and hatching (fractional / >16"
// sizes) is drawn as real diagonal lines, not a tint. The PIECES table swatches use the same palette
// (by the SKU's placed thickness) instead of the old per-SKU colorForSku hash. Printed labels use a
// plain `"` because pdf-lib's standard Helvetica (WinAnsi) can't encode the ″ glyph.
//
// lbr-09 (Steve, 2026-10-13): floor terms — FRONT = doors (R1, right), REAR = nose (left); labels
// only, the layout is unchanged (see endLabels). PIECES and STACK BREAKDOWN start 14pt lower and are
// real tables: a bold header row, 16pt rows, a 0.5pt rule under the header and between rows, a rule
// at the bottom, and a Color column — the stack breakdown's swatches (base, then top-off) sit directly
// left of each pattern (Color · Stack · Stacks). A table that runs past the bottom margin continues on a new page under "Trailer N
// Loading Diagram (cont.)" with its header repeated, so nothing is drawn off the page.
//
// lb-diag-01 (Steve, 2026-10-26): supersedes lbr-09's FRONT/REAR — the floor calls the nose end the
// WALL and the door end the DOORS (labels only; internal names like posFromFront / FRONT_ORANGE stay).
// WALL now sits vertically centred left of the box, mirroring DOORS on the right. Freight is loaded
// wall-first, so the load draws flush to the wall and any unused length shows at the doors (rowSpanX),
// with a dashed line marking the load's doors-side end.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Dimensions, PackColumn, PackRow, PackTrailer, PackSku } from "./packEngine";
import { thicknessColor } from "./thicknessPalette";

// --- pure helpers (exported for loadingDiagramPdf.selfcheck.ts) ---

/** Mirrors legacy's getStackPrintLines (load-builder.html:1044) for v2's column shape. v2 columns
 * always have a populated layers[] (unlike legacy's column, which could be several older shapes),
 * so only that one branch applies here — still worth naming/testing since it's the one piece of
 * text-formatting logic the diagram and the stack-breakdown table both depend on. */
export function formatStackLines(column: PackColumn): string[] {
  // lb-box-03: an on-edge column's layer unitHeight is the 24" tier, not a size — it reads by
  // thickness (colWidth) so the floor never mistakes it for a flat stack.
  if (column.onEdge) return column.layers.map((l) => `${fmtNum(column.colWidth)}" on edge - ${l.count}`);
  return column.layers.map((l) => `${fmtNum(l.unitHeight)}"-${l.count}`);
}

/** lb-box-03: the board thickness a layer represents — colWidth for an on-edge column (its layer
 * unitHeight is the 24" tier), unitHeight otherwise. Drives the thickness palette. */
export function layerThickness(column: PackColumn, layer: { unitHeight: number }): number {
  return column.onEdge ? column.colWidth : layer.unitHeight;
}

/** lb-box-03: one compact label for a row's whole on-edge slot ("7×1"-4 2×6"-4"), so 1"–6" columns
 * never carry their own text. null when the row has no on-edge column. */
export function formatEdgeSlotDetail(row: PackRow): string | null {
  const edges = row.columns.filter((c) => c.onEdge);
  if (edges.length === 0) return null;
  const groups = new Map<string, number>();
  for (const c of edges) {
    const key = `${fmtNum(c.colWidth)}"-${c.stackCount}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return Array.from(groups.entries())
    .map(([key, n]) => (n > 1 ? `${n}×${key}` : key))
    .join(" ");
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
  /** lbr-05: the thickness palette color for this SKU's placed thickness (was the per-SKU hash). */
  color: string;
  /** lbr-05: true when that thickness is drawn hatched (fractional or > 16"). */
  hatched: boolean;
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
          const tc = thicknessColor(layerThickness(column, layer));
          bySku.set(layer.skuId, {
            skuId: layer.skuId,
            name: layer.skuName,
            color: tc.bg,
            hatched: tc.hatched,
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
  /** lbr-09: the pattern's layers, base first — drives the Color cell's swatches (base, then top-off). */
  layers: { unitHeight: number }[];
}

/** Groups columns by their layer-size signature ("10"-4" for a single-layer stack, "10"-4 · 8"-1"
 * for a topped-off one) and counts how many columns share it — the stack breakdown table. Mirrors
 * legacy's stackPatterns (stacks-descending sort). Columns sharing a pattern share its layer sizes,
 * so `layers` comes from the first column seen. */
export function buildStackBreakdown(trailer: PackTrailer): StackBreakdownRow[] {
  const byPattern = new Map<string, StackBreakdownRow>();
  for (const row of trailer.rows) {
    for (const column of row.columns) {
      const pattern = formatStackLines(column).join(" · ");
      const existing = byPattern.get(pattern);
      if (existing) existing.stacks += 1;
      else byPattern.set(pattern, { pattern, stacks: 1, layers: column.layers.map((l) => ({ unitHeight: layerThickness(column, l) })) });
    }
  }
  return Array.from(byPattern.values()).sort((a, b) => b.stacks - a.stacks);
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

export interface DiagramBox {
  x: number;
  yTop: number; // pdf-lib y of the box's TOP edge (pdf-lib's origin is bottom-left)
  width: number;
  height: number;
}

/** Same percentage-of-self geometry TrailerDiagram.tsx uses on screen (rowWidthPct =
 * rowLength/dims.length, heightPct = colWidth/dims.width, topPct = posY/dims.width, widthPct =
 * colLength/rowLength) — ported from CSS percentages (top-down, origin top-left) into pdf-lib
 * points (origin bottom-left), not re-derived. Pure and deterministic: the one piece of layout math
 * worth isolating and testing per Part C, since a transposed axis here would silently draw a diagram
 * that doesn't match what the planner saw on screen.
 *
 * Steve, 2026-09-16: mirrored so the nose (cab end) draws on the left and the rear (doors) draws on
 * the right — readers scan left to right, and loading runs nose-first (lb-engine-03 B3's own row
 * ordering). Was rear-left/nose-right (matching legacy's own buildTopViewSVG/buildPrintSvg, and the
 * previous TrailerDiagram.tsx convention) — deliberately deviated from both on this direct
 * instruction. This mirror is thickness-agnostic (index-based only); see packEngine.ts's own
 * row-order-nose-first comment for which end the thickest freight actually sits at. `rowX` below is
 * a mirror transform (`1 - endFrac`, not `startFrac`) so each row's on-screen LEFT edge is its true nose-ward
 * (far) edge — this flips ROW order only. A shallow column's own anchor within its row (flush to the
 * row's left edge, colX = rowX) is UNCHANGED (lb-diag-01: rowX now comes from rowSpanX, which also
 * anchors the load to the wall instead of the doors): PackColumn carries no along-length offset within its
 * row (only posY, on the width axis), so which end of the row's depth a shallow column visually sits
 * against was never a physical placement fact to begin with — it's a display convention for showing
 * the lane's wastedFloorArea, and has nothing to mirror. */
export function layoutColumnRects(trailer: PackTrailer, dims: Dimensions, box: DiagramBox): LayoutRect[] {
  const rects: LayoutRect[] = [];
  trailer.rows.forEach((row: PackRow, rowIndex) => {
    const { x: rowX, width: rowW } = rowSpanX(trailer, dims, box, row);
    row.columns.forEach((column: PackColumn, columnIndex) => {
      const topFrac = dims.width > 0 ? column.posY / dims.width : 0;
      const heightFrac = dims.width > 0 ? column.colWidth / dims.width : 0;
      const widthFrac = row.rowLength > 0 ? column.colLength / row.rowLength : 1;
      const colW = widthFrac * rowW;
      const colX = rowX; // flush to the row's own left edge — a display convention, not mirrored
      const colH = heightFrac * box.height;
      const colTopY = box.yTop - topFrac * box.height;
      const colY = colTopY - colH;
      rects.push({ rowIndex, columnIndex, x: colX, y: colY, width: colW, height: colH });
    });
  });
  return rects;
}

/** lb-diag-01: one row's horizontal span in the box. Wall-anchored: `noseEnd` (the furthest
 * posFromFront + rowLength over all rows — computed, not read from usedLength) maps to box.x, so the
 * nose-most row starts at the wall and the unused length sits at the doors (right). A full-length
 * trailer draws exactly as before. Used by both layoutColumnRects and drawDiagram. */
export function rowSpanX(trailer: PackTrailer, dims: Dimensions, box: DiagramBox, row: PackRow): { x: number; width: number } {
  if (dims.length <= 0) return { x: box.x, width: 0 };
  const noseEnd = loadNoseEnd(trailer);
  return {
    x: box.x + ((noseEnd - (row.posFromFront + row.rowLength)) / dims.length) * box.width,
    width: (row.rowLength / dims.length) * box.width,
  };
}

/** lb-diag-01: max over rows of posFromFront + rowLength (0 for an empty trailer). */
export function loadNoseEnd(trailer: PackTrailer): number {
  return trailer.rows.reduce((m, r) => Math.max(m, r.posFromFront + r.rowLength), 0);
}

// --- PDF assembly ---

const PAGE_WIDTH = 792; // US Letter landscape, points — matches bolShared.ts's template convention
const PAGE_HEIGHT = 612;
const MARGIN = 36;
// lbr-08: the dims / remaining-footage caption's band under the diagram box. The caption used to sit
// where the PIECES / STACK BREAKDOWN headings start (it overlapped them); it now sits right under the
// box and the tables start this much lower.
const DIAGRAM_CAPTION_H = 16;

const INK = rgb(0.06, 0.09, 0.15); // ~#0f172a, matches legacy's print body color
const LINE = rgb(0.2, 0.24, 0.33); // ~#334155, matches legacy's print stroke color
const MUTED = rgb(0.4, 0.45, 0.55); // ~#64748b
const WARN = rgb(0.57, 0.25, 0.02); // ~#92400e, matches legacy's runner-note color
const FRONT_ORANGE = rgb(0.85, 0.55, 0.02);

// lbr-09: tables. TABLE_DROP is the extra space between the diagram caption and the tables.
const TABLE_DROP = 14;
const TABLE_TITLE_H = 18; // title baseline -> bottom of the header row
const TABLE_HEADER_H = 14;
const TABLE_ROW_H = 16;
const CONT_TITLE_H = 26;

export interface EndLabel {
  text: "DOORS" | "WALL";
  side: "left" | "right";
  x: number;
  y: number;
  /** The orange emphasis — always on DOORS. */
  emphasis: boolean;
}

/** Size of the end labels, drawn in the bold font. */
export const END_LABEL_SIZE = 10;

/** The diagram's end labels. Floor terms (lb-diag-01, supersedes lbr-09's FRONT/REAR): WALL = nose,
 * DOORS = door end. The doors end (trailer.rows[0], posFromFront 0, R1) draws on the right — see
 * layoutColumnRects — so DOORS is the right-side label and carries the orange emphasis; WALL mirrors
 * it on the left, vertically centred, its right edge 6pt clear of the box (measured with `fontBold`). */
export function endLabels(box: DiagramBox, fontBold: PDFFont): EndLabel[] {
  const midY = box.yTop - box.height / 2 - 4;
  const wallW = fontBold.widthOfTextAtSize("WALL", END_LABEL_SIZE);
  return [
    { text: "WALL", side: "left", x: box.x - 6 - wallW, y: midY, emphasis: false },
    { text: "DOORS", side: "right", x: box.x + box.width + 6, y: midY, emphasis: true },
  ];
}

/** Rows that fit under a table whose title baseline is at `yTop`, above the bottom margin. */
export function tableRowCapacity(yTop: number): number {
  return Math.max(1, Math.floor((yTop - TABLE_TITLE_H - MARGIN) / TABLE_ROW_H));
}

/** Splits `rowCount` table rows into per-page counts: `firstCapacity` on the first page, then
 * `contCapacity` on each continuation page. An empty table still takes its one first-page slot. */
export function paginateRows(rowCount: number, firstCapacity: number, contCapacity: number): number[] {
  const pages = [Math.min(rowCount, firstCapacity)];
  let left = rowCount - pages[0];
  while (left > 0) {
    const n = Math.min(left, contCapacity);
    pages.push(n);
    left -= n;
  }
  return pages;
}

/** Title baseline of a table on a continuation page (under the "(cont.)" title). */
export const CONT_TABLE_TOP = PAGE_HEIGHT - MARGIN - CONT_TITLE_H - TABLE_DROP;

export interface BuildLoadingDiagramPdfOptions {
  /** Drives the runner-dunnage note, exactly like legacy's `state.runnerHeight > 0` gate — not a
   * packEngine.ts warnings-array entry (there isn't one). */
  runnerHeight?: number;
  /** Plan-level warnings; only entries naming this trailer are shown (filterTrailerWarnings). */
  warnings?: string[];
  /** lb-diag-02: this trailer's BOL # (the Load Builder card's input, saved by the BOL generator as
   * `bol_number`). Printed bold at the top right of the title row; "BOL # —" in grey when absent,
   * so a missing number shows on the floor instead of silently vanishing. */
  bolNumber?: string;
  /** The job's invoice #, appended to the subtitle as " · INV# …" when present and different from
   * the BOL #. */
  invoiceNumber?: string;
}

/** lb-diag-02: the header's label logic, pure so the selfcheck can test it without rendering. */
export function diagramHeaderText(options: Pick<BuildLoadingDiagramPdfOptions, "bolNumber" | "invoiceNumber">): { bol: string | null; subtitleSuffix: string } {
  const bol = options.bolNumber?.trim() || null;
  const inv = options.invoiceNumber?.trim() || "";
  return { bol, subtitleSuffix: inv && inv !== bol ? ` · INV# ${inv}` : "" };
}

const TITLE_SIZE = 20;
const BOL_SIZE = 16;
const BOL_MIN_SIZE = 12;
const BOL_GAP = 16; // minimum space between the title and the BOL #

/** Draws "BOL # …" right-aligned on a title row (baseline `y`) whose title is `title`: bold 16pt
 * INK, shrinking to 12pt and then truncating so it never runs into the title; "BOL # —" in MUTED
 * when there's no number. */
function drawBolLabel(page: PDFPage, fontBold: PDFFont, title: string, bol: string | null, y: number) {
  const text = `BOL # ${bol ?? "—"}`;
  const right = PAGE_WIDTH - MARGIN;
  const room = right - (MARGIN + fontBold.widthOfTextAtSize(title, TITLE_SIZE) + BOL_GAP);
  let size = BOL_SIZE;
  while (size > BOL_MIN_SIZE && fontBold.widthOfTextAtSize(text, size) > room) size -= 1;
  const fitted = fitText(fontBold, text, size, room);
  const width = fontBold.widthOfTextAtSize(fitted, size);
  page.drawText(fitted, { x: right - width, y, size, font: fontBold, color: bol ? INK : MUTED });
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

  // Title (+ BOL # on the right) + subtitle
  const header = diagramHeaderText(options);
  const title = `Trailer ${trailerIndex + 1} Loading Diagram`;
  page.drawText(title, { x: MARGIN, y: cursorY - 20, size: TITLE_SIZE, font: fontBold, color: INK });
  drawBolLabel(page, fontBold, title, header.bol, cursorY - 20);
  cursorY -= 26;
  page.drawText(`${dims.length}"L × ${dims.width}"W × ${dims.height}"H${header.subtitleSuffix}`, { x: MARGIN, y: cursorY - 12, size: 12, font, color: MUTED });
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
  cursorY = diagramTop - diagramHeight - 34 - DIAGRAM_CAPTION_H - TABLE_DROP;

  // Two-column tables: pieces (left) / stack breakdown (right). Each continues onto new pages on its
  // own when it runs out of room; a continuation page is created once and shared by both.
  const tableTop = cursorY;
  const colGap = 16;
  const colWidth = (PAGE_WIDTH - MARGIN * 2 - colGap) / 2;
  const pages: PDFPage[] = [page];
  const pageAt = (i: number): PDFPage => {
    while (pages.length <= i) {
      const more = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      const contTitle = `Trailer ${trailerIndex + 1} Loading Diagram (cont.)`;
      more.drawText(contTitle, { x: MARGIN, y: PAGE_HEIGHT - MARGIN - 20, size: TITLE_SIZE, font: fontBold, color: INK });
      drawBolLabel(more, fontBold, contTitle, header.bol, PAGE_HEIGHT - MARGIN - 20);
      pages.push(more);
    }
    return pages[i];
  };
  const fonts = { font, fontBold };
  drawTable(pageAt, fonts, piecesTableSpec(buildPiecesTable(trailer, skus), colWidth), { x: MARGIN, width: colWidth }, tableTop);
  drawTable(pageAt, fonts, stackTableSpec(buildStackBreakdown(trailer), colWidth), { x: MARGIN + colWidth + colGap, width: colWidth }, tableTop);

  return doc.save();
}

/** lb-trailer-01: one trailer's input to buildAllLoadingDiagramsPdf — the same per-trailer values
 * its own card's Print / Export passes. */
export interface AllDiagramsTrailer {
  trailer: PackTrailer;
  trailerIndex: number;
  dims: Dimensions;
  bolNumber?: string;
  invoiceNumber?: string;
}

/** lb-trailer-01: "Print all diagrams" — buildLoadingDiagramPdf per trailer, merged in trailer order
 * with copyPages (bolShared.ts's merge pattern). No drawing code of its own. Empty trailers (no
 * stacks) are skipped defensively; Apply and saved-load restore already drop them. */
export async function buildAllLoadingDiagramsPdf(
  trailers: AllDiagramsTrailer[],
  skus: PackSku[],
  options: Pick<BuildLoadingDiagramPdfOptions, "runnerHeight" | "warnings"> = {}
): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const t of trailers) {
    if (t.trailer.rows.every((row) => row.columns.length === 0)) continue;
    const bytes = await buildLoadingDiagramPdf(t.trailer, t.trailerIndex, t.dims, skus, {
      runnerHeight: options.runnerHeight,
      warnings: options.warnings,
      bolNumber: t.bolNumber,
      invoiceNumber: t.invoiceNumber,
    });
    const one = await PDFDocument.load(bytes);
    const pages = await merged.copyPages(one, one.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  return merged.save();
}

function drawDiagram(page: PDFPage, font: PDFFont, fontBold: PDFFont, trailer: PackTrailer, dims: Dimensions, box: DiagramBox) {
  const boxBottomY = box.yTop - box.height;

  // Outer trailer boundary
  page.drawRectangle({ x: box.x, y: boxBottomY, width: box.width, height: box.height, borderColor: LINE, borderWidth: 2, color: rgb(1, 1, 1) });

  // Row R{n} labels + dashed row-boundary lines.
  //
  // Labels stay tied to array index (R${rowIndex+1}), NOT visual left-to-right position — even
  // though the mirror now draws row 0 (rear-most) on the right, so the printed R-numbers descend
  // left to right on a multi-row trailer. This is deliberate: `row ${rowIndex+1}` (1-based, same
  // array index) is what TrailerDiagram.tsx's aria-label, TrailerEditModal's row list/move-target
  // picker, and packEngine's own stability-warning strings ("trailer 0 row 1 column 0: ...") all
  // use — renumbering just the PDF's printed label to match reading order would make the printout
  // and the app name different physical rows for the same number. The nose-left/doors-right mirror
  // itself is what Steve asked for; row numbering wasn't part of that complaint.
  //
  // Boundary lines: drawn at each row's own left edge, skipped only when that edge coincides with
  // the box's own left or right border (which the outer rectangle already strokes) — checked by
  // position, not by array index, since the packed rows don't always span the full dims.length (a
  // trailer with unused length leaves a gap that isn't flush to either border).
  const EPS = 0.01;
  trailer.rows.forEach((row, rowIndex) => {
    const { x: rowX, width: rowW } = rowSpanX(trailer, dims, box, row);
    const label = `R${rowIndex + 1}`;
    const labelWidth = fontBold.widthOfTextAtSize(label, 9);
    page.drawText(label, { x: rowX + rowW / 2 - labelWidth / 2, y: box.yTop + 4, size: 9, font: fontBold, color: MUTED });
    const atLeftBorder = Math.abs(rowX - box.x) < EPS;
    const atRightBorder = Math.abs(rowX - (box.x + box.width)) < EPS;
    if (!atLeftBorder && !atRightBorder) {
      page.drawLine({ start: { x: rowX, y: box.yTop }, end: { x: rowX, y: boxBottomY }, thickness: 0.75, color: MUTED, dashArray: [3, 2] });
    }
  });
  // lb-diag-01: with free length, mark the load's doors-side end (R1's right edge) the same way.
  if (trailer.rows.length > 0) {
    const r1 = rowSpanX(trailer, dims, box, trailer.rows[0]);
    const loadEndX = r1.x + r1.width;
    if (loadEndX < box.x + box.width - EPS && loadEndX > box.x + EPS) {
      page.drawLine({ start: { x: loadEndX, y: box.yTop }, end: { x: loadEndX, y: boxBottomY }, thickness: 0.75, color: MUTED, dashArray: [3, 2] });
    }
  }

  // Column rects, filled by thickness (lbr-05). The top band of a topped stack sits at the column's
  // top edge (the same side TrailerDiagram.tsx draws it), sized by the top layer's share of the
  // stack height with a readable minimum, above a dashed line in the base fg.
  for (const rect of layoutColumnRects(trailer, dims, box)) {
    const column = trailer.rows[rect.rowIndex].columns[rect.columnIndex];
    const base = column.layers[0];
    const top = column.layers.length > 1 ? column.layers[column.layers.length - 1] : null;
    if (!base) continue;
    if (column.onEdge) {
      // lb-box-03: true narrow width, thickness color, always hatched (the EDGE treatment, B/W safe);
      // the text lives in one per-row slot label below, never inside a 1"–6" strip.
      page.drawRectangle({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, color: parseHexColor(thicknessColor(column.colWidth).bg) });
      drawHatch(page, rect, LINE);
      page.drawRectangle({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, borderColor: LINE, borderWidth: 0.6 });
      continue;
    }
    const baseColor = thicknessColor(base.unitHeight);
    page.drawRectangle({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, color: parseHexColor(baseColor.bg) });
    if (baseColor.hatched) drawHatch(page, rect, parseHexColor(baseColor.fg));

    let baseArea = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    if (top) {
      const topColor = thicknessColor(top.unitHeight);
      const total = column.totalHeight > 0 ? column.totalHeight : base.unitHeight * base.count + top.unitHeight * top.count;
      const frac = total > 0 ? (top.unitHeight * top.count) / total : 0;
      const bandH = Math.min(rect.height * 0.6, Math.max(rect.height * frac, Math.min(12, rect.height * 0.45)));
      const band = { x: rect.x, y: rect.y + rect.height - bandH, width: rect.width, height: bandH };
      page.drawRectangle({ ...band, color: parseHexColor(topColor.bg) });
      if (topColor.hatched) drawHatch(page, band, parseHexColor(topColor.fg));
      page.drawLine({ start: { x: band.x, y: band.y }, end: { x: band.x + band.width, y: band.y }, thickness: 1.5, color: parseHexColor(baseColor.fg), dashArray: [3, 2] });
      drawFittedLabel(page, fontBold, `+${fmtNum(top.unitHeight)}"×${top.count}`, band, parseHexColor(topColor.fg));
      baseArea = { x: rect.x, y: rect.y, width: rect.width, height: rect.height - bandH };
    }
    drawFittedLabel(page, fontBold, `${fmtNum(base.unitHeight)}"×${base.count}`, baseArea, parseHexColor(baseColor.fg));
    page.drawRectangle({ x: rect.x, y: rect.y, width: rect.width, height: rect.height, borderColor: LINE, borderWidth: 1.2 });
  }

  // lb-box-03: one label per row's on-edge slot, on a white tab so it reads over the hatch.
  const rects = layoutColumnRects(trailer, dims, box);
  trailer.rows.forEach((row, rowIndex) => {
    const detail = formatEdgeSlotDetail(row);
    if (!detail) return;
    const slotRects = rects.filter((r) => r.rowIndex === rowIndex && row.columns[r.columnIndex]?.onEdge);
    const yLo = Math.min(...slotRects.map((r) => r.y));
    const yHi = Math.max(...slotRects.map((r) => r.y + r.height));
    const area = { x: slotRects[0].x, y: yLo, width: slotRects[0].width, height: yHi - yLo };
    drawEdgeSlotLabel(page, fontBold, detail, area);
  });

  // WALL (nose, left) / DOORS (right) + dims caption — see endLabels() for the floor terms.
  for (const l of endLabels(box, fontBold)) {
    page.drawText(l.text, { x: l.x, y: l.y, size: END_LABEL_SIZE, font: fontBold, color: l.emphasis ? FRONT_ORANGE : MUTED });
  }
  const remaining = formatRemainingLabel(dims, trailer);
  const caption = remaining ? `${dims.length}"L × ${dims.width}"W — ${remaining}` : `${dims.length}"L × ${dims.width}"W`;
  const capW = font.widthOfTextAtSize(caption, 10);
  page.drawText(caption, { x: box.x + box.width / 2 - capW / 2, y: boxBottomY - DIAGRAM_CAPTION_H + 2, size: 10, font, color: MUTED });
}

/** lb-box-03: "ON EDGE" over the slot detail when both fit, else "EDGE <detail>", else "EDGE". */
function drawEdgeSlotLabel(page: PDFPage, font: PDFFont, detail: string, area: { x: number; y: number; width: number; height: number }) {
  if (area.width < 8 || area.height < 4) return;
  const fits = (text: string, size: number) => font.widthOfTextAtSize(text, size) <= area.width - 6;
  const twoLine = Math.min(10, (area.height - 2) / 2.3);
  let lines: string[];
  let size: number;
  if (twoLine >= 5 && fits("ON EDGE", twoLine) && fits(detail, twoLine)) {
    lines = ["ON EDGE", detail];
    size = twoLine;
  } else {
    size = Math.min(10, area.height * 0.7);
    lines = [`EDGE ${detail}`];
    while (size > 4 && !fits(lines[0], size)) size -= 0.5;
    if (!fits(lines[0], size)) {
      lines = ["EDGE"];
      size = Math.min(10, area.height * 0.7);
    }
  }
  const lineH = size * 1.15;
  const tabW = Math.max(...lines.map((l) => font.widthOfTextAtSize(l, size))) + 4;
  const tabH = Math.min(area.height, lines.length * lineH + 1);
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  page.drawRectangle({ x: cx - tabW / 2, y: cy - tabH / 2, width: tabW, height: tabH, color: rgb(1, 1, 1), opacity: 0.9 });
  lines.forEach((text, i) => {
    const w = font.widthOfTextAtSize(text, size);
    const y = cy + ((lines.length - 1) / 2 - i) * lineH - size / 2.8;
    page.drawText(text, { x: cx - w / 2, y, size, font, color: INK });
  });
}

/** Centers one label in `area`, shrinking down to 5pt to fit — labels are always printed so the
 * diagram reads on a black-and-white printer (color is never the only signal). */
function drawFittedLabel(page: PDFPage, font: PDFFont, text: string, area: { x: number; y: number; width: number; height: number }, color: ReturnType<typeof rgb>) {
  if (area.width < 4 || area.height < 4) return;
  let size = Math.min(11, area.height * 0.7);
  while (size > 5 && font.widthOfTextAtSize(text, size) > area.width - 2) size -= 0.5;
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: area.x + area.width / 2 - w / 2, y: area.y + area.height / 2 - size / 2.8, size, font, color });
}

/** Diagonal hatch for fractional / > 16" sizes, drawn as real lines clipped to the rect (pdf-lib has
 * no clip path helper here), so it survives black-and-white printing. Pure segment math: each line
 * y = x + c is intersected with the rect's four edges. */
export function hatchSegments(rect: { x: number; y: number; width: number; height: number }, spacing = 5): { x1: number; y1: number; x2: number; y2: number }[] {
  const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const { x, y, width: w, height: h } = rect;
  if (w <= 0 || h <= 0) return segs;
  // Lines y - y0 = (x - x0) + k, k from -w to h.
  for (let k = -w + spacing / 2; k < h; k += spacing) {
    const sx = Math.max(0, -k);
    const ex = Math.min(w, h - k);
    if (ex <= sx) continue;
    segs.push({ x1: x + sx, y1: y + sx + k, x2: x + ex, y2: y + ex + k });
  }
  return segs;
}

function drawHatch(page: PDFPage, rect: { x: number; y: number; width: number; height: number }, color: ReturnType<typeof rgb>) {
  for (const s of hatchSegments(rect)) {
    page.drawLine({ start: { x: s.x1, y: s.y1 }, end: { x: s.x2, y: s.y2 }, thickness: 0.6, color, opacity: 0.45 });
  }
}

// --- lbr-09: tables ---

interface Fonts {
  font: PDFFont;
  fontBold: PDFFont;
}

type Swatch = { color: string; hatched: boolean };
type Cell = { text: string; bold?: boolean; muted?: boolean } | { swatches: Swatch[] };

interface TableColumn {
  label: string;
  width: number;
  align: "left" | "right";
}

interface TableSpec {
  title: string;
  columns: TableColumn[];
  rows: Cell[][];
  emptyText: string;
}

const CELL_PAD = 6;
const SWATCH = 10;

function piecesTableSpec(rows: PieceTableRow[], width: number): TableSpec {
  const colorW = 34;
  const sizeW = 92;
  const piecesW = 44;
  return {
    title: "PIECES",
    columns: [
      { label: "Color", width: colorW, align: "left" },
      { label: "Part", width: width - colorW - sizeW - piecesW, align: "left" },
      { label: "Size", width: sizeW, align: "right" },
      { label: "Pieces", width: piecesW, align: "right" },
    ],
    rows: rows.map((r) => [
      { swatches: [{ color: r.color, hatched: r.hatched }] },
      { text: r.name },
      { text: r.dimsLabel, muted: true },
      { text: String(r.pieces), bold: true },
    ]),
    emptyText: "No pieces placed.",
  };
}

/** Color · Stack · Stacks: the swatches (base, then top-off) sit directly left of the pattern they
 * color, and the count is right-aligned at the end — the same shape as PIECES. */
function stackTableSpec(rows: StackBreakdownRow[], width: number): TableSpec {
  const colorW = 40;
  const stacksW = 48;
  return {
    title: "STACK BREAKDOWN",
    columns: [
      { label: "Color", width: colorW, align: "left" },
      { label: "Stack", width: width - colorW - stacksW, align: "left" },
      { label: "Stacks", width: stacksW, align: "right" },
    ],
    rows: rows.map((r) => [
      { swatches: r.layers.map((l) => ({ color: thicknessColor(l.unitHeight).bg, hatched: thicknessColor(l.unitHeight).hatched })) },
      { text: r.pattern },
      { text: String(r.stacks), bold: true },
    ]),
    emptyText: "No stacks placed.",
  };
}

/** Shortens `text` with "..." until it fits `width` at `size`. */
function fitText(font: PDFFont, text: string, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t}...`;
}

function drawRule(page: PDFPage, x: number, width: number, y: number, thickness: number) {
  page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness, color: MUTED });
}

/** Draws one table with its title baseline at `firstTop` on page 0, continuing onto pageAt(1),
 * pageAt(2)… (title + header repeated at CONT_TABLE_TOP) when its rows run past the bottom margin. */
function drawTable(pageAt: (i: number) => PDFPage, fonts: Fonts, spec: TableSpec, area: { x: number; width: number }, firstTop: number) {
  const perPage = paginateRows(spec.rows.length, tableRowCapacity(firstTop), tableRowCapacity(CONT_TABLE_TOP));
  let next = 0;
  perPage.forEach((count, pageIndex) => {
    const page = pageAt(pageIndex);
    const top = pageIndex === 0 ? firstTop : CONT_TABLE_TOP;
    page.drawText(pageIndex === 0 ? spec.title : `${spec.title} (cont.)`, { x: area.x, y: top, size: 11, font: fonts.fontBold, color: INK });

    // Header row: bold, smaller; a 0.5pt rule under it.
    let y = top - TABLE_TITLE_H + TABLE_HEADER_H; // top edge of the header row
    let cx = area.x;
    spec.columns.forEach((col, ci) => {
      const size = 8;
      const w = fonts.fontBold.widthOfTextAtSize(col.label, size);
      const tx = col.align === "right" ? cx + col.width - w - CELL_PAD : cx + (ci === 0 ? 0 : CELL_PAD);
      page.drawText(col.label, { x: tx, y: y - TABLE_HEADER_H + 4, size, font: fonts.fontBold, color: INK });
      cx += col.width;
    });
    y -= TABLE_HEADER_H;
    drawRule(page, area.x, area.width, y, 0.5);

    if (spec.rows.length === 0) {
      page.drawText(spec.emptyText, { x: area.x, y: y - TABLE_ROW_H + 5, size: 9.5, font: fonts.font, color: MUTED });
      drawRule(page, area.x, area.width, y - TABLE_ROW_H, 0.75);
      return;
    }

    for (let i = 0; i < count; i++, next++) {
      const rowBottom = y - TABLE_ROW_H;
      let x = area.x;
      spec.rows[next].forEach((cell, ci) => {
        const col = spec.columns[ci];
        const lead = ci === 0 ? 0 : CELL_PAD;
        if ("swatches" in cell) {
          cell.swatches.forEach((sw, si) => {
            const r = { x: x + lead + si * (SWATCH + 3), y: rowBottom + (TABLE_ROW_H - SWATCH) / 2, width: SWATCH, height: SWATCH };
            page.drawRectangle({ ...r, color: parseHexColor(sw.color), borderColor: LINE, borderWidth: 0.5 });
            if (sw.hatched) drawHatch(page, r, INK);
          });
        } else {
          const size = cell.muted ? 8.5 : 9.5;
          const f = cell.bold ? fonts.fontBold : fonts.font;
          const text = fitText(f, cell.text, size, col.width - lead - CELL_PAD);
          const w = f.widthOfTextAtSize(text, size);
          const tx = col.align === "right" ? x + col.width - w - CELL_PAD : x + lead;
          page.drawText(text, { x: tx, y: rowBottom + 5, size, font: f, color: cell.muted ? MUTED : INK });
        }
        x += col.width;
      });
      // 0.5pt between rows; a slightly heavier rule closes the table (or this page's part of it).
      drawRule(page, area.x, area.width, rowBottom, i === count - 1 ? 0.75 : 0.5);
      y = rowBottom;
    }
  });
}

function parseHexColor(hex: string): ReturnType<typeof rgb> {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return MUTED;
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}
