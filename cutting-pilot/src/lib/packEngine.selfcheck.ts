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
  skuOrientations,
  familyOrientationOptions,
  HOLEY_BOARD_CATEGORY,
  TRAILER_TYPES,
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

export function runPackEngineSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  function expectClean(rule: string, plan: PackPlan, label: string) {
    const violations = validatePlan(plan, DIMS, CART, SKUS, OPTS);
    check(`${rule}: ${label} has no ${rule} violation`, ruleViolations(violations, rule) === 0, JSON.stringify(violations));
  }

  function expectViolation(rule: string, plan: PackPlan, label: string, skus: PackSku[] = SKUS, cart: CartLine[] = CART) {
    const violations = validatePlan(plan, DIMS, cart, skus, OPTS);
    check(`${rule}: ${label} triggers ${rule}`, ruleViolations(violations, rule) > 0, JSON.stringify(violations));
  }

  // The baseline plan alone satisfies all 13 rules simultaneously.
  const baseline = makeBaselinePlan();
  const baselineViolations = validatePlan(baseline, DIMS, CART, SKUS, OPTS);
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
  const goodHoleyViolations = validatePlan(goodHoley, DIMS, holeyCart, holeySkus, OPTS);
  check(
    "holey-no-rotation: declared orientation (48x24) has no violation",
    ruleViolations(goodHoleyViolations, "holey-no-rotation") === 0,
    JSON.stringify(goodHoleyViolations)
  );

  const badHoley = makeHoleyPlan(24, 48, 24); // swapped: footprint no longer matches declared L/W
  const badHoleyViolations = validatePlan(badHoley, DIMS, holeyCart, holeySkus, OPTS);
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
    const mixedDepthViolations = validatePlan(mixedDepthHoley, DIMS, mixedDepthCart, mixedDepthSkus, OPTS);
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
    const cleanViolations = validatePlan(mixedDepthPlan, DIMS, mixedDepthCart, mixedDepthSkus, OPTS);
    check(
      "trailer-length: mixed-depth row with colLength <= rowLength for both columns has no violation",
      ruleViolations(cleanViolations, "trailer-length") === 0,
      JSON.stringify(cleanViolations)
    );

    const overDepth = clone(mixedDepthPlan);
    overDepth.trailers[0].rows[0].columns[1].colLength = 999; // now exceeds rowLength (20)
    const overDepthViolations = validatePlan(overDepth, DIMS, mixedDepthCart, mixedDepthSkus, OPTS);
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
    const warnedViolations = validatePlan(warnedPlan, tallDims, tallCart, [tallSku], { ...OPTS, stabilityWarnRatio: 3 });
    check("stabilityWarnRatio: warning is advisory only, produces zero validatePlan violations", warnedViolations.length === 0, JSON.stringify(warnedViolations));

    const suppressedPlan = pack(tallCart, [tallSku], tallDims, { stabilityWarnRatio: Infinity });
    const suppressedHasWarning = suppressedPlan.warnings.some((w) => w.includes("stability"));
    check("stabilityWarnRatio: Infinity suppresses the warning entirely", !suppressedHasWarning, JSON.stringify(suppressedPlan.warnings));
  }

  // --- Real-order fixtures (lb-engine-02's acceptance cases, run through the real pack()) ---

  const TRAILER_53FT = TRAILER_TYPES["53ft Standard"];

  // C8/D11 (checked before C7 below since the holey grid is the simplest case — B4 in the
  // lb-engine-02 prompt: "if the general algorithm can't reproduce the obvious answer on the
  // simplest case, it is wrong"). Base qty 676 = 52 columns * 13 per column exactly, so the base
  // alone still gives a full grid with no partial columns. lb-engine-03 D11 adds a SECOND holey
  // SKU sharing the same 48x24 footprint, height 5" (>= K), qty 52 — exactly enough to top off
  // every one of the 52 base columns' 5" residual (13x8"=104", 109-104=5" left, 1x5"=5" exact).
  // The grid shape is unaffected: base demand alone already divides into exactly 52 full columns,
  // so top-off only fills existing columns' residual, it can't create new ones.
  {
    const siplastSku: PackSku = {
      id: "SIPLAST",
      name: "Siplast holey board",
      sku: "SIPLAST-1",
      length: 48,
      width: 24,
      height: 8,
      weight: 5,
      category: HOLEY_BOARD_CATEGORY,
      allowRotation: false,
    };
    const siplastTopoffSku: PackSku = {
      id: "SIPLAST_TOPOFF",
      name: "Siplast holey board (5in)",
      sku: "SIPLAST-2",
      length: 48,
      width: 24,
      height: 5,
      weight: 4,
      category: HOLEY_BOARD_CATEGORY,
      allowRotation: false,
    };
    const siplastSkus = [siplastSku, siplastTopoffSku];
    const siplastCart: CartLine[] = [
      { skuId: "SIPLAST", qty: 676 },
      { skuId: "SIPLAST_TOPOFF", qty: 52 },
    ];
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
    const validationOnSiplast = validatePlan(siplastPlan, TRAILER_53FT, siplastCart, siplastSkus, OPTS);
    check("FIXTURE_HOLEY_SIPLAST: validatePlan reports zero violations (top-off satisfies K)", validationOnSiplast.length === 0, JSON.stringify(validationOnSiplast));
  }

  // C7. FIXTURE_BLOCKS_PAIRING end-to-end (INV_4202) — the load legacy could not fit on one
  // truck. Declared with 90.75" as the length axis already, matching the "orient with 90.75 down
  // the trailer length" pairing decision, so the winning combination is each family's own "flat".
  {
    const skuPairA: PackSku = { id: "PAIR_A", name: "42.75x90.75x8", sku: "PAIR-A", length: 90.75, width: 42.75, height: 8, weight: 40, category: "Blocks", allowRotation: true };
    const skuPairB: PackSku = { id: "PAIR_B", name: "54.75x90.75x8", sku: "PAIR-B", length: 90.75, width: 54.75, height: 8, weight: 40, category: "Blocks", allowRotation: true };
    const skuPairC: PackSku = { id: "PAIR_C", name: "54.75x66.75x8", sku: "PAIR-C", length: 66.75, width: 54.75, height: 8, weight: 40, category: "Blocks", allowRotation: true };
    const skuPairD: PackSku = { id: "PAIR_D", name: "24.75x90.75x4", sku: "PAIR-D", length: 90.75, width: 24.75, height: 4, weight: 25, category: "Blocks", allowRotation: true };
    const pairingSkus = [skuPairA, skuPairB, skuPairC, skuPairD];
    const pairingCart: CartLine[] = [
      { skuId: "PAIR_A", qty: 43 },
      { skuId: "PAIR_B", qty: 40 },
      { skuId: "PAIR_C", qty: 15 },
      { skuId: "PAIR_D", qty: 10 },
    ];
    const pairingPlan = pack(pairingCart, pairingSkus, TRAILER_53FT);
    const pairingViolations = validatePlan(pairingPlan, TRAILER_53FT, pairingCart, pairingSkus, OPTS);

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
  const mixSeaRay8: PackSku = { id: "MIX_SEARAY8", name: "Sea Ray", sku: "SEARAY-8", length: 54.75, width: 90.75, height: 8, weight: 30, category: "Blocks", allowRotation: true };
  const mixStock8: PackSku = { id: "MIX_STOCK8", name: "STOCK", sku: "STOCK-8", length: 54.75, width: 90.75, height: 8, weight: 30, category: "Blocks", allowRotation: true };
  const mixKansas525: PackSku = { id: "MIX_KANSAS525", name: "Kansas", sku: "KANSAS-5.25", length: 54.75, width: 90.75, height: 5.25, weight: 20, category: "Blocks", allowRotation: true };
  const mixSeaRay9: PackSku = { id: "MIX_SEARAY9", name: "Sea Ray", sku: "SEARAY-9", length: 54.75, width: 90.75, height: 9, weight: 32, category: "Blocks", allowRotation: true };
  const mixNoriaA: PackSku = { id: "MIX_NORIA_A", name: "Noria", sku: "NORIA-A", length: 19.75, width: 30.75, height: 8, weight: 10, category: "Blocks", allowRotation: true };
  const mixKansasComp: PackSku = { id: "MIX_KANSAS_COMP", name: "Kansas Comp", sku: "KANSAS-COMP", length: 24.75, width: 54.75, height: 8, weight: 15, category: "Blocks", allowRotation: true };
  const mixWestwegoCA: PackSku = { id: "MIX_WESTWEGO_CA", name: "Westwego CA Comp", sku: "WESTWEGO-CA", length: 24.75, width: 54.75, height: 6, weight: 12, category: "Blocks", allowRotation: true };
  const mixKAB: PackSku = { id: "MIX_KAB", name: "KAB CA Comps", sku: "KAB-CA", length: 42.75, width: 54.75, height: 7, weight: 18, category: "Blocks", allowRotation: true };
  const mixWestwegoGW: PackSku = { id: "MIX_WESTWEGO_GW", name: "Westwego GW Comp", sku: "WESTWEGO-GW", length: 42.75, width: 54.75, height: 7, weight: 18, category: "Blocks", allowRotation: true };
  const mixCharlotte: PackSku = { id: "MIX_CHARLOTTE", name: "Charlotte County", sku: "CHARLOTTE", length: 54.75, width: 66.75, height: 12, weight: 25, category: "Blocks", allowRotation: true };
  const mixNoriaB: PackSku = { id: "MIX_NORIA_B", name: "Noria", sku: "NORIA-B", length: 30.75, width: 90.75, height: 8, weight: 20, category: "Blocks", allowRotation: true };

  const mixedSkus: PackSku[] = [
    mixSeaRay8, mixStock8, mixKansas525, mixSeaRay9, mixNoriaA, mixKansasComp, mixWestwegoCA, mixKAB, mixWestwegoGW, mixCharlotte, mixNoriaB,
  ];
  const mixedCart: CartLine[] = [
    { skuId: "MIX_SEARAY8", qty: 25 },
    { skuId: "MIX_STOCK8", qty: 35 },
    { skuId: "MIX_KANSAS525", qty: 18 },
    { skuId: "MIX_SEARAY9", qty: 2 },
    { skuId: "MIX_NORIA_A", qty: 6 },
    { skuId: "MIX_KANSAS_COMP", qty: 2 },
    { skuId: "MIX_WESTWEGO_CA", qty: 1 },
    { skuId: "MIX_KAB", qty: 2 },
    { skuId: "MIX_WESTWEGO_GW", qty: 1 },
    { skuId: "MIX_CHARLOTTE", qty: 1 },
    { skuId: "MIX_NORIA_B", qty: 1 },
  ];
  const mixedTotalQty = mixedCart.reduce((s, c) => s + c.qty, 0);
  check("FIXTURE_BLOCKS_MIXED: fixture totals 94 pieces", mixedTotalQty === 94, String(mixedTotalQty));

  const mixedPlan = pack(mixedCart, mixedSkus, TRAILER_53FT);
  const mixedViolations = validatePlan(mixedPlan, TRAILER_53FT, mixedCart, mixedSkus, OPTS);
  check("FIXTURE_BLOCKS_MIXED: validatePlan reports zero violations", mixedViolations.length === 0, JSON.stringify(mixedViolations));

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

    const fillViolations = validatePlan(fillPlan, TRAILER_53FT, fillCart, [fillBase, fillTopoff], OPTS);
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
    const capViolations = validatePlan(capPlan, TRAILER_53FT, capCart, [capA, capB, capC], OPTS);
    check("D5: 0 max-skus-per-column violations", capViolations.filter((v) => v.rule === "max-skus-per-column").length === 0, JSON.stringify(capViolations));
  }

  // D6. Rows are ordered thickest-base at posFromFront 0 (rear), thinnest at the nose.
  // allowRotation:false on both SKUs pins them to their declared flat orientation so A1's
  // six-orientation search can't complicate which footprint/depth each ends up at — this fixture
  // is purely about B3's row sort, not orientation choice.
  {
    const rowThick: PackSku = { id: "ROWTEST_THICK", name: "thick", sku: "ROWTEST_THICK", length: 90.75, width: 90.75, height: 20, weight: 50, category: "Blocks", allowRotation: false };
    const rowThin: PackSku = { id: "ROWTEST_THIN", name: "thin", sku: "ROWTEST_THIN", length: 40, width: 40, height: 4, weight: 10, category: "Blocks", allowRotation: false };
    const rowCart: CartLine[] = [{ skuId: "ROWTEST_THICK", qty: 5 }, { skuId: "ROWTEST_THIN", qty: 5 }];
    const rowPlan = pack(rowCart, [rowThick, rowThin], TRAILER_53FT);

    const thickRow = findRow(rowPlan, (r) => r.columns.some((c) => c.layers[0].skuId === "ROWTEST_THICK"));
    const thinRow = findRow(rowPlan, (r) => r.columns.some((c) => c.layers[0].skuId === "ROWTEST_THIN"));
    check("D6: the thickest-base row sits at posFromFront 0 (the rear)", thickRow?.posFromFront === 0, String(thickRow?.posFromFront));
    check(
      "D6: the thinner-base row sits further from the rear (toward the nose) than the thick row",
      (thinRow?.posFromFront ?? -1) > (thickRow?.posFromFront ?? -1),
      `thin=${thinRow?.posFromFront} thick=${thickRow?.posFromFront}`
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

    const balViolations = validatePlan(balPlan, TRAILER_53FT, balCart, [balSku], { ...OPTS, trailerLimit: 1 });
    check("D8: 0 violations — conservation holds exactly across the trailerLimit cut", balViolations.length === 0, JSON.stringify(balViolations));
  }

  return { pass: results.every((r) => r.pass), results };
}
