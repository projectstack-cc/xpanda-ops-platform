// src/lib/loadingDiagramPdf.selfcheck.ts
// lb-ui-08: guarded dev self-check for loadingDiagramPdf.ts's pure logic — the layout math, table
// aggregation, and text formatting that produce the PDF's content, NOT the PDF bytes themselves
// (per Part C: "if the only meaningful check is 'produces non-empty bytes without throwing', say so
// plainly" — here there IS real pure logic worth isolating, so that's tested instead). Mirrors
// dissolve.selfcheck.ts's shape: a hand-built fixture, a check()/results table, one exported
// run*SelfCheck() function. Not part of the production build path.
//
// lbr-09: async — the overflow check builds a real PDF and counts its pages with pdf-lib.
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { PackColumn, PackRow, PackTrailer, Dimensions, PackSku } from "./packEngine";
import {
  formatStackLines,
  formatRemainingLabel,
  buildPiecesTable,
  buildStackBreakdown,
  filterTrailerWarnings,
  layoutColumnRects,
  hatchSegments,
  endLabels,
  paginateRows,
  buildLoadingDiagramPdf,
  formatEdgeSlotDetail,
  layerThickness,
  rowSpanX,
  loadNoseEnd,
  END_LABEL_SIZE,
  diagramHeaderText,
} from "./loadingDiagramPdf";
import { pack, TRAILER_TYPES, DEFAULT_PACK_OPTIONS, HOLEY_BOARD_CATEGORY } from "./packEngine";
import { thicknessColor } from "./thicknessPalette";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function makeColumn(posY: number, colWidth: number, colLength: number, layers: PackColumn["layers"]): PackColumn {
  return {
    posY,
    colWidth,
    colLength,
    totalHeight: layers.reduce((s, l) => s + l.unitHeight * l.count, 0),
    totalWeight: 0,
    stackCount: layers.reduce((s, l) => s + l.count, 0),
    layers,
    mixed: new Set(layers.map((l) => l.skuId)).size > 1,
    rationale: "fixture column",
  };
}

function makeRow(posFromFront: number, rowLength: number, columns: PackColumn[]): PackRow {
  return { posFromFront, rowLength, rowWidthUsed: 0, wastedFloorArea: 0, columns, totalUnits: 0, totalWeight: 0 };
}

// Native SKU dims deliberately DIFFER from the as-placed orientation dims used in the fixture
// columns below (colA's orientation is 20x20x10, SKU A's native record is 24x18x10) — this is
// what lets the dims-column test prove the pieces table reads from the SKU record, not from the
// as-placed layer/orientation or from skuName parsing.
const SKUS: PackSku[] = [
  { id: "A", name: "SKU A", sku: "A-1", length: 24, width: 18, height: 10, weight: 50, allowRotation: true },
  { id: "B", name: "SKU B", sku: "B-1", length: 15, width: 30, height: 8, weight: 40, allowRotation: true },
];

// dims: 65"L x 50"W (arbitrary, chosen only so /65 and /50 fractions are easy to hand-verify).
const DIMS: Dimensions = { length: 65, width: 50, height: 40, maxWeight: 10000 };

// Row0 [posFromFront 0, rowLength 20]:
//   colA: posY 0,  colWidth 20, colLength 20 (== rowLength, widthFrac 1), layer SKU A ×2 @10"
//   colB: posY 20, colWidth 30, colLength 15 (0.75 of rowLength 20),      layer SKU B ×3 @8"
// Row1 [posFromFront 20, rowLength 15]:
//   colC: posY 0,  colWidth 50, colLength 15 (== rowLength, widthFrac 1), layer SKU A ×2 @10"
//     (deliberately the SAME pattern as colA — "10"-2" — to test buildStackBreakdown's grouping,
//      and the same skuId A to test buildPiecesTable's cross-column aggregation: A totals 2+2=4)
function makeFixture(): PackTrailer {
  const colA = makeColumn(0, 20, 20, [{ skuId: "A", skuName: "SKU A", skuCode: "A-1", color: "#112233", unitHeight: 10, count: 2, orientation: { length: 20, width: 20, height: 10, label: "flat" } }]);
  const colB = makeColumn(20, 30, 15, [{ skuId: "B", skuName: "SKU B", skuCode: "B-1", color: "#445566", unitHeight: 8, count: 3, orientation: { length: 15, width: 30, height: 8, label: "flat" } }]);
  const colC = makeColumn(0, 50, 15, [{ skuId: "A", skuName: "SKU A", skuCode: "A-1", color: "#112233", unitHeight: 10, count: 2, orientation: { length: 15, width: 50, height: 10, label: "flat" } }]);
  const row0 = makeRow(0, 20, [colA, colB]);
  const row1 = makeRow(20, 15, [colC]);
  return {
    dims: DIMS,
    rows: [row0, row1],
    usedLength: 35,
    usedFloorArea: 0,
    usedWeight: 0,
    totalStacks: 3,
    totalUnits: 7,
    mixedStacks: 0,
    widthUtilization: 0,
    heightUtilization: 0,
  };
}

export async function runLoadingDiagramPdfSelfCheck(): Promise<{ pass: boolean; results: CheckResult[] }> {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  const trailer = makeFixture();

  // formatStackLines: single-layer and multi-layer (mixed) columns.
  {
    const single = formatStackLines(trailer.rows[0].columns[0]); // colA: 10"×2
    check('formatStackLines: single-layer column -> ["10"-2"]', single.length === 1 && single[0] === '10"-2', JSON.stringify(single));

    const mixedColumn = makeColumn(0, 20, 20, [
      { skuId: "X", skuName: "X", skuCode: "X-1", color: "#000", unitHeight: 10, count: 2, orientation: { length: 20, width: 20, height: 10, label: "flat" } },
      { skuId: "Y", skuName: "Y", skuCode: "Y-1", color: "#000", unitHeight: 8, count: 1, orientation: { length: 20, width: 20, height: 8, label: "flat" } },
    ]);
    const mixed = formatStackLines(mixedColumn);
    check('formatStackLines: mixed column -> ["10"-2", "8"-1"], base layer first', mixed.length === 2 && mixed[0] === '10"-2' && mixed[1] === '8"-1', JSON.stringify(mixed));
  }

  // formatRemainingLabel: feet+inches, inches-only, and "nothing left" -> null.
  {
    const feetAndInches = formatRemainingLabel(DIMS, trailer); // 65 - 35 = 30 -> 2'6"
    check('formatRemainingLabel: 30" remaining -> "2\' 6" remaining"', feetAndInches === "2' 6\" remaining", String(feetAndInches));

    const inchesOnly = formatRemainingLabel(DIMS, { ...trailer, usedLength: 60 }); // 65-60=5
    check('formatRemainingLabel: 5" remaining -> "5" remaining" (no feet prefix)', inchesOnly === '5" remaining', String(inchesOnly));

    const nothingLeft = formatRemainingLabel(DIMS, { ...trailer, usedLength: 65 });
    check("formatRemainingLabel: fully used -> null (nothing to caption)", nothingLeft === null, String(nothingLeft));

    // Rounding edge cases: the TOTAL must round before the feet/inches divmod, not after (a prior
    // draft rounded the remainder of `% 12` instead, which could print "1' 12\" remaining").
    const fractionalNoCarry = formatRemainingLabel(DIMS, { ...trailer, usedLength: 65 - 11.7 }); // 11.7 -> round 12 -> 1'0"
    check('formatRemainingLabel: 11.7" remaining rounds to 12" -> "1\' 0" remaining" (not "0\' 12"")', fractionalNoCarry === "1' 0\" remaining", String(fractionalNoCarry));

    const fractionalWithCarry = formatRemainingLabel(DIMS, { ...trailer, usedLength: 65 - 23.7 }); // 23.7 -> round 24 -> 2'0"
    check('formatRemainingLabel: 23.7" remaining rounds to 24" -> "2\' 0" remaining" (not "1\' 12"")', fractionalWithCarry === "2' 0\" remaining", String(fractionalWithCarry));
  }

  // buildPiecesTable: aggregates by SKU across columns AND rows, name-sorted, dims from the SKU
  // record (not from skuName or the as-placed orientation).
  {
    const pieces = buildPiecesTable(trailer, SKUS);
    check("buildPiecesTable: exactly 2 rows (SKU A, SKU B)", pieces.length === 2, JSON.stringify(pieces));
    check(
      "buildPiecesTable: name-sorted (A before B)",
      pieces[0]?.skuId === "A" && pieces[1]?.skuId === "B",
      JSON.stringify(pieces)
    );
    check(
      "buildPiecesTable: SKU A totals 4 (2 from colA + 2 from colC, cross-row aggregation)",
      pieces.find((p) => p.skuId === "A")?.pieces === 4,
      JSON.stringify(pieces)
    );
    // lbr-05: swatches come from the thickness palette (A is 10", B is 8"), not the layer's per-SKU color.
    check(
      "buildPiecesTable: swatch colors are the thickness palette (A 10\", B 8\"), not PackLayer.color",
      pieces.find((p) => p.skuId === "A")?.color === thicknessColor(10).bg && pieces.find((p) => p.skuId === "B")?.color === thicknessColor(8).bg && pieces.every((p) => p.hatched === false),
      JSON.stringify(pieces)
    );
    check(
      "buildPiecesTable: SKU B totals 3 (colB only)",
      pieces.find((p) => p.skuId === "B")?.pieces === 3,
      JSON.stringify(pieces)
    );
    check(
      'buildPiecesTable: SKU A dimsLabel is native 24"x18"x10" from the SKU record, NOT colA\'s as-placed orientation (20x20x10)',
      pieces.find((p) => p.skuId === "A")?.dimsLabel === '24"×18"×10"',
      JSON.stringify(pieces)
    );
    check(
      'buildPiecesTable: SKU B dimsLabel is native 15"x30"x8" from the SKU record',
      pieces.find((p) => p.skuId === "B")?.dimsLabel === '15"×30"×8"',
      JSON.stringify(pieces)
    );

    const noSkuRecord = buildPiecesTable(trailer, []);
    check(
      'buildPiecesTable: missing SKU record -> dimsLabel falls back to "—", does not throw',
      noSkuRecord.every((p) => p.dimsLabel === "—"),
      JSON.stringify(noSkuRecord)
    );
  }

  // buildStackBreakdown: groups by layer-size signature, stacks-descending.
  {
    const stacks = buildStackBreakdown(trailer);
    check("buildStackBreakdown: exactly 2 patterns", stacks.length === 2, JSON.stringify(stacks));
    check(
      'buildStackBreakdown: "10"-2" pattern has 2 stacks (colA + colC) and sorts first (stacks-descending)',
      stacks[0]?.pattern === '10"-2' && stacks[0]?.stacks === 2,
      JSON.stringify(stacks)
    );
    check(
      'buildStackBreakdown: "8"-3" pattern has 1 stack (colB) and sorts second',
      stacks[1]?.pattern === '8"-3' && stacks[1]?.stacks === 1,
      JSON.stringify(stacks)
    );
    // lbr-09: layers (base first) drive the Color cell's swatches.
    check(
      "buildStackBreakdown: each row carries its layers (10\" and 8\" pure stacks -> one layer each)",
      JSON.stringify(stacks.map((r) => r.layers)) === JSON.stringify([[{ unitHeight: 10 }], [{ unitHeight: 8 }]]),
      JSON.stringify(stacks.map((r) => r.layers))
    );
    const topped: PackTrailer = {
      ...trailer,
      rows: [
        makeRow(0, 20, [
          makeColumn(0, 20, 20, [
            { skuId: "A", skuName: "SKU A", skuCode: "A-1", color: "#000", unitHeight: 10, count: 4, orientation: { length: 20, width: 20, height: 10, label: "flat" } },
            { skuId: "B", skuName: "SKU B", skuCode: "B-1", color: "#000", unitHeight: 8, count: 1, orientation: { length: 20, width: 20, height: 8, label: "flat" } },
          ]),
        ]),
      ],
    };
    const toppedRows = buildStackBreakdown(topped);
    check(
      'buildStackBreakdown: a topped pattern ("10"-4 · 8"-1") has 2 layers, base first',
      toppedRows.length === 1 && toppedRows[0].pattern === '10"-4 · 8"-1' && JSON.stringify(toppedRows[0].layers) === JSON.stringify([{ unitHeight: 10 }, { unitHeight: 8 }]),
      JSON.stringify(toppedRows)
    );
  }

  // lb-diag-01 (supersedes lbr-09's FRONT/REAR): DOORS / WALL labels. The doors end is
  // trailer.rows[0] (R1), drawn rightmost — DOORS sits on that side with the emphasis; WALL mirrors
  // it on the left, vertically centred, fully clear of the box (measured with the real bold font).
  {
    const fontBold = await (await PDFDocument.create()).embedFont(StandardFonts.HelveticaBold);
    const box = { x: 60, yTop: 400, width: 650, height: 190 };
    const labels = endLabels(box, fontBold);
    const doors = labels.find((l) => l.text === "DOORS");
    const wall = labels.find((l) => l.text === "WALL");
    const rects = layoutColumnRects(trailer, DIMS, box);
    const r1 = rects.find((r) => r.rowIndex === 0)!;
    const r1Center = r1.x + r1.width / 2;
    check("endLabels: R1 (rows[0], the doors) draws right of every other row", rects.every((r) => r.rowIndex === 0 || r.x + r.width <= r1.x + 1e-9), JSON.stringify(rects));
    check(
      "endLabels: DOORS is on the doors (R1) side, right of the box, and carries the emphasis",
      !!doors && doors.side === "right" && doors.x >= box.x + box.width && doors.x > r1Center && doors.emphasis,
      JSON.stringify(doors)
    );
    const wallRight = wall ? wall.x + fontBold.widthOfTextAtSize("WALL", END_LABEL_SIZE) : NaN;
    check("endLabels: WALL is on the nose side, left of the box (right edge <= box.x - 4), no emphasis", !!wall && wall.side === "left" && wallRight <= box.x - 4 && !wall.emphasis, `${JSON.stringify(wall)} right=${wallRight}`);
    check("endLabels: WALL and DOORS share one baseline, vertically centred on the box", !!wall && !!doors && wall.y === doors.y && Math.abs(wall.y + 4 - (box.yTop - box.height / 2)) < 1e-9, JSON.stringify(labels));
  }

  // lb-diag-01: the load draws flush to the wall (left); unused length sits at the doors (right).
  {
    const EPS = 1e-9;
    const box = { x: 60, yTop: 400, width: 650, height: 190 };
    const noseEnd = loadNoseEnd(trailer); // 35 of 65
    const spans = trailer.rows.map((row) => rowSpanX(trailer, DIMS, box, row));
    const noseMost = spans.reduce((a, b) => (b.x < a.x ? b : a));
    check("rowSpanX: loadNoseEnd computed from the rows (35)", noseEnd === 35, String(noseEnd));
    check("rowSpanX: short load — the nose-most row's left edge is box.x (the wall)", Math.abs(noseMost.x - box.x) < EPS, JSON.stringify(spans));
    const r1Right = spans[0].x + spans[0].width;
    const expected = box.x + (noseEnd / DIMS.length) * box.width;
    check("rowSpanX: short load — R1's right edge is box.x + noseEnd/length*width, short of the doors", Math.abs(r1Right - expected) < EPS && r1Right < box.x + box.width, `r1Right=${r1Right} expected=${expected}`);

    const full: PackTrailer = { ...trailer, rows: [makeRow(0, 30, trailer.rows[0].columns), makeRow(30, 35, trailer.rows[1].columns)], usedLength: 65 };
    const fullSpans = full.rows.map((row) => rowSpanX(full, DIMS, box, row));
    check("rowSpanX: full-length load — R1's right edge is the box's right edge (unchanged)", Math.abs(fullSpans[0].x + fullSpans[0].width - (box.x + box.width)) < EPS, JSON.stringify(fullSpans));
    check("rowSpanX: full-length load — the nose row starts at box.x", Math.abs(fullSpans[1].x - box.x) < EPS, JSON.stringify(fullSpans));
  }

  // lbr-09: table pagination.
  {
    check("paginateRows: fits on one page", JSON.stringify(paginateRows(5, 13, 30)) === "[5]", JSON.stringify(paginateRows(5, 13, 30)));
    check("paginateRows: 40 rows -> 13 + 27", JSON.stringify(paginateRows(40, 13, 30)) === "[13,27]", JSON.stringify(paginateRows(40, 13, 30)));
    check("paginateRows: 80 rows -> 13 + 30 + 30 + 7", JSON.stringify(paginateRows(80, 13, 30)) === "[13,30,30,7]", JSON.stringify(paginateRows(80, 13, 30)));
    check("paginateRows: empty table keeps one slot", JSON.stringify(paginateRows(0, 13, 30)) === "[0]");
  }

  // lbr-09: a synthetic trailer with 40 distinct stack patterns (and 40 SKUs) overflows both tables
  // onto exactly one continuation page; the golden-size fixture above stays on one page.
  {
    const wide: Dimensions = { length: 636, width: 98, height: 109, maxWeight: 44000 };
    const manySkus: PackSku[] = [];
    const rows: PackRow[] = [];
    for (let r = 0; r < 10; r++) {
      const cols: PackColumn[] = [];
      for (let c = 0; c < 4; c++) {
        const i = r * 4 + c;
        const h = 1 + i * 0.25;
        manySkus.push({ id: `P${i}`, name: `Part ${i}`, sku: `P-${i}`, length: 48, width: 24, height: h, weight: 1, allowRotation: false });
        cols.push(makeColumn(c * 24, 24, 48, [{ skuId: `P${i}`, skuName: `Part ${i}`, skuCode: `P-${i}`, color: "#000", unitHeight: h, count: 2, orientation: { length: 48, width: 24, height: h, label: "flat" } }]));
      }
      rows.push(makeRow(r * 48, 48, cols));
    }
    const many: PackTrailer = { ...trailer, dims: wide, rows, usedLength: 480, totalStacks: 40 };
    check("overflow fixture: 40 distinct stack patterns", buildStackBreakdown(many).length === 40, String(buildStackBreakdown(many).length));
    const manyPages = (await PDFDocument.load(await buildLoadingDiagramPdf(many, 1, wide, manySkus))).getPageCount();
    check("buildLoadingDiagramPdf: 40 patterns -> 2 pages (tables continue, nothing off the page)", manyPages === 2, String(manyPages));
    const manyWithNotes = (await PDFDocument.load(await buildLoadingDiagramPdf(many, 1, wide, manySkus, { runnerHeight: 4, warnings: ["trailer 1 row 0 column 0: stability: x"] }))).getPageCount();
    check("buildLoadingDiagramPdf: runner + warning lines push rows down but still 2 pages", manyWithNotes === 2, String(manyWithNotes));
    const smallPages = (await PDFDocument.load(await buildLoadingDiagramPdf(trailer, 0, DIMS, SKUS))).getPageCount();
    check("buildLoadingDiagramPdf: a small trailer stays on 1 page", smallPages === 1, String(smallPages));
    // lb-diag-02: a 30-character BOL # shrinks/truncates beside the title (page 1 and the (cont.) page).
    const longBol = "BOL-2026-10-26-4511-01-ABCDEFG";
    const longPages = (await PDFDocument.load(await buildLoadingDiagramPdf(many, 1, wide, manySkus, { bolNumber: longBol, invoiceNumber: "4511" }))).getPageCount();
    check("lb-diag-02: a 30-char BOL # still builds a loadable PDF (2 pages)", longBol.length === 30 && longPages === 2, String(longPages));
  }

  // lb-diag-02: header label logic.
  {
    const same = (a: { bol: string | null; subtitleSuffix: string }, bol: string | null, suffix: string) => a.bol === bol && a.subtitleSuffix === suffix;
    check("lb-diag-02 header: BOL only -> BOL, no suffix", same(diagramHeaderText({ bolNumber: "4511-01" }), "4511-01", ""));
    check("lb-diag-02 header: BOL != invoice -> BOL + INV# suffix", same(diagramHeaderText({ bolNumber: "4511-01", invoiceNumber: "4511" }), "4511-01", " · INV# 4511"));
    check("lb-diag-02 header: BOL == invoice -> no duplicate suffix", same(diagramHeaderText({ bolNumber: "4511", invoiceNumber: "4511" }), "4511", ""));
    check("lb-diag-02 header: invoice only -> no BOL, INV# suffix", same(diagramHeaderText({ invoiceNumber: "4511" }), null, " · INV# 4511"));
    check("lb-diag-02 header: neither -> no BOL, empty suffix", same(diagramHeaderText({}), null, "") && same(diagramHeaderText({ bolNumber: "  ", invoiceNumber: "" }), null, ""));
  }

  // filterTrailerWarnings: only this trailer's lines, prefix-matched exactly (not a substring match
  // that would also catch "trailer 10 ..." for trailerIndex 1).
  {
    const warnings = [
      "trailer 0 row 1 column 0: stability: sku A unitHeight 10 exceeds 3x its footprint",
      "trailer 1 row 0 column 0: stability: sku B unitHeight 8 exceeds 3x its footprint",
      "sku Z not found in catalog — 5 unplaced",
    ];
    const forTrailer0 = filterTrailerWarnings(warnings, 0);
    check("filterTrailerWarnings: trailer 0 gets exactly its 1 line", forTrailer0.length === 1 && forTrailer0[0].includes("sku A"), JSON.stringify(forTrailer0));
    const forTrailer1 = filterTrailerWarnings(warnings, 1);
    check("filterTrailerWarnings: trailer 1 gets exactly its 1 line, not trailer 0's", forTrailer1.length === 1 && forTrailer1[0].includes("sku B"), JSON.stringify(forTrailer1));
  }

  // layoutColumnRects: hand-verified against TrailerDiagram.tsx's own percentage formulas
  // (rowWidthPct = rowLength/dims.length, heightPct = colWidth/dims.width, topPct = posY/dims.width,
  // widthPct = colLength/rowLength) — box scaled ×10 from dims (width 650×500) so the fractions
  // produce round numbers to assert against exactly.
  //
  // lb-diag-01: wall-anchored — the 35-unit load now sits flush LEFT (wall) and the 30-unit gap is on
  // the right (doors): row1 0..150, row0 150..350 (was 300..450 / 450..650 below).
  //
  // Steve, 2026-09-16: mirrored (nose-left/doors-right — see layoutColumnRects' own header comment
  // in loadingDiagramPdf.ts). Row0 (posFromFront 0, the rear-most row) now sits flush to the box's
  // own right edge (450..650 of a 650-wide box) instead of its left (0..200); row1 sits immediately
  // to row0's left (300..450); the 30-unit (of 65 total) unused length beyond row1 now shows as a
  // gap on the LEFT (nose) side of the box (0..300) instead of the right. y/height are unaffected —
  // the mirror is length-axis (x), row-position only. A shallow column's own anchor WITHIN its row
  // is unchanged (still flush to the row's own left edge, colX = rowX): PackColumn carries no
  // along-length offset within its row, so that anchor was never a physical fact to mirror — colB
  // (colLength 15 of rowLength 20) sits at row0's rowX (450), same as colA, not at its far edge.
  {
    const box = { x: 0, yTop: 100, width: 650, height: 500 };
    const rects = layoutColumnRects(trailer, DIMS, box);
    check("layoutColumnRects: 3 rects (colA, colB, colC)", rects.length === 3, JSON.stringify(rects));

    const rectA = rects.find((r) => r.rowIndex === 0 && r.columnIndex === 0)!;
    check(
      "layoutColumnRects: colA (row0, full row width+depth) -> x150 y-100 w200 h200",
      rectA.x === 150 && rectA.y === -100 && rectA.width === 200 && rectA.height === 200,
      JSON.stringify(rectA)
    );

    const rectB = rects.find((r) => r.rowIndex === 0 && r.columnIndex === 1)!;
    check(
      "layoutColumnRects: colB (row0, posY 20 of 50, colLength 15 of rowLength 20, flush left) -> x150 y-400 w150 h300",
      rectB.x === 150 && rectB.y === -400 && rectB.width === 150 && rectB.height === 300,
      JSON.stringify(rectB)
    );

    const rectC = rects.find((r) => r.rowIndex === 1 && r.columnIndex === 0)!;
    check(
      "layoutColumnRects: colC (row1, posFromFront 20 of 65, nose-most) -> x0 y-400 w150 h500",
      rectC.x === 0 && rectC.y === -400 && rectC.width === 150 && rectC.height === 500,
      JSON.stringify(rectC)
    );

    // Zero-dims guard: no division-by-zero / NaN when dims.length or dims.width is 0.
    const zeroDims: Dimensions = { length: 0, width: 0, height: 40, maxWeight: 10000 };
    const zeroRects = layoutColumnRects(trailer, zeroDims, box);
    check(
      "layoutColumnRects: dims.length/width 0 produces finite numbers, not NaN",
      zeroRects.every((r) => Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.width) && Number.isFinite(r.height)),
      JSON.stringify(zeroRects)
    );
  }

  // lbr-05: hatch lines (fractional / >16" sizes) stay inside their rect and actually cover it.
  {
    const rect = { x: 10, y: 20, width: 40, height: 15 };
    const segs = hatchSegments(rect);
    const inside = (x: number, y: number) => x >= rect.x - 1e-9 && x <= rect.x + rect.width + 1e-9 && y >= rect.y - 1e-9 && y <= rect.y + rect.height + 1e-9;
    check("hatchSegments: produces lines for a real rect", segs.length > 5, String(segs.length));
    check("hatchSegments: every segment stays inside the rect", segs.every((g) => inside(g.x1, g.y1) && inside(g.x2, g.y2)), JSON.stringify(segs.slice(0, 3)));
    check("hatchSegments: 45° lines (dy === dx)", segs.every((g) => Math.abs(g.y2 - g.y1 - (g.x2 - g.x1)) < 1e-9));
    check("hatchSegments: empty rect -> no lines", hatchSegments({ x: 0, y: 0, width: 0, height: 10 }).length === 0);
  }

  // lb-box-03: on-edge columns read by thickness, never as a flat stack; one label per slot; the
  // PDF still builds on one page.
  {
    const hb = (t: number): PackSku => ({ id: `EDGE${t}`, name: `${t}in holey`, sku: `EDGE${t}`, length: 48, width: 24, height: t, weight: 1, category: HOLEY_BOARD_CATEGORY, allowRotation: false });
    const skus = [hb(6), hb(1), hb(13)];
    const box = TRAILER_TYPES["26ft Box Truck"];
    const plan = pack([{ skuId: "EDGE6", qty: 36 }, { skuId: "EDGE1", qty: 28 }, { skuId: "EDGE13", qty: 32 }], skus, box, DEFAULT_PACK_OPTIONS);
    const t0 = plan.trailers[0];
    const edge6 = t0.rows.flatMap((r) => r.columns).find((c) => c.onEdge && c.colWidth === 6);
    check("lb-box-03: edge stack line reads `6\" on edge - 4`", !!edge6 && formatStackLines(edge6)[0] === '6" on edge - 4', edge6 ? formatStackLines(edge6)[0] : "no 6\" edge column");
    check("lb-box-03: edge layer thickness is the board (6), not the 24\" tier", !!edge6 && layerThickness(edge6, edge6.layers[0]) === 6);
    const slotRow = t0.rows.find((r) => r.columns.filter((c) => c.onEdge).length > 2);
    check("lb-box-03: slot detail groups the row's edge columns", !!slotRow && formatEdgeSlotDetail(slotRow) === '7×1"-4 2×6"-4', slotRow ? String(formatEdgeSlotDetail(slotRow)) : "no slot row");
    check("lb-box-03: stack breakdown keeps on-edge apart from flat", buildStackBreakdown(t0).some((b) => b.pattern.includes("on edge")) && buildStackBreakdown(t0).some((b) => !b.pattern.includes("on edge")));
    check("lb-box-03: pieces table colors an edge-only size by its thickness", buildPiecesTable(t0, skus).every((p) => p.color === thicknessColor(Number(p.skuId.replace("EDGE", ""))).bg));
    const pages = (await PDFDocument.load(await buildLoadingDiagramPdf(t0, 0, box, skus))).getPageCount();
    check("lb-box-03: an on-edge trailer's PDF builds (1 page)", pages === 1, String(pages));
  }

  return { pass: results.every((r) => r.pass), results };
}
