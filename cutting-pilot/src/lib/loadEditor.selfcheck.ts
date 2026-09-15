// src/lib/loadEditor.selfcheck.ts
// Guarded dev self-check for the customize editor's pure edit operations (lb-ui-02 Part D).
// Mirrors packEngine.selfcheck.ts's shape: a hand-built fixture plan, a check()/results table, one
// exported run*SelfCheck() function. Not part of the production build path.
//
// Every check ends with a validatePlan()-derived assertion (via validateForApply, which is the
// same apply-gate call CustomizeEditor/EditorGuards use) returning zero violations, UNLESS the
// check is specifically testing that a violation fires — per Part D's stated discipline.
import type { CartLine, PackColumn, PackOptions, PackPlan, PackRow, PackSku, PackTrailer, Dimensions } from "./packEngine";
import { DEFAULT_PACK_OPTIONS } from "./packEngine";
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
  type EditorState,
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

const SKUS: PackSku[] = [SKU_A, SKU_B, SKU_C, SKU_D, SKU_E, SKU_F];
const CART: CartLine[] = [
  { skuId: "A", qty: 1 },
  { skuId: "B", qty: 1 },
  { skuId: "C", qty: 1 },
  { skuId: "D", qty: 1 },
  { skuId: "E", qty: 1 },
  { skuId: "F", qty: 1 },
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
    balance: [],
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

  return { pass: results.every((r) => r.pass), results };
}
