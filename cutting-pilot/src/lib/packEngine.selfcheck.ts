// src/lib/packEngine.selfcheck.ts
// Guarded dev self-check for the packing engine (lb-engine-01 contracts + invariant harness,
// lb-engine-02 orientation/pairing/row-assembly algorithm). Not part of the production build path
// — mirrors blockNester.selfcheck.ts's / bolShared.selfcheck.ts's shape. There is no v2 load
// builder UI yet (lb-ui-01 wires this in); exported and left unreferenced.
//
// Two kinds of checks live here:
// - validatePlan() invariant checks: each of the (now 13, rule set unchanged in count by
//   lb-engine-02) rules gets one hand-built PackPlan fixture that satisfies it and one that
//   violates it, built from a single self-consistent baseline plan (recompute() derives every
//   aggregate field from the structural leaves) so mutating one thing to break a target rule
//   doesn't accidentally trip an unrelated one.
// - pack() algorithm checks (lb-engine-02): call the real algorithm against the three real-order
//   fixtures (FIXTURE_HOLEY_SIPLAST, FIXTURE_BLOCKS_PAIRING, FIXTURE_BLOCKS_MIXED) and assert on
//   its actual output — these are the acceptance cases from the lb-engine-02 prompt.
import {
  pack,
  validatePlan,
  skuOrientations,
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
  {
    // 10x10 footprint, 35" tall single unit: 35 > 3 * min(10,10) = 30, so this should warn.
    const tallSku: PackSku = { id: "T", name: "Tall narrow slab", sku: "T-1", length: 10, width: 10, height: 35, weight: 5, category: "Blocks", allowRotation: true };
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

  // C8 (checked before C7 below since the holey grid is the simplest case — B4 in the prompt:
  // "if the general algorithm can't reproduce the obvious answer on the simplest case, it is
  // wrong"). qty 676 = 52 columns * 13 per column exactly, so every column is full and none are
  // left partial — isolates the grid shape from column-fill rounding.
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
    const siplastCart: CartLine[] = [{ skuId: "SIPLAST", qty: 676 }];
    const siplastPlan = pack(siplastCart, [siplastSku], TRAILER_53FT);

    check("FIXTURE_HOLEY_SIPLAST: pack() places all 676 pieces (balance empty)", siplastPlan.balance.length === 0, JSON.stringify(siplastPlan.balance));
    check("FIXTURE_HOLEY_SIPLAST: single trailer", siplastPlan.trailers.length === 1, String(siplastPlan.trailers.length));
    const siplastTrailer = siplastPlan.trailers[0];
    check("FIXTURE_HOLEY_SIPLAST: 13 rows deep", siplastTrailer?.rows.length === 13, String(siplastTrailer?.rows.length));
    const allRowsHave4Columns = siplastTrailer?.rows.every((r) => r.columns.length === 4) ?? false;
    check("FIXTURE_HOLEY_SIPLAST: 4 columns across in every row", allRowsHave4Columns);
    const totalColumns = siplastTrailer?.rows.reduce((s, r) => s + r.columns.length, 0) ?? 0;
    check("FIXTURE_HOLEY_SIPLAST: 52 columns total (4 x 13)", totalColumns === 52, String(totalColumns));
    const noRotation = siplastTrailer?.rows.every((r) => r.columns.every((c) => c.layers.every((l) => l.orientation.label === "flat"))) ?? false;
    check("FIXTURE_HOLEY_SIPLAST: no rotation used anywhere (every layer orientation is 'flat')", noRotation);
    const validationOnSiplast = validatePlan(siplastPlan, TRAILER_53FT, siplastCart, [siplastSku], OPTS);
    check("FIXTURE_HOLEY_SIPLAST: validatePlan reports zero violations", validationOnSiplast.length === 0, JSON.stringify(validationOnSiplast));
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
  }

  // C9. FIXTURE_BLOCKS_MIXED — family grouping (INV_4347-shaped). The dominant 54.75 x 90.75
  // footprint carries four different labels/thicknesses (load-bearing per the prompt: 80 of 94
  // real pieces share this footprint across four labels); the other five footprints are
  // deliberately synthetic placeholders (distinct, obviously-round numbers) standing in for
  // Steve's real INV_4347 rows, which should replace them once available. The assertion is
  // structural — "the dominant family's four labels all land on the same footprint, and there
  // are exactly 6 distinct footprints in play" — so it holds regardless of the placeholder values.
  {
    const dominant = [
      { id: "MIX_DOM_1", height: 8, qty: 30 },
      { id: "MIX_DOM_2", height: 9, qty: 25 },
      { id: "MIX_DOM_3", height: 5.25, qty: 15 },
      { id: "MIX_DOM_4", height: 6.5, qty: 10 },
    ].map((m) => ({
      sku: { id: m.id, name: `Dominant family ${m.id}`, sku: m.id, length: 90.75, width: 54.75, height: m.height, weight: 30, category: "Blocks", allowRotation: true } as PackSku,
      qty: m.qty,
    }));
    // Synthetic minor footprints — NOT from real order data, replace with Steve's INV_4347 rows.
    const minorFootprints: Array<{ length: number; width: number; height: number; qty: number }> = [
      { length: 40, width: 30, height: 6, qty: 8 },
      { length: 50, width: 20, height: 6, qty: 6 },
      { length: 60, width: 36, height: 6, qty: 5 },
      { length: 45, width: 25, height: 6, qty: 4 },
      { length: 35, width: 35, height: 6, qty: 3 },
    ];
    const minors = minorFootprints.map((f, i) => ({
      sku: { id: `MIX_MIN_${i}`, name: `Minor family ${i}`, sku: `MIX_MIN_${i}`, length: f.length, width: f.width, height: f.height, weight: 20, category: "Blocks", allowRotation: true } as PackSku,
      qty: f.qty,
    }));
    const allMembers = [...dominant, ...minors];
    const mixedSkus = allMembers.map((m) => m.sku);
    const mixedCart: CartLine[] = allMembers.map((m) => ({ skuId: m.sku.id, qty: m.qty }));
    const mixedPlan = pack(mixedCart, mixedSkus, TRAILER_53FT);

    const footprintKey = (l: number, w: number) => `${Math.min(l, w)}x${Math.max(l, w)}`;
    const footprintsBySku = new Map<string, string>();
    for (const trailer of mixedPlan.trailers) {
      for (const row of trailer.rows) {
        for (const column of row.columns) {
          for (const layer of column.layers) {
            footprintsBySku.set(layer.skuId, footprintKey(column.colLength, column.colWidth));
          }
        }
      }
    }
    const distinctFootprints = new Set(Array.from(footprintsBySku.values()));
    check("FIXTURE_BLOCKS_MIXED: exactly 6 distinct footprints placed", distinctFootprints.size === 6, JSON.stringify(Array.from(distinctFootprints)));

    const dominantFootprint = footprintKey(90.75, 54.75);
    const dominantLabelsPlaced = dominant.map((d) => d.sku.id).filter((id) => footprintsBySku.get(id) === dominantFootprint);
    check(
      "FIXTURE_BLOCKS_MIXED: all four dominant-family labels land on the 54.75x90.75 footprint",
      dominantLabelsPlaced.length === 4,
      JSON.stringify(dominantLabelsPlaced)
    );
  }

  return { pass: results.every((r) => r.pass), results };
}
