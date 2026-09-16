// src/lib/packEngine.selfcheck.ts
// Guarded dev self-check for the packing engine (lb-engine-01 contracts + invariant harness,
// lb-engine-02 orientation/pairing/row-assembly algorithm, lb-engine-03 column fill/top-off,
// rear->front ordering, running balance — completes pack()). Not part of the production build path
// — mirrors blockNester.selfcheck.ts's / bolShared.selfcheck.ts's shape. There is no v2 load
// builder UI yet (lb-ui-01 wires this in); exported and left unreferenced.
//
// Two kinds of checks live here:
// - validatePlan() invariant checks: each of the (13, rule set unchanged in count since
//   lb-engine-02) rules gets one hand-built PackPlan fixture that satisfies it and one that
//   violates it, built from a single self-consistent baseline plan (recompute() derives every
//   aggregate field from the structural leaves) so mutating one thing to break a target rule
//   doesn't accidentally trip an unrelated one.
// - pack() algorithm checks: call the real algorithm against the real-order fixtures
//   (FIXTURE_HOLEY_SIPLAST, FIXTURE_BLOCKS_PAIRING, FIXTURE_BLOCKS_MIXED — the last now the real
//   INV_4347 data, lb-engine-03 Part C) plus lb-engine-03's own targeted fixtures for column fill,
//   K top-off, rear->front ordering, depth-aware row assembly and running balance, and assert on
//   actual output.
import {
  pack,
  validatePlan,
  planMetrics,
  skuOrientations,
  familyOrientationOptions,
  HOLEY_BOARD_CATEGORY,
  TRAILER_TYPES,
  type PlanMetrics,
  type PackPlan,
  type PackTrailer,
  type PackRow,
  type PackColumn,
  type PackLayer,
  type PackSku,
  type CartLine,
  type PackOptions,
  type Dimensions,
} from "./packEngine";
import { FIXTURE_BLOCKS_PAIRING, FIXTURE_HOLEY_SIPLAST, FIXTURE_BLOCKS_MIXED } from "./loadBuilderFixtures";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Finds the first column (searching trailers -> rows -> columns in order) matching `pred`. Used
// throughout the lb-engine-03 fixtures below to inspect what pack() actually built, rather than
// re-deriving the fill decision by hand.
function findColumn(plan: PackPlan, pred: (c: PackColumn) => boolean): PackColumn | null {
  for (const trailer of plan.trailers) {
    for (const row of trailer.rows) {
      for (const col of row.columns) {
        if (pred(col)) return col;
      }
    }
  }
  return null;
}

function findRow(plan: PackPlan, pred: (r: PackRow) => boolean): PackRow | null {
  for (const trailer of plan.trailers) {
    for (const row of trailer.rows) {
      if (pred(row)) return row;
    }
  }
  return null;
}

// Derives every aggregate field (row/trailer/plan totals, posFromFront/posY geometry,
// wastedFloorArea) from the structural leaves (rowLength, colWidth, colLength, stackCount,
// totalWeight, mixed) so a fixture builder can mutate a leaf field and stay internally consistent
// everywhere except the rule under test. Never touches rowLength itself — some fixtures
// deliberately corrupt it to test trailer-length, and recompute must not paper over that.
function recompute(plan: PackPlan): void {
  let planUnits = 0;
  let planWeight = 0;
  let planStacks = 0;
  let planMixed = 0;

  for (const trailer of plan.trailers) {
    let runningLength = 0;
    let usedLength = 0;
    let usedFloorArea = 0;
    let usedWeight = 0;
    let totalUnits = 0;
    let totalStacks = 0;
    let mixedStacks = 0;

    for (const row of trailer.rows) {
      row.posFromFront = runningLength;
      runningLength += row.rowLength;
      usedLength += row.rowLength;

      let runningWidth = 0;
      let rowUnits = 0;
      let rowWeight = 0;

      for (const column of row.columns) {
        column.posY = runningWidth;
        runningWidth += column.colWidth;
        usedFloorArea += column.colWidth * row.rowLength;
        rowUnits += column.stackCount;
        rowWeight += column.totalWeight;
        totalStacks += 1;
        if (column.mixed) mixedStacks += 1;
      }

      row.rowWidthUsed = runningWidth;
      row.totalUnits = rowUnits;
      row.totalWeight = rowWeight;
      row.wastedFloorArea = row.columns.reduce((s, c) => s + (row.rowLength - c.colLength) * c.colWidth, 0);
      totalUnits += rowUnits;
      usedWeight += rowWeight;
    }

    trailer.usedLength = usedLength;
    trailer.usedFloorArea = usedFloorArea;
    trailer.usedWeight = usedWeight;
    trailer.totalUnits = totalUnits;
    trailer.totalStacks = totalStacks;
    trailer.mixedStacks = mixedStacks;
    trailer.widthUtilization = trailer.dims.width > 0 ? usedFloorArea / (trailer.dims.width * (usedLength || 1)) : 0;
    trailer.heightUtilization = 0;

    planUnits += totalUnits;
    planWeight += usedWeight;
    planStacks += totalStacks;
    planMixed += mixedStacks;
  }

  plan.totalUnits = planUnits;
  plan.totalWeight = planWeight;
  plan.totalStacks = planStacks;
  plan.mixedStacks = planMixed;
}

// --- Baseline fixture: one trailer, one row, one column, two stacked SKUs (base + top-off). ---

const DIMS: Dimensions = { length: 100, width: 50, height: 40, maxWeight: 1000 };

const OPTS: PackOptions = {
  allowRotation: true,
  topOffMinInchesPerPiece: 3,
  maxSkusPerColumn: 2,
  supportPolicy: "strict",
  trailerLimit: 20,
  stabilityWarnRatio: 3,
};

const SKU_A: PackSku = {
  id: "A",
  name: "SKU A",
  sku: "A-1",
  length: 20,
  width: 10,
  height: 5,
  weight: 2,
  category: "Blocks",
  allowRotation: true,
};

const SKU_B: PackSku = {
  id: "B",
  name: "SKU B",
  sku: "B-1",
  length: 20,
  width: 10,
  height: 3,
  weight: 1.5,
  category: "Blocks",
  allowRotation: true,
};

const SKUS: PackSku[] = [SKU_A, SKU_B];
const CART: CartLine[] = [
  { skuId: "A", qty: 3 },
  { skuId: "B", qty: 2 },
];

function baseLayers(): PackLayer[] {
  return [
    {
      skuId: "A",
      skuName: "SKU A",
      skuCode: "A-1",
      color: "#111111",
      unitHeight: 5,
      count: 3,
      orientation: { length: 20, width: 10, height: 5, label: "flat" },
    },
    {
      skuId: "B",
      skuName: "SKU B",
      skuCode: "B-1",
      color: "#222222",
      unitHeight: 3,
      count: 2,
      orientation: { length: 20, width: 10, height: 3, label: "flat" },
    },
  ];
}

function makeBaselinePlan(): PackPlan {
  const layers = baseLayers();
  const column: PackColumn = {
    posY: 0,
    colWidth: 10,
    colLength: 20,
    totalHeight: layers.reduce((s, l) => s + l.unitHeight * l.count, 0),
    totalWeight: 3 * SKU_A.weight + 2 * SKU_B.weight,
    stackCount: layers.reduce((s, l) => s + l.count, 0),
    layers,
    mixed: true,
    rationale: "Base SKU A x3 (15\") + topoff SKU B x2 (6\") = 21\" stack",
  };
  const row: PackRow = {
    posFromFront: 0,
    rowLength: 20,
    rowWidthUsed: 10,
    wastedFloorArea: 0,
    columns: [column],
    totalUnits: 0,
    totalWeight: 0,
  };
  const trailer: PackTrailer = {
    type: "Custom",
    dims: DIMS,
    rows: [row],
    usedLength: 0,
    usedFloorArea: 0,
    usedWeight: 0,
    totalStacks: 0,
    totalUnits: 0,
    mixedStacks: 0,
    widthUtilization: 0,
    heightUtilization: 0,
  };
  const plan: PackPlan = {
    trailers: [trailer],
    balance: [],
    warnings: [],
    totalWeight: 0,
    totalUnits: 0,
    totalStacks: 0,
    mixedStacks: 0,
  };
  recompute(plan);
  return plan;
}

function ruleViolations(violations: { rule: string }[], rule: string): number {
  return violations.filter((v) => v.rule === rule).length;
}

// --- lb-engine-04 Part B2: the metrics ratchet ---
//
// These are MUST-NOT-REGRESS bars, measured against the live engine at lb-engine-04 and pinned
// here. A future prompt that makes packing worse fails these checks instead of quietly shipping.
//
// LOWERING A BAR IS A DELIBERATE DECISION, NOT A QUIET EDIT. If a change genuinely trades one of
// these numbers for something better (say, more rows but a materially better weight distribution),
// that is a real call to make — but make it explicitly: change the constant in the same commit as
// the change that moved it, and say in the CHANGELOG entry why the trade is worth it. Do not
// re-measure and paste in whatever the engine now happens to emit.
//
// trailerCount / rowCount / usedLength are `<=` bars (fewer/shorter is better).
// meanHeightUtilization is a `>=` bar (fuller columns are better), compared with an epsilon so
// float accumulation across 50+ columns can't trip a bar the engine actually still clears. The
// pinned utilization figures are the observed values truncated to 4 decimal places for the same
// reason — the bar is "no worse than this", not "bit-identical to this".
interface RatchetBar {
  trailerCount: number;
  rowCount: number;
  usedLength: number;
  meanHeightUtilization: number;
}

const RATCHET: Record<string, RatchetBar> = {
  // INV_4202 — the load legacy could not fit on one truck. 6 rows / 508.5" matches the figure
  // quoted in the lb-engine-04 prompt.
  FIXTURE_BLOCKS_PAIRING: { trailerCount: 1, rowCount: 6, usedLength: 508.5, meanHeightUtilization: 0.7691 },
  // The simplest case: a 4-across x 13-deep holey grid, every column topped off to 109" exact, so
  // height utilization is a full 1.0 here and any future change that leaves even one column short
  // of the roof will fail this bar. That is intended.
  FIXTURE_HOLEY_SIPLAST: { trailerCount: 1, rowCount: 13, usedLength: 624, meanHeightUtilization: 1 },
  // INV_4347 — 94 pieces across six footprints, the messiest of the three.
  FIXTURE_BLOCKS_MIXED: { trailerCount: 1, rowCount: 7, usedLength: 635.25, meanHeightUtilization: 0.6229 },
};

const RATCHET_EPS = 1e-9;

// Pure predicate: returns one string per violated bar, empty when the metrics clear every bar.
// Deliberately NOT wired to check() internally — that is what lets the "prove the bar has teeth"
// check below feed it a knowingly-worse plan and assert it comes back non-empty, without polluting
// the results table with a deliberate failure.
function ratchetFailures(metrics: PlanMetrics, bar: RatchetBar): string[] {
  const failures: string[] = [];
  if (metrics.trailerCount > bar.trailerCount) {
    failures.push(`trailerCount ${metrics.trailerCount} > pinned ${bar.trailerCount}`);
  }
  if (metrics.rowCount > bar.rowCount) {
    failures.push(`rowCount ${metrics.rowCount} > pinned ${bar.rowCount}`);
  }
  if (metrics.usedLength > bar.usedLength + RATCHET_EPS) {
    failures.push(`usedLength ${metrics.usedLength} > pinned ${bar.usedLength}`);
  }
  if (metrics.meanHeightUtilization < bar.meanHeightUtilization - RATCHET_EPS) {
    failures.push(`meanHeightUtilization ${metrics.meanHeightUtilization} < pinned ${bar.meanHeightUtilization}`);
  }
  return failures;
}

export function runPackEngineSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  function expectClean(rule: string, plan: PackPlan, label: string) {
    const violations = validatePlan(plan, CART, SKUS, OPTS);
    check(`${rule}: ${label} has no ${rule} violation`, ruleViolations(violations, rule) === 0, JSON.stringify(violations));
  }

  function expectViolation(rule: string, plan: PackPlan, label: string, skus: PackSku[] = SKUS, cart: CartLine[] = CART) {
    const violations = validatePlan(plan, cart, skus, OPTS);
    check(`${rule}: ${label} triggers ${rule}`, ruleViolations(violations, rule) > 0, JSON.stringify(violations));
  }

  // The baseline plan alone satisfies all 13 rules simultaneously.
  const baseline = makeBaselinePlan();
  const baselineViolations = validatePlan(baseline, CART, SKUS, OPTS);
  check("baseline: zero violations", baselineViolations.length === 0, JSON.stringify(baselineViolations));

  // 1. sku-unplaceable (renamed from piece-fits-trailer in lb-engine-01 — A4 split the old
  // "fits in some orientation" logic out under this name; piece-fits-trailer now means something
  // stricter, tested separately below).
  expectClean("sku-unplaceable", baseline, "baseline SKUs fit the trailer envelope");
  const oversizedSkus: PackSku[] = [{ ...SKU_A, length: 200 }, SKU_B];
  expectViolation("sku-unplaceable", baseline, "SKU A too long for trailer in any orientation", oversizedSkus);

  // 2. column-height
  expectClean("column-height", baseline, "baseline stack (21\") under trailer height (40\")");
  {
    const bad = clone(baseline);
    bad.trailers[0].rows[0].columns[0].totalHeight = 999;
    expectViolation("column-height", bad, "column totalHeight overrides trailer height");
  }

  // 3. row-width
  expectClean("row-width", baseline, "baseline column width (10\") under trailer width (50\")");
  {
    const bad = clone(baseline);
    bad.trailers[0].rows[0].columns[0].colWidth = 999;
    recompute(bad);
    expectViolation("row-width", bad, "column width alone exceeds trailer width");
  }

  // 4. trailer-length
  expectClean("trailer-length", baseline, "baseline row length (20\") under trailer length (100\")");
  {
    const bad = clone(baseline);
    bad.trailers[0].rows[0].rowLength = 999;
    recompute(bad);
    expectViolation("trailer-length", bad, "row length alone exceeds trailer length");
  }

  // 5. row-geometry
  expectClean("row-geometry", baseline, "baseline posFromFront/posY match running sums");
  {
    const bad = clone(baseline);
    recompute(bad);
    bad.trailers[0].rows[0].posFromFront = 5;
    expectViolation("row-geometry", bad, "row.posFromFront disagrees with running length");
  }

  // 6. holey-no-rotation (dedicated holey-board fixture, since baseline uses category "Blocks").
  // makeHoleyPlan takes the column's actual footprint (colLength, colWidth) plus the row's
  // rowLength separately, so the same builder can produce both a single-column row (rowLength ===
  // colLength) and a mixed-depth row (rowLength > colLength) for the A5 regression test below.
  const holeySku: PackSku = {
    id: "H",
    name: "Holey Board 24x48",
    sku: "H-1",
    length: 48,
    width: 24,
    height: 0.75,
    weight: 5,
    category: HOLEY_BOARD_CATEGORY,
    allowRotation: false,
  };
  const holeyCart: CartLine[] = [{ skuId: "H", qty: 1 }];
  const holeySkus: PackSku[] = [holeySku];

  const makeHoleyPlan = (colLength: number, colWidth: number, rowLength: number, extraColumn?: PackColumn): PackPlan => {
    const layer: PackLayer = {
      skuId: "H",
      skuName: holeySku.name,
      skuCode: holeySku.sku,
      color: "#333",
      unitHeight: 0.75,
      count: 1,
      orientation: { length: colLength, width: colWidth, height: 0.75, label: "flat" },
    };
    const column: PackColumn = {
      posY: 0,
      colWidth,
      colLength,
      totalHeight: 0.75,
      totalWeight: 5,
      stackCount: 1,
      layers: [layer],
      mixed: false,
      rationale: "Single holey board sheet",
    };
    const columns = extraColumn ? [column, extraColumn] : [column];
    const row: PackRow = {
      posFromFront: 0,
      rowLength,
      rowWidthUsed: 0,
      wastedFloorArea: 0,
      columns,
      totalUnits: 0,
      totalWeight: 0,
    };
    const trailer: PackTrailer = {
      dims: DIMS,
      rows: [row],
      usedLength: 0,
      usedFloorArea: 0,
      usedWeight: 0,
      totalStacks: 0,
      totalUnits: 0,
      mixedStacks: 0,
      widthUtilization: 0,
      heightUtilization: 0,
    };
    const plan: PackPlan = { trailers: [trailer], balance: [], warnings: [], totalWeight: 0, totalUnits: 0, totalStacks: 0, mixedStacks: 0 };
    recompute(plan);
    return plan;
  };

  const goodHoley = makeHoleyPlan(48, 24, 48); // matches sku.length=48, sku.width=24
  const goodHoleyViolations = validatePlan(goodHoley, holeyCart, holeySkus, OPTS);
  check(
    "holey-no-rotation: declared orientation (48x24) has no violation",
    ruleViolations(goodHoleyViolations, "holey-no-rotation") === 0,
    JSON.stringify(goodHoleyViolations)
  );

  const badHoley = makeHoleyPlan(24, 48, 24); // swapped: footprint no longer matches declared L/W
  const badHoleyViolations = validatePlan(badHoley, holeyCart, holeySkus, OPTS);
  check(
    "holey-no-rotation: swapped footprint (24x48) triggers holey-no-rotation",
    ruleViolations(badHoleyViolations, "holey-no-rotation") > 0,
    JSON.stringify(badHoleyViolations)
  );

  // 7. strict-support
  expectClean("strict-support", baseline, "baseline column has positive-area footprint under strict policy");
  {
    const bad = clone(baseline);
    bad.trailers[0].rows[0].columns[0].colWidth = 0;
    recompute(bad);
    expectViolation("strict-support", bad, "zero-width column has no real footprint");
  }

  // 8. conservation
  expectClean("conservation", baseline, "baseline placed + remaining == cart qty for every SKU");
  {
    const bad = clone(baseline);
    bad.balance = [{ skuId: "A", remaining: 5 }];
    expectViolation("conservation", bad, "spurious remaining balance breaks conservation for SKU A");
  }

  // 9. weight
  expectClean("weight", baseline, "baseline usedWeight (9) under maxWeight (1000)");
  {
    const bad = clone(baseline);
    bad.trailers[0].rows[0].columns[0].totalWeight = 99999;
    recompute(bad);
    expectViolation("weight", bad, "column weight blown out past trailer maxWeight");
  }

  // 10. max-skus-per-column
  expectClean("max-skus-per-column", baseline, "baseline column has 2 SKUs == maxSkusPerColumn (2)");
  {
    const skuC: PackSku = { id: "C", name: "SKU C", sku: "C-1", length: 20, width: 10, height: 4, weight: 1, category: "Blocks", allowRotation: true };
    const bad = clone(baseline);
    bad.trailers[0].rows[0].columns[0].layers.push({
      skuId: "C",
      skuName: "SKU C",
      skuCode: "C-1",
      color: "#333333",
      unitHeight: 4,
      count: 1,
      orientation: { length: 20, width: 10, height: 4, label: "flat" },
    });
    bad.trailers[0].rows[0].columns[0].totalHeight += 4;
    bad.trailers[0].rows[0].columns[0].totalWeight += 1;
    bad.trailers[0].rows[0].columns[0].stackCount += 1;
    recompute(bad);
    const skusWithC = [...SKUS, skuC];
    const cartWithC: CartLine[] = [...CART, { skuId: "C", qty: 1 }];
    expectViolation("max-skus-per-column", bad, "third distinct SKU exceeds maxSkusPerColumn (2)", skusWithC, cartWithC);
  }

  // 11. topoff-threshold
  expectClean("topoff-threshold", baseline, "baseline topoff layer (3\") meets topOffMinInchesPerPiece (3)");
  {
    const bad = clone(baseline);
    bad.trailers[0].rows[0].columns[0].layers[1].unitHeight = 2;
    bad.trailers[0].rows[0].columns[0].totalHeight = 5 * 3 + 2 * 2;
    recompute(bad);
    expectViolation("topoff-threshold", bad, "topoff layer thinned below topOffMinInchesPerPiece (3)");
  }

  // 12. rationale-present
  expectClean("rationale-present", baseline, "baseline column has a non-empty rationale");
  {
    const bad = clone(baseline);
    bad.trailers[0].rows[0].columns[0].rationale = "";
    expectViolation("rationale-present", bad, "empty rationale string");
  }

  // 13. totals-consistent
  expectClean("totals-consistent", baseline, "baseline aggregates match the sum of their parts");
  {
    const bad = clone(baseline);
    bad.trailers[0].totalStacks += 1;
    expectViolation("totals-consistent", bad, "trailer.totalStacks manually corrupted after recompute");
  }

  // --- lb-engine-02 additions (Part C) ---

  // C1. skuOrientations: 6 for a plain block, 1 for holey, 1 when allowRotation:false, and
  // dedupe for a SKU with two equal dimensions.
  {
    const block: PackSku = { id: "P1", name: "Plain block", sku: "P1", length: 20, width: 10, height: 5, weight: 2, category: "Blocks", allowRotation: true };
    check("skuOrientations: plain block returns 6 orientations", skuOrientations(block, OPTS).length === 6);

    const holey: PackSku = { ...holeySku };
    check("skuOrientations: holey board returns 1 orientation", skuOrientations(holey, OPTS).length === 1);

    const noRotate: PackSku = { ...block, id: "P2", allowRotation: false };
    check("skuOrientations: allowRotation:false returns 1 orientation", skuOrientations(noRotate, OPTS).length === 1);

    const squareFootprint: PackSku = { id: "P3", name: "Square-footprint block", sku: "P3", length: 20, width: 20, height: 5, weight: 2, category: "Blocks", allowRotation: true };
    check(
      "skuOrientations: two equal dimensions (20x20x5) dedupes to 3 distinct shapes",
      skuOrientations(squareFootprint, OPTS).length === 3
    );
  }

  // C2. piece-fits-trailer fires when the layer's declared orientation disagrees with its
  // placement (legal for the SKU in isolation, but not what the column actually is).
  {
    const bad = clone(baseline);
    // flat-rotated (10x20x5) is a legal orientation of SKU A, but this column is 20 long x 10
    // wide — the placement is still "flat" (20x10x5), so declaring flat-rotated is a lie.
    bad.trailers[0].rows[0].columns[0].layers[0].orientation = { length: 10, width: 20, height: 5, label: "flat-rotated" };
    expectViolation("piece-fits-trailer", bad, "declared orientation disagrees with actual column placement");
  }
  expectClean("piece-fits-trailer", baseline, "baseline layers' declared orientation matches their placement");

  // C3. sku-unplaceable fires on a SKU larger than the trailer in every orientation (covered
  // above under the renamed rule — restated here under its Part C number for traceability).
  check(
    "sku-unplaceable: covered by check #1 above (renamed from piece-fits-trailer per A4)",
    results.some((r) => r.name.startsWith("sku-unplaceable:") && r.pass)
  );

  // C4. holey-no-rotation does NOT fire for a correctly-placed holey column sitting in a
  // mixed-depth row (the A5 regression: comparing against row.rowLength instead of
  // column.colLength would have produced a false violation here).
  {
    const dummySku: PackSku = { id: "DUMMY", name: "dummy deep filler", sku: "DUMMY", length: 90.75, width: 20, height: 8, weight: 10, category: "Blocks", allowRotation: true };
    const deepDummy: PackColumn = {
      posY: 24,
      colWidth: 20,
      colLength: 90.75,
      totalHeight: 8,
      totalWeight: 10,
      stackCount: 1,
      layers: [
        {
          skuId: "DUMMY",
          skuName: "dummy deep filler",
          skuCode: "DUMMY",
          color: "#444",
          unitHeight: 8,
          count: 1,
          orientation: { length: 90.75, width: 20, height: 8, label: "flat" },
        },
      ],
      mixed: false,
      rationale: "Dummy deep neighbour column to force a mixed-depth row",
    };
    const mixedDepthHoley = makeHoleyPlan(48, 24, 90.75, deepDummy);
    const mixedDepthSkus = [...holeySkus, dummySku];
    const mixedDepthCart: CartLine[] = [...holeyCart, { skuId: "DUMMY", qty: 1 }];
    const mixedDepthViolations = validatePlan(mixedDepthHoley, mixedDepthCart, mixedDepthSkus, OPTS);
    check(
      "holey-no-rotation: correctly-placed holey column in a mixed-depth row (rowLength 90.75 > colLength 48) has no violation",
      ruleViolations(mixedDepthViolations, "holey-no-rotation") === 0,
      JSON.stringify(mixedDepthViolations)
    );
  }

  // C5. colLength <= rowLength violation fires, and wastedFloorArea computes correctly for a
  // mixed-depth row.
  {
    const skuShallow: PackSku = { id: "S", name: "Shallow block", sku: "S-1", length: 15, width: 10, height: 5, weight: 2, category: "Blocks", allowRotation: true };
    const deepColumn: PackColumn = {
      posY: 0,
      colWidth: 10,
      colLength: 20,
      totalHeight: 15,
      totalWeight: 6,
      stackCount: 3,
      layers: [
        { skuId: "A", skuName: "SKU A", skuCode: "A-1", color: "#111", unitHeight: 5, count: 3, orientation: { length: 20, width: 10, height: 5, label: "flat" } },
      ],
      mixed: false,
      rationale: "Deep column, sets the row's depth",
    };
    const shallowColumn: PackColumn = {
      posY: 10,
      colWidth: 10,
      colLength: 15,
      totalHeight: 15,
      totalWeight: 6,
      stackCount: 3,
      layers: [
        { skuId: "S", skuName: "Shallow block", skuCode: "S-1", color: "#222", unitHeight: 5, count: 3, orientation: { length: 15, width: 10, height: 5, label: "flat" } },
      ],
      mixed: false,
      rationale: "Shallow column, shorter than the row's depth",
    };
    const row: PackRow = {
      posFromFront: 0,
      rowLength: 20,
      rowWidthUsed: 20,
      wastedFloorArea: 0,
      columns: [deepColumn, shallowColumn],
      totalUnits: 0,
      totalWeight: 0,
    };
    const trailer: PackTrailer = {
      dims: DIMS,
      rows: [row],
      usedLength: 0,
      usedFloorArea: 0,
      usedWeight: 0,
      totalStacks: 0,
      totalUnits: 0,
      mixedStacks: 0,
      widthUtilization: 0,
      heightUtilization: 0,
    };
    const mixedDepthPlan: PackPlan = { trailers: [trailer], balance: [], warnings: [], totalWeight: 0, totalUnits: 0, totalStacks: 0, mixedStacks: 0 };
    recompute(mixedDepthPlan);
    const mixedDepthCart: CartLine[] = [{ skuId: "A", qty: 3 }, { skuId: "S", qty: 3 }];
    const mixedDepthSkus: PackSku[] = [SKU_A, skuShallow];

    check(
      "wastedFloorArea: (20-20)*10 + (20-15)*10 === 50 for the mixed-depth row",
      mixedDepthPlan.trailers[0].rows[0].wastedFloorArea === 50,
      String(mixedDepthPlan.trailers[0].rows[0].wastedFloorArea)
    );
    const cleanViolations = validatePlan(mixedDepthPlan, mixedDepthCart, mixedDepthSkus, OPTS);
    check(
      "trailer-length: mixed-depth row with colLength <= rowLength for both columns has no violation",
      ruleViolations(cleanViolations, "trailer-length") === 0,
      JSON.stringify(cleanViolations)
    );

    const overDepth = clone(mixedDepthPlan);
    overDepth.trailers[0].rows[0].columns[1].colLength = 999; // now exceeds rowLength (20)
    const overDepthViolations = validatePlan(overDepth, mixedDepthCart, mixedDepthSkus, OPTS);
    check(
      "trailer-length: column colLength (999) exceeding row rowLength (20) triggers trailer-length",
      ruleViolations(overDepthViolations, "trailer-length") > 0,
      JSON.stringify(overDepthViolations)
    );
  }

  // C6. stabilityWarnRatio produces a warning + rationale note but no violation; Infinity
  // suppresses it. Uses pack() directly since the warning is only ever emitted by the algorithm
  // (it is advisory, not part of validatePlan's invariants).
  // Amended for lb-engine-03 A1: a rotation-allowed single-member family now gets up to six
  // orientations, and pack() correctly PREFERS tipping this SKU onto its side (10x35 or 35x10
  // footprint, height 10 — no stability warning at all) over standing it up tall/narrow, since the
  // tipped placement scores better on width utilization. That's A1 working as intended, not a
  // regression — but it defeats this fixture's premise, so allowRotation:false pins the SKU to its
  // declared flat (10x10x35) orientation, forcing the tall/narrow placement the test needs.
  {
    // 10x10 footprint, 35" tall single unit: 35 > 3 * min(10,10) = 30, so this should warn.
    const tallSku: PackSku = { id: "T", name: "Tall narrow slab", sku: "T-1", length: 10, width: 10, height: 35, weight: 5, category: "Blocks", allowRotation: false };
    const tallDims: Dimensions = { length: 100, width: 50, height: 40, maxWeight: 1000 };
    const tallCart: CartLine[] = [{ skuId: "T", qty: 1 }];

    const warnedPlan = pack(tallCart, [tallSku], tallDims, { stabilityWarnRatio: 3 });
    const hasStabilityWarning = warnedPlan.warnings.some((w) => w.includes("stability"));
    const hasRationaleNote = warnedPlan.trailers.some((t) => t.rows.some((r) => r.columns.some((c) => c.rationale.includes("[stability"))));
    check("stabilityWarnRatio: tall/narrow placement produces a plan.warnings entry", hasStabilityWarning, JSON.stringify(warnedPlan.warnings));
    check("stabilityWarnRatio: tall/narrow placement adds a rationale note", hasRationaleNote);
    const warnedViolations = validatePlan(warnedPlan, tallCart, [tallSku], { ...OPTS, stabilityWarnRatio: 3 });
    check("stabilityWarnRatio: warning is advisory only, produces zero validatePlan violations", warnedViolations.length === 0, JSON.stringify(warnedViolations));

    const suppressedPlan = pack(tallCart, [tallSku], tallDims, { stabilityWarnRatio: Infinity });
    const suppressedHasWarning = suppressedPlan.warnings.some((w) => w.includes("stability"));
    check("stabilityWarnRatio: Infinity suppresses the warning entirely", !suppressedHasWarning, JSON.stringify(suppressedPlan.warnings));
  }

  // --- Real-order fixtures (lb-engine-02's acceptance cases, run through the real pack()) ---

  const TRAILER_53FT = TRAILER_TYPES["53ft Standard"];

  // lb-engine-04 B2: each fixture records its metrics here as it runs, so the ratchet checks can
  // be reported together at the end rather than scattered through the three fixture blocks.
  const fixtureMetrics = new Map<string, PlanMetrics>();

  // C8/D11 (checked before C7 below since the holey grid is the simplest case — B4 in the
  // lb-engine-02 prompt: "if the general algorithm can't reproduce the obvious answer on the
  // simplest case, it is wrong"). Base qty 676 = 52 columns * 13 per column exactly, so the base
  // alone still gives a full grid with no partial columns. lb-engine-03 D11 adds a SECOND holey
  // SKU sharing the same 48x24 footprint, height 5" (>= K), qty 52 — exactly enough to top off
  // every one of the 52 base columns' 5" residual (13x8"=104", 109-104=5" left, 1x5"=5" exact).
  // The grid shape is unaffected: base demand alone already divides into exactly 52 full columns,
  // so top-off only fills existing columns' residual, it can't create new ones.
  {
    // lb-ui-01: fixture SKUs/cart now live in loadBuilderFixtures.ts (shared with the plan view's
    // fixture picker) rather than being duplicated here.
    const { skus: siplastSkus, cart: siplastCart } = FIXTURE_HOLEY_SIPLAST;
    const siplastPlan = pack(siplastCart, siplastSkus, TRAILER_53FT);

    check("FIXTURE_HOLEY_SIPLAST: pack() places all 728 pieces (balance empty)", siplastPlan.balance.length === 0, JSON.stringify(siplastPlan.balance));
    check("FIXTURE_HOLEY_SIPLAST: single trailer", siplastPlan.trailers.length === 1, String(siplastPlan.trailers.length));
    const siplastTrailer = siplastPlan.trailers[0];
    check("FIXTURE_HOLEY_SIPLAST: 13 rows deep", siplastTrailer?.rows.length === 13, String(siplastTrailer?.rows.length));
    const allRowsHave4Columns = siplastTrailer?.rows.every((r) => r.columns.length === 4) ?? false;
    check("FIXTURE_HOLEY_SIPLAST: 4 columns across in every row (grid shape unaffected by top-off)", allRowsHave4Columns);
    const totalColumns = siplastTrailer?.rows.reduce((s, r) => s + r.columns.length, 0) ?? 0;
    check("FIXTURE_HOLEY_SIPLAST: 52 columns total (4 x 13)", totalColumns === 52, String(totalColumns));
    const noRotation = siplastTrailer?.rows.every((r) => r.columns.every((c) => c.layers.every((l) => l.orientation.label === "flat"))) ?? false;
    check("FIXTURE_HOLEY_SIPLAST: no rotation used anywhere (every layer orientation is 'flat')", noRotation);
    const allColumnsToppedOff = siplastTrailer?.rows.every((r) => r.columns.every((c) => c.mixed && c.layers.length === 2 && c.totalHeight === 109)) ?? false;
    check("FIXTURE_HOLEY_SIPLAST: with top-off active, every column mixes both thicknesses to 109\" exact", allColumnsToppedOff);
    const validationOnSiplast = validatePlan(siplastPlan, siplastCart, siplastSkus, OPTS);
    check("FIXTURE_HOLEY_SIPLAST: validatePlan reports zero violations (top-off satisfies K)", validationOnSiplast.length === 0, JSON.stringify(validationOnSiplast));
    fixtureMetrics.set("FIXTURE_HOLEY_SIPLAST", planMetrics(siplastPlan, OPTS));
  }

  // C7. FIXTURE_BLOCKS_PAIRING end-to-end (INV_4202) — the load legacy could not fit on one
  // truck. Declared with 90.75" as the length axis already, matching the "orient with 90.75 down
  // the trailer length" pairing decision, so the winning combination is each family's own "flat".
  {
    const { skus: pairingSkus, cart: pairingCart } = FIXTURE_BLOCKS_PAIRING;
    const pairingPlan = pack(pairingCart, pairingSkus, TRAILER_53FT);
    const pairingViolations = validatePlan(pairingPlan, pairingCart, pairingSkus, OPTS);

    check("FIXTURE_BLOCKS_PAIRING: pack() returns exactly one trailer", pairingPlan.trailers.length === 1, String(pairingPlan.trailers.length));
    check("FIXTURE_BLOCKS_PAIRING: balance is empty (all 108 pieces placed)", pairingPlan.balance.length === 0, JSON.stringify(pairingPlan.balance));
    check("FIXTURE_BLOCKS_PAIRING: validatePlan reports zero violations", pairingViolations.length === 0, JSON.stringify(pairingViolations));

    // D9: lb-engine-03 must not regress against the lb-engine-02 baseline (8 rows, 516" used) —
    // row count and used length must both be <= baseline. lb-engine-03's B1 (multi-SKU column
    // fill) gives this fixture nothing directly (all four SKUs are distinct footprints, so each
    // is its own single-member family — no cross-SKU top-off is possible here); the improvement
    // comes from A1 (six orientations now searched per single-member family) and A2 (depth-aware
    // row assembly), scored via the row-count-first scoreResult ordering added in lb-engine-03 to
    // stop A1 from finding degenerate many-thin-rows placements that score well on width
    // utilization alone.
    const PAIRING_BASELINE_ROWS = 8;
    const PAIRING_BASELINE_LENGTH = 516;
    const pairingRowCount = pairingPlan.trailers[0]?.rows.length ?? Infinity;
    const pairingUsedLength = pairingPlan.trailers[0]?.usedLength ?? Infinity;
    check(
      `FIXTURE_BLOCKS_PAIRING: row count (${pairingRowCount}) <= lb-engine-02 baseline (${PAIRING_BASELINE_ROWS})`,
      pairingRowCount <= PAIRING_BASELINE_ROWS,
      String(pairingRowCount)
    );
    check(
      `FIXTURE_BLOCKS_PAIRING: used length (${pairingUsedLength}") <= lb-engine-02 baseline (${PAIRING_BASELINE_LENGTH}")`,
      pairingUsedLength <= PAIRING_BASELINE_LENGTH,
      String(pairingUsedLength)
    );
    fixtureMetrics.set("FIXTURE_BLOCKS_PAIRING", planMetrics(pairingPlan, OPTS));
  }

  // C9 / D10. FIXTURE_BLOCKS_MIXED — real INV_4347 data (lb-engine-03 Part C; replaces the
  // lb-engine-02 synthetic placeholders). 94 pieces, six footprints. The dominant 54.75x90.75
  // footprint carries four labels at three thicknesses (8", 9", 5.25") — load-bearing per the
  // prompt, and the reason B1's multi-SKU column fill matters: the exact fills documented in the
  // prompt (e.g. 11x8"+4x5.25"=109" exact) only exist because these four can mix. Two footprints
  // (54.75x90.75 and 42.75x54.75) hold multiple labels at differing thicknesses, so family
  // grouping must survive label *and* thickness differences in more than one place. Three of the
  // six families are single-member (Noria x2, Charlotte County), exercising A1's six-orientation
  // path. 54.75 + 42.75 = 97.5" is a second width-pairing opportunity against the 98" trailer —
  // the same mechanism INV_4202 turns on, here across two DIFFERENT depth groups (90.75 vs
  // 54.75), so it only surfaces through buildOneRow's ungrouped widest-fit candidate, not the
  // same-depth-seeded ones.
  // lb-ui-01: fixture SKUs/cart now live in loadBuilderFixtures.ts (shared with the plan view's
  // fixture picker) rather than being duplicated here.
  const { skus: mixedSkus, cart: mixedCart } = FIXTURE_BLOCKS_MIXED;
  const mixedTotalQty = mixedCart.reduce((s, c) => s + c.qty, 0);
  check("FIXTURE_BLOCKS_MIXED: fixture totals 94 pieces", mixedTotalQty === 94, String(mixedTotalQty));

  const mixedPlan = pack(mixedCart, mixedSkus, TRAILER_53FT);
  const mixedViolations = validatePlan(mixedPlan, mixedCart, mixedSkus, OPTS);
  check("FIXTURE_BLOCKS_MIXED: validatePlan reports zero violations", mixedViolations.length === 0, JSON.stringify(mixedViolations));
  fixtureMetrics.set("FIXTURE_BLOCKS_MIXED", planMetrics(mixedPlan, OPTS));

  const footprintKey = (l: number, w: number) => `${Math.min(l, w)}x${Math.max(l, w)}`;
  const footprintsBySku = new Map<string, string>();
  const rationalesBySku = new Map<string, string[]>();
  for (const trailer of mixedPlan.trailers) {
    for (const row of trailer.rows) {
      for (const column of row.columns) {
        for (const layer of column.layers) {
          footprintsBySku.set(layer.skuId, footprintKey(column.colLength, column.colWidth));
          const list = rationalesBySku.get(layer.skuId) ?? [];
          list.push(column.rationale);
          rationalesBySku.set(layer.skuId, list);
        }
      }
    }
  }
  const distinctFootprints = new Set(Array.from(footprintsBySku.values()));
  check("FIXTURE_BLOCKS_MIXED: exactly 6 distinct footprints placed", distinctFootprints.size === 6, JSON.stringify(Array.from(distinctFootprints)));

  const dominantFootprint = footprintKey(54.75, 90.75);
  const dominantLabelsPlaced = ["MIX_SEARAY8", "MIX_STOCK8", "MIX_KANSAS525", "MIX_SEARAY9"].filter((id) => footprintsBySku.get(id) === dominantFootprint);
  check(
    "FIXTURE_BLOCKS_MIXED: all four dominant-family labels (Sea Ray 8/9, STOCK, Kansas) land on the 54.75x90.75 footprint",
    dominantLabelsPlaced.length === 4,
    JSON.stringify(dominantLabelsPlaced)
  );

  const kansasCompFootprint = footprintKey(24.75, 54.75);
  const kansasCompLabelsPlaced = ["MIX_KANSAS_COMP", "MIX_WESTWEGO_CA"].filter((id) => footprintsBySku.get(id) === kansasCompFootprint);
  check(
    "FIXTURE_BLOCKS_MIXED: both 24.75x54.75 labels (Kansas Comp, Westwego CA Comp) land on the same footprint",
    kansasCompLabelsPlaced.length === 2,
    JSON.stringify(kansasCompLabelsPlaced)
  );

  const kabFootprint = footprintKey(42.75, 54.75);
  const kabLabelsPlaced = ["MIX_KAB", "MIX_WESTWEGO_GW"].filter((id) => footprintsBySku.get(id) === kabFootprint);
  check(
    "FIXTURE_BLOCKS_MIXED: both 42.75x54.75 labels (KAB CA Comps, Westwego GW Comp) land on the same footprint",
    kabLabelsPlaced.length === 2,
    JSON.stringify(kabLabelsPlaced)
  );

  // D10: the 54.75 + 42.75 = 97.5" width pairing is found somewhere in the plan — a row whose
  // columns include one at colWidth ~54.75 (from the dominant family) and one at colWidth ~42.75
  // (from the KAB/Westwego GW family), together summing to 97.5".
  {
    let found = false;
    for (const trailer of mixedPlan.trailers) {
      for (const row of trailer.rows) {
        const has5475 = row.columns.some((c) => Math.abs(c.colWidth - 54.75) < 1e-6);
        const has4275 = row.columns.some((c) => Math.abs(c.colWidth - 42.75) < 1e-6);
        if (has5475 && has4275) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    check("FIXTURE_BLOCKS_MIXED: the 54.75\"+42.75\"=97.5\" width pairing is found", found);
  }

  // D1's "three of the six families are single-member" exercises A1 here too: Noria (19.75x30.75),
  // Charlotte County (54.75x66.75), Noria (30.75x90.75) are each placed alone, so all should still
  // be findable in the plan.
  check(
    "FIXTURE_BLOCKS_MIXED: the three single-member families (both Norias, Charlotte County) are all placed",
    footprintsBySku.has("MIX_NORIA_A") && footprintsBySku.has("MIX_NORIA_B") && footprintsBySku.has("MIX_CHARLOTTE")
  );

  // --- lb-engine-03 Part D additions (beyond the fixture updates above) ---

  // D1. familyOrientationOptions: 6 for a single-member non-holey family, 2 for a multi-member
  // family, 1 for holey, 1 when allowRotation:false. Family objects are passed as plain object
  // literals (Family isn't exported — TS structural typing accepts the matching shape).
  {
    const repSingle: PackSku = { id: "FO_SINGLE", name: "single", sku: "FO_SINGLE", length: 20, width: 10, height: 5, weight: 2, category: "Blocks", allowRotation: true };
    const singleFamily = { length: 20, width: 10, members: [{ sku: repSingle, qty: 5 }] };
    check("familyOrientationOptions: single-member non-holey family returns 6 orientations", familyOrientationOptions(singleFamily, OPTS).length === 6, String(familyOrientationOptions(singleFamily, OPTS).length));

    const repMultiA: PackSku = { id: "FO_MULTI_A", name: "multiA", sku: "FO_MULTI_A", length: 20, width: 10, height: 5, weight: 2, category: "Blocks", allowRotation: true };
    const repMultiB: PackSku = { id: "FO_MULTI_B", name: "multiB", sku: "FO_MULTI_B", length: 20, width: 10, height: 8, weight: 3, category: "Blocks", allowRotation: true };
    const multiFamily = { length: 20, width: 10, members: [{ sku: repMultiA, qty: 3 }, { sku: repMultiB, qty: 2 }] };
    check("familyOrientationOptions: 2-member family returns 2 orientations (flat/flat-rotated)", familyOrientationOptions(multiFamily, OPTS).length === 2);

    const repHoley: PackSku = { id: "FO_HOLEY", name: "holey", sku: "FO_HOLEY", length: 48, width: 24, height: 0.75, weight: 5, category: HOLEY_BOARD_CATEGORY, allowRotation: false };
    const holeyFamily = { length: 48, width: 24, members: [{ sku: repHoley, qty: 10 }] };
    check("familyOrientationOptions: holey single-member family returns 1 orientation", familyOrientationOptions(holeyFamily, OPTS).length === 1);

    const repNoRotate: PackSku = { id: "FO_NOROTATE", name: "norotate", sku: "FO_NOROTATE", length: 20, width: 10, height: 5, weight: 2, category: "Blocks", allowRotation: false };
    const noRotateFamily = { length: 20, width: 10, members: [{ sku: repNoRotate, qty: 4 }] };
    check("familyOrientationOptions: allowRotation:false single-member family returns 1 orientation", familyOrientationOptions(noRotateFamily, OPTS).length === 1);
  }

  // D2/D4. Column fill finds 8x11 + 5.25x4 = 109" exactly for the INV_4347 dominant footprint
  // (isolated to just those two SKUs so the search has nothing else to consider), and the
  // resulting column is a correctly-rolled-up mixed/top-off column.
  {
    const fillBase: PackSku = { id: "FILL_BASE", name: "base 8in", sku: "FILL_BASE", length: 54.75, width: 90.75, height: 8, weight: 30, category: "Blocks", allowRotation: true };
    const fillTopoff: PackSku = { id: "FILL_TOPOFF", name: "topoff 5.25in", sku: "FILL_TOPOFF", length: 54.75, width: 90.75, height: 5.25, weight: 20, category: "Blocks", allowRotation: true };
    const fillCart: CartLine[] = [{ skuId: "FILL_BASE", qty: 100 }, { skuId: "FILL_TOPOFF", qty: 100 }];
    const fillPlan = pack(fillCart, [fillBase, fillTopoff], TRAILER_53FT);

    const exactColumn = findColumn(
      fillPlan,
      (c) => c.layers.length === 2 && c.layers[0].unitHeight === 8 && c.layers[0].count === 11 && c.layers[1].unitHeight === 5.25 && c.layers[1].count === 4
    );
    check("Column fill: 8x11 + 5.25x4 = 109\" exact is found for the INV_4347 dominant footprint", exactColumn !== null);
    check("Column fill: the exact-fill column totals 109\" with zero gap", exactColumn?.totalHeight === 109, String(exactColumn?.totalHeight));
    check("D4: the exact-fill (base + accepted top-off) column is marked mixed", exactColumn?.mixed === true);

    const fillViolations = validatePlan(fillPlan, fillCart, [fillBase, fillTopoff], OPTS);
    check("Column fill: 0 violations, and mixedStacks rolls up (>0) for the accepted top-off", fillViolations.length === 0 && fillPlan.mixedStacks > 0, `violations=${fillViolations.length} mixedStacks=${fillPlan.mixedStacks}`);
  }

  // D3. Top-off is rejected when the best available candidate's inches-per-piece < K, the gap is
  // left open (single-layer column), and the rationale says so. Both members are declared below
  // K (2.5" and 1.75") so that neither role assignment (base vs top-off) can ever find an
  // ELIGIBLE top-off — otherwise the search would legitimately promote the thinner member to
  // "base" and use the thicker one as an eligible top-off, which is a real accepted case, not a
  // rejection.
  {
    const rejA: PackSku = { id: "REJ_A", name: "2.5in", sku: "REJ_A", length: 54.75, width: 90.75, height: 2.5, weight: 15, category: "Blocks", allowRotation: true };
    const rejB: PackSku = { id: "REJ_B", name: "1.75in", sku: "REJ_B", length: 54.75, width: 90.75, height: 1.75, weight: 10, category: "Blocks", allowRotation: true };
    const rejCart: CartLine[] = [{ skuId: "REJ_A", qty: 100 }, { skuId: "REJ_B", qty: 100 }];
    const rejPlan = pack(rejCart, [rejA, rejB], TRAILER_53FT);

    const rejColumn = findColumn(rejPlan, (c) => c.layers.some((l) => l.skuId === "REJ_A" || l.skuId === "REJ_B"));
    check("D3: below-K top-off is rejected — the column stays single-layer (gap left open)", rejColumn?.layers.length === 1, JSON.stringify(rejColumn));
    check("D3: rejection rationale names the best top-off candidate and the K threshold", (rejColumn?.rationale ?? "").includes("below K of"), rejColumn?.rationale);
    check("D3: rejected column is not marked mixed", rejColumn?.mixed === false);
  }

  // D5. maxSkusPerColumn:2 (the default) is never exceeded, even for a footprint where a 3-SKU
  // fill would land exactly on dims.height (8x5 + 9x3 + 5.25x8 = 109", per the prompt) — with
  // three candidate SKUs and the default cap, pack() must still only ever use two per column.
  {
    const capA: PackSku = { id: "CAP_A", name: "8in", sku: "CAP_A", length: 54.75, width: 90.75, height: 8, weight: 30, category: "Blocks", allowRotation: true };
    const capB: PackSku = { id: "CAP_B", name: "9in", sku: "CAP_B", length: 54.75, width: 90.75, height: 9, weight: 32, category: "Blocks", allowRotation: true };
    const capC: PackSku = { id: "CAP_C", name: "5.25in", sku: "CAP_C", length: 54.75, width: 90.75, height: 5.25, weight: 20, category: "Blocks", allowRotation: true };
    const capCart: CartLine[] = [{ skuId: "CAP_A", qty: 50 }, { skuId: "CAP_B", qty: 50 }, { skuId: "CAP_C", qty: 50 }];
    const capPlan = pack(capCart, [capA, capB, capC], TRAILER_53FT, { maxSkusPerColumn: 2 });

    let maxLayersSeen = 0;
    for (const trailer of capPlan.trailers) {
      for (const row of trailer.rows) {
        for (const col of row.columns) {
          maxLayersSeen = Math.max(maxLayersSeen, new Set(col.layers.map((l) => l.skuId)).size);
        }
      }
    }
    check("D5: maxSkusPerColumn:2 is never exceeded, even where a 3-SKU fill would land exactly on 109\"", maxLayersSeen <= 2, String(maxLayersSeen));
    const capViolations = validatePlan(capPlan, capCart, [capA, capB, capC], OPTS);
    check("D5: 0 max-skus-per-column violations", capViolations.filter((v) => v.rule === "max-skus-per-column").length === 0, JSON.stringify(capViolations));
  }

  // D6. row-order-nose-first (2026-09-16, superseding B3's original "thickest at the rear"
  // assumption): rows are ordered thinnest-base at posFromFront 0 (rear, where the doors are —
  // loaded last), thickest at the nose (loaded first — "biggest sizes go in first," confirmed with
  // Steve). allowRotation:false on both SKUs pins them to their declared flat orientation so A1's
  // six-orientation search can't complicate which footprint/depth each ends up at — this fixture
  // is purely about B3's row sort, not orientation choice.
  {
    const rowThick: PackSku = { id: "ROWTEST_THICK", name: "thick", sku: "ROWTEST_THICK", length: 90.75, width: 90.75, height: 20, weight: 50, category: "Blocks", allowRotation: false };
    const rowThin: PackSku = { id: "ROWTEST_THIN", name: "thin", sku: "ROWTEST_THIN", length: 40, width: 40, height: 4, weight: 10, category: "Blocks", allowRotation: false };
    const rowCart: CartLine[] = [{ skuId: "ROWTEST_THICK", qty: 5 }, { skuId: "ROWTEST_THIN", qty: 5 }];
    const rowPlan = pack(rowCart, [rowThick, rowThin], TRAILER_53FT);

    const thickRow = findRow(rowPlan, (r) => r.columns.some((c) => c.layers[0].skuId === "ROWTEST_THICK"));
    const thinRow = findRow(rowPlan, (r) => r.columns.some((c) => c.layers[0].skuId === "ROWTEST_THIN"));
    check("D6: the thinnest-base row sits at posFromFront 0 (the rear)", thinRow?.posFromFront === 0, String(thinRow?.posFromFront));
    check(
      "D6: the thicker-base row sits further from the rear (toward the nose) than the thin row",
      (thickRow?.posFromFront ?? -1) > (thinRow?.posFromFront ?? -1),
      `thin=${thinRow?.posFromFront} thick=${thickRow?.posFromFront}`
    );
  }

  // D9, row-order-tail-placement (2026-09-16): when a thickness's own column supply runs out
  // mid-tier, buildOneRow's greedy width-pack leaves one row with fewer columns than its
  // same-thickness neighbors. Without a same-thickness tiebreak, that sparse row can land
  // sandwiched between two full rows of its own thickness — a gap in the middle of the diagram a
  // loader would read as a mistake, not an intentional "ran out." The fix's secondary sort key
  // (rowWidthUsed ascending on a thickness tie) should push the sparse row to the rear-adjacent edge
  // of its tier instead. Quantities picked so 6.5" holey board's own tail column (8 of its 16/column
  // max) has enough leftover room to chain into 10 units of 5.5" (holey-sequential-fill) before
  // 5.5" continues as pure columns of its own — ground-truthed by running pack() directly rather
  // than hand-derived, since the chain absorbs some of 5.5"'s demand into that mixed column: 169
  // total 5.5" demand, minus 10 chained, leaves 159 = 8 full columns (152) + a 7pc tail, not a
  // clean 8-full+17-tail split.
  {
    const tailA: PackSku = { id: "TAIL_65", name: "6.5in holey", sku: "TAIL_65", length: 48, width: 24, height: 6.5, weight: 10, category: HOLEY_BOARD_CATEGORY, allowRotation: false };
    const tailB: PackSku = { id: "TAIL_55", name: "5.5in holey", sku: "TAIL_55", length: 48, width: 24, height: 5.5, weight: 10, category: HOLEY_BOARD_CATEGORY, allowRotation: false };
    const tailCart: CartLine[] = [{ skuId: "TAIL_65", qty: 16 * 12 + 8 }, { skuId: "TAIL_55", qty: 19 * 8 + 17 }];
    const tailPlan = pack(tailCart, [tailA, tailB], TRAILER_53FT);
    const tailRows = tailPlan.trailers[0]?.rows ?? [];

    const sparse55Row = tailRows.find(
      (r) => r.columns.length === 2 && r.columns.some((c) => c.layers[0]?.skuId === "TAIL_55" && c.layers[0]?.count === 7)
    );
    check("D9: the sparse tail row (1 full lane + the 7pc remainder) exists", !!sparse55Row, JSON.stringify(tailRows.map((r) => r.columns.length)));
    check(
      "D9: the sparse 5.5\" row is the rear-most row of its thickness tier (every full 5.5\" row sits farther toward the nose)",
      tailRows.every((r) => {
        if (!sparse55Row || r === sparse55Row) return true;
        const isFull55 = r.columns.length === 4 && r.columns.every((c) => c.layers[0]?.unitHeight === 5.5);
        return !isFull55 || r.posFromFront > sparse55Row.posFromFront;
      }),
      JSON.stringify(tailRows.map((r) => ({ posFromFront: r.posFromFront, cols: r.columns.length })))
    );
  }

  // D7. Depth-aware assembly: when two same-depth families can fill a row's width together
  // (60x50 + 60x48 = 98" exactly), pack() prefers that same-depth pairing over reaching for a
  // mismatched-depth family (40x50) even though the latter is also available — wastedFloorArea is
  // 0 for the same-depth row.
  {
    const depthP: PackSku = { id: "DEPTH_P", name: "P", sku: "DEPTH_P", length: 60, width: 50, height: 8, weight: 20, category: "Blocks", allowRotation: false };
    const depthQ: PackSku = { id: "DEPTH_Q", name: "Q", sku: "DEPTH_Q", length: 60, width: 48, height: 8, weight: 20, category: "Blocks", allowRotation: false };
    const depthR: PackSku = { id: "DEPTH_R", name: "R", sku: "DEPTH_R", length: 40, width: 50, height: 8, weight: 20, category: "Blocks", allowRotation: false };
    const depthCart: CartLine[] = [{ skuId: "DEPTH_P", qty: 20 }, { skuId: "DEPTH_Q", qty: 20 }, { skuId: "DEPTH_R", qty: 5 }];
    const depthPlan = pack(depthCart, [depthP, depthQ, depthR], TRAILER_53FT);

    const sameDepthRow = findRow(
      depthPlan,
      (r) => r.columns.some((c) => c.layers[0].skuId === "DEPTH_P") && r.columns.some((c) => c.layers[0].skuId === "DEPTH_Q") && !r.columns.some((c) => c.layers[0].skuId === "DEPTH_R")
    );
    check("D7: a same-depth P+Q row (50+48=98\") is found", sameDepthRow !== null);
    check("D7: the same-depth row's wastedFloorArea is 0", sameDepthRow?.wastedFloorArea === 0, String(sameDepthRow?.wastedFloorArea));
  }

  // D8. trailerLimit:1 on a cart far exceeding one trailer's capacity places exactly one full
  // trailer and returns the exact remainder in balance, with zero violations (conservation holds
  // across the cut — the case B4 exists for: plan *this* truck, carry the rest forward).
  {
    const balSku: PackSku = { id: "BAL_SKU", name: "balance test", sku: "BAL_SKU", length: 54.75, width: 90.75, height: 8, weight: 30, category: "Blocks", allowRotation: false };
    const balCart: CartLine[] = [{ skuId: "BAL_SKU", qty: 2000 }];
    const balPlan = pack(balCart, [balSku], TRAILER_53FT, { trailerLimit: 1 });

    check("D8: trailerLimit:1 caps the plan at exactly one trailer", balPlan.trailers.length === 1, String(balPlan.trailers.length));
    check("D8: the remainder lands in balance", balPlan.balance.some((b) => b.remaining > 0), JSON.stringify(balPlan.balance));

    const placedCount = balPlan.trailers.reduce((s, t) => s + t.totalUnits, 0);
    const remainingCount = balPlan.balance.reduce((s, b) => s + b.remaining, 0);
    check("D8: placed + remaining == cart qty exactly (2000)", placedCount + remainingCount === 2000, `${placedCount}+${remainingCount}`);

    const balViolations = validatePlan(balPlan, balCart, [balSku], { ...OPTS, trailerLimit: 1 });
    check("D8: 0 violations — conservation holds exactly across the trailerLimit cut", balViolations.length === 0, JSON.stringify(balViolations));
  }

  // --- lb-engine-04 Part C: rationale honesty (E1-E5) + planMetrics/ratchet (E6-E8) ---

  // E1. Below-K: a footprint-mate WITH remaining demand exists but is under K, so the rationale
  // must name it and the threshold — not claim the footprint is empty and not claim demand is
  // used up. Both members are declared below K (2.5" and 1.75") for the reason D3 documents: if
  // only one were below K, the search would legitimately promote the thin one to "base" and use
  // the thick one as an ELIGIBLE top-off, which is an accepted pairing, not a rejection. With
  // 100 of each, the mate still has remaining demand when the first column is decided.
  {
    const bkA: PackSku = { id: "BK_A", name: "2.5in", sku: "BK_A", length: 54.75, width: 90.75, height: 2.5, weight: 15, category: "Blocks", allowRotation: true };
    const bkB: PackSku = { id: "BK_B", name: "1.75in", sku: "BK_B", length: 54.75, width: 90.75, height: 1.75, weight: 10, category: "Blocks", allowRotation: true };
    const bkCart: CartLine[] = [{ skuId: "BK_A", qty: 100 }, { skuId: "BK_B", qty: 100 }];
    const bkPlan = pack(bkCart, [bkA, bkB], TRAILER_53FT);
    const bkRationale = findColumn(bkPlan, (c) => c.layers.length === 1)?.rationale ?? "";

    check("E1: below-K rationale names the best top-off candidate and the K threshold", bkRationale.includes("below K of"), bkRationale);
    check("E1: below-K rationale does NOT claim the footprint has no other SKU", !bkRationale.includes("no other SKU"), bkRationale);
    check("E1: below-K rationale does NOT claim demand is exhausted", !bkRationale.includes("no remaining demand"), bkRationale);
  }

  // E2. Demand exhausted, the real INV_4347 42.75x54.75 family (KAB CA Comps qty 2 + Westwego GW
  // Comp qty 1, both 7"). Before lb-engine-04 this column read
  //   `2 x 7" = 14", topped off with 1 x 7" = 7" — 21" of 109", 88" left`
  // which reads as 88" of wasted trailer. It was never waste: there were only three pieces in the
  // whole order. The prompt requires the string not to claim "no other SKU"; asserting only that
  // would pass vacuously (that wording never applied to this branch), so the positive assertion
  // that it actually says the pieces ran out is the one with teeth.
  {
    const kabRationales = (rationalesBySku.get("MIX_KAB") ?? []).concat(rationalesBySku.get("MIX_WESTWEGO_GW") ?? []);
    const kabRationale = kabRationales[0] ?? "";
    check("E2: INV_4347 42.75x54.75 column reports that all available pieces were placed", kabRationale.includes("all available pieces placed"), kabRationale);
    check("E2: INV_4347 42.75x54.75 column does NOT claim \"no other SKU\"", kabRationale.length > 0 && !kabRationale.includes("no other SKU"), kabRationale);
    check("E2: INV_4347 42.75x54.75 column no longer reports a bare 88\" leftover gap", !kabRationale.includes("88\" left"), kabRationale);

    // The same three-way split on the else branch: the last STOCK piece lands alone on the
    // dominant 54.75x90.75 footprint after every footprint-mate is used up, so it must take the
    // demand-exhausted wording rather than "no other SKU on this footprint".
    const exhaustedElse = findColumn(
      mixedPlan,
      (c) => c.layers.length === 1 && c.rationale.includes("no remaining demand for this footprint")
    );
    check("E2: a single-layer column on a shared footprint uses the demand-exhausted wording", exhaustedElse !== null, exhaustedElse?.rationale);
    check("E2: that column does NOT claim \"no other SKU\"", !(exhaustedElse?.rationale ?? "no other SKU").includes("no other SKU"), exhaustedElse?.rationale);
  }

  // E3. No footprint-mate at all — a genuine single-member family keeps the original wording.
  // 9 x 12" = 108" leaves 1" on a 109" trailer, matching the prompt's example exactly.
  {
    const soloSku: PackSku = { id: "SOLO", name: "solo 12in", sku: "SOLO", length: 54.75, width: 90.75, height: 12, weight: 25, category: "Blocks", allowRotation: false };
    const soloCart: CartLine[] = [{ skuId: "SOLO", qty: 9 }];
    const soloPlan = pack(soloCart, [soloSku], TRAILER_53FT);
    const soloRationale = findColumn(soloPlan, () => true)?.rationale ?? "";

    check("E3: single-member family keeps the no-footprint-mate wording", soloRationale.includes("no other SKU on this footprint"), soloRationale);
    check("E3: single-member family does NOT claim demand exhaustion", !soloRationale.includes("no remaining demand"), soloRationale);
    check("E3: single-member family rationale still shows the fill (9 x 12\" = 108\", 1\" left)", soloRationale.startsWith("9 × 12\" = 108\", 1\" left"), soloRationale);
  }

  // E4. Equal thickness is not a "top-off". Same INV_4347 column as E2: two 7" labels stacked is a
  // second label at the same thickness, not a thinner piece filling a residual gap, so it names
  // both SKUs and drops the "topped off with" verb.
  {
    const kabRationale = (rationalesBySku.get("MIX_KAB") ?? [])[0] ?? "";
    check("E4: equal-thickness pairing does NOT say \"topped off with\"", kabRationale.length > 0 && !kabRationale.includes("topped off with"), kabRationale);
    check("E4: equal-thickness pairing names both SKUs", kabRationale.includes("(KAB CA Comps)") && kabRationale.includes("(Westwego GW Comp)"), kabRationale);
    check("E4: a genuinely thinner top-off still uses \"topped off with\"", ((rationalesBySku.get("MIX_KANSAS525") ?? [])[0] ?? "").includes("topped off with"), (rationalesBySku.get("MIX_KANSAS525") ?? [])[0]);
  }

  // E5 (A4). applyStabilityWarnings appends onto rationale after buildFamilyColumns has written
  // it. Nothing in Part A may overwrite the string later, so a column that earns a stability note
  // must still carry its Part A rationale, with the note appended AFTER it.
  {
    const stabilityColumn = findColumn(mixedPlan, (c) => c.rationale.includes("[stability:"));
    const stabilityRationale = stabilityColumn?.rationale ?? "";
    const partAIndex = stabilityRationale.indexOf("no other SKU on this footprint");
    const noteIndex = stabilityRationale.indexOf("[stability:");
    check("E5: a column with a stability note still carries its Part A rationale", partAIndex >= 0, stabilityRationale);
    check("E5: the stability note is appended AFTER the Part A rationale, not over it", partAIndex >= 0 && noteIndex > partAIndex, stabilityRationale);
    check("E5: the stability note is still the tail of the string", stabilityRationale.endsWith("]"), stabilityRationale);
  }

  // E6. planMetrics() against a hand-built plan whose every field is known by construction: two
  // rows (20" and 10" deep) on a 100x50x40 trailer, three columns at 20"/30"/40" tall.
  {
    const metricsDims: Dimensions = { length: 100, width: 50, height: 40, maxWeight: 1000 };
    const mkLayer = (unitHeight: number, count: number): PackLayer => ({
      skuId: "A", skuName: "SKU A", skuCode: "A-1", color: "#111111", unitHeight, count,
      orientation: { length: 20, width: 10, height: unitHeight, label: "flat" },
    });
    const mkColumn = (colWidth: number, colLength: number, unitHeight: number, count: number, mixed: boolean): PackColumn => ({
      posY: 0, colWidth, colLength, totalHeight: unitHeight * count, totalWeight: count * 2,
      stackCount: count, layers: [mkLayer(unitHeight, count)], mixed, rationale: "hand-built",
    });
    const mkRow = (rowLength: number, columns: PackColumn[]): PackRow => ({
      posFromFront: 0, rowLength, rowWidthUsed: 0, wastedFloorArea: 0, columns, totalUnits: 0, totalWeight: 0,
    });
    const metricsPlan: PackPlan = {
      trailers: [{
        type: "Custom", dims: metricsDims,
        rows: [
          mkRow(20, [mkColumn(10, 20, 10, 2, true), mkColumn(15, 10, 10, 3, false)]),
          mkRow(10, [mkColumn(20, 10, 10, 4, false)]),
        ],
        usedLength: 0, usedFloorArea: 0, usedWeight: 0, totalStacks: 0, totalUnits: 0, mixedStacks: 0,
        widthUtilization: 0, heightUtilization: 0,
      }],
      balance: [{ skuId: "A", remaining: 4 }, { skuId: "B", remaining: 6 }],
      warnings: [], totalWeight: 0, totalUnits: 0, totalStacks: 0, mixedStacks: 0,
    };
    recompute(metricsPlan);
    const m = planMetrics(metricsPlan, OPTS);

    check("E6: planMetrics trailerCount", m.trailerCount === 1, String(m.trailerCount));
    check("E6: planMetrics rowCount", m.rowCount === 2, String(m.rowCount));
    check("E6: planMetrics usedLength sums row lengths (20 + 10 = 30)", m.usedLength === 30, String(m.usedLength));
    // (20/40 + 30/40 + 40/40) / 3 = 0.75
    check("E6: planMetrics meanHeightUtilization averages across columns (0.75)", Math.abs(m.meanHeightUtilization - 0.75) < 1e-9, String(m.meanHeightUtilization));
    // (25/50 + 20/50) / 2 = 0.45
    check("E6: planMetrics meanWidthUtilization averages across rows (0.45)", Math.abs(m.meanWidthUtilization - 0.45) < 1e-9, String(m.meanWidthUtilization));
    // row 0: (20-20)*10 + (20-10)*15 = 150; row 1: (10-10)*20 = 0
    check("E6: planMetrics wastedFloorArea sums across rows (150)", m.wastedFloorArea === 150, String(m.wastedFloorArea));
    check("E6: planMetrics mixedStacks", m.mixedStacks === 1, String(m.mixedStacks));
    check("E6: planMetrics balancePieces sums remaining demand (4 + 6 = 10)", m.balancePieces === 10, String(m.balancePieces));

    const emptyMetrics = planMetrics({ trailers: [], balance: [], warnings: [], totalWeight: 0, totalUnits: 0, totalStacks: 0, mixedStacks: 0 }, OPTS);
    check("E6: planMetrics on an empty plan returns zeroes, not NaN", emptyMetrics.meanHeightUtilization === 0 && emptyMetrics.meanWidthUtilization === 0 && emptyMetrics.rowCount === 0);
  }

  // E7. The ratchet passes for all three real fixtures.
  for (const [name, bar] of Object.entries(RATCHET)) {
    const metrics = fixtureMetrics.get(name);
    if (!metrics) {
      check(`E7: ${name} recorded metrics for the ratchet`, false, "fixture did not run");
      continue;
    }
    const failures = ratchetFailures(metrics, bar);
    check(
      `E7: ${name} clears the ratchet (${metrics.rowCount} rows, ${metrics.usedLength}" used, ${metrics.meanHeightUtilization.toFixed(4)} mean height util)`,
      failures.length === 0,
      failures.join("; ")
    );
  }

  // E8. Prove the bar has teeth: a ratchet that cannot fail is not a ratchet. Take the real
  // FIXTURE_BLOCKS_PAIRING metrics and degrade each dimension the ratchet guards, one at a time,
  // then confirm ratchetFailures() catches each on its own and all of them together.
  {
    const good = fixtureMetrics.get("FIXTURE_BLOCKS_PAIRING");
    const bar = RATCHET.FIXTURE_BLOCKS_PAIRING;
    if (!good) {
      check("E8: FIXTURE_BLOCKS_PAIRING metrics available to degrade", false, "fixture did not run");
    } else {
      check("E8: the unmodified fixture is the control — it clears the bar", ratchetFailures(good, bar).length === 0);
      check("E8: an extra trailer fails the ratchet", ratchetFailures({ ...good, trailerCount: good.trailerCount + 1 }, bar).length > 0);
      check("E8: an extra row fails the ratchet", ratchetFailures({ ...good, rowCount: good.rowCount + 1 }, bar).length > 0);
      check("E8: more used length fails the ratchet", ratchetFailures({ ...good, usedLength: good.usedLength + 12 }, bar).length > 0);
      check("E8: worse height utilization fails the ratchet", ratchetFailures({ ...good, meanHeightUtilization: good.meanHeightUtilization - 0.05 }, bar).length > 0);

      const allWorse = ratchetFailures(
        { ...good, trailerCount: good.trailerCount + 1, rowCount: good.rowCount + 1, usedLength: good.usedLength + 12, meanHeightUtilization: good.meanHeightUtilization - 0.05 },
        bar
      );
      check("E8: a plan worse on every guarded dimension reports all four failures", allWorse.length === 4, allWorse.join("; "));

      // A strictly BETTER plan must still pass — the bar is "no worse than", not "equal to".
      const better = ratchetFailures({ ...good, rowCount: good.rowCount - 1, usedLength: good.usedLength - 20, meanHeightUtilization: good.meanHeightUtilization + 0.05 }, bar);
      check("E8: a strictly better plan still clears the ratchet", better.length === 0, better.join("; "));
    }
  }

  // --- lb-engine-05 Part C: runner height (F1-F5) + near-weight advisory removal (F6-F7) ---

  // F1. runnerHeight caps columns at the effective height, not the nominal trailer height. Pinned
  // to a single orientation (allowRotation:false) so the search can't tip the 8" dimension onto
  // another axis — the exact trap C6/D6 already document elsewhere in this file. Weight is kept
  // low (1 lb) so weightCap is never the binding constraint, only height is under test.
  {
    const f1Sku: PackSku = { id: "F1_SKU", name: "8in runner test", sku: "F1", length: 20, width: 10, height: 8, weight: 1, category: "Blocks", allowRotation: false };
    const f1Cart: CartLine[] = [{ skuId: "F1_SKU", qty: 20 }];

    const noRunnerPlan = pack(f1Cart, [f1Sku], TRAILER_53FT);
    const noRunnerCount = findColumn(noRunnerPlan, () => true)?.layers[0]?.count;
    check("F1: no runner — 8in SKU stacks 13 per column (13x8=104 <= 109)", noRunnerCount === 13, String(noRunnerCount));

    const runner4Plan = pack(f1Cart, [f1Sku], TRAILER_53FT, { runnerHeight: 4 });
    const runner4Count = findColumn(runner4Plan, () => true)?.layers[0]?.count;
    check("F1: 4in runner — 8in SKU still stacks 13 per column (13x8=104 <= 105 effective)", runner4Count === 13, String(runner4Count));

    const runner8Plan = pack(f1Cart, [f1Sku], TRAILER_53FT, { runnerHeight: 8 });
    const runner8Count = findColumn(runner8Plan, () => true)?.layers[0]?.count;
    check("F1: 8in runner — 8in SKU drops to 12 per column (13x8=104 > 101 effective)", runner8Count === 12, String(runner8Count));
  }

  // F2. This is the exact bug A1 describes: a column that fits under the nominal trailer height
  // but overflows the runner-adjusted effective height must now be caught by column-height, and
  // must NOT be caught when no runner is set (same plan, same column, only the options differ).
  {
    const runnerOpts: PackOptions = { ...OPTS, runnerHeight: 5 }; // effectiveHeight = 40 - 5 = 35
    const bad = clone(baseline);
    bad.trailers[0].rows[0].columns[0].totalHeight = 38; // < DIMS.height (40), > effective height (35)

    const violationsWithRunner = validatePlan(bad, CART, SKUS, runnerOpts);
    check(
      "F2: column exceeding effective height (35) but under trailer height (40) triggers column-height",
      ruleViolations(violationsWithRunner, "column-height") > 0,
      JSON.stringify(violationsWithRunner)
    );

    const violationsNoRunner = validatePlan(bad, CART, SKUS, OPTS);
    check(
      "F2: the identical column is clean when no runner is set (38 <= trailer height 40)",
      ruleViolations(violationsNoRunner, "column-height") === 0,
      JSON.stringify(violationsNoRunner)
    );
  }

  // F3. Same plan, same nominal dims — a runner shrinks the denominator, so meanHeightUtilization
  // must read HIGHER with a runner set, not lower or unchanged (a runnered load isn't actually
  // less full than the algorithm believed; the old dims.height denominator just under-reported it).
  {
    const noRunnerMetrics = planMetrics(baseline, OPTS);
    const runnerMetrics = planMetrics(baseline, { ...OPTS, runnerHeight: 5 });
    check(
      "F3: meanHeightUtilization is higher against effective height than nominal height for the same plan",
      runnerMetrics.meanHeightUtilization > noRunnerMetrics.meanHeightUtilization,
      `no-runner=${noRunnerMetrics.meanHeightUtilization} runner=${runnerMetrics.meanHeightUtilization}`
    );
  }

  // F4. Rationale names the runner and the usable height when one is set, and is byte-for-byte
  // silent about both when it isn't (the negative case has teeth: it's what proves the no-runner
  // path is untouched, not merely that the runner path adds something).
  {
    const f4Sku: PackSku = { id: "F4_SKU", name: "12in solo", sku: "F4", length: 20, width: 10, height: 12, weight: 5, category: "Blocks", allowRotation: false };
    const f4Cart: CartLine[] = [{ skuId: "F4_SKU", qty: 9 }];
    const f4Dims: Dimensions = { length: 100, width: 50, height: 109, maxWeight: 1000 };

    const noRunnerPlan = pack(f4Cart, [f4Sku], f4Dims);
    const noRunnerRationale = findColumn(noRunnerPlan, () => true)?.rationale ?? "";
    check(
      "F4: no runner set — rationale mentions neither usable height nor a runner",
      !noRunnerRationale.includes("usable") && !noRunnerRationale.includes("runner"),
      noRunnerRationale
    );

    const runnerPlan = pack(f4Cart, [f4Sku], f4Dims, { runnerHeight: 4 });
    const runnerRationale = findColumn(runnerPlan, () => true)?.rationale ?? "";
    check("F4: runner set — rationale reports the usable height", runnerRationale.includes("usable ("), runnerRationale);
    check("F4: runner set — rationale names the runner", runnerRationale.includes(" runner)"), runnerRationale);
    check("F4: runner set — usable height is the effective 105 (109 trailer - 4 runner)", runnerRationale.includes("105"), runnerRationale);
  }

  // F5. A negative, NaN, Infinity, or >= dims.height runnerHeight is nonsense — pack() must clamp
  // it to 0 (behaving exactly as if unset) and warn, rather than produce a zero/negative budget.
  // Checked against pack()'s own clamp-and-warn AND against validatePlan's independent resolution
  // of the same invalid option, since the two don't share a call graph.
  {
    const f5Sku: PackSku = { id: "F5_SKU", name: "12in clamp test", sku: "F5", length: 20, width: 10, height: 12, weight: 5, category: "Blocks", allowRotation: false };
    const f5Cart: CartLine[] = [{ skuId: "F5_SKU", qty: 9 }];
    const f5Dims: Dimensions = { length: 100, width: 50, height: 109, maxWeight: 1000 };
    const badValues = [-5, NaN, Infinity, 109, 200];

    for (const rh of badValues) {
      const plan = pack(f5Cart, [f5Sku], f5Dims, { runnerHeight: rh });
      const hasWarning = plan.warnings.some((w) => w.includes("runnerHeight") && w.includes("clamped to 0"));
      check(`F5: runnerHeight ${rh} is invalid — pack() warns and clamps to 0`, hasWarning, JSON.stringify(plan.warnings));
      const count = findColumn(plan, () => true)?.layers[0]?.count;
      check(`F5: runnerHeight ${rh} clamped — column still fills against the full 109" (count 9)`, count === 9, String(count));
    }

    const badOpts: PackOptions = { ...OPTS, runnerHeight: -5 };
    const violations = validatePlan(baseline, CART, SKUS, badOpts);
    check(
      "F5: validatePlan independently clamps an invalid runnerHeight (baseline stack stays clean against DIMS.height 40)",
      ruleViolations(violations, "column-height") === 0,
      JSON.stringify(violations)
    );
  }

  // F6. Part B: legacy's near-weight-limit advisory (usedWeight/maxWeight > 0.95) is not carried
  // forward. A single piece at exactly 96% of a small trailer's maxWeight, deterministically.
  {
    const f6Sku: PackSku = { id: "F6_SKU", name: "weight test", sku: "F6", length: 10, width: 10, height: 5, weight: 96, category: "Blocks", allowRotation: false };
    const f6Dims: Dimensions = { length: 100, width: 100, height: 40, maxWeight: 100 };
    const f6Cart: CartLine[] = [{ skuId: "F6_SKU", qty: 1 }];
    const f6Plan = pack(f6Cart, [f6Sku], f6Dims);

    check(
      "F6: fixture lands at exactly 96% of maxWeight",
      Math.abs(f6Plan.totalWeight / f6Dims.maxWeight - 0.96) < 1e-9,
      String(f6Plan.totalWeight)
    );
    const hasNearWeightWarning = f6Plan.warnings.some((w) => /near|weight limit/i.test(w));
    check("F6: no near-weight-limit advisory is emitted at 96% of maxWeight", !hasNearWeightWarning, JSON.stringify(f6Plan.warnings));
  }

  // F7. The weight rule is a data canary now (Part B), not a load warning — it must still fire for
  // a genuinely over-weight plan, or the canary would be silently disarmed.
  {
    const bad = clone(baseline);
    bad.trailers[0].rows[0].columns[0].totalWeight = 99999;
    recompute(bad);
    const violations = validatePlan(bad, CART, SKUS, OPTS);
    check("F7: the weight canary still fires for a genuinely over-weight plan", ruleViolations(violations, "weight") > 0, JSON.stringify(violations));
  }

  // Steve, 2026-09-16 (superseded by holey-sequential-fill below, same day — see that section's own
  // comment for the full redesign). Kept as a regression check on the resulting single-SKU-column
  // shape, not on a "declined trade" mechanism that no longer exists: the new sequential fill has
  // no search to decline — it simply visits H1 (8", the tallest with demand) first, stacks it to
  // its true physical max (2, both units — that's just floor(19/8) capped by remaining/weight, not
  // a choice among alternatives), then tries H2 (5") in the 3" gap left over, which doesn't fit.
  // H2's demand (6, untouched) rolls into later columns instead.
  {
    const holeyBase: PackSku = { id: "HOLEY_MAX_BASE", name: "8in holey", sku: "HOLEY_MAX_BASE", length: 48, width: 24, height: 8, weight: 5, category: HOLEY_BOARD_CATEGORY, allowRotation: false };
    const holeyOther: PackSku = { id: "HOLEY_MAX_OTHER", name: "5in holey", sku: "HOLEY_MAX_OTHER", length: 48, width: 24, height: 5, weight: 4, category: HOLEY_BOARD_CATEGORY, allowRotation: false };
    const holeyMaxCart: CartLine[] = [{ skuId: "HOLEY_MAX_BASE", qty: 2 }, { skuId: "HOLEY_MAX_OTHER", qty: 6 }];
    const holeyMaxDims: Dimensions = { length: 100, width: 100, height: 19, maxWeight: 100000 };
    const holeyMaxPlan = pack(holeyMaxCart, [holeyBase, holeyOther], holeyMaxDims);

    const maxedColumn = findColumn(holeyMaxPlan, (c) => c.layers.length === 1 && c.layers[0].skuId === "HOLEY_MAX_BASE" && c.layers[0].count === 2);
    check(
      "Holey max-base-first: H1 is stacked to its true max (2 x 8\") in a column of its own",
      maxedColumn !== null,
      JSON.stringify(findColumn(holeyMaxPlan, (c) => c.layers.some((l) => l.skuId === "HOLEY_MAX_BASE")))
    );
    check("Holey max-base-first: that column totals 16\" (H2 can't fit the 3\" residual gap)", maxedColumn?.totalHeight === 16, String(maxedColumn?.totalHeight));
    check("Holey max-base-first: that column is not mixed — H2 never enters it", maxedColumn?.mixed === false && !maxedColumn?.layers.some((l) => l.skuId === "HOLEY_MAX_OTHER"));
    check(
      "Holey max-base-first: rationale names the blocked candidate and explains why, not a bare \"no other SKU\" (which would be false — H2 exists and has demand)",
      (maxedColumn?.rationale ?? "").includes("doesn't fit the remaining gap") && (maxedColumn?.rationale ?? "").includes("5\""),
      maxedColumn?.rationale
    );

    const maxHoleyViolations = validatePlan(holeyMaxPlan, holeyMaxCart, [holeyBase, holeyOther], OPTS);
    check("Holey max-base-first: validatePlan reports zero violations", maxHoleyViolations.length === 0, JSON.stringify(maxHoleyViolations));
  }

  // holey-sequential-fill, 2026-09-16: Holey Board's sequential-stacking redesign (replacing the
  // exact-fill search above with strict descending-height chaining — Steve's own description of how
  // the floor crew loads a truck). Five distinct thicknesses on one footprint, none dividing
  // effectiveHeight (40") evenly and none dividing each other evenly either, forcing the fill to
  // chain through 3+ SKUs in a single column — something the pre-existing cap (maxSkusPerColumn: 2)
  // made structurally impossible. Also exercises the validatePlan exemption end to end: without it,
  // this fixture would fail max-skus-per-column even though the column shape itself is correct.
  {
    const mkHoley = (h: number): PackSku => ({
      id: `CHAIN_${h}`,
      name: `${h}in holey`,
      sku: `CHAIN_${h}`,
      length: 48,
      width: 24,
      height: h,
      weight: 10,
      category: HOLEY_BOARD_CATEGORY,
      allowRotation: false,
    });
    const chainSkus = [10, 9, 8, 7, 6].map(mkHoley);
    const chainQtys: Record<number, number> = { 10: 22, 9: 15, 8: 6, 7: 4, 6: 3 };
    const chainCart: CartLine[] = chainSkus.map((s) => ({ skuId: s.id, qty: chainQtys[s.height] }));
    const chainDims: Dimensions = { length: 200, width: 48, height: 40, maxWeight: 100000 };
    const chainPlan = pack(chainCart, chainSkus, chainDims);

    const allColumns = chainPlan.trailers.flatMap((t) => t.rows.flatMap((r) => r.columns));
    check(
      "Holey sequential chain: every piece placed, none left in balance",
      chainPlan.balance.length === 0,
      JSON.stringify(chainPlan.balance)
    );
    check(
      "Holey sequential chain: at least one column chains through 3+ distinct thicknesses",
      allColumns.some((c) => c.layers.length >= 3),
      JSON.stringify(allColumns.map((c) => c.layers.length))
    );
    check(
      "Holey sequential chain: descending order within every column (base tallest, chained layers strictly shorter)",
      allColumns.every((c) => c.layers.every((l, i) => i === 0 || l.unitHeight < c.layers[i - 1].unitHeight)),
      JSON.stringify(allColumns.map((c) => c.layers.map((l) => l.unitHeight)))
    );
    const chainViolations = validatePlan(chainPlan, chainCart, chainSkus, OPTS);
    check(
      "Holey sequential chain: validatePlan reports zero violations (max-skus-per-column exemption is load-bearing here)",
      chainViolations.length === 0,
      JSON.stringify(chainViolations)
    );
  }

  // --- lb-ui-12: auto-downsize + trailerTypeLabel (G1-G5) ---

  const TRAILER_53FT_G = TRAILER_TYPES["53ft Standard"];
  const BOX_TRUCK = TRAILER_TYPES["26ft Box Truck"];

  // G1. Off by default: DEFAULT_PACK_OPTIONS.autoDownsize is false, so an ordinary pack() call
  // (no options override) never downsizes, even when everything placed would fit a box truck.
  {
    const g1Sku: PackSku = { id: "G1_SKU", name: "Small Block", sku: "G1", length: 40, width: 20, height: 8, weight: 30, category: "Blocks", allowRotation: true };
    const g1Cart: CartLine[] = [{ skuId: "G1_SKU", qty: 20 }];
    const g1Plan = pack(g1Cart, [g1Sku], TRAILER_53FT_G);
    check(
      "G1: autoDownsize off by default — trailer keeps primary dims",
      g1Plan.trailers.length === 1 && g1Plan.trailers[0].dims.length === TRAILER_53FT_G.length,
      JSON.stringify(g1Plan.trailers.map((t) => ({ type: t.type, length: t.dims.length })))
    );
  }

  // G2. On, and everything placed fits a box truck: the trailer is repacked to box-truck dims,
  // tagged with the "26ft Box Truck" label, loses no units, and the repacked trailer is itself
  // clean under validatePlan (trailer.dims now IS the box truck's dims, per lb-ui-12's earlier
  // validatePlan change, so this exercises that the two features compose correctly).
  {
    const g2Sku: PackSku = { id: "G2_SKU", name: "Small Block", sku: "G2", length: 40, width: 20, height: 8, weight: 30, category: "Blocks", allowRotation: true };
    const g2Cart: CartLine[] = [{ skuId: "G2_SKU", qty: 20 }];
    const g2PlanOff = pack(g2Cart, [g2Sku], TRAILER_53FT_G, { autoDownsize: false });
    const g2PlanOn = pack(g2Cart, [g2Sku], TRAILER_53FT_G, { autoDownsize: true, trailerTypeLabel: "53ft Standard" });
    check(
      "G2: autoDownsize on — the sole trailer is repacked to box-truck dims and labeled",
      g2PlanOn.trailers.length === 1 &&
        g2PlanOn.trailers[0].dims.length === BOX_TRUCK.length &&
        g2PlanOn.trailers[0].type === "26ft Box Truck",
      JSON.stringify(g2PlanOn.trailers.map((t) => ({ type: t.type, length: t.dims.length })))
    );
    const totalOff = g2PlanOff.trailers.reduce((s, t) => s + t.totalUnits, 0);
    const totalOn = g2PlanOn.trailers.reduce((s, t) => s + t.totalUnits, 0);
    check("G2: unit count is conserved across the downsize", totalOff === totalOn && totalOn === 20, `off=${totalOff} on=${totalOn}`);
    const g2Violations = validatePlan(g2PlanOn, g2Cart, [g2Sku], OPTS);
    check("G2: downsized plan is clean under validatePlan (validates against trailer.dims, not the primary dims)", g2Violations.length === 0, JSON.stringify(g2Violations));
  }

  // G3. Rejected: a SKU with no legal orientation fitting the box truck at all (too long, and
  // allowRotation:false forbids reorienting it) — downsize must be refused and the primary-dims
  // trailer kept exactly as built, not silently dropped or half-repacked.
  {
    const g3Sku: PackSku = { id: "G3_SKU", name: "Big Panel", sku: "G3", length: 400, width: 20, height: 8, weight: 30, category: "Blocks", allowRotation: false };
    const g3Cart: CartLine[] = [{ skuId: "G3_SKU", qty: 2 }];
    const g3Plan = pack(g3Cart, [g3Sku], TRAILER_53FT_G, { autoDownsize: true, trailerTypeLabel: "53ft Standard" });
    check(
      "G3: SKU too big for the box truck in any orientation — downsize rejected, primary dims kept",
      g3Plan.trailers.length === 1 && g3Plan.trailers[0].dims.length === TRAILER_53FT_G.length && g3Plan.trailers[0].type === "53ft Standard",
      JSON.stringify(g3Plan.trailers.map((t) => ({ type: t.type, length: t.dims.length })))
    );
  }

  // G4. Rejected: every SKU individually fits the box truck's envelope, but the last trailer's
  // total demand needs more length than one box truck offers (it fit the primary trailer's 636"
  // only because that's nearly double the box truck's 312") — the recursive repack would need 2
  // box trucks, so it must be rejected as a whole, not accepted as a 2-trailer "downsize".
  {
    const g4Sku: PackSku = { id: "G4_SKU", name: "Panel", sku: "G4", length: 180, width: 60, height: 50, weight: 50, category: "Blocks", allowRotation: false };
    const g4Cart: CartLine[] = [{ skuId: "G4_SKU", qty: 6 }];
    const g4PlanOff = pack(g4Cart, [g4Sku], TRAILER_53FT_G);
    const g4PlanOn = pack(g4Cart, [g4Sku], TRAILER_53FT_G, { autoDownsize: true, trailerTypeLabel: "53ft Standard" });
    // Pins WHY the downsize must fail, not just that it did — the fixture's actual rejection lives
    // or dies on this fitting into 1 primary trailer while exceeding 1 box truck's length; without
    // this, a future engine change (e.g. different width-pairing) could make these 6 units collapse
    // into fewer rows than expected and this check would start silently testing nothing.
    check(
      "G4 premise: fixture's row layout actually exceeds the box truck's length (else this test proves nothing)",
      g4PlanOff.trailers.length === 1 && g4PlanOff.trailers[0].usedLength > BOX_TRUCK.length,
      `usedLength=${g4PlanOff.trailers[0]?.usedLength} boxTruckLength=${BOX_TRUCK.length}`
    );
    check(
      "G4: fits the box truck's envelope per-SKU but needs 2 of them lengthwise — downsize rejected",
      g4PlanOff.trailers.length === 1 &&
        g4PlanOn.trailers.length === 1 &&
        g4PlanOn.trailers[0].dims.length === TRAILER_53FT_G.length &&
        g4PlanOn.trailers[0].type === "53ft Standard",
      JSON.stringify({ off: g4PlanOff.trailers.length, on: g4PlanOn.trailers.map((t) => ({ type: t.type, length: t.dims.length })) })
    );
  }

  // G5. trailerTypeLabel: populated on EVERY trailer from a call that sets it (not just a
  // downsized one) — a multi-trailer load where only the last one downsizes still labels the
  // earlier, primary-dims trailers correctly, so the UI never needs a `type ?? primaryKey`
  // fallback (the whole point of threading the label through pack() at all).
  {
    const g5Sku: PackSku = { id: "G5_SKU", name: "Small Block", sku: "G5", length: 40, width: 20, height: 8, weight: 30, category: "Blocks", allowRotation: true };
    // Enough demand to force 2+ trailers under the primary type, so the downsize (if it fires) only
    // ever touches the LAST one — the rest must still carry the primary label. A 53ft trailer holds
    // several hundred of this small a SKU, so this needs to be a large multiple of that, not just
    // "more than one truck's worth" by a rough estimate.
    const g5Cart: CartLine[] = [{ skuId: "G5_SKU", qty: 2000 }];
    const g5Plan = pack(g5Cart, [g5Sku], TRAILER_53FT_G, { autoDownsize: true, trailerTypeLabel: "53ft Standard" });
    check(
      "G5: multi-trailer load — every trailer is labeled, not just the (possibly downsized) last one",
      g5Plan.trailers.length >= 2 && g5Plan.trailers.every((t) => !!t.type),
      JSON.stringify(g5Plan.trailers.map((t) => t.type))
    );
    check(
      "G5: every non-last trailer keeps the primary label (only the last one may read \"26ft Box Truck\")",
      g5Plan.trailers.slice(0, -1).every((t) => t.type === "53ft Standard"),
      JSON.stringify(g5Plan.trailers.map((t) => t.type))
    );
  }

  return { pass: results.every((r) => r.pass), results };
}
