// src/lib/loadEditor.selfcheck.ts
// Guarded dev self-check for the customize editor's pure edit operations (lb-ui-02 Part D).
// Mirrors packEngine.selfcheck.ts's shape: a hand-built fixture plan, a check()/results table, one
// exported run*SelfCheck() function. Not part of the production build path.
//
// Every check ends with a validatePlan()-derived assertion (via validateForApply, which is the
// same apply-gate call CustomizeEditor/EditorGuards use) returning zero violations, UNLESS the
// check is specifically testing that a violation fires — per Part D's stated discipline.
import type { CartLine, PackColumn, PackOptions, PackPlan, PackRow, PackSku, PackTrailer, Dimensions } from "./packEngine";
import { DEFAULT_PACK_OPTIONS, pack, TRAILER_TYPES, HOLEY_BOARD_CATEGORY } from "./packEngine";
import { proposeDissolve } from "./dissolve";
import {
  createEditorState,
  moveColumn,
  pullToHolding,
  placeFromHolding,
  compactLoad,
  undo,
  canDrop,
  validateForApply,
  findOverflowingRows,
  normalizeState,
  addRow,
  addColumn,
  addLayer,
  setLayerCount,
  removeRow,
  planForApply,
  introduceSku,
  addRowFromLibrary,
  addColumnFromLibrary,
  addLayerFromLibrary,
  evaluateStackTarget,
  stackOnto,
  evaluateSlotTarget,
  moveToSlot,
  takeToHolding,
  evaluateSwapTarget,
  swapColumns,
  addToHolding,
  shiftToRear,
  shiftToRearWithNote,
  withAutoShift,
  NEW_ROW,
  type EditorState,
  type PieceSource,
} from "./loadEditor";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function ruleViolations(violations: { rule: string }[], rule: string): number {
  return violations.filter((v) => v.rule === rule).length;
}

// --- fixture ---
//
// Trailer 0 (dims.length 65", 5" margin over its 60"-used baseline):
//   Row0 [A(20x20), B(20x20)]  width 40/50, rowLength 20, posFromFront 0
//   Row1 [C(20x20)]            width 20/50, rowLength 20, posFromFront 20  <- shallow row, target for D
//   Row2 [F(20x20)]            width 20/50, rowLength 20, posFromFront 40  <- downstream row
// Trailer 1:
//   Row0 [E(40x10)]            width 40/50, rowLength 10, posFromFront 0
// Holding: [D(20x40)] — a column already pulled off, deep enough that placing it into Trailer0's
// Row1 raises that row's rowLength to 40 and pushes Trailer0's usedLength from 60" to 80", past
// dims.length (65") — the trailer-length overflow surfaces at Row2, not at the drop site (Row1).
//
// Every column is single-SKU, single-layer, stackCount 1, so conservation is one piece per SKU per
// location and easy to verify by eye.

const DIMS: Dimensions = { length: 65, width: 50, height: 40, maxWeight: 10000 };
const OPTS: PackOptions = { ...DEFAULT_PACK_OPTIONS };

function makeSku(id: string, length: number, width: number, weight: number): PackSku {
  return { id, name: `SKU ${id}`, sku: `${id}-1`, length, width, height: 10, weight, category: "Blocks", allowRotation: true };
}

const SKU_A = makeSku("A", 20, 20, 5);
const SKU_B = makeSku("B", 20, 20, 5);
const SKU_C = makeSku("C", 20, 20, 5);
const SKU_D = makeSku("D", 40, 20, 5); // deep column, starts in holding
const SKU_E = makeSku("E", 10, 40, 3); // wide column, lives on trailer 1
const SKU_F = makeSku("F", 20, 20, 5);
// lb-ui-07: two SKUs dedicated to the new add* operations — neither is placed anywhere in the base
// fixture, so both stay in plan.balance (unlike A-F, which are fully accounted for by trailers +
// holding with zero balance), giving the add* checks real unplaced demand to legally draw from.
const SKU_G: PackSku = { id: "G", name: "SKU G", sku: "G-1", length: 15, width: 15, height: 4, weight: 4, category: "Blocks", allowRotation: true };
// G's 15x15 footprint deliberately matches NO existing column (A/B/C/F are all 20x20, E is 10x40) —
// doubles as the "mismatched footprint" addLayer test SKU (check 16).
const SKU_H: PackSku = { id: "H", name: "SKU H", sku: "H-1", length: 20, width: 20, height: 8, weight: 2, category: "Blocks", allowRotation: true };
// H's 20x20 footprint deliberately matches A/B/C/F's column footprint exactly — the "legal,
// matched-footprint" addLayer test SKU (check 15).
// lb-ui-11: SKU L deliberately does NOT appear in SKUS or CART below — it stands in for a
// parts-library part the job never ordered, so makeFixture()'s state.skus/originalSkuIds start
// without it, matching what a real /api/load-builder-skus pick looks like before introduceSku runs.
const SKU_L: PackSku = { id: "L", name: "SKU L", sku: "L-1", length: 12, width: 12, height: 5, weight: 3, category: "Blocks", allowRotation: true };

const SKUS: PackSku[] = [SKU_A, SKU_B, SKU_C, SKU_D, SKU_E, SKU_F, SKU_G, SKU_H];
const CART: CartLine[] = [
  { skuId: "A", qty: 1 },
  { skuId: "B", qty: 1 },
  { skuId: "C", qty: 1 },
  { skuId: "D", qty: 1 },
  { skuId: "E", qty: 1 },
  { skuId: "F", qty: 1 },
  { skuId: "G", qty: 3 },
  { skuId: "H", qty: 2 },
];

function makeColumn(sku: PackSku, rationale: string): PackColumn {
  return {
    posY: 0,
    colWidth: sku.width,
    colLength: sku.length,
    totalHeight: sku.height,
    totalWeight: sku.weight,
    stackCount: 1,
    layers: [
      {
        skuId: sku.id,
        skuName: sku.name,
        skuCode: sku.sku,
        color: "#333333",
        unitHeight: sku.height,
        count: 1,
        orientation: { length: sku.length, width: sku.width, height: sku.height, label: "flat" },
      },
    ],
    mixed: false,
    rationale,
  };
}

function makeRow(columns: PackColumn[]): PackRow {
  return { posFromFront: 0, rowLength: 0, rowWidthUsed: 0, wastedFloorArea: 0, columns, totalUnits: 0, totalWeight: 0 };
}

function makeTrailer(rows: PackRow[]): PackTrailer {
  return {
    dims: DIMS,
    rows,
    usedLength: 0,
    usedFloorArea: 0,
    usedWeight: 0,
    totalStacks: 0,
    totalUnits: 0,
    mixedStacks: 0,
    widthUtilization: 0,
    heightUtilization: 0,
  };
}

function makeFixture(): EditorState {
  const trailer0 = makeTrailer([
    makeRow([makeColumn(SKU_A, "Single column A"), makeColumn(SKU_B, "Single column B")]),
    makeRow([makeColumn(SKU_C, "Single column C")]),
    makeRow([makeColumn(SKU_F, "Single column F")]),
  ]);
  const trailer1 = makeTrailer([makeRow([makeColumn(SKU_E, "Single column E")])]);
  const plan: PackPlan = {
    trailers: [trailer0, trailer1],
    // lb-ui-07: G and H are in CART but placed nowhere above and not in holding — their full cart
    // qty must sit here as unplaced demand for the fixture's own baseline conservation check to pass.
    balance: [
      { skuId: "G", remaining: 3 },
      { skuId: "H", remaining: 2 },
    ],
    warnings: [],
    totalWeight: 0,
    totalUnits: 0,
    totalStacks: 0,
    mixedStacks: 0,
  };
  const raw = createEditorState(plan, DIMS, OPTS, CART, SKUS);
  const normalized = normalizeState(raw);
  return { ...normalized, holding: [makeColumn(SKU_D, "Single column D, held off the load")] };
}

// --- conservation helper (check #5's own invariant, distinct from validatePlan's own
// trailers+balance-only `conservation` rule — see loadEditor.ts's header comment) ---

function countBySku(state: EditorState): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (skuId: string, n: number) => counts.set(skuId, (counts.get(skuId) ?? 0) + n);
  for (const trailer of state.plan.trailers) {
    for (const row of trailer.rows) {
      for (const column of row.columns) {
        for (const layer of column.layers) add(layer.skuId, layer.count);
      }
    }
  }
  for (const column of state.holding) {
    for (const layer of column.layers) add(layer.skuId, layer.count);
  }
  for (const b of state.plan.balance) add(b.skuId, b.remaining);
  return counts;
}

function conservationHolds(state: EditorState): { ok: boolean; detail: string } {
  const counts = countBySku(state);
  const mismatches: string[] = [];
  for (const line of state.cart) {
    const got = counts.get(line.skuId) ?? 0;
    if (got !== line.qty) mismatches.push(`${line.skuId}: trailers+holding+balance=${got} != cart qty ${line.qty}`);
  }
  return { ok: mismatches.length === 0, detail: mismatches.join("; ") };
}

// --- lbr-07 fixture: golden-like stacks on one 90×42-footprint family, 109″ clearance ---
const DIMS_S: Dimensions = { length: 380, width: 98, height: 109, maxWeight: 44000 };
function stackSku(id: string, height: number, length = 90, width = 42): PackSku {
  return { id, name: `${height}" ${id}`, sku: `${id}-1`, length, width, height, weight: 1, category: "Blocks", allowRotation: true };
}
const SKU_S13 = stackSku("S13", 13);
const SKU_S12 = stackSku("S12", 12);
const SKU_S11 = stackSku("S11", 11);
const SKU_S10 = stackSku("S10", 10);
const SKU_S9 = stackSku("S9", 9);
const SKU_S2 = stackSku("S2", 2);
const SKU_SX = stackSku("SX", 10, 48, 24); // a different footprint
const SKU_SW = stackSku("SW", 10, 90, 60); // a 60″-wide stack, for the swap width check
// Not in the job: stands in for a parts-library pick.
const SKU_S5L = stackSku("S5L", 5);

function makeStack(layers: [PackSku, number][], stackKind?: "full" | "partial"): PackColumn {
  const [first] = layers[0];
  return {
    posY: 0,
    colWidth: first.width,
    colLength: first.length,
    totalHeight: layers.reduce((s, [k, n]) => s + k.height * n, 0),
    totalWeight: layers.reduce((s, [k, n]) => s + k.weight * n, 0),
    stackCount: layers.reduce((s, [, n]) => s + n, 0),
    layers: layers.map(([k, n]) => ({
      skuId: k.id,
      skuName: k.name,
      skuCode: k.sku,
      color: "#333333",
      unitHeight: k.height,
      count: n,
      orientation: { length: k.length, width: k.width, height: k.height, label: "flat" },
    })),
    mixed: new Set(layers.map(([k]) => k.id)).size > 1,
    rationale: "Fixture stack",
    stackKind,
  };
}

function makeStackFixture(): EditorState {
  const trailer: PackTrailer = {
    ...makeTrailer([
      makeRow([makeStack([[SKU_S11, 9]], "full"), makeStack([[SKU_S13, 8]], "full")]),
      makeRow([makeStack([[SKU_S10, 10], [SKU_S9, 1]], "full"), makeStack([[SKU_S10, 9]], "partial")]),
      makeRow([makeStack([[SKU_SW, 5]], "partial")]),
    ]),
    dims: DIMS_S,
  };
  const plan: PackPlan = { trailers: [trailer], balance: [{ skuId: "S12", remaining: 4 }], warnings: [], totalWeight: 0, totalUnits: 0, totalStacks: 0, mixedStacks: 0 };
  const skus = [SKU_S13, SKU_S12, SKU_S11, SKU_S10, SKU_S9, SKU_S2, SKU_SX, SKU_SW];
  const cart: CartLine[] = [
    { skuId: "S13", qty: 8 },
    { skuId: "S12", qty: 4 },
    { skuId: "S11", qty: 9 },
    { skuId: "S10", qty: 19 },
    { skuId: "S9", qty: 1 },
    { skuId: "S2", qty: 5 },
    { skuId: "SX", qty: 2 },
    { skuId: "SW", qty: 5 },
  ];
  const normalized = normalizeState(createEditorState(plan, DIMS_S, OPTS, cart, skus));
  return { ...normalized, holding: [makeStack([[SKU_SX, 2]], "partial"), makeStack([[SKU_S2, 5]], "partial")] };
}

export function runLoadEditorSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  const fixture = makeFixture();

  // Baseline sanity: the fixture itself must be clean before any check builds on it.
  {
    const baselineViolations = validateForApply(fixture);
    check("fixture baseline: validateForApply reports zero violations", baselineViolations.length === 0, JSON.stringify(baselineViolations));
    const baselineConservation = conservationHolds(fixture);
    check("fixture baseline: conservation holds (trailers + holding + balance == cart qty)", baselineConservation.ok, baselineConservation.detail);
  }

  // 1. moveColumn between two rows: geometry recomputed, validatePlan clean.
  {
    const state = makeFixture();
    // Move B (trailer0/row0/col1) to the end of row2 (trailer0/row2, currently just [F]).
    const moved = moveColumn(state, { t: 0, r: 0, c: 1 }, { t: 0, r: 2, slot: 1 });
    const row0 = moved.plan.trailers[0].rows[0];
    const row2 = moved.plan.trailers[0].rows[2];
    check("moveColumn: row0 now has only A, width 20", row0.columns.length === 1 && row0.rowWidthUsed === 20, JSON.stringify(row0));
    check(
      "moveColumn: row2 now has [F, B], B.posY recomputed to 20 (after F's width)",
      row2.columns.length === 2 && row2.columns[1].layers[0].skuId === "B" && row2.columns[1].posY === 20,
      JSON.stringify(row2)
    );
    const violations = validateForApply(moved);
    check("moveColumn: validateForApply reports zero violations after the move", violations.length === 0, JSON.stringify(violations));
  }

  // 2. moveColumn producing width overflow: row-width fires, canDrop returned ok:false first.
  {
    const state = makeFixture();
    // E (trailer1/row0/col0, colWidth 40) into trailer0/row0 (already 40/50 used by A+B) — 80 > 50.
    const eColumn = state.plan.trailers[1].rows[0].columns[0];
    const feedback = canDrop(state, eColumn, { t: 0, r: 0 });
    check("canDrop: E into row0 (40+40=80 > 50) predicts overflow, ok:false", feedback.ok === false, JSON.stringify(feedback));

    const forced = moveColumn(state, { t: 1, r: 0, c: 0 }, { t: 0, r: 0, slot: 2 });
    const violations = validateForApply(forced);
    check("moveColumn: forced move (bypassing canDrop) triggers row-width", ruleViolations(violations, "row-width") > 0, JSON.stringify(violations));
  }

  // 3. Deep column into a shallow row: rowLength grows, downstream posFromFront shifts, and
  //    trailer-length fires because the trailer overflows.
  {
    const state = makeFixture();
    const before = state.plan.trailers[0].rows[2].posFromFront;
    check("fixture: row2.posFromFront starts at 40", before === 40, String(before));

    // D (held, colLength 40) placed into row1 (currently [C], rowLength 20) at the end.
    const placed = placeFromHolding(state, 0, { t: 0, r: 1, slot: 1 });
    const row1 = placed.plan.trailers[0].rows[1];
    const row2 = placed.plan.trailers[0].rows[2];
    check("placeFromHolding: row1.rowLength grows to 40 (max of C's 20 and D's 40)", row1.rowLength === 40, String(row1.rowLength));
    check("placeFromHolding: row2.posFromFront shifts from 40 to 60 (20 + 40)", row2.posFromFront === 60, String(row2.posFromFront));

    const overflows = findOverflowingRows(placed);
    check(
      "findOverflowingRows: names trailer0/row2 as the overflow point (60+20=80 > dims.length 65), not row1 where the drop happened",
      overflows.some((o) => o.trailerIndex === 0 && o.rowIndex === 2),
      JSON.stringify(overflows)
    );
    const violations = validateForApply(placed);
    check("placeFromHolding: trailer-length fires on the overflowing trailer", ruleViolations(violations, "trailer-length") > 0, JSON.stringify(violations));
  }

  // 4. pullToHolding then placeFromHolding round-trips to an identical plan.
  {
    const state = makeFixture();
    const pulled = pullToHolding(state, { t: 0, r: 0, c: 1 }); // pull B off row0
    check("pullToHolding: row0 now has only A", pulled.plan.trailers[0].rows[0].columns.length === 1, JSON.stringify(pulled.plan.trailers[0].rows[0]));
    check("pullToHolding: B now in holding (2 held columns: D + B)", pulled.holding.length === 2, String(pulled.holding.length));

    const heldIndex = pulled.holding.findIndex((c) => c.layers[0].skuId === "B");
    const placedBack = placeFromHolding(pulled, heldIndex, { t: 0, r: 0, slot: 1 }); // back to the end of row0
    const originalRow0 = clone(state.plan.trailers[0].rows[0]);
    const roundTrippedRow0 = clone(placedBack.plan.trailers[0].rows[0]);
    check(
      "pullToHolding -> placeFromHolding: row0 is structurally identical to the original",
      JSON.stringify(originalRow0) === JSON.stringify(roundTrippedRow0),
      JSON.stringify({ originalRow0, roundTrippedRow0 })
    );
    check("pullToHolding -> placeFromHolding: holding count restored to 1 (just D)", placedBack.holding.length === 1, String(placedBack.holding.length));
    const violations = validateForApply(placedBack);
    check("pullToHolding -> placeFromHolding round-trip: validateForApply reports zero violations", violations.length === 0, JSON.stringify(violations));
  }

  // 5. Conservation across edits: pieces on trailers + holding + balance == cart qty, at every step.
  {
    let state = makeFixture();
    const steps: [string, (s: EditorState) => EditorState][] = [
      ["pullToHolding(row0/col0=A)", (s) => pullToHolding(s, { t: 0, r: 0, c: 0 })],
      ["placeFromHolding(D -> row1 end)", (s) => placeFromHolding(s, s.holding.findIndex((c) => c.layers[0].skuId === "D"), { t: 0, r: 1, slot: 1 })],
      ["moveColumn(row2/col0=F -> row0 end)", (s) => moveColumn(s, { t: 0, r: 2, c: 0 }, { t: 0, r: 0, slot: 1 })],
      ["compactLoad", (s) => compactLoad(s)],
      ["placeFromHolding(A back -> row2 end)", (s) => placeFromHolding(s, s.holding.findIndex((c) => c.layers[0].skuId === "A"), { t: 0, r: 2, slot: 0 })],
    ];
    let allHeld = true;
    for (const [label, step] of steps) {
      state = step(state);
      const result = conservationHolds(state);
      check(`conservation after ${label}`, result.ok, result.detail);
      if (!result.ok) allHeld = false;
    }
    check("conservation: held across the entire edit sequence, not just at the end", allHeld);
  }

  // 6. undo restores the prior state exactly; undo past the start is a safe no-op.
  {
    const state = makeFixture();
    const originalPlan = clone(state.plan);
    const moved = moveColumn(state, { t: 0, r: 0, c: 1 }, { t: 0, r: 2, slot: 1 });
    check("undo fixture: move actually changed the plan", JSON.stringify(clone(moved.plan)) !== JSON.stringify(originalPlan));

    const undone = undo(moved);
    check(
      "undo: restores the prior plan exactly",
      JSON.stringify(clone(undone.plan)) === JSON.stringify(originalPlan),
      JSON.stringify({ undonePlan: undone.plan, originalPlan })
    );
    check("undo: restores holding exactly", JSON.stringify(clone(undone.holding)) === JSON.stringify(clone(state.holding)));
    check("undo: history is one shorter after undo", undone.history.length === moved.history.length - 1, String(undone.history.length));

    const atStart = undo(state); // state.history is empty — nothing to undo
    check("undo past the start: safe no-op, returns the same state", atStart === state);
  }

  // 7. compactLoad closes a gap without reordering; running it twice is a no-op the second time.
  {
    const state = makeFixture();
    // Empty row1 entirely (pull its only column, C) to create a gap.
    const gapped = pullToHolding(state, { t: 0, r: 1, c: 0 });
    check("compactLoad fixture: row1 is now empty", gapped.plan.trailers[0].rows[1].columns.length === 0);

    const compacted = compactLoad(gapped);
    const rowSkuOrder = compacted.plan.trailers[0].rows.map((r) => r.columns.map((c) => c.layers[0].skuId));
    check(
      "compactLoad: empty row1 removed, row0 ([A,B]) and row2 ([F]) keep their original column order",
      compacted.plan.trailers[0].rows.length === 2 &&
        JSON.stringify(rowSkuOrder) === JSON.stringify([["A", "B"], ["F"]]),
      JSON.stringify(rowSkuOrder)
    );
    check("compactLoad: row2 (now index 1) posFromFront recomputed to 20 (right after row0's length 20)", compacted.plan.trailers[0].rows[1].posFromFront === 20, String(compacted.plan.trailers[0].rows[1].posFromFront));

    const compactedAgain = compactLoad(compacted);
    check("compactLoad: running it again on an already-compact load is a no-op (same state reference)", compactedAgain === compacted);

    const violations = validateForApply(compacted);
    check("compactLoad: validateForApply reports zero violations after compaction", violations.length === 0, JSON.stringify(violations));
  }

  // 8. canDrop feedback strings are correct for a fitting and a non-fitting target.
  {
    const state = makeFixture();
    const dColumn = state.holding[0]; // colWidth 20
    const fitting = canDrop(state, dColumn, { t: 0, r: 1 }); // row1 currently [C], width 20/50 -> 40/50
    check(
      'canDrop: D into row1 fits, reason reads \'fits · 40" of 50"\'',
      fitting.ok === true && fitting.reason === 'fits · 40" of 50"' && fitting.widthAfter === 40 && fitting.widthLimit === 50,
      JSON.stringify(fitting)
    );

    const eColumn = state.plan.trailers[1].rows[0].columns[0]; // colWidth 40
    const notFitting = canDrop(state, eColumn, { t: 0, r: 0 }); // row0 already 40/50 -> 80/50
    check(
      'canDrop: E into row0 does not fit, reason reads \'too wide · would be 80"\'',
      notFitting.ok === false && notFitting.reason === 'too wide · would be 80"' && notFitting.widthAfter === 80,
      JSON.stringify(notFitting)
    );
  }

  // 9. A column moved anywhere never changes height (the invariant behind guard 4).
  {
    const state = makeFixture();
    const before = state.plan.trailers[0].rows[0].columns[0].totalHeight; // A
    const moved = moveColumn(state, { t: 0, r: 0, c: 0 }, { t: 0, r: 2, slot: 0 });
    const after = moved.plan.trailers[0].rows[2].columns[0].totalHeight;
    check("moveColumn: column totalHeight unchanged by the move (10 before and after)", before === after && after === 10, `${before} -> ${after}`);
    const violations = validateForApply(moved);
    check("moveColumn: column-height guard does not fire (the invariant it protects held)", ruleViolations(violations, "column-height") === 0, JSON.stringify(violations));
  }

  // 10. lb-ui-03 Part C: canDrop predicts a length problem BEFORE the drop, naming the overflowing
  //     row — not just after validateForApply runs. D (colLength 40) is first placed into row0
  //     (already [A,B], rowLength 20 -> 40), which alone pushes trailer0 to 80" (over dims.length
  //     65", overflowing at row2 — same total as check 3, D just starts somewhere else this time).
  //     From there, predict moving D from row0 to row1 (currently [C], rowLength 20).
  {
    const state = makeFixture();
    const withD = placeFromHolding(state, 0, { t: 0, r: 0, slot: 2 });
    check("fixture: placing D into row0 already overflows trailer0 (setup for this check)", findOverflowingRows(withD).some((o) => o.trailerIndex === 0), JSON.stringify(findOverflowingRows(withD)));

    const dRef = { t: 0, r: 0, c: 2 };
    const dColumn = withD.plan.trailers[0].rows[0].columns[2];
    const feedback = canDrop(withD, dColumn, { t: 0, r: 1 }, dRef);
    check(
      "canDrop: predicts D row0->row1 is still too deep (row0's shrink doesn't fix it, it just relocates which row overflows), names the trailer",
      feedback.lengthOk === false && feedback.ok === false && feedback.reason.includes("too deep"),
      JSON.stringify(feedback)
    );
  }

  // 11. The same move computed via moveColumn (actually performed) and via canDrop's simulation
  //     (predicted) agree — the simulation is not a second, drifting formula. Reuses check 10's setup.
  {
    const state = makeFixture();
    const withD = placeFromHolding(state, 0, { t: 0, r: 0, slot: 2 });
    const dRef = { t: 0, r: 0, c: 2 };
    const dColumn = withD.plan.trailers[0].rows[0].columns[2];

    const predicted = canDrop(withD, dColumn, { t: 0, r: 1 }, dRef);
    const actual = moveColumn(withD, dRef, { t: 0, r: 1, slot: 1 });
    const actuallyOverflows = findOverflowingRows(actual).length > 0;
    check(
      "canDrop's length prediction agrees with findOverflowingRows on the actually-performed move",
      predicted.lengthOk === !actuallyOverflows,
      JSON.stringify({ predictedLengthOk: predicted.lengthOk, actuallyOverflows })
    );
  }

  // 12. No regression on the width-only behavior lb-ui-02 already covers: (a) a same-row reorder
  //     (B within row0) predicts lengthOk true — nothing about depth changes; (b) E into row0
  //     (check 2's width-overflow scenario) still predicts lengthOk true even with `from` supplied,
  //     because E (colLength 10) is SHALLOWER than row0's existing rowLength (20) and can't grow
  //     it — the two checks are independent, and this one confirms the depth-check doesn't spill
  //     over into scenarios it has no business flagging.
  {
    const state = makeFixture();
    const bColumn = state.plan.trailers[0].rows[0].columns[1];
    const reorderFeedback = canDrop(state, bColumn, { t: 0, r: 0 }, { t: 0, r: 0, c: 1 });
    check(
      "canDrop: same-row reorder (B within row0) predicts lengthOk true",
      reorderFeedback.lengthOk === true,
      JSON.stringify(reorderFeedback)
    );

    const eColumn = state.plan.trailers[1].rows[0].columns[0];
    const eFeedback = canDrop(state, eColumn, { t: 0, r: 0 }, { t: 1, r: 0, c: 0 });
    check(
      "canDrop: E into row0 still blocks on width alone (lengthOk true, ok false) — matches check 2's pre-fix behavior",
      eFeedback.lengthOk === true && eFeedback.ok === false,
      JSON.stringify(eFeedback)
    );
  }

  // --- lb-ui-07: manual/custom load building (addRow/addColumn/addLayer/setLayerCount/removeRow) ---

  // 13. addRow: a legal new row on trailer1 (SKU G, count 1) — zero violations, balance decrements,
  //     conservation holds.
  {
    const state = makeFixture();
    const before = state.plan.trailers[1].rows.length;
    const added = addRow(state, 1, "G", 1);
    check("addRow: trailer1 gains a new row (1 -> 2)", added.plan.trailers[1].rows.length === before + 1, String(added.plan.trailers[1].rows.length));
    const newRow = added.plan.trailers[1].rows[added.plan.trailers[1].rows.length - 1];
    check(
      "addRow: new row is [G], colWidth 15, colLength 15, unitHeight 4, count 1 (identity orientation)",
      newRow.columns.length === 1 && newRow.columns[0].colWidth === 15 && newRow.columns[0].colLength === 15 && newRow.columns[0].layers[0].unitHeight === 4,
      JSON.stringify(newRow)
    );
    const gBalance = added.plan.balance.find((b) => b.skuId === "G");
    check("addRow: balance for G decrements from 3 to 2", (gBalance?.remaining ?? 0) === 2, JSON.stringify(added.plan.balance));
    const violations = validateForApply(added);
    check("addRow: validateForApply reports zero violations for a legal add", violations.length === 0, JSON.stringify(violations));
    const conservation = conservationHolds(added);
    check("addRow: conservation holds", conservation.ok, conservation.detail);
  }

  // 14. addColumn: a legal new column on trailer0/row1 (SKU G, count 1, alongside existing C) —
  //     zero violations, row1's rowLength unchanged (G is shallower than C), balance decrements.
  {
    const state = makeFixture();
    const added = addColumn(state, 0, 1, "G", 1);
    const row1 = added.plan.trailers[0].rows[1];
    check("addColumn: row1 gains a second column (C, G)", row1.columns.length === 2 && row1.columns[1].layers[0].skuId === "G", JSON.stringify(row1));
    check("addColumn: row1.rowWidthUsed is 35 (20 + 15)", row1.rowWidthUsed === 35, String(row1.rowWidthUsed));
    check("addColumn: row1.rowLength stays 20 (G's colLength 15 < C's 20)", row1.rowLength === 20, String(row1.rowLength));
    const gBalance = added.plan.balance.find((b) => b.skuId === "G");
    check("addColumn: balance for G decrements from 3 to 2", (gBalance?.remaining ?? 0) === 2, JSON.stringify(added.plan.balance));
    const violations = validateForApply(added);
    check("addColumn: validateForApply reports zero violations for a legal add", violations.length === 0, JSON.stringify(violations));
    const conservation = conservationHolds(added);
    check("addColumn: conservation holds", conservation.ok, conservation.detail);
  }

  // 15. addLayer, matched footprint: SKU H (20x20x8) onto trailer0/row0/col0 (SKU A's column, also
  //     20x20) — a legal top-off, column becomes mixed, zero violations, balance decrements.
  {
    const state = makeFixture();
    const added = addLayer(state, { t: 0, r: 0, c: 0 }, "H", 1);
    const column = added.plan.trailers[0].rows[0].columns[0];
    check("addLayer: column now has 2 layers (A base, H top-off)", column.layers.length === 2 && column.layers[1].skuId === "H", JSON.stringify(column));
    check("addLayer: column.mixed is now true", column.mixed === true);
    check("addLayer: column.totalHeight is 18 (A's 10 + H's 8)", column.totalHeight === 18, String(column.totalHeight));
    const hBalance = added.plan.balance.find((b) => b.skuId === "H");
    check("addLayer: balance for H decrements from 2 to 1", (hBalance?.remaining ?? 0) === 1, JSON.stringify(added.plan.balance));
    const violations = validateForApply(added);
    check("addLayer: validateForApply reports zero violations for a legal, matched-footprint add", violations.length === 0, JSON.stringify(violations));
    const conservation = conservationHolds(added);
    check("addLayer: conservation holds", conservation.ok, conservation.detail);
  }

  // 16. addLayer, mismatched footprint: SKU G (15x15) has no orientation matching column A's 20x20
  //     footprint. Part C #3's chosen contract: the operation does NOT pre-check this — it still
  //     adds the layer (falling back to G's identity orientation) and validateForApply catches the
  //     mismatch via piece-fits-trailer, the same "operation doesn't pre-validate" behavior
  //     moveColumn already has for row-width.
  {
    const state = makeFixture();
    const added = addLayer(state, { t: 0, r: 0, c: 0 }, "G", 1);
    const column = added.plan.trailers[0].rows[0].columns[0];
    check("addLayer (mismatched): the layer is still added, not silently refused", column.layers.length === 2 && column.layers[1].skuId === "G", JSON.stringify(column));
    const violations = validateForApply(added);
    check(
      "addLayer (mismatched): validateForApply flags piece-fits-trailer, NOT a pre-emptive block",
      ruleViolations(violations, "piece-fits-trailer") > 0,
      JSON.stringify(violations)
    );
  }

  // 17. addColumn causing row-width overflow: SKU G (colWidth 15) onto trailer1/row0 (already E,
  //     colWidth 40) — 40 + 15 = 55 > 50. Same no-pre-check contract as check 16, mirrored for
  //     row-width (Part C #2's exact scenario).
  {
    const state = makeFixture();
    const added = addColumn(state, 1, 0, "G", 1);
    const row0 = added.plan.trailers[1].rows[0];
    check("addColumn (overflow): the column is still added, not silently refused", row0.columns.length === 2, JSON.stringify(row0));
    const violations = validateForApply(added);
    check(
      "addColumn (overflow): validateForApply flags row-width, NOT a pre-emptive block",
      ruleViolations(violations, "row-width") > 0,
      JSON.stringify(violations)
    );
  }

  // 18. setLayerCount: increase draws further from balance, decrease returns it, and zeroing a
  //     layer removes it (reverting a mixed column back to single-SKU) — round-tripping back to
  //     the exact pre-addLayer state including balance.
  {
    const state = makeFixture();
    const withLayer = addLayer(state, { t: 0, r: 0, c: 0 }, "H", 1); // H balance 2 -> 1

    const increased = setLayerCount(withLayer, { t: 0, r: 0, c: 0 }, 1, 2); // H count 1 -> 2
    const hAfterIncrease = increased.plan.balance.find((b) => b.skuId === "H");
    check("setLayerCount (increase): H layer count is now 2", increased.plan.trailers[0].rows[0].columns[0].layers[1].count === 2);
    check("setLayerCount (increase): balance for H drops to 0 and the entry is removed (not left at 0)", hAfterIncrease === undefined, JSON.stringify(increased.plan.balance));

    const decreased = setLayerCount(increased, { t: 0, r: 0, c: 0 }, 1, 1); // H count 2 -> 1
    const hAfterDecrease = decreased.plan.balance.find((b) => b.skuId === "H");
    check("setLayerCount (decrease): balance for H returns to 1", (hAfterDecrease?.remaining ?? 0) === 1, JSON.stringify(decreased.plan.balance));

    const zeroed = setLayerCount(decreased, { t: 0, r: 0, c: 0 }, 1, 0); // H layer removed entirely
    const columnAfterZero = zeroed.plan.trailers[0].rows[0].columns[0];
    check("setLayerCount (zero): the H layer is removed, column reverts to just A", columnAfterZero.layers.length === 1 && columnAfterZero.layers[0].skuId === "A", JSON.stringify(columnAfterZero));
    check("setLayerCount (zero): column.mixed is false again", columnAfterZero.mixed === false);
    check("setLayerCount (zero): column.totalHeight reverts to 10 (just A)", columnAfterZero.totalHeight === 10, String(columnAfterZero.totalHeight));
    const hAfterZero = zeroed.plan.balance.find((b) => b.skuId === "H");
    check("setLayerCount (zero): balance for H fully restored to 2 — round-trips to the pre-addLayer state", (hAfterZero?.remaining ?? 0) === 2, JSON.stringify(zeroed.plan.balance));
    const conservation = conservationHolds(zeroed);
    check("setLayerCount round-trip: conservation holds throughout", conservation.ok, conservation.detail);

    // Zeroing a column's ONLY layer drops the column from its row (not just the layer) — matching
    // pullToHolding's own convention of leaving an emptied row in place rather than compacting
    // automatically (see this file's #3 comment above pullToHolding in loadEditor.ts).
    const withNewRow = addRow(state, 1, "G", 1); // fresh new row on trailer1, single G column
    const newRowIndex = withNewRow.plan.trailers[1].rows.length - 1;
    const columnZeroed = setLayerCount(withNewRow, { t: 1, r: newRowIndex, c: 0 }, 0, 0);
    check(
      "setLayerCount (zero, only layer): the whole column is dropped from the row, row stays present (possibly empty)",
      columnZeroed.plan.trailers[1].rows[newRowIndex] !== undefined && columnZeroed.plan.trailers[1].rows[newRowIndex].columns.length === 0,
      JSON.stringify(columnZeroed.plan.trailers[1].rows[newRowIndex])
    );
    const gAfterColumnZeroed = columnZeroed.plan.balance.find((b) => b.skuId === "G");
    check("setLayerCount (zero, only layer): balance for G fully restored to 3", (gAfterColumnZeroed?.remaining ?? 0) === 3, JSON.stringify(columnZeroed.plan.balance));
  }

  // 19. undo after a new operation restores the exact prior state — no special-casing needed since
  //     addRow uses withHistory() exactly like every existing operation (mirrors check 6).
  {
    const state = makeFixture();
    const originalPlan = clone(state.plan);
    const originalBalance = clone(state.plan.balance);
    const added = addRow(state, 1, "G", 1);
    check("undo fixture (addRow): the add actually changed the plan", JSON.stringify(clone(added.plan)) !== JSON.stringify(originalPlan));

    const undone = undo(added);
    check(
      "undo (addRow): restores the prior plan exactly, including balance",
      JSON.stringify(clone(undone.plan)) === JSON.stringify(originalPlan) && JSON.stringify(clone(undone.plan.balance)) === JSON.stringify(originalBalance),
      JSON.stringify({ undonePlan: undone.plan, originalPlan })
    );
    check("undo (addRow): history is one shorter after undo", undone.history.length === added.history.length - 1, String(undone.history.length));
  }

  // 20. removeRow: trailer0/row0 ([A, B]) removed — both columns move to holding (not
  //     hard-deleted), row0 disappears, balance untouched (relocation only), conservation holds,
  //     validateForApply stays clean (holdingCount is advisory, not a validatePlan rule).
  {
    const state = makeFixture();
    const originalBalance = clone(state.plan.balance);
    const removed = removeRow(state, 0, 0);
    check("removeRow: trailer0 now has 2 rows (was 3)", removed.plan.trailers[0].rows.length === 2, String(removed.plan.trailers[0].rows.length));
    check(
      "removeRow: A and B both moved to holding (1 held -> 3 held: D, A, B)",
      removed.holding.length === 3 && removed.holding.some((c) => c.layers[0].skuId === "A") && removed.holding.some((c) => c.layers[0].skuId === "B"),
      JSON.stringify(removed.holding.map((c) => c.layers[0].skuId))
    );
    check("removeRow: plan.balance is untouched (relocation only)", JSON.stringify(removed.plan.balance) === JSON.stringify(originalBalance), JSON.stringify(removed.plan.balance));
    const conservation = conservationHolds(removed);
    check("removeRow: conservation holds", conservation.ok, conservation.detail);
    const violations = validateForApply(removed);
    check("removeRow: validateForApply reports zero violations (nothing was placed illegally, just relocated)", violations.length === 0, JSON.stringify(violations));

    const undone = undo(removed);
    check("removeRow: undo restores trailer0 to 3 rows and holding to 1", undone.plan.trailers[0].rows.length === 3 && undone.holding.length === 1, JSON.stringify({ rows: undone.plan.trailers[0].rows.length, holding: undone.holding.length }));
  }

  // 21. Unassigned pieces = planForApply(state).balance — the same balance+holding merge
  //     validateForApply already relies on, not a fourth bucket. Against the base fixture
  //     (balance [G:3, H:2], holding [D:1]), the merge must be exactly those three entries.
  {
    const state = makeFixture();
    const unassigned = planForApply(state).balance;
    const bySku = new Map(unassigned.map((b) => [b.skuId, b.remaining]));
    check(
      "unassigned pieces (planForApply merge): exactly {D:1, G:3, H:2}, nothing more or less",
      unassigned.length === 3 && bySku.get("D") === 1 && bySku.get("G") === 3 && bySku.get("H") === 2,
      JSON.stringify(unassigned)
    );
  }

  // 22. undo after setLayerCount-to-zero: the only new op that both mutates balance bidirectionally
  //     AND splices a column out of its row — check 19 only covers addRow's simpler (add-a-row,
  //     decrement-balance) case. H's layer is zeroed (column reverts to just A, balance restored to
  //     2 — check 18's zeroed state), then undo must restore the 2-layer column AND re-decrement
  //     balance back to 1 in one step, not leave either half stale.
  {
    const state = makeFixture();
    const withLayer = addLayer(state, { t: 0, r: 0, c: 0 }, "H", 1); // H balance 2 -> 1, column has [A,H]
    const beforeZero = clone(withLayer.plan);
    const zeroed = setLayerCount(withLayer, { t: 0, r: 0, c: 0 }, 1, 0); // H layer removed, balance -> 2
    check(
      "undo fixture (setLayerCount zero): the zero-out actually changed the plan",
      JSON.stringify(clone(zeroed.plan)) !== JSON.stringify(beforeZero)
    );

    const undone = undo(zeroed);
    check(
      "undo (setLayerCount zero): restores the 2-layer column exactly, including balance back to 1",
      JSON.stringify(clone(undone.plan)) === JSON.stringify(beforeZero),
      JSON.stringify({ undonePlan: undone.plan, beforeZero })
    );
    const hAfterUndo = undone.plan.balance.find((b) => b.skuId === "H");
    check("undo (setLayerCount zero): H balance back to 1, not left at zeroed-state's 2", (hAfterUndo?.remaining ?? 0) === 1, JSON.stringify(undone.plan.balance));
    const conservation = conservationHolds(undone);
    check("undo (setLayerCount zero): conservation holds after undo", conservation.ok, conservation.detail);
  }

  // --- lb-ui-11: parts library in custom builds (introduceSku + cartAfterPlacement) ---
  // SKU L is absent from SKUS/CART — makeFixture()'s originalSkuIds never includes it, matching a
  // real parts-library pick that isn't part of the pulled job's own demand.

  // 23. introduceSku: merges an unknown SKU into state.skus without touching plan/cart/balance;
  //     idempotent for both an unknown SKU (second call) and an already-known one (SKU_G) — the
  //     latter returns the exact same state reference, a true no-op.
  {
    const state = makeFixture();
    check("introduceSku fixture: L is not yet known", !state.skus.some((s) => s.id === "L"));

    const withL = introduceSku(state, SKU_L);
    check("introduceSku: L now in state.skus", withL.skus.some((s) => s.id === "L"), JSON.stringify(withL.skus.map((s) => s.id)));
    check("introduceSku: plan unchanged", JSON.stringify(clone(withL.plan)) === JSON.stringify(clone(state.plan)));
    check("introduceSku: cart unchanged (introducing ≠ placing)", JSON.stringify(withL.cart) === JSON.stringify(state.cart), JSON.stringify(withL.cart));

    const introducedAgain = introduceSku(withL, SKU_L);
    check("introduceSku: introducing the same SKU again is a no-op (same skus length, no duplicate)", introducedAgain.skus.length === withL.skus.length, String(introducedAgain.skus.length));

    const noopOnKnown = introduceSku(state, SKU_G);
    check("introduceSku: introducing an already-known SKU (G) returns the exact same state reference", noopOnKnown === state);
  }

  // 24. addRowFromLibrary (the real call path CustomizeEditor.tsx uses): balance for L stays
  //     untouched (nothing to draw down), cart grows a brand-new {L: 3} line, conservation holds,
  //     zero violations.
  {
    const state = makeFixture();
    const added = addRowFromLibrary(state, 1, SKU_L, 3);
    const lBalance = added.plan.balance.find((b) => b.skuId === "L");
    check("addRowFromLibrary: no plan.balance entry created for L", lBalance === undefined, JSON.stringify(added.plan.balance));
    const lCart = added.cart.find((c) => c.skuId === "L");
    check("addRowFromLibrary: cart gains a new {L: 3} line", lCart?.qty === 3, JSON.stringify(added.cart));
    const violations = validateForApply(added);
    check("addRowFromLibrary: validateForApply reports zero violations", violations.length === 0, JSON.stringify(violations));
    const conservation = conservationHolds(added);
    check("addRowFromLibrary: conservation holds (cart grew to cover the new demand)", conservation.ok, conservation.detail);
  }

  // 25. A second, later addRowFromLibrary of the SAME library SKU grows cart cumulatively
  //     (3 -> 3+2=5), not just once — the bug this design specifically avoids (see
  //     cartAfterPlacement's doc comment). The 2nd call still goes through addRowFromLibrary (not
  //     plain addRow), matching how CustomizeEditor.tsx always calls it via the library picker.
  {
    const state = makeFixture();
    const first = addRowFromLibrary(state, 1, SKU_L, 3);
    const second = addRowFromLibrary(first, 1, SKU_L, 2); // introduceSku no-ops; L already in first.skus
    const lCart = second.cart.find((c) => c.skuId === "L");
    check("addRowFromLibrary (2nd add): cart's L qty accumulates to 5 (3 + 2)", lCart?.qty === 5, JSON.stringify(second.cart));
    const violations = validateForApply(second);
    check("addRowFromLibrary (2nd add): validateForApply reports zero violations", violations.length === 0, JSON.stringify(violations));
    const conservation = conservationHolds(second);
    check("addRowFromLibrary (2nd add): conservation holds", conservation.ok, conservation.detail);
  }

  // 26. setLayerCount on a library-placed layer: a decrease synthesizes a plan.balance `remaining`
  //     entry for L (adjustBalance's own existing fallback) rather than needing cart touched; a
  //     later increase draws it back down, exactly like a normal job SKU's balance. Cart's L total
  //     (fixed at the highest-ever-placed count) never changes across this round-trip.
  {
    const state = makeFixture();
    const withRow = addRowFromLibrary(state, 1, SKU_L, 5);
    const newRowIndex = withRow.plan.trailers[1].rows.length - 1;
    const cartAfterAdd = withRow.cart.find((c) => c.skuId === "L")?.qty;

    const decreased = setLayerCount(withRow, { t: 1, r: newRowIndex, c: 0 }, 0, 2); // L count 5 -> 2
    const lBalanceAfterDecrease = decreased.plan.balance.find((b) => b.skuId === "L");
    check("setLayerCount (library, decrease): balance for L synthesized at 3 (the returned units)", lBalanceAfterDecrease?.remaining === 3, JSON.stringify(decreased.plan.balance));
    check("setLayerCount (library, decrease): cart's L qty unchanged by the decrease", decreased.cart.find((c) => c.skuId === "L")?.qty === cartAfterAdd, JSON.stringify(decreased.cart));
    const conservationAfterDecrease = conservationHolds(decreased);
    check("setLayerCount (library, decrease): conservation holds", conservationAfterDecrease.ok, conservationAfterDecrease.detail);

    const increased = setLayerCount(decreased, { t: 1, r: newRowIndex, c: 0 }, 0, 4); // L count 2 -> 4
    const lBalanceAfterIncrease = increased.plan.balance.find((b) => b.skuId === "L");
    check("setLayerCount (library, increase): balance for L drawn back down to 1", (lBalanceAfterIncrease?.remaining ?? 0) === 1, JSON.stringify(increased.plan.balance));
    check("setLayerCount (library, increase): cart's L qty still unchanged", increased.cart.find((c) => c.skuId === "L")?.qty === cartAfterAdd, JSON.stringify(increased.cart));
    const conservationAfterIncrease = conservationHolds(increased);
    check("setLayerCount (library, increase): conservation holds", conservationAfterIncrease.ok, conservationAfterIncrease.detail);
  }

  // 27. undo after addRowFromLibrary restores the prior cart AND skus exactly (not just plan) — one
  //     undo step reverts both the SKU introduction and the placement together (see
  //     addRowFromLibrary's own doc comment for why plain addRow(introduceSku(...), ...) composed
  //     inline would NOT do this: introduceSku pushes no history entry of its own, so addRow's
  //     snapshot would capture the already-introduced state as "prior").
  {
    const state = makeFixture();
    const originalCart = clone(state.cart);
    const originalSkuIds = state.skus.map((s) => s.id).sort();
    const added = addRowFromLibrary(state, 1, SKU_L, 3);
    check("undo fixture (addRowFromLibrary): cart/skus actually changed", added.cart.length > state.cart.length && added.skus.length > state.skus.length);

    const undone = undo(added);
    check("undo (addRowFromLibrary): cart restored exactly (L's line gone)", JSON.stringify(undone.cart) === JSON.stringify(originalCart), JSON.stringify(undone.cart));
    check(
      "undo (addRowFromLibrary): skus restored exactly (L gone)",
      JSON.stringify(undone.skus.map((s) => s.id).sort()) === JSON.stringify(originalSkuIds),
      JSON.stringify(undone.skus.map((s) => s.id))
    );
    const conservation = conservationHolds(undone);
    check("undo (addRowFromLibrary): conservation holds on the restored state", conservation.ok, conservation.detail);
  }

  // 28. addColumnFromLibrary and addLayerFromLibrary (the other two library entry points
  //     CustomizeEditor.tsx wires up) behave the same way as addRowFromLibrary: cart grows to cover
  //     the new SKU, balance stays untouched, conservation holds.
  {
    const state = makeFixture();
    const withColumn = addColumnFromLibrary(state, 0, 1, SKU_L, 2); // trailer0/row1, alongside C
    const row1 = withColumn.plan.trailers[0].rows[1];
    check("addColumnFromLibrary: row1 gains an L column", row1.columns.some((c) => c.layers[0].skuId === "L"), JSON.stringify(row1));
    check("addColumnFromLibrary: cart gains {L: 2}", withColumn.cart.find((c) => c.skuId === "L")?.qty === 2, JSON.stringify(withColumn.cart));
    check("addColumnFromLibrary: no balance entry for L", withColumn.plan.balance.find((b) => b.skuId === "L") === undefined, JSON.stringify(withColumn.plan.balance));
    check("addColumnFromLibrary: conservation holds", conservationHolds(withColumn).ok, conservationHolds(withColumn).detail);
    check("addColumnFromLibrary: validateForApply reports zero violations", validateForApply(withColumn).length === 0, JSON.stringify(validateForApply(withColumn)));

    const withLayer = addLayerFromLibrary(state, { t: 0, r: 0, c: 0 }, SKU_L, 1); // top-off column A
    const column = withLayer.plan.trailers[0].rows[0].columns[0];
    check("addLayerFromLibrary: column A now has an L top-off layer", column.layers.some((l) => l.skuId === "L"), JSON.stringify(column));
    check("addLayerFromLibrary: cart gains {L: 1}", withLayer.cart.find((c) => c.skuId === "L")?.qty === 1, JSON.stringify(withLayer.cart));
    check("addLayerFromLibrary: no balance entry for L", withLayer.plan.balance.find((b) => b.skuId === "L") === undefined, JSON.stringify(withLayer.plan.balance));
    check("addLayerFromLibrary: conservation holds", conservationHolds(withLayer).ok, conservationHolds(withLayer).detail);
  }


  // --- lbr-07: tap-to-place operations (stackOnto / moveToSlot / takeToHolding / swapColumns /
  // addToHolding) and every verdict reason, on a golden-like fixture (makeStackFixture below):
  //   R1 [A 11″×9 (99″), B 13″×8 (104″)]   R2 [C 10″×10+9″×1 (109″), D 10″×9 (90″)]   R3 [W 60″-wide 10″×5]
  //   holding [X 48×24 10″×2, T 2″×5]   balance {12″: 4}   effective height 109″, 98″ wide, 380″ long.
  // Every ok/warn result must pass validateForApply (validatePlan) with zero violations, conserve
  // cart (trailers + holding + balance), and undo back to exactly the prior state.
  {
    const base = makeStackFixture();
    const sameAs = (a: EditorState, b: EditorState) =>
      JSON.stringify(clone(a.plan)) === JSON.stringify(clone(b.plan)) &&
      JSON.stringify(clone(a.holding)) === JSON.stringify(clone(b.holding)) &&
      JSON.stringify(a.cart) === JSON.stringify(b.cart) &&
      JSON.stringify(a.skus.map((s) => s.id)) === JSON.stringify(b.skus.map((s) => s.id));
    const layersOf = (s: EditorState, r: number, c: number) =>
      s.plan.trailers[0].rows[r].columns[c].layers.map((l) => `${l.unitHeight}x${l.count}`).join("+");
    const verifyResult = (name: string, before: EditorState, after: EditorState) => {
      check(`${name}: the state changed`, after !== before);
      const v = validateForApply(after);
      check(`${name}: validatePlan reports zero violations`, v.length === 0, JSON.stringify(v));
      const c = conservationHolds(after);
      check(`${name}: conservation holds`, c.ok, c.detail);
      check(`${name}: undo restores exactly`, sameAs(undo(after), before));
    };

    check("lbr-07 fixture: baseline validatePlan clean", validateForApply(base).length === 0, JSON.stringify(validateForApply(base)));
    check("lbr-07 fixture: baseline conservation", conservationHolds(base).ok, conservationHolds(base).detail);

    const A = { t: 0, r: 0, c: 0 };
    const B = { t: 0, r: 0, c: 1 };
    const C = { t: 0, r: 1, c: 0 };
    const D = { t: 0, r: 1, c: 1 };
    const W = { t: 0, r: 2, c: 0 };
    const oneTenFromD: PieceSource = { kind: "top", ref: D, count: 1 };

    // a. a single 10″ piece onto 11x9 -> 11x9+10x1, ok
    const vA = evaluateStackTarget(base, oneTenFromD, A);
    check("evaluateStackTarget: one 10″ piece onto 11x9 is ok (109″)", vA.level === "ok" && vA.heightAfter === 109, JSON.stringify(vA));
    const sA = stackOnto(base, oneTenFromD, A);
    check("stackOnto: 11x9 now reads 11x9+10x1", layersOf(sA, 0, 0) === "11x9+10x1", layersOf(sA, 0, 0));
    check("stackOnto: the source lost one piece off its top (10x8) and is now a partial", layersOf(sA, 1, 1) === "10x8" && sA.plan.trailers[0].rows[1].columns[1].stackKind === "partial", layersOf(sA, 1, 1));
    check("stackOnto: target is mixed with a rationale", sA.plan.trailers[0].rows[0].columns[0].mixed && sA.plan.trailers[0].rows[0].columns[0].rationale.length > 0);
    check("stackOnto: balance and cart untouched", JSON.stringify(sA.plan.balance) === JSON.stringify(base.plan.balance) && sA.cart === base.cart);
    verifyResult("stackOnto (10″ onto 11x9)", base, sA);

    // b. 10″ onto 13x8 -> no (114″ > 109″)
    const vB = evaluateStackTarget(base, oneTenFromD, B);
    check("evaluateStackTarget: 10″ onto 13x8 is no — would be 114″ tall (limit 109″)", vB.level === "no" && vB.reason === "would be 114″ tall (limit 109″)", JSON.stringify(vB));
    check("stackOnto: refuses a 'no' (same state)", stackOnto(base, oneTenFromD, B) === base);

    // c. 3 sizes -> no. D gets C's 9″ top-off first (10x9+9x1 = 99″), then a 2″ piece from holding.
    const nineOnD = stackOnto(base, { kind: "top", ref: C, count: 1 }, D);
    check("stackOnto: C's 9″ top-off onto D -> 10x9+9x1", layersOf(nineOnD, 1, 1) === "10x9+9x1", layersOf(nineOnD, 1, 1));
    verifyResult("stackOnto (9″ top-off onto 10x9)", base, nineOnD);
    const vC = evaluateStackTarget(nineOnD, { kind: "holdingTop", index: 1, count: 1 }, D);
    check("evaluateStackTarget: a third size is no — would be 3 sizes in one stack (max 2)", vC.level === "no" && vC.reason === "would be 3 sizes in one stack (max 2)", JSON.stringify(vC));

    // d. sub-K -> no
    const vD = evaluateStackTarget(base, { kind: "holdingTop", index: 1, count: 1 }, A);
    check("evaluateStackTarget: a 2″ piece onto 11x9 is no — too thin to top off (min 3″)", vD.level === "no" && vD.reason === "2″ pieces are too thin to top off (min 3″)", JSON.stringify(vD));

    // e. thicker-on-thinner -> warn (allowed)
    const elevenFromA: PieceSource = { kind: "top", ref: A, count: 1 };
    const vE = evaluateStackTarget(base, elevenFromA, D);
    check("evaluateStackTarget: an 11″ piece onto 10x9 is warn — thicker on thinner", vE.level === "warn" && vE.reason === "thicker pieces on thinner — usually loaded the other way", JSON.stringify(vE));
    const sE = stackOnto(base, elevenFromA, D);
    check("stackOnto: a warn still applies (10x9+11x1)", layersOf(sE, 1, 1) === "10x9+11x1", layersOf(sE, 1, 1));
    verifyResult("stackOnto (warn: 11″ onto 10x9)", base, sE);

    // f. footprint mismatch -> no
    const vF = evaluateStackTarget(base, { kind: "holding", index: 0 }, A);
    check("evaluateStackTarget: 48×24 pieces onto a 90×42 stack is no — different footprint (48×24 vs 90×42)", vF.level === "no" && vF.reason === "different footprint (48×24 vs 90×42)", JSON.stringify(vF));
    check("evaluateStackTarget: a stack onto itself is no", evaluateStackTarget(base, { kind: "column", ref: A }, A).level === "no");

    // g. holdingTop split + stack: 3 of the five 2″ pieces become a new rear row, then 1 more stacks onto it.
    const split = moveToSlot(base, { kind: "holdingTop", index: 1, count: 3 }, { t: 0, r: NEW_ROW, slot: 0 });
    check("moveToSlot (holdingTop -> new row): new rear row at index 0 holds 2x3", split.plan.trailers[0].rows.length === 4 && layersOf(split, 0, 0) === "2x3", JSON.stringify(split.plan.trailers[0].rows.map((r) => r.columns.length)));
    check("moveToSlot (holdingTop): the held stack keeps the other 2 pieces", split.holding[1]?.stackCount === 2, JSON.stringify(split.holding.map((h) => h.stackCount)));
    verifyResult("moveToSlot (holdingTop split to a new row)", base, split);
    const onSplit = stackOnto(split, { kind: "holdingTop", index: 1, count: 1 }, { t: 0, r: 0, c: 0 });
    check("stackOnto (holdingTop, same size): merges into one layer 2x4", layersOf(onSplit, 0, 0) === "2x4", layersOf(onSplit, 0, 0));
    verifyResult("stackOnto (holdingTop onto a same-size stack)", split, onSplit);

    // h. slot verdicts: width, depth (incl. a held stack — the lb-ui-03 gap), height.
    const vH1 = evaluateSlotTarget(base, { kind: "holding", index: 0 }, { t: 0, r: 0, slot: 2 });
    check("evaluateSlotTarget: X (24″ wide) into R1 (84″ used) is no — too wide", vH1.level === "no" && vH1.reason.startsWith("too wide"), JSON.stringify(vH1));
    const vH2 = evaluateSlotTarget(base, { kind: "column", ref: D }, { t: 0, r: NEW_ROW, slot: 0 });
    check("evaluateSlotTarget: D as a new rear row is ok (270″ -> 360″ of 380″)", vH2.level === "ok", JSON.stringify(vH2));
    const newRow = moveToSlot(base, { kind: "column", ref: D }, { t: 0, r: NEW_ROW, slot: 0 });
    verifyResult("moveToSlot (column -> new row)", base, newRow);
    const vH3 = evaluateSlotTarget(newRow, { kind: "top", ref: { t: 0, r: 1, c: 1 }, count: 1 }, { t: 0, r: NEW_ROW, slot: 0 });
    check("evaluateSlotTarget: another 90″-deep new row is no — too deep", vH3.level === "no" && vH3.reason.startsWith("too deep"), JSON.stringify(vH3));
    const vH4 = evaluateSlotTarget(newRow, { kind: "holding", index: 0 }, { t: 0, r: 0, slot: 1 });
    check("evaluateSlotTarget: X (48″ deep) beside D in the new row is ok", vH4.level === "ok", JSON.stringify(vH4));
    const placed = moveToSlot(newRow, { kind: "holding", index: 0 }, { t: 0, r: 0, slot: 1 });
    verifyResult("moveToSlot (whole held stack into a row slot)", newRow, placed);
    check("placeFromHolding (wrapper) == moveToSlot holding", JSON.stringify(clone(placeFromHolding(newRow, 0, { t: 0, r: 0, slot: 1 }).plan)) === JSON.stringify(clone(placed.plan)));

    // i. takeToHolding
    const tookTop = takeToHolding(base, { kind: "top", ref: C, count: 1 });
    check("takeToHolding (top): C is 10x10, the 9″ piece is a new held stack", layersOf(tookTop, 1, 0) === "10x10" && tookTop.holding.length === 3 && tookTop.holding[2].layers[0].unitHeight === 9, layersOf(tookTop, 1, 0));
    verifyResult("takeToHolding (top)", base, tookTop);
    const tookCol = takeToHolding(base, { kind: "column", ref: A });
    check("takeToHolding (column) == pullToHolding", JSON.stringify(clone(tookCol.plan)) === JSON.stringify(clone(pullToHolding(base, A).plan)) && tookCol.holding.length === 3);
    verifyResult("takeToHolding (column)", base, tookCol);
    const emptiedRow = takeToHolding(takeToHolding(base, { kind: "column", ref: W }), { kind: "column", ref: { t: 0, r: 0, c: 0 } });
    check("takeToHolding: a row that empties stays as a placeholder", emptiedRow.plan.trailers[0].rows.length === 3 && emptiedRow.plan.trailers[0].rows[2].columns.length === 0);

    // j. swapColumns
    const vJ1 = evaluateSwapTarget(base, A, D);
    check("evaluateSwapTarget: A <-> D (same widths) is ok", vJ1.level === "ok", JSON.stringify(vJ1));
    const swappedAD = swapColumns(base, A, D);
    check("swapColumns: A and D traded places", layersOf(swappedAD, 0, 0) === "10x9" && layersOf(swappedAD, 1, 1) === "11x9");
    verifyResult("swapColumns", base, swappedAD);
    const vJ2 = evaluateSwapTarget(base, W, A);
    check("evaluateSwapTarget: the 60″-wide W into R1 (B is 42″) is no — row R1 would be 102″ wide", vJ2.level === "no" && vJ2.reason.includes("row R1 would be 102\" wide"), JSON.stringify(vJ2));
    check("swapColumns: refuses a 'no' (same state)", swapColumns(base, W, A) === base);

    // k. addToHolding — job SKU draws balance; library SKU grows cart; both then placed onto a stack.
    const addJob = addToHolding(base, SKU_S12, 1);
    check("addToHolding (job): one 12″ held stack, balance 4 -> 3, cart unchanged", addJob.holding.length === 3 && addJob.plan.balance.find((b) => b.skuId === "S12")?.remaining === 3 && addJob.cart === base.cart, JSON.stringify(addJob.plan.balance));
    verifyResult("addToHolding (job)", base, addJob);
    const jobOnD = stackOnto(addJob, { kind: "holding", index: 2 }, D);
    check("addToHolding -> stackOnto (job, warn 12″ on 10″): D reads 10x9+12x1", layersOf(jobOnD, 1, 1) === "10x9+12x1", layersOf(jobOnD, 1, 1));
    verifyResult("addToHolding -> stackOnto (job)", addJob, jobOnD);
    const addLib = addToHolding(base, SKU_S5L, 1);
    check("addToHolding (library): SKU introduced, cart gains {S5L: 1}, no balance entry", addLib.skus.some((s) => s.id === "S5L") && addLib.cart.find((c) => c.skuId === "S5L")?.qty === 1 && !addLib.plan.balance.some((b) => b.skuId === "S5L"), JSON.stringify(addLib.cart));
    verifyResult("addToHolding (library)", base, addLib);
    const libOnA = stackOnto(addLib, { kind: "holding", index: 2 }, A);
    check("addToHolding -> stackOnto (library): A reads 11x9+5x1", layersOf(libOnA, 0, 0) === "11x9+5x1", layersOf(libOnA, 0, 0));
    verifyResult("addToHolding -> stackOnto (library)", addLib, libOnA);
    const addMany = addToHolding(base, SKU_S5L, 25);
    check("addToHolding: 25 × 5″ splits into full-height held stacks 21 + 4", addMany.holding.length === 4 && addMany.holding[2].stackCount === 21 && addMany.holding[3].stackCount === 4, JSON.stringify(addMany.holding.map((h) => h.stackCount)));
    verifyResult("addToHolding (split into full-height stacks)", base, addMany);
    check("addToHolding: count <= 0 is a no-op", addToHolding(base, SKU_S12, 0) === base);
  }

  // --- lbr-09: Shift to rear (shiftToRear / withAutoShift). Floor terms: FRONT = doors =
  // trailer.rows[0]; REAR = nose = the last row. Stacks are tagged with a unique id in their
  // rationale (describeManualLayers keeps that prefix), so "order preserved" compares id sequences
  // walked rear -> front. Every result must pass validatePlan with zero violations, conserve cart,
  // and never grow a trailer's used length. ---
  {
    const MANUAL = " + manually added:";
    const idOf = (c: PackColumn) => c.rationale.split(MANUAL)[0];
    const walkIds = (s: EditorState, t = 0) =>
      [...s.plan.trailers[t].rows].reverse().flatMap((r) => [...r.columns].sort((a, b) => a.posY - b.posY).map(idOf));
    const rowSizes = (s: EditorState, t = 0) => s.plan.trailers[t].rows.map((r) => r.columns.length);
    const tagged = (s: EditorState): EditorState => {
      const plan = clone(s.plan);
      let n = 0;
      for (const trailer of plan.trailers) for (const row of [...trailer.rows].reverse()) for (const c of row.columns) c.rationale = `id-${n++}`;
      return { ...s, plan };
    };
    const verifyShift = (name: string, before: EditorState, after: EditorState) => {
      const v = validateForApply(after);
      check(`${name}: validatePlan reports zero violations`, v.length === 0, JSON.stringify(v));
      const c = conservationHolds(after);
      check(`${name}: conservation holds`, c.ok, c.detail);
      check(
        `${name}: used length never grows`,
        after.plan.trailers.every((t, i) => t.usedLength <= before.plan.trailers[i].usedLength + 1e-6),
        JSON.stringify(after.plan.trailers.map((t, i) => [before.plan.trailers[i].usedLength, t.usedLength]))
      );
    };

    // A uniform-depth trailer: 5 rows × 4 stacks of 48×24 (10″×5 = 50″, so a whole stack fits on
    // another), 98″ wide — the golden layout's shape with short stacks.
    const S48: PackSku = { id: "S48", name: "10in 48x24", sku: "S48-1", length: 48, width: 24, height: 10, weight: 1, category: "Blocks", allowRotation: true };
    const D90: PackSku = { id: "D90", name: "10in 90x24", sku: "D90-1", length: 90, width: 24, height: 10, weight: 1, category: "Blocks", allowRotation: true };
    const shortStack = (sku: PackSku) => makeStack([[sku, 5]], "partial");
    const makeShiftFixture = (rowsSpec: PackSku[][]): EditorState => {
      const trailer: PackTrailer = { ...makeTrailer(rowsSpec.map((cols) => makeRow(cols.map(shortStack)))), dims: DIMS_S };
      const plan: PackPlan = { trailers: [trailer], balance: [], warnings: [], totalWeight: 0, totalUnits: 0, totalStacks: 0, mixedStacks: 0 };
      const qty = new Map<string, number>();
      for (const cols of rowsSpec) for (const sku of cols) qty.set(sku.id, (qty.get(sku.id) ?? 0) + 5);
      const cart = Array.from(qty.entries()).map(([skuId, q]) => ({ skuId, qty: q }));
      return tagged(normalizeState(createEditorState(plan, DIMS_S, OPTS, cart, [S48, D90])));
    };
    const full = [S48, S48, S48, S48];
    const base = makeShiftFixture([full, full, full, full, full]);
    check("lbr-09 fixture: baseline validatePlan clean", validateForApply(base).length === 0, JSON.stringify(validateForApply(base)));

    // 1. Golden layout shape: a whole stack off a full middle row onto another stack -> auto-shift.
    const src = { t: 0, r: 2, c: 1 };
    const dst = { t: 0, r: 3, c: 0 };
    const srcId = idOf(base.plan.trailers[0].rows[2].columns[1]);
    const moved = stackOnto(base, { kind: "column", ref: src }, dst);
    check("shift 1: stackOnto left a hole in R3 (3 stacks)", rowSizes(moved)[2] === 3, JSON.stringify(rowSizes(moved)));
    const auto = withAutoShift(base, moved);
    check("shift 1: row count unchanged or lower (5 -> 5)", auto.plan.trailers[0].rows.length <= 5, JSON.stringify(rowSizes(auto)));
    check("shift 1: the only gap is at the front (doors) end — R1 holds 3, every other row 4", JSON.stringify(rowSizes(auto)) === "[3,4,4,4,4]", JSON.stringify(rowSizes(auto)));
    check(
      "shift 1: every other stack keeps its order (rear -> front id sequence)",
      JSON.stringify(walkIds(auto)) === JSON.stringify(walkIds(base).filter((id) => id !== srcId)),
      JSON.stringify(walkIds(auto))
    );
    check("shift 1: the merged stack is 10″×10", auto.plan.trailers[0].rows.flatMap((r) => r.columns).some((c) => c.stackCount === 10));
    check("shift 1: withAutoShift keeps the move's history (one entry for move + shift)", auto.history.length === moved.history.length && auto.history.length === base.history.length + 1);
    verifyShift("shift 1 (stackOnto + auto-shift)", base, auto);
    // 5. One undo restores the pre-move plan exactly.
    const undone1 = undo(auto);
    check("shift 5: one undo after an auto-shifted move restores the pre-move plan exactly", JSON.stringify(clone(undone1.plan)) === JSON.stringify(clone(base.plan)) && undone1.holding.length === base.holding.length);

    // 2. Two holes in different rows close in one shift (holding keeps the two stacks).
    const twoHoles = takeToHolding(takeToHolding(base, { kind: "column", ref: { t: 0, r: 1, c: 2 } }), { kind: "column", ref: { t: 0, r: 3, c: 0 } });
    check("shift 2: fixture has two holes (R2 and R4 hold 3)", JSON.stringify(rowSizes(twoHoles)) === "[4,3,4,3,4]", JSON.stringify(rowSizes(twoHoles)));
    const shifted2 = shiftToRear(twoHoles);
    check("shift 2: both holes closed in one shift — R1 holds 2, every other row 4", JSON.stringify(rowSizes(shifted2)) === "[2,4,4,4,4]", JSON.stringify(rowSizes(shifted2)));
    check("shift 2: order preserved", JSON.stringify(walkIds(shifted2)) === JSON.stringify(walkIds(twoHoles)), JSON.stringify(walkIds(shifted2)));
    check("shift 2: the button's shift is its own history step", shifted2.history.length === twoHoles.history.length + 1);
    check("shift 2: holding untouched", shifted2.holding.length === 2);
    verifyShift("shift 2 (two holes)", twoHoles, shifted2);
    check("shift 2: undo reverts just the shift", JSON.stringify(clone(undo(shifted2).plan)) === JSON.stringify(clone(twoHoles.plan)));

    // An emptied row (placeholder) is closed too, and the trailer's freed floor ends up at the front.
    const emptiedRow = [0, 0, 0, 0].reduce((s) => takeToHolding(s, { kind: "column", ref: { t: 0, r: 2, c: 0 } }), base);
    check("shift: fixture R3 emptied to a placeholder", JSON.stringify(rowSizes(emptiedRow)) === "[4,4,0,4,4]", JSON.stringify(rowSizes(emptiedRow)));
    const shiftedEmpty = shiftToRear(emptiedRow);
    check(
      "shift: the empty row closes (4 rows of 4), order kept",
      JSON.stringify(rowSizes(shiftedEmpty)) === "[4,4,4,4]" && JSON.stringify(walkIds(shiftedEmpty)) === JSON.stringify(walkIds(emptiedRow)),
      JSON.stringify(rowSizes(shiftedEmpty))
    );
    verifyShift("shift (empty row)", emptiedRow, shiftedEmpty);

    // Rows of different depth (each row uniform): a refilled row never mixes depths.
    const depths = makeShiftFixture([[S48, S48], full, [D90, D90]]);
    const depthHole = takeToHolding(depths, { kind: "column", ref: { t: 0, r: 1, c: 0 } });
    const shiftedDepths = shiftToRear(depthHole);
    const depthRows = shiftedDepths.plan.trailers[0].rows.map((r) => r.columns.map((c) => c.colLength));
    check("shift: rows of different depth refill within their own depth (R1 48, R2 48×4, R3 90×2)", JSON.stringify(depthRows) === "[[48],[48,48,48,48],[90,90]]", JSON.stringify(depthRows));
    check("shift: no refilled row is mixed-depth", depthRows.every((r) => r.every((l) => l === r[0])));
    verifyShift("shift (different-depth rows)", depthHole, shiftedDepths);

    // 3. A trailer with a mixed-depth row. lbr-09 closed only its empty rows (with a note); lbr-10
    //    replaces that branch on purpose: the rear row pulls in the nearest same-depth stack from in
    //    front, so these three assertions now state the lbr-10 result.
    const mixed = makeShiftFixture([[S48, D90], [S48, S48], [S48]]);
    const mixedHoles = takeToHolding(takeToHolding(mixed, { kind: "column", ref: { t: 0, r: 2, c: 0 } }), { kind: "column", ref: { t: 0, r: 1, c: 1 } });
    const mixedResult = shiftToRearWithNote(mixedHoles);
    const depthsOf = (st: EditorState) => st.plan.trailers[0].rows.map((r) => r.columns.map((c) => c.colLength));
    check(
      "shift 3 (lbr-10): mixed-depth trailer -> R2's 48″ stack slides back from R1; the 90″ stays at the front",
      JSON.stringify(depthsOf(mixedResult.state)) === "[[90],[48,48]]",
      JSON.stringify(depthsOf(mixedResult.state))
    );
    check("shift 3 (lbr-10): no note (the old mixed-depth note is gone)", mixedResult.note === null, String(mixedResult.note));
    verifyShift("shift 3 (mixed depth)", mixedHoles, mixedResult.state);
    const mixedFull = shiftToRearWithNote(mixed);
    check(
      "shift 3 (lbr-10): mixed-depth trailer with a part-empty rear row -> the 48″ stacks slide back into it, no note",
      mixedFull.state !== mixed && JSON.stringify(depthsOf(mixedFull.state)) === "[[90],[48,48,48,48]]" && mixedFull.note === null,
      JSON.stringify(depthsOf(mixedFull.state))
    );
    verifyShift("shift 3 (mixed depth, part-empty rear row)", mixed, mixedFull.state);

    // 4. No-op returns the same reference: a full layout, an already-shifted one, withAutoShift on a no-op.
    check("shift 4: a full layout is a no-op (same reference, no note)", shiftToRear(base) === base && shiftToRearWithNote(base).note === null);
    check("shift 4: shifting twice — the second is a no-op", shiftToRear(shifted2) === shifted2);
    check("shift 4: withAutoShift(before, before) === before", withAutoShift(base, base) === base);
    const swapOnly = swapColumns(base, { t: 0, r: 0, c: 0 }, { t: 0, r: 4, c: 3 });
    check("shift 4: withAutoShift after a hole-free swap returns the swap itself", swapOnly !== base && withAutoShift(base, swapOnly) === swapOnly);

    // trailerIndex: only that trailer moves.
    const twoTrailers: EditorState = { ...twoHoles, plan: clone(twoHoles.plan) };
    twoTrailers.plan.trailers.push(clone(twoHoles.plan.trailers[0]));
    const onlySecond = shiftToRear(twoTrailers, 1);
    check(
      "shift: trailerIndex 1 shifts trailer 2 only",
      JSON.stringify(rowSizes(onlySecond, 0)) === "[4,3,4,3,4]" && JSON.stringify(rowSizes(onlySecond, 1)) === "[2,4,4,4,4]",
      JSON.stringify([rowSizes(onlySecond, 0), rowSizes(onlySecond, 1)])
    );

    // Golden 4472 T1 through pack(): already gap-free (a fixed point); take one stack off a full
    // middle row to holding -> auto-shift closes it, 13 rows, order kept, only R1 short.
    const mkGolden = (h: number): PackSku => ({ id: `GOLD_${h}`, name: `${h}in holey`, sku: `GOLD_${h}`, length: 48, width: 24, height: h, weight: 1, category: HOLEY_BOARD_CATEGORY, allowRotation: false });
    const goldenSkus = [13, 12, 11, 10, 9, 8].map(mkGolden);
    const goldenQty: Record<number, number> = { 13: 85, 12: 120, 11: 195, 10: 85, 9: 6, 8: 1 };
    const goldenCart: CartLine[] = goldenSkus.map((s) => ({ skuId: s.id, qty: goldenQty[s.height] }));
    const T53 = TRAILER_TYPES["53ft Standard"];
    const golden = tagged(createEditorState(pack(goldenCart, goldenSkus, T53), T53, OPTS, goldenCart, goldenSkus));
    check("shift golden: the auto-pack is a fixed point (same reference)", shiftToRear(golden) === golden, JSON.stringify(rowSizes(golden)));
    const goldenSrcId = idOf(golden.plan.trailers[0].rows[6].columns[2]);
    const goldenTook = takeToHolding(golden, { kind: "column", ref: { t: 0, r: 6, c: 2 } });
    const goldenAuto = withAutoShift(golden, goldenTook);
    check(
      "shift golden: 13 rows, only R1 (doors) short",
      goldenAuto.plan.trailers[0].rows.length === 13 && rowSizes(goldenAuto).slice(1).every((n) => n === 4) && rowSizes(goldenAuto)[0] === 3,
      JSON.stringify(rowSizes(goldenAuto))
    );
    check("shift golden: order preserved", JSON.stringify(walkIds(goldenAuto)) === JSON.stringify(walkIds(golden).filter((id) => id !== goldenSrcId)));
    verifyShift("shift golden (to holding + auto-shift)", golden, goldenAuto);
    check("shift golden: one undo restores the auto-pack", JSON.stringify(clone(undo(goldenAuto).plan)) === JSON.stringify(clone(golden.plan)) && undo(goldenAuto).holding.length === 0);
  }

  // --- lbr-10: Shift to rear on mixed-footprint rows. A row with free width pulls in the NEAREST
  // stack in front of it whose depth matches a stack already in the row — never a new depth, never a
  // longer row, never a longer trailer. Same 98″-wide trailer as above; stacks carry ids. ---
  {
    const MANUAL = " + manually added:";
    const idOf = (c: PackColumn) => c.rationale.split(MANUAL)[0];
    const S48: PackSku = { id: "S48", name: "10in 48x24", sku: "S48-1", length: 48, width: 24, height: 10, weight: 1, category: "Blocks", allowRotation: true };
    const D90: PackSku = { id: "D90", name: "10in 90x24", sku: "D90-1", length: 90, width: 24, height: 10, weight: 1, category: "Blocks", allowRotation: true };
    const S36: PackSku = { id: "S36", name: "10in 36x24", sku: "S36-1", length: 36, width: 24, height: 10, weight: 1, category: "Blocks", allowRotation: true };
    const build = (rowsSpec: PackSku[][]): EditorState => {
      const trailer: PackTrailer = { ...makeTrailer(rowsSpec.map((cols) => makeRow(cols.map((k) => makeStack([[k, 5]], "partial"))))), dims: DIMS_S };
      const plan: PackPlan = { trailers: [trailer], balance: [], warnings: [], totalWeight: 0, totalUnits: 0, totalStacks: 0, mixedStacks: 0 };
      const qty = new Map<string, number>();
      for (const cols of rowsSpec) for (const k of cols) qty.set(k.id, (qty.get(k.id) ?? 0) + 5);
      const st = normalizeState(createEditorState(plan, DIMS_S, OPTS, Array.from(qty.entries()).map(([skuId, q]) => ({ skuId, qty: q })), [S48, D90, S36]));
      const tagged = clone(st.plan);
      let n = 0;
      for (const row of [...tagged.trailers[0].rows].reverse()) for (const c of row.columns) c.rationale = `id-${n++}`;
      return { ...st, plan: tagged };
    };
    const ids = (st: EditorState) => st.plan.trailers[0].rows.map((r) => [...r.columns].sort((a, b) => a.posY - b.posY).map(idOf));
    const lens = (st: EditorState) => st.plan.trailers[0].rows.map((r) => r.rowLength);
    const stacks = (st: EditorState) => st.plan.trailers[0].rows.reduce((s, r) => s + r.columns.length, 0);

    // 1. Mixed rows [D90 + 48s], a hole in the rear row made by pullToHolding.
    //    front-first: R1 [D90 S48 S48], R2 [D90 S48 S48 S48], R3 [D90 S48 S48 S48] -> pull R3's 3rd stack.
    const mixedBase = build([[D90, S48, S48], [D90, S48, S48, S48], [D90, S48, S48, S48]]);
    const withHole = pullToHolding(mixedBase, { t: 0, r: 2, c: 2 });
    const before = ids(withHole);
    const shifted = shiftToRearWithNote(withHole);
    const after = ids(shifted.state);
    // Nearest stack in front of R3 with a depth already in R3 (90 or 48) is R2's first (posY order):
    // its D90. R2 then has room and pulls R1's nearest 48″ stack (R1's D90 is a depth R2 no longer has).
    check(
      "lbr-10 mixed 1: R3's hole is filled by the nearest same-depth stack from in front (R2's first stack)",
      after[2].length === 4 && after[2][3] === before[1][0],
      JSON.stringify({ before, after })
    );
    check("lbr-10 mixed 1: R2 refilled from R1 with a 48″ stack", JSON.stringify(after[1]) === JSON.stringify([...before[1].slice(1), before[0][1]]), JSON.stringify(after));
    check(
      "lbr-10 mixed 1: no row gained a new depth",
      shifted.state.plan.trailers[0].rows.every((r, i) => r.columns.every((c) => withHole.plan.trailers[0].rows[i]?.columns.some((x) => Math.abs(x.colLength - c.colLength) < 1e-6))),
      JSON.stringify(shifted.state.plan.trailers[0].rows.map((r) => r.columns.map((c) => c.colLength)))
    );
    check(
      "lbr-10 mixed 1: no row's rowLength grows",
      lens(shifted.state).every((l, i) => l <= lens(withHole)[i] + 1e-6),
      JSON.stringify({ before: lens(withHole), after: lens(shifted.state) })
    );
    check("lbr-10 mixed 1: stack count unchanged (on the trailer)", stacks(shifted.state) === stacks(withHole), `${stacks(withHole)} -> ${stacks(shifted.state)}`);
    check("lbr-10 mixed 1: no note", shifted.note === null, String(shifted.note));
    const v1 = validateForApply(shifted.state);
    check("lbr-10 mixed 1: validatePlan clean", v1.length === 0, JSON.stringify(v1));
    check("lbr-10 mixed 1: conservation holds", conservationHolds(shifted.state).ok, conservationHolds(shifted.state).detail);
    check("lbr-10 mixed 1: used length ≤ before", shifted.state.plan.trailers[0].usedLength <= withHole.plan.trailers[0].usedLength + 1e-6);
    check("lbr-10 mixed 1: undo reverts the shift", JSON.stringify(clone(undo(shifted.state).plan)) === JSON.stringify(clone(withHole.plan)));
    const auto = withAutoShift(mixedBase, withHole);
    check("lbr-10 mixed 1: the auto-shift after the pull gives the same layout, one history step", JSON.stringify(ids(auto)) === JSON.stringify(after) && auto.history.length === withHole.history.length);
    check("lbr-10 mixed 1: a second shift is a no-op", shiftToRear(shifted.state) === shifted.state);

    // 2. Mixed rear row [S48 S36] with room, but every stack in front is 90″ deep -> no-op.
    const noMatch = build([[D90, D90, D90, D90], [S48, S36]]);
    const nm = shiftToRearWithNote(noMatch);
    check("lbr-10 mixed 2: no same-depth stack in front -> same reference, no note", nm.state === noMatch && nm.note === null);

    // 3. The guard ("couldn't slide stacks without lengthening the trailer") is unreachable for a
    //    well-formed row: a stack only joins a row that already holds a stack of its exact depth, so
    //    the row's rowLength (its deepest stack) can't grow, and the row it left can only get shorter
    //    or disappear — the used length (the sum of rowLengths) can't grow either. It stays in as a
    //    defensive check; the harness sweep over every real mixed-depth trailer confirms it never fires.
    check("lbr-10 mixed 3: guard never fired on these fixtures", [shifted.note, nm.note].every((n) => n === null));
  }

  // lb-box-03 H8. On-edge columns are locked in Customize; dissolve never moves or targets them.
  {
    const BOX = TRAILER_TYPES["26ft Box Truck"];
    const hb6: PackSku = { id: "EDGE6", name: "6in holey", sku: "EDGE6", length: 48, width: 24, height: 6, weight: 1, category: HOLEY_BOARD_CATEGORY, allowRotation: false };
    const opts = { ...DEFAULT_PACK_OPTIONS };
    const cart: CartLine[] = [{ skuId: "EDGE6", qty: 198 }];
    const plan = pack(cart, [hb6], BOX, opts);
    const st = createEditorState(plan, BOX, opts, cart, [hb6]);
    const rows = st.plan.trailers[0].rows;
    const ri = rows.findIndex((r) => r.columns.some((c) => c.onEdge));
    const edgeRef = { t: 0, r: ri, c: rows[ri].columns.findIndex((c) => c.onEdge) };
    const flatRef = { t: 0, r: ri, c: rows[ri].columns.findIndex((c) => !c.onEdge) };
    const otherRi = rows.findIndex((r, i) => i !== ri && r.columns.some((c) => !c.onEdge));
    const otherFlat = { t: 0, r: otherRi, c: rows[otherRi].columns.findIndex((c) => !c.onEdge) };
    check("H8 fixture: the box-truck plan has on-edge columns", ri >= 0 && edgeRef.c >= 0 && flatRef.c >= 0 && otherRi >= 0);
    check("H8: an edge column can't be pulled to holding", pullToHolding(st, edgeRef) === st);
    check("H8: an edge column can't be moved to a slot", moveToSlot(st, { kind: "column", ref: edgeRef }, { t: 0, r: otherRi, slot: 0 }) === st);
    check("H8: pieces can't come off an edge column's top", takeToHolding(st, { kind: "top", ref: edgeRef, count: 1 }) === st);
    check("H8: nothing stacks onto an edge column", evaluateStackTarget(st, { kind: "top", ref: otherFlat, count: 1 }, edgeRef).level === "no");
    check("H8: an edge column can't be swapped", swapColumns(st, flatRef, edgeRef) === st && evaluateSwapTarget(st, otherFlat, edgeRef).level === "no");
    check("H8: an edge column's count can't change", setLayerCount(st, edgeRef, 0, 1) === st);
    check("H8: a row holding edge columns can't be deleted", removeRow(st, 0, ri) === st);
    const held = takeToHolding(st, { kind: "top", ref: otherFlat, count: 1 });
    check("H8: a flat stack can't be placed into a full wall slot", evaluateSlotTarget(held, { kind: "holding", index: held.holding.length - 1 }, { t: 0, r: ri, slot: rows[ri].columns.length }).level === "no");
    const edgesBefore = JSON.stringify(st.plan.trailers[0].rows.map((r) => r.columns.filter((c) => c.onEdge).map((c) => [c.posY, c.colWidth, c.stackCount])));
    const shifted = shiftToRear(st);
    const edgesAfter = JSON.stringify(shifted.plan.trailers[0].rows.map((r) => r.columns.filter((c) => c.onEdge).map((c) => [c.posY, c.colWidth, c.stackCount])));
    check("H8: Shift to rear leaves edge columns in place", edgesBefore === edgesAfter, edgesAfter);
    const swapped = swapColumns(st, flatRef, otherFlat);
    check("H8: an allowed edit (swap two flat stacks) still validates", swapped !== st && validateForApply(swapped).length === 0, JSON.stringify(validateForApply(swapped)));
    // Dissolve: two box trucks; the second's pieces may go onto the first, never into its slot, and
    // the first's edge boards are never offered as a source.
    const cart2: CartLine[] = [{ skuId: "EDGE6", qty: 396 + 10 }];
    const plan2 = pack(cart2, [hb6], BOX, opts);
    const st2 = createEditorState(plan2, BOX, opts, cart2, [hb6]);
    const isEdgeAt = (ti: number, r: number, c: number) => st2.plan.trailers[ti]?.rows[r]?.columns[c]?.onEdge === true;
    const fromLast = proposeDissolve(st2, st2.plan.trailers.length - 1);
    const fromFirst = proposeDissolve(st2, 0);
    check("H8 fixture: dissolve plan has 2 box trucks with edge columns", st2.plan.trailers.length === 2 && st2.plan.trailers.some((t) => t.rows.some((r) => r.columns.some((c) => c.onEdge))), String(st2.plan.trailers.length));
    check("H8: dissolve never targets an edge column", [...fromLast.moves, ...fromFirst.moves].every((m) => !isEdgeAt(m.toTi, m.toRi, m.toCi)));
    check("H8: dissolve never sources from an edge column", fromFirst.moves.every((m) => !isEdgeAt(0, m.fromRi, m.fromCi)) && fromLast.moves.every((m) => !isEdgeAt(fromLast.srcTi, m.fromRi, m.fromCi)));
  }

  return { pass: results.every((r) => r.pass), results };
}
