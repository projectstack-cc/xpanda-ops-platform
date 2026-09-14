// src/lib/packEngine.selfcheck.ts
// Guarded dev self-check for the packing engine's contracts (lb-engine-01). Not part of the
// production build path — mirrors blockNester.selfcheck.ts's / bolShared.selfcheck.ts's shape.
// There is no v2 load builder UI yet (lb-ui-01 wires this in); exported and left unreferenced.
//
// Because pack() is a deliberate stub until lb-engine-02, this file tests validatePlan() itself —
// that each of the 13 rules fires when it should and stays quiet when it shouldn't. Each rule gets
// one hand-built PackPlan fixture that satisfies it and one that violates it. Fixtures are built
// from a single self-consistent baseline plan (recompute() derives every aggregate field from the
// structural leaves — rows/columns/layers/geometry) so that mutating one thing to break a target
// rule doesn't accidentally trip an unrelated one.
//
// Also carries the three real-order fixtures from the lb-engine-01 prompt (FIXTURE_HOLEY_SIPLAST,
// FIXTURE_BLOCKS_PAIRING, FIXTURE_BLOCKS_MIXED) as data, with their arithmetic asserted here as
// pure number checks — these become lb-engine-02/-03's acceptance cases.
import {
  validatePlan,
  HOLEY_BOARD_CATEGORY,
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

// Derives every aggregate field (row/trailer/plan totals, posFromFront/posY geometry) from the
// structural leaves (rowLength, colWidth, stackCount, totalWeight, mixed) so a fixture builder can
// mutate a leaf field and stay internally consistent everywhere except the rule under test.
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
    { skuId: "A", skuName: "SKU A", skuCode: "A-1", color: "#111111", unitHeight: 5, count: 3 },
    { skuId: "B", skuName: "SKU B", skuCode: "B-1", color: "#222222", unitHeight: 3, count: 2 },
  ];
}

function makeBaselinePlan(): PackPlan {
  const layers = baseLayers();
  const column: PackColumn = {
    posY: 0,
    colWidth: 10,
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

  // 1. piece-fits-trailer
  expectClean("piece-fits-trailer", baseline, "baseline SKUs fit the trailer envelope");
  const oversizedSkus: PackSku[] = [{ ...SKU_A, length: 200 }, SKU_B];
  expectViolation("piece-fits-trailer", baseline, "SKU A too long for trailer in any orientation", oversizedSkus);

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

  // 6. holey-no-rotation (dedicated holey-board fixture, since baseline uses category "Blocks")
  {
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

    const makeHoleyPlan = (colWidth: number, rowLength: number): PackPlan => {
      const layer: PackLayer = { skuId: "H", skuName: holeySku.name, skuCode: holeySku.sku, color: "#333", unitHeight: 0.75, count: 1 };
      const column: PackColumn = {
        posY: 0,
        colWidth,
        totalHeight: 0.75,
        totalWeight: 5,
        stackCount: 1,
        layers: [layer],
        mixed: false,
        rationale: "Single holey board sheet",
      };
      const row: PackRow = { posFromFront: 0, rowLength, rowWidthUsed: colWidth, columns: [column], totalUnits: 0, totalWeight: 0 };
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

    const goodHoley = makeHoleyPlan(24, 48); // matches sku.width=24, sku.length=48
    const goodHoleyViolations = validatePlan(goodHoley, DIMS, holeyCart, holeySkus, OPTS);
    check(
      "holey-no-rotation: declared orientation (48x24) has no violation",
      ruleViolations(goodHoleyViolations, "holey-no-rotation") === 0,
      JSON.stringify(goodHoleyViolations)
    );

    const badHoley = makeHoleyPlan(48, 24); // swapped: footprint no longer matches declared L/W
    const badHoleyViolations = validatePlan(badHoley, DIMS, holeyCart, holeySkus, OPTS);
    check(
      "holey-no-rotation: swapped footprint (24x48) triggers holey-no-rotation",
      ruleViolations(badHoleyViolations, "holey-no-rotation") > 0,
      JSON.stringify(badHoleyViolations)
    );
  }

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
    bad.trailers[0].rows[0].columns[0].layers.push({ skuId: "C", skuName: "SKU C", skuCode: "C-1", color: "#333333", unitHeight: 4, count: 1 });
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

  // --- Real-order fixtures (become lb-engine-02/-03's acceptance cases) ---

  const FIXTURE_HOLEY_SIPLAST = {
    boardLength: 48,
    boardWidth: 24,
    thicknesses: [4.75, 5.75, 6.75, 7.75, 8.75, 9.75, 10.75, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21],
  };
  check(
    `FIXTURE_HOLEY_SIPLAST: floor(98/${FIXTURE_HOLEY_SIPLAST.boardWidth}) === 4`,
    Math.floor(98 / FIXTURE_HOLEY_SIPLAST.boardWidth) === 4
  );
  check(
    `FIXTURE_HOLEY_SIPLAST: floor(636/${FIXTURE_HOLEY_SIPLAST.boardLength}) === 13`,
    Math.floor(636 / FIXTURE_HOLEY_SIPLAST.boardLength) === 13
  );
  check("FIXTURE_HOLEY_SIPLAST: 17 thickness rows present", FIXTURE_HOLEY_SIPLAST.thicknesses.length === 17);

  const FIXTURE_BLOCKS_PAIRING = [
    { width: 42.75, length: 90.75, height: 8, qty: 43 },
    { width: 54.75, length: 90.75, height: 8, qty: 40 },
    { width: 54.75, length: 66.75, height: 8, qty: 15 },
    { width: 24.75, length: 90.75, height: 4, qty: 10 },
  ];
  const pairSum = FIXTURE_BLOCKS_PAIRING[0].width + FIXTURE_BLOCKS_PAIRING[1].width;
  check(`FIXTURE_BLOCKS_PAIRING: 42.75 + 54.75 === 97.5`, pairSum === 97.5);
  check(`FIXTURE_BLOCKS_PAIRING: 97.5 <= 98`, pairSum <= 98);

  const FIXTURE_BLOCKS_MIXED = {
    footprintWidth: 54.75,
    footprintLength: 90.75,
    thicknesses: [
      { height: 8, qty: 60 },
      { height: 9, qty: 2 },
      { height: 5.25, qty: 18 },
    ],
  };
  const [h8, h9, h525] = FIXTURE_BLOCKS_MIXED.thicknesses.map((t) => t.height);
  check(`FIXTURE_BLOCKS_MIXED: 8*11 + 5.25*4 === 109`, h8 * 11 + h525 * 4 === 109);
  check(`FIXTURE_BLOCKS_MIXED: 8*8 + 9*5 === 109`, h8 * 8 + h9 * 5 === 109);
  check(`FIXTURE_BLOCKS_MIXED: 8*5 + 9*3 + 5.25*8 === 109`, h8 * 5 + h9 * 3 + h525 * 8 === 109);

  return { pass: results.every((r) => r.pass), results };
}
