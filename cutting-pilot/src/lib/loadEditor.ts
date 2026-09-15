// src/lib/loadEditor.ts
// lb-ui-02: pure, headless edit operations for the v2 load builder's customize editor. No React,
// no DOM — CustomizeEditor.tsx calls these and re-renders from the returned EditorState.
//
// The move unit is a whole column (Decision, locked) — individual layers are never peeled off a
// stack; a column carries its full layer composition wherever it goes.
//
// EditorState extends the prompt's stated 3-field shape (plan/holding/history) with dims/options/
// cart/skus. This is a necessary, not cosmetic, extension: PackPlan carries no dims of its own — by
// packEngine.ts's own design, pack()/validatePlan()/planMetrics() all take dims as a separate
// argument — and validatePlan (the apply gate) additionally needs cart+skus+options. Carrying them
// in EditorState means every operation's signature matches the prompt's pseudocode exactly (state +
// move descriptors, nothing else) instead of threading four extra parameters through every call.
//
// Conservation model — three distinct, non-overlapping buckets (see loadEditor.selfcheck.ts #5):
// pieces on trailers (state.plan.trailers) + pieces in holding (state.holding) + pieces never
// placed at all (state.plan.balance) must sum to cart qty, at every step. validatePlan()'s own
// `conservation` rule only knows about trailers + plan.balance, so it would spuriously fire the
// moment a column sits in holding; validateForApply() below builds a MERGED balance (plan.balance +
// holding, by SKU) for that one call only, without mutating state.plan.balance itself.
//
// lb-ui-02/03's operations (moveColumn, pullToHolding, placeFromHolding, compactLoad, dissolve.ts)
// never touch state.plan.balance — they only ever RELOCATE pieces the auto-pack already placed
// somewhere, so total placed count never changes and balance is correctly left alone.
//
// lb-ui-07's operations (addRow/addColumn/addLayer/setLayerCount below) are different in kind: they
// CREATE placement the auto-pack never chose to make, drawing on previously-unplaced demand. They
// DO adjust plan.balance — adjustBalance() below moves exactly `count` units from "unplaced" to
// "placed" (or back, for a count decrease) for the SKU involved. If a planner adds more of a SKU
// than plan.balance actually has remaining, the operation still completes (Part C's "don't
// pre-validate, let validateForApply catch it" contract, same as moveColumn's own width/length
// behavior) — balance clamps at zero rather than going negative, so the excess surfaces as a real
// `conservation` violation at Apply time instead of a nonsensical negative "remaining" figure.
// removeRow is relocation-only (its columns move to holding, exactly like pullToHolding) and does
// NOT touch balance, for the same reason the pre-existing relocation ops don't.
//
// Derived-geometry recompute (recomputeRow/recomputeTrailer/recomputePlan below) re-implements the
// same math as packEngine.ts's private assembleRowFrom/buildTrailer. Those functions aren't
// exported — the engine is closed and ratchet-guarded (lb-engine-05) — so this is a deliberate,
// minimal re-derivation of the same formulas, not a fork of engine logic; it never touches
// packEngine.ts.

import type {
  PackPlan,
  PackTrailer,
  PackRow,
  PackColumn,
  PackLayer,
  Dimensions,
  PackOptions,
  CartLine,
  PackSku,
  PackBalance,
  PackViolation,
} from "./packEngine";
import { validatePlan, skuOrientations } from "./packEngine";
// Reuses lb-ui-05's reproduction of packEngine.ts's private, unexported colorForSku rather than
// duplicating the palette/hash a third time — packEngine.ts is closed/ratchet-guarded and exports
// neither. See jobPull.ts's own header note; BACKLOG.md's existing "export colorForSku instead of
// duplicating it" follow-up now has two consumers, not one.
import { colorForSkuId } from "./jobPull";

export interface EditorState {
  plan: PackPlan;
  dims: Dimensions;
  options: PackOptions;
  cart: CartLine[];
  skus: PackSku[];
  holding: PackColumn[];
  history: EditorState[];
}

export interface ColumnRef {
  t: number;
  r: number;
  c: number;
}

export interface DropTarget {
  t: number;
  r: number;
  slot: number;
}

export interface DropFeedback {
  ok: boolean;
  reason: string;
  widthAfter: number;
  widthLimit: number;
  // lb-ui-03 Part C: length-side prediction. Additive — every existing caller that only read
  // ok/reason/widthAfter/widthLimit keeps working unchanged.
  lengthOk: boolean;
}

export interface RowOverflow {
  trailerIndex: number;
  rowIndex: number;
  overflowBy: number;
}

export interface EditorGuardState {
  blocking: PackViolation[]; // row-width, trailer-length — refuses apply
  bug: PackViolation[]; // column-height — should never fire; a move can't change a column's height
  otherViolations: PackViolation[]; // defensive catch-all for anything else validatePlan flags
  holdingCount: number; // advisory — columns that will be dropped from the load if applied now
  overflowingRows: RowOverflow[];
  canApply: boolean;
}

const MAX_HISTORY_DEPTH = 20;
const EPS = 1e-6;

function fmtInches(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function approxEq(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

// --- cloning (deep enough that no mutation below ever leaks back into the caller's plan) ---

// Exported for dissolve.ts (lb-ui-03): dissolve mutates column layers directly (a customize
// operation never needs to — it only ever relocates whole, already-formed columns), so it needs
// its own clone-before-mutate and the same recompute/history plumbing every other operation in this
// file already uses, rather than re-deriving a third copy of the same clone/recompute math.
export function cloneColumn(column: PackColumn): PackColumn {
  return { ...column, layers: column.layers.map((l) => ({ ...l, orientation: { ...l.orientation } })) };
}

function cloneRow(row: PackRow): PackRow {
  return { ...row, columns: row.columns.map(cloneColumn) };
}

function cloneTrailer(trailer: PackTrailer): PackTrailer {
  return { ...trailer, rows: trailer.rows.map(cloneRow) };
}

export function clonePlan(plan: PackPlan): PackPlan {
  return {
    ...plan,
    trailers: plan.trailers.map(cloneTrailer),
    balance: plan.balance.map((b) => ({ ...b })),
    warnings: [...plan.warnings],
  };
}

/** Recomputes every derived geometry/rollup field on a plan without otherwise changing its
 * structure. Exported for fixture-building (loadEditor.selfcheck.ts): a hand-built fixture only
 * has to get the structural leaves (columns, layers) right and can lean on this for every derived
 * field, the same way every edit operation above already does internally. */
export function normalizeState(state: EditorState): EditorState {
  const plan = clonePlan(state.plan);
  recomputePlan(plan, state.dims, state.options);
  return { ...state, plan };
}

export function createEditorState(
  plan: PackPlan,
  dims: Dimensions,
  options: PackOptions,
  cart: CartLine[],
  skus: PackSku[]
): EditorState {
  return { plan: clonePlan(plan), dims, options, cart, skus, holding: [], history: [] };
}

// --- derived-geometry recompute ---

function recomputeRow(row: PackRow): void {
  let posY = 0;
  for (const column of row.columns) {
    column.posY = posY;
    posY += column.colWidth;
  }
  row.rowWidthUsed = posY;
  row.rowLength = row.columns.length > 0 ? Math.max(...row.columns.map((c) => c.colLength)) : 0;
  row.wastedFloorArea = row.columns.reduce((s, c) => s + (row.rowLength - c.colLength) * c.colWidth, 0);
  row.totalUnits = row.columns.reduce((s, c) => s + c.stackCount, 0);
  row.totalWeight = row.columns.reduce((s, c) => s + c.totalWeight, 0);
}

function recomputeTrailer(trailer: PackTrailer, dims: Dimensions, effectiveHeight: number): void {
  let runningLength = 0;
  for (const row of trailer.rows) {
    recomputeRow(row);
    row.posFromFront = runningLength;
    runningLength += row.rowLength;
  }
  trailer.usedLength = runningLength;
  trailer.usedWeight = trailer.rows.reduce((s, r) => s + r.totalWeight, 0);
  trailer.totalUnits = trailer.rows.reduce((s, r) => s + r.totalUnits, 0);
  trailer.totalStacks = trailer.rows.reduce((s, r) => s + r.columns.length, 0);
  trailer.mixedStacks = trailer.rows.reduce((s, r) => s + r.columns.filter((c) => c.mixed).length, 0);
  trailer.usedFloorArea = trailer.rows.reduce(
    (s, r) => s + r.columns.reduce((s2, c) => s2 + c.colWidth * r.rowLength, 0),
    0
  );
  trailer.widthUtilization =
    trailer.rows.length > 0 ? trailer.rows.reduce((s, r) => s + r.rowWidthUsed / dims.width, 0) / trailer.rows.length : 0;
  const allHeights = trailer.rows.flatMap((r) => r.columns.map((c) => c.totalHeight));
  trailer.heightUtilization =
    allHeights.length > 0 ? allHeights.reduce((s, h) => s + h, 0) / allHeights.length / effectiveHeight : 0;
}

export function recomputePlan(plan: PackPlan, dims: Dimensions, options: PackOptions): void {
  const effectiveHeight = dims.height - (options.runnerHeight ?? 0);
  for (const trailer of plan.trailers) recomputeTrailer(trailer, dims, effectiveHeight);
  plan.totalWeight = plan.trailers.reduce((s, t) => s + t.usedWeight, 0);
  plan.totalUnits = plan.trailers.reduce((s, t) => s + t.totalUnits, 0);
  plan.totalStacks = plan.trailers.reduce((s, t) => s + t.totalStacks, 0);
  plan.mixedStacks = plan.trailers.reduce((s, t) => s + t.mixedStacks, 0);
}

// --- history — snapshots never nest their own history (avoids exponential growth at depth 20) ---

function snapshotFor(state: EditorState): EditorState {
  return {
    plan: clonePlan(state.plan),
    dims: state.dims,
    options: state.options,
    cart: state.cart,
    skus: state.skus,
    holding: state.holding.map(cloneColumn),
    history: [],
  };
}

// Exported for dissolve.ts (lb-ui-03), which needs to push its own undo snapshot — Apply's Undo
// button must be able to reverse a dissolve exactly like any other edit.
export function withHistory(state: EditorState): EditorState[] {
  const history = [...state.history, snapshotFor(state)];
  return history.length > MAX_HISTORY_DEPTH ? history.slice(history.length - MAX_HISTORY_DEPTH) : history;
}

/** Undo restores the prior snapshot. Past the start it is a safe no-op — returns `state` unchanged. */
export function undo(state: EditorState): EditorState {
  if (state.history.length === 0) return state;
  const prior = state.history[state.history.length - 1];
  return {
    plan: clonePlan(prior.plan),
    dims: state.dims,
    options: state.options,
    cart: state.cart,
    skus: state.skus,
    holding: prior.holding.map(cloneColumn),
    history: state.history.slice(0, -1),
  };
}

// --- lookups ---

function getColumn(plan: PackPlan, ref: ColumnRef): PackColumn | null {
  return plan.trailers[ref.t]?.rows[ref.r]?.columns[ref.c] ?? null;
}

// --- operations ---

/** Moves a column from one row (possibly the same row, for reordering) to another. */
export function moveColumn(state: EditorState, from: ColumnRef, to: DropTarget): EditorState {
  const column = getColumn(state.plan, from);
  const targetRowExists = state.plan.trailers[to.t]?.rows[to.r];
  if (!column || !targetRowExists) return state;

  const plan = clonePlan(state.plan);
  const fromRow = plan.trailers[from.t].rows[from.r];
  const [moved] = fromRow.columns.splice(from.c, 1);
  if (!moved) return state;
  // When from and to name the same row, toRow IS fromRow (same object) — the splice above already
  // applied, so clamping against its now-shorter length is correct with no special-casing needed.
  const toRow = plan.trailers[to.t].rows[to.r];
  const slot = Math.max(0, Math.min(to.slot, toRow.columns.length));
  toRow.columns.splice(slot, 0, moved);

  recomputePlan(plan, state.dims, state.options);
  return { ...state, plan, history: withHistory(state) };
}

/** Pulls a column off a trailer into the holding area. The row it leaves behind is NOT removed
 * from the trailer even if it becomes empty — it stays as a zero-column placeholder until
 * compactLoad (or apply) removes it. */
export function pullToHolding(state: EditorState, from: ColumnRef): EditorState {
  const column = getColumn(state.plan, from);
  if (!column) return state;

  const plan = clonePlan(state.plan);
  const fromRow = plan.trailers[from.t].rows[from.r];
  const [pulled] = fromRow.columns.splice(from.c, 1);
  if (!pulled) return state;
  recomputePlan(plan, state.dims, state.options);

  return { ...state, plan, holding: [...state.holding, pulled], history: withHistory(state) };
}

/** Places a held column back onto a trailer. */
export function placeFromHolding(state: EditorState, holdingIndex: number, to: DropTarget): EditorState {
  const column = state.holding[holdingIndex];
  const targetRowExists = state.plan.trailers[to.t]?.rows[to.r];
  if (!column || !targetRowExists) return state;

  const plan = clonePlan(state.plan);
  const toRow = plan.trailers[to.t].rows[to.r];
  const slot = Math.max(0, Math.min(to.slot, toRow.columns.length));
  toRow.columns.splice(slot, 0, cloneColumn(column));
  recomputePlan(plan, state.dims, state.options);

  const holding = state.holding.filter((_, i) => i !== holdingIndex);
  return { ...state, plan, holding, history: withHistory(state) };
}

/** Closes gaps left by emptied rows, front-to-back, WITHOUT reordering columns within a row or
 * resorting rows — a planner who deliberately moved a thin row to the rear keeps it there. Returns
 * the exact same `state` reference (not a new object) when there is nothing to compact, so the
 * caller can detect a no-op via `===` and show "Load already compact — nothing to shift." */
export function compactLoad(state: EditorState): EditorState {
  let changed = false;
  const plan = clonePlan(state.plan);
  for (const trailer of plan.trailers) {
    const before = trailer.rows.length;
    trailer.rows = trailer.rows.filter((r) => r.columns.length > 0);
    if (trailer.rows.length !== before) changed = true;
  }
  if (!changed) return state;

  recomputePlan(plan, state.dims, state.options);
  return { ...state, plan, history: withHistory(state) };
}

/** Live drag-feedback predictor — does not mutate state. If `column` is already in the target row,
 * its own current width is excluded from the "before" sum (a same-row reorder nets zero width
 * change).
 *
 * Depth/length side (lb-ui-03 Part C, fixing a carry-over defect from lb-ui-02: this function used
 * to check width only). Pass `from` when the column being dropped is already on a trailer — a deep
 * column dropped into a shallow row raises that row's rowLength, which can overflow the trailer at
 * the nose, on a row downstream of the drop; findOverflowingRows already does this analysis but only
 * after the fact. The prediction is NOT "target row grows by colLength": the source row's rowLength
 * can shrink when the column leaves it (if it was that row's deepest), partially or fully offsetting
 * the target's growth, and for a cross-trailer move the shrink lands on a different trailer's total
 * entirely. Rather than hand-roll that arithmetic a second time, this simulates the move through the
 * exact same recompute path moveColumn already uses and reads the result — the same defence-in-depth
 * relationship canDrop already has with row-width via findOverflowingRows below.
 * `from` is omitted for a holding→trailer placement, where there is no source row to shrink; the
 * depth risk there (a held column dropped into a shallow row can still overflow downstream) is not
 * covered by this pass — see the CHANGELOG entry for lb-ui-03. */
export function canDrop(state: EditorState, column: PackColumn, to: { t: number; r: number }, from?: ColumnRef): DropFeedback {
  const widthLimit = state.dims.width;
  const row = state.plan.trailers[to.t]?.rows[to.r];
  if (!row) {
    return { ok: false, reason: "no such row", widthAfter: 0, widthLimit, lengthOk: true };
  }
  const existingWidth = row.columns.reduce((s, c) => s + (c === column ? 0 : c.colWidth), 0);
  const widthAfter = existingWidth + column.colWidth;
  const widthOk = widthAfter <= widthLimit + EPS;

  let lengthOk = true;
  let lengthReason = "";
  if (from) {
    const slot = row.columns.length;
    const simulated = moveColumn(state, from, { t: to.t, r: to.r, slot });
    const overflow = findOverflowingRows(simulated).find((o) => o.trailerIndex === to.t || o.trailerIndex === from.t);
    if (overflow) {
      lengthOk = false;
      const overflowTotal = state.dims.length + overflow.overflowBy;
      lengthReason = `too deep · pushes trailer ${overflow.trailerIndex + 1} to ${fmtInches(overflowTotal)}"`;
    }
  }

  const ok = widthOk && lengthOk;
  const reason = !widthOk
    ? lengthOk
      ? `too wide · would be ${fmtInches(widthAfter)}"`
      : `too wide · would be ${fmtInches(widthAfter)}" — and ${lengthReason}`
    : !lengthOk
      ? lengthReason
      : `fits · ${fmtInches(widthAfter)}" of ${fmtInches(widthLimit)}"`;

  return { ok, reason, widthAfter, widthLimit, lengthOk };
}

/** validatePlan()'s own `conservation` rule only knows trailers + plan.balance — it would
 * spuriously fire the instant a column sits in holding. This builds a plan whose balance is
 * plan.balance merged with holding (by SKU) for that one call, without mutating state.plan.balance. */
/** The plan as it will look after Apply: holding folded into balance — a column left in holding
 * becomes unplaced demand, not a piece that silently vanishes — without ever mutating
 * state.plan.balance itself. This is the single source of truth for "what Apply commits"; both
 * validateForApply (the gate) and CustomizeEditor's Apply button (the commit) use it, so the UI
 * never reimplements the merge. */
export function planForApply(state: EditorState): PackPlan {
  const merged: PackBalance = state.plan.balance.map((b) => ({ ...b }));
  for (const column of state.holding) {
    for (const layer of column.layers) {
      const existing = merged.find((b) => b.skuId === layer.skuId);
      if (existing) existing.remaining += layer.count;
      else merged.push({ skuId: layer.skuId, remaining: layer.count });
    }
  }
  return { ...state.plan, balance: merged };
}

export function validateForApply(state: EditorState): PackViolation[] {
  const plan = planForApply(state);
  return validatePlan(plan, state.dims, state.cart, state.skus, state.options);
}

/** First row (per trailer) whose cumulative rowLength pushes past dims.length — the row where the
 * overflow becomes visible, not just the summed total validatePlan's own detail string reports. */
export function findOverflowingRows(state: EditorState): RowOverflow[] {
  const overflows: RowOverflow[] = [];
  state.plan.trailers.forEach((trailer, trailerIndex) => {
    let running = 0;
    for (let rowIndex = 0; rowIndex < trailer.rows.length; rowIndex++) {
      running += trailer.rows[rowIndex].rowLength;
      if (running > state.dims.length + EPS) {
        overflows.push({ trailerIndex, rowIndex, overflowBy: running - state.dims.length });
        break;
      }
    }
  });
  return overflows;
}

/** Classifies validateForApply()'s violations into the guard profile Part B specifies: row-width +
 * trailer-length BLOCK apply; a non-empty holding area is ADVISORY only; column-height should be
 * unreachable through normal editing (a move can't change a column's height) — if it fires
 * anyway, treat it as a bug, not a planner-facing guard, and block apply defensively. */
export function evaluateGuards(state: EditorState): EditorGuardState {
  const violations = validateForApply(state);
  const blocking = violations.filter((v) => v.rule === "row-width" || v.rule === "trailer-length");
  const bug = violations.filter((v) => v.rule === "column-height");
  const otherViolations = violations.filter(
    (v) => v.rule !== "row-width" && v.rule !== "trailer-length" && v.rule !== "column-height"
  );
  return {
    blocking,
    bug,
    otherViolations,
    holdingCount: state.holding.length,
    overflowingRows: findOverflowingRows(state),
    canApply: blocking.length === 0 && bug.length === 0 && otherViolations.length === 0,
  };
}

// --- lb-ui-07: manual/custom load building — a new operation family, additive alongside the
// operations above. Every existing operation redistributes pieces already placed by pack(); these
// four CREATE placement pack() never chose to make, drawing on previously-unplaced demand
// (state.plan.balance) via adjustBalance() below — see this file's header comment. ---

/** Moves `delta` units of a SKU between "placed" and "unplaced" in plan.balance (in place on the
 * given array reference's shape, but always returns a new array — caller assigns it to a cloned
 * plan). Positive delta = pieces returning to balance (a count decrease); negative delta = pieces
 * leaving balance to become newly placed (a count increase). Clamps at zero rather than going
 * negative: over-adding beyond what's actually remaining surfaces as a real `conservation`
 * violation at Apply time (see validateForApply), not a nonsensical negative "remaining" figure —
 * the same "operation doesn't pre-validate, validateForApply catches it" contract row-width and
 * max-skus-per-column already rely on for moveColumn/addLayer. */
function adjustBalance(balance: PackBalance, skuId: string, delta: number): PackBalance {
  const next = balance.map((b) => ({ ...b }));
  const entry = next.find((b) => b.skuId === skuId);
  if (entry) {
    entry.remaining = Math.max(0, entry.remaining + delta);
  } else if (delta > 0) {
    next.push({ skuId, remaining: delta });
  }
  // Match pack()'s own convention (packEngine.ts's balance construction filters qty > 0) — a
  // zero-remaining entry would otherwise leak into LoadPlanView's "Carried to next trailer" panel,
  // which renders plan.balance directly, as a spurious "0 x SKU" row.
  return next.filter((b) => b.remaining > 0);
}

/** Builds a brand-new single-SKU, single-layer column from scratch, always in the SKU's identity
 * ("flat") orientation — skuOrientations(sku, options)[0] is guaranteed to be that orientation
 * regardless of rotation policy (allPermutations lists identity first; the no-rotation branch
 * returns exactly identity). This matches legacy's own manual-add behavior exactly: a manually
 * added row/column always uses the SKU's native L/W/H, never an auto-chosen rotation
 * (load-builder.html:2559-2569 — colWidth/unitHeight always read straight off the SKU, no
 * orientation search). posY is a placeholder; recomputeRow (invoked via recomputePlan below) sets
 * it for real, the same as every other operation in this file. */
function buildColumn(sku: PackSku, count: number, options: PackOptions): PackColumn {
  const orientation = skuOrientations(sku, options)[0];
  const layer: PackLayer = {
    skuId: sku.id,
    skuName: sku.name,
    skuCode: sku.sku,
    color: colorForSkuId(sku.id),
    unitHeight: orientation.height,
    count,
    orientation,
  };
  return {
    posY: 0,
    colWidth: orientation.width,
    colLength: orientation.length,
    totalHeight: orientation.height * count,
    totalWeight: sku.weight * count,
    stackCount: count,
    layers: [layer],
    mixed: false,
    rationale: `Manually added — ${count} × ${fmtInches(orientation.height)}" = ${fmtInches(orientation.height * count)}"`,
  };
}

/** Derives a column's rationale from its ORIGINAL text (the part before the first manually-added
 * layer) plus a description of every layer beyond index 0 — regenerated fresh on every addLayer /
 * setLayerCount call rather than appended to. Appending would grow the string without bound across
 * repeated edits and never shrink back when a layer is removed; deriving it fresh from the current
 * layers list is O(layer count), and reverting to zero extra layers reverts the text exactly, which
 * is what loadEditor.selfcheck.ts #18's "round-trips to the pre-addLayer state" actually needs. */
const MANUAL_LAYERS_MARKER = " + manually added:";
function baseRationale(column: PackColumn): string {
  const idx = column.rationale.indexOf(MANUAL_LAYERS_MARKER);
  return idx >= 0 ? column.rationale.slice(0, idx) : column.rationale;
}
function describeManualLayers(column: PackColumn): string {
  const extras = column.layers.slice(1);
  const base = baseRationale(column);
  if (extras.length === 0) return base;
  const parts = extras.map((l) => `${l.count} × ${fmtInches(l.unitHeight)}" (${l.skuName})`);
  return `${base}${MANUAL_LAYERS_MARKER} ${parts.join(", ")}`;
}

/** Appends a brand-new row (one new column, one SKU) to the end of an existing trailer's rows —
 * matching legacy's own "+ ADD ROW" (always appended, never inserted mid-stack). No-op (returns
 * `state` unchanged) if the trailer doesn't exist, the SKU isn't in state.skus, or count <= 0 — the
 * same defensive-no-op contract every existing operation in this file already follows. Does not
 * pre-validate width/length/height/balance sufficiency; validateForApply is the sole gate, same
 * contract moveColumn already has for row-width. */
export function addRow(state: EditorState, trailerIndex: number, skuId: string, count: number): EditorState {
  const sku = state.skus.find((s) => s.id === skuId);
  const trailer = state.plan.trailers[trailerIndex];
  if (!sku || !trailer || count <= 0) return state;

  const plan = clonePlan(state.plan);
  const column = buildColumn(sku, count, state.options);
  const row: PackRow = { posFromFront: 0, rowLength: 0, rowWidthUsed: 0, wastedFloorArea: 0, columns: [column], totalUnits: 0, totalWeight: 0 };
  plan.trailers[trailerIndex].rows.push(row);
  plan.balance = adjustBalance(plan.balance, skuId, -count);

  recomputePlan(plan, state.dims, state.options);
  return { ...state, plan, history: withHistory(state) };
}

/** Appends a brand-new column (one SKU) to the end of an existing row — matching legacy's own
 * "+ COL" (always appended within the row). Same no-pre-validate contract as addRow: a column wide
 * enough to overflow row-width, or deep enough to overflow trailer-length via the row's recomputed
 * rowLength, still gets created; validateForApply flags it afterward, same as a forced moveColumn. */
export function addColumn(state: EditorState, trailerIndex: number, rowIndex: number, skuId: string, count: number): EditorState {
  const sku = state.skus.find((s) => s.id === skuId);
  const row = state.plan.trailers[trailerIndex]?.rows[rowIndex];
  if (!sku || !row || count <= 0) return state;

  const plan = clonePlan(state.plan);
  const column = buildColumn(sku, count, state.options);
  plan.trailers[trailerIndex].rows[rowIndex].columns.push(column);
  plan.balance = adjustBalance(plan.balance, skuId, -count);

  recomputePlan(plan, state.dims, state.options);
  return { ...state, plan, history: withHistory(state) };
}

/** Adds a new layer to an EXISTING column — matching legacy's own "+ LAYER". Unlike a brand-new
 * column, an added layer must share the column's already-fixed footprint (colLength/colWidth):
 * validatePlan's `piece-fits-trailer` rule requires layer.orientation to match column geometry
 * exactly. Searches the SKU's legal orientations for one matching this column's footprint; if none
 * exists (an SKU that simply can't sit on this footprint in any legal orientation), falls back to
 * the SKU's identity orientation rather than refusing the add — same no-pre-validate contract as
 * addRow/addColumn/moveColumn. The mismatch then surfaces as a real `piece-fits-trailer` (and/or
 * `sku-unplaceable`) violation at Apply time, not a blocked operation and not a silent no-op. */
export function addLayer(state: EditorState, ref: ColumnRef, skuId: string, count: number): EditorState {
  const sku = state.skus.find((s) => s.id === skuId);
  const existingColumn = getColumn(state.plan, ref);
  if (!sku || !existingColumn || count <= 0) return state;

  const plan = clonePlan(state.plan);
  const column = getColumn(plan, ref)!;
  const orientations = skuOrientations(sku, state.options);
  const matched = orientations.find((o) => approxEq(o.length, column.colLength) && approxEq(o.width, column.colWidth));
  const orientation = matched ?? orientations[0];
  const layer: PackLayer = {
    skuId: sku.id,
    skuName: sku.name,
    skuCode: sku.sku,
    color: colorForSkuId(sku.id),
    unitHeight: orientation.height,
    count,
    orientation,
  };
  column.layers.push(layer);
  column.totalHeight += orientation.height * count;
  column.totalWeight += sku.weight * count;
  column.stackCount += count;
  column.mixed = new Set(column.layers.map((l) => l.skuId)).size > 1;
  column.rationale = describeManualLayers(column);
  plan.balance = adjustBalance(plan.balance, skuId, -count);

  recomputePlan(plan, state.dims, state.options);
  return { ...state, plan, history: withHistory(state) };
}

/** Sets a layer's count directly (legacy's own free-typed count field, load-builder.html:2462) —
 * also the removal path: count <= 0 drops the layer entirely (legacy's separate "×" button is the
 * same operation at count 0, unified here rather than two code paths for one outcome). If removing
 * the layer empties the column, the column itself is dropped from its row — an empty column has no
 * footprint left to render or validate, the same fate `compactLoad` gives an emptied row. Adjusts
 * plan.balance by exactly the count delta in either direction (see adjustBalance's own doc
 * comment) — a decrease genuinely returns pieces to unplaced demand, an increase draws on it. */
export function setLayerCount(state: EditorState, ref: ColumnRef, layerIndex: number, count: number): EditorState {
  const existingColumn = getColumn(state.plan, ref);
  const existingLayer = existingColumn?.layers[layerIndex];
  if (!existingColumn || !existingLayer) return state;
  const priorCount = existingLayer.count;
  const nextCount = Math.max(0, Math.floor(count));
  const delta = nextCount - priorCount;
  if (delta === 0) return state;

  const plan = clonePlan(state.plan);
  const column = getColumn(plan, ref)!;
  if (nextCount === 0) {
    column.layers.splice(layerIndex, 1);
  } else {
    column.layers[layerIndex].count = nextCount;
  }
  column.totalHeight = column.layers.reduce((s, l) => s + l.unitHeight * l.count, 0);
  column.totalWeight = column.layers.reduce((s, l) => {
    const sku = state.skus.find((x) => x.id === l.skuId);
    return s + (sku ? sku.weight * l.count : 0);
  }, 0);
  column.stackCount = column.layers.reduce((s, l) => s + l.count, 0);
  column.mixed = new Set(column.layers.map((l) => l.skuId)).size > 1;
  if (column.layers.length > 0) column.rationale = describeManualLayers(column);
  plan.balance = adjustBalance(plan.balance, existingLayer.skuId, -delta);

  if (column.layers.length === 0) {
    const row = plan.trailers[ref.t].rows[ref.r];
    const idx = row.columns.indexOf(column);
    if (idx >= 0) row.columns.splice(idx, 1);
  }

  recomputePlan(plan, state.dims, state.options);
  return { ...state, plan, history: withHistory(state) };
}

/** Removes a row entirely — its columns move to holding first (lb-ui-02's "nothing vanishes
 * silently" pattern, same as pullToHolding), never hard-deleted. Purely relocation, like
 * pullToHolding/moveColumn: does not touch plan.balance, since total placed-or-held count is
 * unchanged, only where it sits. Legacy's own "DEL ROW" hard-deletes with no such safety net
 * (load-builder.html:2403-2406) — this is a deliberate improvement, not a like-for-like port,
 * consistent with lb-ui-02's own CHANGELOG precedent for the same divergence on column delete. */
export function removeRow(state: EditorState, trailerIndex: number, rowIndex: number): EditorState {
  const row = state.plan.trailers[trailerIndex]?.rows[rowIndex];
  if (!row) return state;

  const plan = clonePlan(state.plan);
  const removedRow = plan.trailers[trailerIndex].rows[rowIndex];
  const movedToHolding = removedRow.columns.map(cloneColumn);
  plan.trailers[trailerIndex].rows.splice(rowIndex, 1);

  recomputePlan(plan, state.dims, state.options);
  return { ...state, plan, holding: [...state.holding, ...movedToHolding], history: withHistory(state) };
}
