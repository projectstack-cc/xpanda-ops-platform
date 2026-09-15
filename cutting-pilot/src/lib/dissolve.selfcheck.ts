// src/lib/dissolve.selfcheck.ts
// Guarded dev self-check for dissolve.ts (lb-ui-03 Part D). Mirrors loadEditor.selfcheck.ts's shape:
// hand-built fixtures, a check()/results table, one exported run*SelfCheck() function. Not part of
// the production build path.
//
// Each rule gets its own small, targeted fixture rather than one shared fixture for every check —
// dissolve's eligibility rules are combinatorial (same-SKU vs different-SKU, cap, K, footprint
// match) and a single shared fixture makes it too easy for one rule's pass to mask another rule's
// silent no-op. Where a check needs multiple receivers to observe an exclusion or an ordering
// effect, that is called out in the check's own comment.
import type { CartLine, Dimensions, PackColumn, PackLayer, PackOptions, PackPlan, PackRow, PackSku, PackTrailer } from "./packEngine";
import { DEFAULT_PACK_OPTIONS } from "./packEngine";
import { createEditorState, normalizeState, validateForApply, type EditorState } from "./loadEditor";
import { proposeDissolve, applyDissolve, dissolveGroupKey } from "./dissolve";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const DIMS: Dimensions = { length: 100, width: 50, height: 40, maxWeight: 100000 };
const OPTS: PackOptions = { ...DEFAULT_PACK_OPTIONS, topOffMinInchesPerPiece: 5, maxSkusPerColumn: 2 };

function makeSku(id: string, length: number, width: number, height: number, weight: number): PackSku {
  return { id, name: `SKU ${id}`, sku: `${id}-1`, length, width, height, weight, category: "Blocks", allowRotation: true };
}

function makeLayer(s: PackSku, count: number): PackLayer {
  return {
    skuId: s.id,
    skuName: s.name,
    skuCode: s.sku,
    color: "#333333",
    unitHeight: s.height,
    count,
    orientation: { length: s.length, width: s.width, height: s.height, label: "flat" },
  };
}

function makeColumn(layers: PackLayer[], skuById: Map<string, PackSku>): PackColumn {
  const first = layers[0];
  const distinct = new Set(layers.map((l) => l.skuId));
  return {
    posY: 0,
    colWidth: first.orientation.width,
    colLength: first.orientation.length,
    totalHeight: layers.reduce((s, l) => s + l.count * l.unitHeight, 0),
    totalWeight: layers.reduce((s, l) => s + l.count * (skuById.get(l.skuId)?.weight ?? 0), 0),
    stackCount: layers.reduce((s, l) => s + l.count, 0),
    layers,
    mixed: distinct.size > 1,
    rationale: "test fixture column",
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

/** Builds a normalized two-trailer state: trailer 0 = source rows, trailer 1 = receiver rows. Row/
 * trailer-level derived fields (rowLength, posFromFront, usedLength, ...) come from loadEditor.ts's
 * own normalizeState/recomputePlan — the same derivation every other operation in this codebase
 * relies on — so this fixture only has to get the structural leaves (columns, layers) right. */
function buildState(sourceRows: PackRow[], receiverRows: PackRow[], cart: CartLine[], skus: PackSku[]): EditorState {
  const plan: PackPlan = {
    trailers: [makeTrailer(sourceRows), makeTrailer(receiverRows)],
    balance: [],
    warnings: [],
    totalWeight: 0,
    totalUnits: 0,
    totalStacks: 0,
    mixedStacks: 0,
  };
  return normalizeState(createEditorState(plan, DIMS, OPTS, cart, skus));
}

function conservationHolds(state: EditorState, cart: CartLine[]): { ok: boolean; detail: string } {
  const counts = new Map<string, number>();
  const add = (skuId: string, n: number) => counts.set(skuId, (counts.get(skuId) ?? 0) + n);
  for (const trailer of state.plan.trailers) {
    for (const row of trailer.rows) {
      for (const column of row.columns) {
        for (const layer of column.layers) add(layer.skuId, layer.count);
      }
    }
  }
  for (const b of state.plan.balance) add(b.skuId, b.remaining);
  const mismatches: string[] = [];
  for (const line of cart) {
    const got = counts.get(line.skuId) ?? 0;
    if (got !== line.qty) mismatches.push(`${line.skuId}: trailers+balance=${got} != cart qty ${line.qty}`);
  }
  return { ok: mismatches.length === 0, detail: mismatches.join("; ") };
}

export function runDissolveSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  // 1. Found + group key round-trips. Source: one column, 2 pieces of P. Receiver: one column,
  //    1 pre-existing piece of P (headroom 30, plenty) — same SKU, so eligibility is headroom-only.
  {
    const P = makeSku("P", 20, 20, 10, 5);
    const skuById = new Map([[P.id, P]]);
    const state = buildState(
      [makeRow([makeColumn([makeLayer(P, 2)], skuById)])],
      [makeRow([makeColumn([makeLayer(P, 1)], skuById)])],
      [{ skuId: "P", qty: 3 }],
      [P]
    );
    const proposal = proposeDissolve(state, 0);
    check("propose: both P units found a receiver", proposal.moves.length === 2, JSON.stringify(proposal));
    check("propose: eligibleReceiverCount is 1 (one receiver column absorbed both)", proposal.eligibleReceiverCount === 1, String(proposal.eligibleReceiverCount));
    const [m1, m2] = proposal.moves;
    check(
      "dissolveGroupKey: both P moves share one group key (same SKU/thickness/destination)",
      dissolveGroupKey(m1) === dissolveGroupKey(m2) && dissolveGroupKey(m1) === "P-1|10|1",
      `${dissolveGroupKey(m1)} vs ${dissolveGroupKey(m2)}`
    );
  }

  // 2. A receiver already at maxSkusPerColumn distinct SKUs is never proposed as a target for a
  //    different SKU, even with plenty of headroom and a K-eligible piece — the ONLY receiver in
  //    this fixture, so a non-empty proposal here could only mean the cap check was skipped.
  {
    const P = makeSku("P", 20, 20, 10, 5); // K-eligible (10 >= K 5), plenty of headroom either way
    const Y = makeSku("Y", 20, 20, 8, 4);
    const Z = makeSku("Z", 20, 20, 8, 4);
    const skuById = new Map([P, Y, Z].map((s) => [s.id, s]));
    const state = buildState(
      [makeRow([makeColumn([makeLayer(P, 1)], skuById)])],
      [makeRow([makeColumn([makeLayer(Y, 1), makeLayer(Z, 1)], skuById)])], // already 2 distinct SKUs
      [{ skuId: "P", qty: 1 }, { skuId: "Y", qty: 1 }, { skuId: "Z", qty: 1 }],
      [P, Y, Z]
    );
    const proposal = proposeDissolve(state, 0);
    check(
      "propose: a column already at maxSkusPerColumn is never a target for a third SKU",
      proposal.moves.length === 0 && proposal.eligibleReceiverCount === 0,
      JSON.stringify(proposal)
    );
  }

  // 3. K threshold, both directions, isolated from headroom (receiver has 20" of headroom, both
  //    candidate pieces are well under that): a different-SKU piece below K is never proposed as a
  //    top-off; one at or above K is.
  {
    const R = makeSku("R", 20, 20, 3, 2); // below K (5)
    const Q = makeSku("Q", 20, 20, 6, 3); // meets K (5)
    const X = makeSku("X", 20, 20, 20, 8); // pure receiver base, distinct from both
    const skuById = new Map([R, Q, X].map((s) => [s.id, s]));
    const state = buildState(
      [makeRow([makeColumn([makeLayer(R, 1)], skuById), makeColumn([makeLayer(Q, 1)], skuById)])],
      [makeRow([makeColumn([makeLayer(X, 1)], skuById)])],
      [{ skuId: "R", qty: 1 }, { skuId: "Q", qty: 1 }, { skuId: "X", qty: 1 }],
      [R, Q, X]
    );
    const proposal = proposeDissolve(state, 0);
    check("propose: R (3\" < K 5\") is never proposed as a top-off", proposal.moves.every((m) => m.skuId !== "R"), JSON.stringify(proposal));
    check(
      "propose: Q (6\" >= K 5\") IS proposed as a top-off onto the same receiver",
      proposal.moves.length === 1 && proposal.moves[0].skuId === "Q",
      JSON.stringify(proposal)
    );
  }

  // 4. colLength/colWidth mismatch disqualifies a receiver even when the footprint would otherwise
  //    have headroom to spare — one receiver column with the wrong colLength, one with the right
  //    colLength but the wrong colWidth.
  {
    const P = makeSku("P", 20, 20, 10, 5); // colLength 20, colWidth 20
    const M = makeSku("M", 15, 20, 6, 3); // colLength 15 — length mismatch
    const W = makeSku("W", 20, 30, 6, 3); // colLength 20, colWidth 30 — width mismatch
    const skuById = new Map([P, M, W].map((s) => [s.id, s]));
    const state = buildState(
      [makeRow([makeColumn([makeLayer(P, 1)], skuById)])],
      [makeRow([makeColumn([makeLayer(M, 1)], skuById)]), makeRow([makeColumn([makeLayer(W, 1)], skuById)])],
      [{ skuId: "P", qty: 1 }, { skuId: "M", qty: 1 }, { skuId: "W", qty: 1 }],
      [P, M, W]
    );
    const proposal = proposeDissolve(state, 0);
    check(
      "propose: neither a colLength mismatch nor a colWidth mismatch is ever proposed as a receiver",
      proposal.moves.length === 0 && proposal.eligibleReceiverCount === 0,
      JSON.stringify(proposal)
    );
  }

  // 5. Excluding a group in applyDissolve leaves those specific pieces on the source trailer and
  //    moves everything else — two distinct groups (P same-SKU stack, Q different-SKU top-off) so
  //    excluding one has something else to leave unexcluded.
  {
    const P = makeSku("P", 20, 20, 10, 5);
    const Q = makeSku("Q", 20, 20, 6, 3);
    const skuById = new Map([P, Q].map((s) => [s.id, s]));
    const state = buildState(
      [makeRow([makeColumn([makeLayer(P, 1)], skuById), makeColumn([makeLayer(Q, 1)], skuById)])],
      [makeRow([makeColumn([makeLayer(P, 1)], skuById)])],
      [{ skuId: "P", qty: 2 }, { skuId: "Q", qty: 1 }],
      [P, Q]
    );
    const proposal = proposeDissolve(state, 0);
    check("propose (check 5 setup): P and Q each found a receiver", proposal.moves.length === 2, JSON.stringify(proposal));
    const qMove = proposal.moves.find((m) => m.skuId === "Q");
    check("propose (check 5 setup): Q's move exists to exclude", !!qMove);

    const excluded = new Set(qMove ? [dissolveGroupKey(qMove)] : []);
    const applied = applyDissolve(state, proposal, excluded);

    const srcRow = applied.plan.trailers[0].rows[0];
    const qStillOnSource = srcRow.columns.some((c) => c.layers.some((l) => l.skuId === "Q" && l.count === 1));
    const pGoneFromSource = !srcRow.columns.some((c) => c.layers.some((l) => l.skuId === "P"));
    check("applyDissolve: excluded Q stays on the source trailer, untouched", qStillOnSource, JSON.stringify(srcRow));
    check("applyDissolve: non-excluded P is fully moved off the source trailer", pGoneFromSource, JSON.stringify(srcRow));

    const receiverCol = applied.plan.trailers[1].rows[0].columns[0];
    const pMovedIn = receiverCol.layers.find((l) => l.skuId === "P")?.count === 2;
    const qNotMovedIn = !receiverCol.layers.some((l) => l.skuId === "Q");
    check("applyDissolve: receiver gained P (now 2) but not the excluded Q", pMovedIn && qNotMovedIn, JSON.stringify(receiverCol));

    // 6. Conservation holds after applyDissolve.
    const conservation = conservationHolds(applied, [{ skuId: "P", qty: 2 }, { skuId: "Q", qty: 1 }]);
    check("applyDissolve: conservation holds (trailers + balance == cart qty)", conservation.ok, conservation.detail);
  }

  // 7. applyDissolve's result passes validateForApply with zero violations — a full apply (nothing
  //    excluded) of check 1's fixture, so the receiver ends up genuinely mixed (P stacked to 3, no
  //    second SKU here) and every derived field (recomputeColumnAggregates + recomputePlan) has to
  //    agree with validatePlan's own totals-consistent/max-skus-per-column/topoff-threshold rules.
  {
    const P = makeSku("P", 20, 20, 10, 5);
    const Q = makeSku("Q", 20, 20, 6, 3);
    const skuById = new Map([P, Q].map((s) => [s.id, s]));
    const state = buildState(
      [makeRow([makeColumn([makeLayer(P, 2)], skuById), makeColumn([makeLayer(Q, 1)], skuById)])],
      [makeRow([makeColumn([makeLayer(P, 1)], skuById)])],
      [{ skuId: "P", qty: 3 }, { skuId: "Q", qty: 1 }],
      [P, Q]
    );
    const proposal = proposeDissolve(state, 0);
    const applied = applyDissolve(state, proposal, new Set());
    const violations = validateForApply(applied);
    check("applyDissolve (full apply, nothing excluded): validateForApply reports zero violations", violations.length === 0, JSON.stringify(violations));
  }

  // 9. Mixed-depth row regression: a row's rowLength is its DEEPEST column, so a row can contain
  //    columns of genuinely different depth (PackRow's own comment). Eligibility must match each
  //    unit's OWN source column depth (colLength) against each candidate's OWN receiver column
  //    depth — never a row-level rowLength, which is shared by every column in a row and can
  //    coincidentally equal an unrelated column's depth. Source row: DEEP (colLength 30, width 25 —
  //    every receiver column below is width 20, so it matches nothing and can't interfere) sets the
  //    row's rowLength to 30; SHALLOW's own
  //    depth is 15, not 30. Receiver row 0 has rowLength 30 too (via RX) but its columns are 30
  //    (RX) and 20 (RY) deep — neither is 15. Receiver row 1 (RZ, depth 15) is SHALLOW's only true
  //    match. A row-level rowLength check would accept RX (row 0's rowLength coincidentally equals
  //    the source row's) and hand SHALLOW's real 15"-deep piece an illegal 30"-deep orientation;
  //    correct per-column matching must skip straight past row 0 to RZ in row 1.
  {
    const DEEP = makeSku("DEEP", 30, 25, 10, 5); // width 25 (vs every receiver's 20): cannot match any receiver's colWidth
    const SHALLOW = makeSku("SHALLOW", 15, 20, 8, 4);
    const RX = makeSku("RX", 30, 20, 6, 3); // row 0, sets its rowLength to 30 — the coincidence
    const RY = makeSku("RY", 20, 20, 6, 3); // row 0, also wrong depth (20) for SHALLOW (15)
    const RZ = makeSku("RZ", 15, 20, 6, 3); // row 1 — SHALLOW's only genuine depth match
    const skuById = new Map([DEEP, SHALLOW, RX, RY, RZ].map((s) => [s.id, s]));
    const state = buildState(
      [makeRow([makeColumn([makeLayer(DEEP, 1)], skuById), makeColumn([makeLayer(SHALLOW, 1)], skuById)])],
      [
        makeRow([makeColumn([makeLayer(RX, 1)], skuById), makeColumn([makeLayer(RY, 1)], skuById)]),
        makeRow([makeColumn([makeLayer(RZ, 1)], skuById)]),
      ],
      [
        { skuId: "DEEP", qty: 1 },
        { skuId: "SHALLOW", qty: 1 },
        { skuId: "RX", qty: 1 },
        { skuId: "RY", qty: 1 },
        { skuId: "RZ", qty: 1 },
      ],
      [DEEP, SHALLOW, RX, RY, RZ]
    );
    check(
      "fixture sanity: the source row's rowLength (30) does not equal SHALLOW's own colLength (15)",
      state.plan.trailers[0].rows[0].rowLength === 30,
      String(state.plan.trailers[0].rows[0].rowLength)
    );
    const proposal = proposeDissolve(state, 0);
    const shallowMove = proposal.moves.find((m) => m.skuId === "SHALLOW");
    check(
      "propose: SHALLOW's piece is never proposed onto row 0 (RX/RY) despite row 0's rowLength coincidentally matching the source row's",
      !!shallowMove && shallowMove.toRi === 1 && shallowMove.toCi === 0,
      JSON.stringify(shallowMove)
    );
    check("propose: DEEP's piece (width 25, matches no receiver) finds no receiver anywhere", !proposal.moves.some((m) => m.skuId === "DEEP"), JSON.stringify(proposal));

    const applied = applyDissolve(state, proposal, new Set());
    const violations = validateForApply(applied);
    check(
      "applyDissolve (mixed-depth row): validateForApply reports zero violations — SHALLOW landed on a receiver column with its own true footprint, not a borrowed one",
      violations.length === 0,
      JSON.stringify(violations)
    );
  }

  // 10. noteDissolved must not clobber packEngine.ts's own "[stability: ...]" rationale note when
  //     replacing a receiver's rationale — dissolve makes columns taller, so a receiver is exactly
  //     the kind of column packEngine's applyStabilityWarnings tags as a loader-rearrange candidate,
  //     and silently losing that tag on dissolve is nothing else's job to catch (stability is a
  //     warning, not a validateForApply violation).
  {
    const P = makeSku("P", 20, 20, 10, 5);
    const skuById = new Map([[P.id, P]]);
    const receiverCol = makeColumn([makeLayer(P, 1)], skuById);
    receiverCol.rationale = '9 × 4" = 36", 4" left [stability: tall/narrow, ratio 2.1]';
    const state = buildState(
      [makeRow([makeColumn([makeLayer(P, 1)], skuById)])],
      [makeRow([receiverCol])],
      [{ skuId: "P", qty: 2 }],
      [P]
    );
    const proposal = proposeDissolve(state, 0);
    const applied = applyDissolve(state, proposal, new Set());
    const finalRationale = applied.plan.trailers[1].rows[0].columns[0].rationale;
    check(
      "applyDissolve: noteDissolved preserves an existing [stability: ...] note rather than dropping it",
      finalRationale.includes("[stability: tall/narrow, ratio 2.1]"),
      finalRationale
    );
    check(
      "applyDissolve: noteDissolved still replaces the stale fill-count prose ahead of the stability note",
      !finalRationale.includes("9 × 4") && finalRationale.includes("composition changed by dissolve"),
      finalRationale
    );
  }

  // 8. A source trailer with zero eligible receivers (no other trailer exists at all) returns an
  //    empty proposal, not an error.
  {
    const P = makeSku("P", 20, 20, 10, 5);
    const skuById = new Map([[P.id, P]]);
    const plan: PackPlan = {
      trailers: [makeTrailer([makeRow([makeColumn([makeLayer(P, 1)], skuById)])])],
      balance: [],
      warnings: [],
      totalWeight: 0,
      totalUnits: 0,
      totalStacks: 0,
      mixedStacks: 0,
    };
    const state = normalizeState(createEditorState(plan, DIMS, OPTS, [{ skuId: "P", qty: 1 }], [P]));
    let threw = false;
    let proposal;
    try {
      proposal = proposeDissolve(state, 0);
    } catch {
      threw = true;
    }
    check(
      "propose: a single-trailer plan (no possible receiver) returns moves:[] / eligibleReceiverCount:0, does not throw",
      !threw && !!proposal && proposal.moves.length === 0 && proposal.eligibleReceiverCount === 0,
      JSON.stringify(proposal)
    );
  }

  return { pass: results.every((r) => r.pass), results };
}
