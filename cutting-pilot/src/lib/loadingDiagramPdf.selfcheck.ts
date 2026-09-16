// src/lib/loadingDiagramPdf.selfcheck.ts
// lb-ui-08: guarded dev self-check for loadingDiagramPdf.ts's pure logic — the layout math, table
// aggregation, and text formatting that produce the PDF's content, NOT the PDF bytes themselves
// (per Part C: "if the only meaningful check is 'produces non-empty bytes without throwing', say so
// plainly" — here there IS real pure logic worth isolating, so that's tested instead). Mirrors
// dissolve.selfcheck.ts's shape: a hand-built fixture, a check()/results table, one exported
// run*SelfCheck() function. Not part of the production build path.
import type { PackColumn, PackRow, PackTrailer, Dimensions, PackSku } from "./packEngine";
import { formatStackLines, formatRemainingLabel, buildPiecesTable, buildStackBreakdown, filterTrailerWarnings, layoutColumnRects } from "./loadingDiagramPdf";

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

export function runLoadingDiagramPdfSelfCheck(): { pass: boolean; results: CheckResult[] } {
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
      "layoutColumnRects: colA (row0, full row width+depth) -> x450 y-100 w200 h200",
      rectA.x === 450 && rectA.y === -100 && rectA.width === 200 && rectA.height === 200,
      JSON.stringify(rectA)
    );

    const rectB = rects.find((r) => r.rowIndex === 0 && r.columnIndex === 1)!;
    check(
      "layoutColumnRects: colB (row0, posY 20 of 50, colLength 15 of rowLength 20, flush left) -> x450 y-400 w150 h300",
      rectB.x === 450 && rectB.y === -400 && rectB.width === 150 && rectB.height === 300,
      JSON.stringify(rectB)
    );

    const rectC = rects.find((r) => r.rowIndex === 1 && r.columnIndex === 0)!;
    check(
      "layoutColumnRects: colC (row1, posFromFront 20 of 65) -> x300 y-400 w150 h500",
      rectC.x === 300 && rectC.y === -400 && rectC.width === 150 && rectC.height === 500,
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

  return { pass: results.every((r) => r.pass), results };
}
