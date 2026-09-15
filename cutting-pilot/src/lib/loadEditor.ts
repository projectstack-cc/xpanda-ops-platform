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
// placed at all (state.plan.balance) must sum to cart qty, at every step. state.plan.balance is
// NEVER touched by these operations — it is the original pack() leftover, untouched by editing.
// validatePlan()'s own `conservation` rule only knows about trailers + plan.balance, so it would
// spuriously fire the moment a column sits in holding; validateForApply() below builds a MERGED
// balance (plan.balance + holding, by SKU) for that one call only, without mutating
// state.plan.balance itself.
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
  Dimensions,
  PackOptions,
  CartLine,
  PackSku,
  PackBalance,
  PackViolation,
} from "./packEngine";
import { validatePlan } from "./packEngine";

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

// --- cloning (deep enough that no mutation below ever leaks back into the caller's plan) ---

function cloneColumn(column: PackColumn): PackColumn {
  return { ...column, layers: column.layers.map((l) => ({ ...l, orientation: { ...l.orientation } })) };
}

function cloneRow(row: PackRow): PackRow {
  return { ...row, columns: row.columns.map(cloneColumn) };
}

function cloneTrailer(trailer: PackTrailer): PackTrailer {
  return { ...trailer, rows: trailer.rows.map(cloneRow) };
}

function clonePlan(plan: PackPlan): PackPlan {
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

function recomputePlan(plan: PackPlan, dims: Dimensions, options: PackOptions): void {
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

function withHistory(state: EditorState): EditorState[] {
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

/** Pure width-fit predictor for live drag feedback — does not mutate state. If `column` is already
 * in the target row, its own current width is excluded from the "before" sum (a same-row reorder
 * nets zero width change). */
export function canDrop(state: EditorState, column: PackColumn, to: { t: number; r: number }): DropFeedback {
  const widthLimit = state.dims.width;
  const row = state.plan.trailers[to.t]?.rows[to.r];
  if (!row) {
    return { ok: false, reason: "no such row", widthAfter: 0, widthLimit };
  }
  const existingWidth = row.columns.reduce((s, c) => s + (c === column ? 0 : c.colWidth), 0);
  const widthAfter = existingWidth + column.colWidth;
  const ok = widthAfter <= widthLimit + EPS;
  const reason = ok
    ? `fits · ${fmtInches(widthAfter)}" of ${fmtInches(widthLimit)}"`
    : `too wide · would be ${fmtInches(widthAfter)}"`;
  return { ok, reason, widthAfter, widthLimit };
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
