// src/lib/loadEditor.ts
// lb-ui-02: pure, headless edit operations for the v2 load builder's customize editor. No React,
// no DOM — CustomizeEditor.tsx calls these and re-renders from the returned EditorState.
//
// lb-ui-02's move unit was a whole column. lbr-07 adds pieces off the TOP layer (PieceSource
// "top"/"holdingTop" — the way the floor unstacks), stacking onto an existing stack (stackOnto) and
// swaps; a layer is still never pulled out from under another one.
//
// EditorState extends the prompt's stated 3-field shape (plan/holding/history) with dims/options/
// cart/skus. This is a necessary, not cosmetic, extension: pack() still takes dims as a separate
// argument (it has no plan yet to read one from) — and validatePlan (the apply gate) additionally
// needs cart+skus+options. Carrying them in EditorState means every operation's signature matches
// the prompt's pseudocode exactly (state + move descriptors, nothing else) instead of threading
// four extra parameters through every call.
//
// state.dims (lb-ui-12): the dims for a trailer that does NOT YET EXIST — i.e. the type new
// overflow trailers are created as. Once a trailer exists, every operation scoped to it (addRow/
// addColumn/addLayer/setLayerCount, overflow checks, recompute, validate) reads that trailer's OWN
// state.plan.trailers[i].dims instead, never state.dims — a trailer auto-downsized to a smaller
// type (packEngine.ts's pack({ autoDownsize: true })) carries different dims than state.dims, and
// using state.dims for it would validate/constrain it against the wrong physical envelope. Do not
// collapse these two back into one field: they answer different questions ("what type should the
// NEXT trailer be" vs "what type IS this existing trailer").
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
import { validatePlan, skuOrientations, HOLEY_BOARD_CATEGORY, holeyEdgeSlot, HOLEY_EDGE_LABEL } from "./packEngine";
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
  // lb-ui-11: the SKU ids known to the session at createEditorState() time (the pulled job's own
  // SKUs, or a fixture's). Immutable for the life of the session — never added to or removed from
  // after creation, regardless of what state.skus grows to. addRow/addColumn/addLayer use this (not
  // state.cart's current contents) to decide whether a placed SKU is job-known demand (draw down
  // plan.balance, existing behavior) or a parts-library SKU introduced mid-session (grow state.cart
  // instead — see growCartForSku's own comment). A Set, not derived from state.cart, because
  // state.cart itself grows for library SKUs; checking cart membership would only correctly answer
  // "have we added this library SKU before," not "was this part of the original job."
  originalSkuIds: Set<string>;
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
  recomputePlan(plan, state.options);
  return { ...state, plan };
}

export function createEditorState(
  plan: PackPlan,
  dims: Dimensions,
  options: PackOptions,
  cart: CartLine[],
  skus: PackSku[]
): EditorState {
  return { plan: clonePlan(plan), dims, options, cart, skus, holding: [], history: [], originalSkuIds: new Set(skus.map((s) => s.id)) };
}

// --- derived-geometry recompute ---

function recomputeRow(row: PackRow): void {
  let posY = 0;
  for (const column of row.columns) {
    // lb-box-03: an on-edge column keeps its wall-slot position (never slides left into flat floor).
    column.posY = column.onEdge ? Math.max(posY, column.posY) : posY;
    posY = column.posY + column.colWidth;
  }
  row.rowWidthUsed = row.columns.reduce((s, c) => s + c.colWidth, 0);
  row.rowLength = row.columns.length > 0 ? Math.max(...row.columns.map((c) => c.colLength)) : 0;
  row.wastedFloorArea = row.columns.reduce((s, c) => s + (row.rowLength - c.colLength) * c.colWidth, 0);
  row.totalUnits = row.columns.reduce((s, c) => s + c.stackCount, 0);
  row.totalWeight = row.columns.reduce((s, c) => s + c.totalWeight, 0);
}

function recomputeTrailer(trailer: PackTrailer, options: PackOptions): void {
  const dims = trailer.dims;
  const effectiveHeight = dims.height - (options.runnerHeight ?? 0);
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

// lb-ui-12: dropped the plan-wide `dims` param — each trailer recomputes against its OWN
// trailer.dims (see recomputeTrailer), so a trailer auto-downsized to a smaller type stays
// consistent with its actual envelope instead of the plan's primary trailer type.
export function recomputePlan(plan: PackPlan, options: PackOptions): void {
  for (const trailer of plan.trailers) recomputeTrailer(trailer, options);
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
    originalSkuIds: state.originalSkuIds,
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
    cart: prior.cart,
    skus: prior.skus,
    holding: prior.holding.map(cloneColumn),
    history: state.history.slice(0, -1),
    originalSkuIds: state.originalSkuIds,
  };
}

// --- lookups ---

function getColumn(plan: PackPlan, ref: ColumnRef): PackColumn | null {
  return plan.trailers[ref.t]?.rows[ref.r]?.columns[ref.c] ?? null;
}

function rowHasEdge(row: PackRow | undefined): boolean {
  return !!row && row.columns.some((c) => c.onEdge);
}

// --- lb-edge-01 (Steve, 2026-10-26): on-edge holey boards are editable in Customize (lb-box-03 had
// locked them). They move, hold, swap (with other on-edge stacks), change count and go to holding
// with their row like flat stacks, but only ever land in a wall slot, and never stack. Lay flat /
// Stand on edge convert between the two. validatePlan's edge-slot rule stays the authority; every op
// here leaves a plan that passes it. ---

export const EDGE_NO_STACK_REASON = "on-edge boards don't stack";
export const EDGE_SLOT_ONLY_REASON = "on-edge boards only go in the wall slot";
export const EDGE_NO_SLOT_REASON = "this trailer has no wall slot";
export const EDGE_SWAP_REASON = "on-edge boards only swap with on-edge boards";
export const STAND_NOT_PLAIN_REASON = "only plain holey board stacks can stand on edge";
export const STAND_NO_ROOM_REASON = "no wall slot has room";

/** A whole stack, on a trailer or held — the sources Lay flat / Stand on edge take. */
export type WholeStackSource = { kind: "column"; ref: ColumnRef } | { kind: "holding"; index: number };

function skuOfColumn(state: EditorState, column: PackColumn): PackSku | undefined {
  const skuId = column.layers[0]?.skuId;
  return skuId ? state.skus.find((s) => s.id === skuId) : undefined;
}

/** Boards an on-edge column of this SKU can hold on a trailer: floor(effectiveHeight / board width). */
function edgeTiers(state: EditorState, dims: Dimensions, sku: PackSku): number {
  return sku.width > 0 ? Math.floor((effectiveHeightOf(state, dims) + EPS) / sku.width) : 0;
}

/** The dims a held on-edge stack is measured against: the first slot trailer's, else state.dims. */
function edgeDimsForHolding(state: EditorState): Dimensions {
  return state.plan.trailers.find((t) => t.dims.holeyEdgeSlot)?.dims ?? state.dims;
}

/** Most boards one on-edge stack of this column's SKU can hold (for the UI's count stepper). */
export function edgeTierCap(state: EditorState, source: WholeStackSource): number {
  const column = source.kind === "column" ? getColumn(state.plan, source.ref) : state.holding[source.index];
  const sku = column ? skuOfColumn(state, column) : undefined;
  if (!column || !sku) return 0;
  return edgeTiers(state, source.kind === "column" ? state.plan.trailers[source.ref.t].dims : edgeDimsForHolding(state), sku);
}

/** One row's wall slot for boards `skuWidth` wide (24″ holey): where it starts (past the flat
 * columns, never before holeyEdgeSlot's flatWidth) and the width left after its on-edge columns.
 * `exclude` leaves one column out (a stack moving within its own row). */
function wallSlotRoom(row: PackRow, dims: Dimensions, skuWidth: number, exclude?: PackColumn | null): { start: number; free: number } {
  const flatSum = row.columns.filter((c) => !c.onEdge && c !== exclude).reduce((s, c) => s + c.colWidth, 0);
  const start = Math.max(holeyEdgeSlot(dims, skuWidth).flatWidth, flatSum);
  const edgeSum = row.columns.filter((c) => c.onEdge && c !== exclude).reduce((s, c) => s + c.colWidth, 0);
  return { start, free: dims.width - start - edgeSum };
}

/** Lays a row's on-edge columns side by side from its wall slot's start, in array order. */
function packWallSlot(row: PackRow, dims: Dimensions, skuWidth: number): void {
  let posY = wallSlotRoom(row, dims, skuWidth).start;
  for (const column of row.columns) {
    if (!column.onEdge) continue;
    column.posY = posY;
    posY += column.colWidth;
  }
}

/** True when every on-edge column in the row ends inside the trailer width. */
function wallSlotFits(row: PackRow, dims: Dimensions): boolean {
  return row.columns.every((c) => !c.onEdge || c.posY + c.colWidth <= dims.width + EPS);
}

/** Free wall-slot width (inches) in row `r` of trailer `t` for `source`'s pieces (an on-edge stack,
 * or a holey stack about to stand), leaving out the source column when it already sits in that row.
 * null when the trailer has no slot or the row doesn't exist. The UI uses it to decide which slots
 * get a button. */
export function edgeSlotFree(state: EditorState, source: PieceSource, t: number, r: number): number | null {
  const trailer = state.plan.trailers[t];
  const row = trailer?.rows[r];
  const pieces = piecesFor(state, source);
  if (!trailer || !row || !pieces || !trailer.dims.holeyEdgeSlot) return null;
  const sku = skuOfColumn(state, pieces);
  if (!sku) return null;
  const own = source.kind === "column" ? getColumn(state.plan, source.ref) : null;
  return wallSlotRoom(row, trailer.dims, sku.width, own).free;
}

// --- operations ---

/** Moves a column from one row (possibly the same row, for reordering) to another. lbr-07: a thin
 * wrapper over moveToSlot, kept so existing callers and selfchecks keep working. */
export function moveColumn(state: EditorState, from: ColumnRef, to: DropTarget): EditorState {
  if (!getColumn(state.plan, from) || !state.plan.trailers[to.t]?.rows[to.r]) return state;
  return moveToSlot(state, { kind: "column", ref: from }, to);
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
  recomputePlan(plan, state.options);

  return { ...state, plan, holding: [...state.holding, pulled], history: withHistory(state) };
}

/** Places a held column back onto a trailer. lbr-07: a thin wrapper over moveToSlot. */
export function placeFromHolding(state: EditorState, holdingIndex: number, to: DropTarget): EditorState {
  if (!state.holding[holdingIndex] || !state.plan.trailers[to.t]?.rows[to.r]) return state;
  return moveToSlot(state, { kind: "holding", index: holdingIndex }, to);
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

  recomputePlan(plan, state.options);
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
  const targetTrailer = state.plan.trailers[to.t];
  const widthLimit = (targetTrailer ?? { dims: state.dims }).dims.width;
  const row = targetTrailer?.rows[to.r];
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
      const overflowTrailerDims = simulated.plan.trailers[overflow.trailerIndex]?.dims ?? state.dims;
      const overflowTotal = overflowTrailerDims.length + overflow.overflowBy;
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

/** lb-trailer-01: a trailer with no rows, or whose rows all have zero columns, holds nothing. */
export function isEmptyTrailer(trailer: PackTrailer): boolean {
  return trailer.rows.every((row) => row.columns.length === 0);
}

/** lb-trailer-01: the plan without its empty trailers (Customize Apply, saved-load restore).
 * `removed` = the original indices dropped, ascending. Balance is untouched — an empty trailer holds
 * no pieces — and only the plan rollups are re-summed (each kept trailer's own geometry is
 * unchanged, so no per-trailer recompute — and no PackOptions — is needed). */
export function dropEmptyTrailers(plan: PackPlan): { plan: PackPlan; removed: number[] } {
  const next = clonePlan(plan);
  const removed: number[] = [];
  next.trailers = next.trailers.filter((trailer, i) => {
    if (!isEmptyTrailer(trailer)) return true;
    removed.push(i);
    return false;
  });
  next.totalWeight = next.trailers.reduce((s, t) => s + t.usedWeight, 0);
  next.totalUnits = next.trailers.reduce((s, t) => s + t.totalUnits, 0);
  next.totalStacks = next.trailers.reduce((s, t) => s + t.totalStacks, 0);
  next.mixedStacks = next.trailers.reduce((s, t) => s + t.mixedStacks, 0);
  return { plan: next, removed };
}

/** lb-topoff-01: validatePlan rules a person customizing may knowingly break. The 3″ top-off rule
 * (topOffMinInchesPerPiece, K) is an auto-pack rule — a supervisor stacking thin pieces on top is
 * choosing to allow it. validatePlan itself (and the auto-packer, and dissolve) still enforce K. */
export const CUSTOMIZE_EXEMPT_RULES: ReadonlySet<string> = new Set(["topoff-threshold"]);

export function validateForApply(state: EditorState): PackViolation[] {
  const plan = planForApply(state);
  return validatePlan(plan, state.cart, state.skus, state.options).filter(
    (v) => !CUSTOMIZE_EXEMPT_RULES.has(v.rule)
  );
}

/** First row (per trailer) whose cumulative rowLength pushes past that trailer's OWN dims.length
 * (lb-ui-12: not state.dims — a downsized trailer overflows against its own, smaller envelope) —
 * the row where the overflow becomes visible, not just the summed total validatePlan's own detail
 * string reports. */
export function findOverflowingRows(state: EditorState): RowOverflow[] {
  const overflows: RowOverflow[] = [];
  state.plan.trailers.forEach((trailer, trailerIndex) => {
    let running = 0;
    for (let rowIndex = 0; rowIndex < trailer.rows.length; rowIndex++) {
      running += trailer.rows[rowIndex].rowLength;
      if (running > trailer.dims.length + EPS) {
        overflows.push({ trailerIndex, rowIndex, overflowBy: running - trailer.dims.length });
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

/** lb-ui-11: grows (or creates) a CartLine's qty by `amount` — the counterpart to adjustBalance for
 * a SKU that ISN'T job-known demand (see EditorState.originalSkuIds's own comment). */
function growCartForSku(cart: CartLine[], skuId: string, amount: number): CartLine[] {
  const next = cart.map((c) => ({ ...c }));
  const entry = next.find((c) => c.skuId === skuId);
  if (entry) entry.qty += amount;
  else next.push({ skuId, qty: amount });
  return next;
}

/** Returns the cart addRow/addColumn/addLayer should attach to their returned state: unchanged for
 * a job-known SKU (originalSkuIds — existing balance-draw behavior, including the intentional
 * over-add-surfaces-a-violation case). For a parts-library SKU, grows cart by only the SHORTFALL
 * beyond what plan.balance can already cover, not by the full `count` — a library SKU that's had
 * some of its placed units later returned via setLayerCount (which, via adjustBalance's own
 * existing fallback, synthesizes a `remaining` balance entry for it — see setLayerCount's doc
 * comment) should draw that returned balance down first, exactly like a normal job SKU, and only
 * grow cart for the genuinely-new amount beyond it. validatePlan's `conservation` rule requires
 * placed + remaining == cartQty; growing by the full count every time would double-count units that
 * setLayerCount had already returned to balance. */
function cartAfterPlacement(state: EditorState, skuId: string, count: number): CartLine[] {
  if (state.originalSkuIds.has(skuId)) return state.cart;
  const available = state.plan.balance.find((b) => b.skuId === skuId)?.remaining ?? 0;
  const shortfall = Math.max(0, count - available);
  return shortfall > 0 ? growCartForSku(state.cart, skuId, shortfall) : state.cart;
}

/** lb-ui-11: makes a parts-library SKU (see partsLibrary.ts / PartRecord, converted to a PackSku by
 * the caller) available to this session's addRow/addColumn/addLayer, which all look up `skuId`
 * against state.skus. Idempotent — a no-op (same state reference) if a SKU with this id is already
 * known, whether from the original job pull or a prior library add. Deliberately does NOT touch
 * state.cart or plan.balance itself: those are adjusted by addRow/addColumn/addLayer's own
 * cartAfterPlacement, at the moment a count is actually placed, not at introduction time — a SKU
 * introduced but never placed should add zero demand. */
export function introduceSku(state: EditorState, sku: PackSku): EditorState {
  if (state.skus.some((s) => s.id === sku.id)) return state;
  return { ...state, skus: [...state.skus, sku] };
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
  const cart = cartAfterPlacement(state, skuId, count);

  recomputePlan(plan, state.options);
  return { ...state, plan, cart, history: withHistory(state) };
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
  // lb-box-03: on-edge columns stay rightmost (the wall slot) — a new stack goes in before them.
  const targetCols = plan.trailers[trailerIndex].rows[rowIndex].columns;
  const firstEdge = targetCols.findIndex((c) => c.onEdge);
  if (firstEdge >= 0) targetCols.splice(firstEdge, 0, column);
  else targetCols.push(column);
  plan.balance = adjustBalance(plan.balance, skuId, -count);
  const cart = cartAfterPlacement(state, skuId, count);

  recomputePlan(plan, state.options);
  return { ...state, plan, cart, history: withHistory(state) };
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
  if (!sku || !existingColumn || count <= 0 || existingColumn.onEdge) return state;

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
  const cart = cartAfterPlacement(state, skuId, count);

  recomputePlan(plan, state.options);
  return { ...state, plan, cart, history: withHistory(state) };
}

/** lb-ui-11: addRow/addColumn/addLayer + introduceSku, composed so undo reverts BOTH in one step.
 * Calling introduceSku(state, sku) and then addRow(introduced, ...) separately (as two expressions)
 * would still work structurally, but addRow's own withHistory(introduced) snapshots the ALREADY-
 * introduced state as "prior" — introduceSku pushes no history entry of its own, so undo would only
 * revert the placement, leaving the library SKU permanently listed in state.skus with nothing placed
 * or demanded for it. These wrappers run the same two steps but overwrite the result's `history`
 * with withHistory(state) — a snapshot of the TRUE pre-introduction state — so one undo removes the
 * SKU from the session exactly as if the whole add had never happened. Each is a no-op (returns
 * `state` unchanged) if the underlying add operation itself declined (bad trailerIndex/count/etc,
 * the same defensive-no-op contract addRow/addColumn/addLayer already have) — nothing is left
 * introduced with no corresponding undo step. */
export function addRowFromLibrary(state: EditorState, trailerIndex: number, sku: PackSku, count: number): EditorState {
  const introduced = introduceSku(state, sku);
  const placed = addRow(introduced, trailerIndex, sku.id, count);
  if (placed === introduced) return state;
  return { ...placed, history: withHistory(state) };
}

export function addColumnFromLibrary(state: EditorState, trailerIndex: number, rowIndex: number, sku: PackSku, count: number): EditorState {
  const introduced = introduceSku(state, sku);
  const placed = addColumn(introduced, trailerIndex, rowIndex, sku.id, count);
  if (placed === introduced) return state;
  return { ...placed, history: withHistory(state) };
}

export function addLayerFromLibrary(state: EditorState, ref: ColumnRef, sku: PackSku, count: number): EditorState {
  const introduced = introduceSku(state, sku);
  const placed = addLayer(introduced, ref, sku.id, count);
  if (placed === introduced) return state;
  return { ...placed, history: withHistory(state) };
}

/** Sets a layer's count directly (legacy's own free-typed count field, load-builder.html:2462) —
 * also the removal path: count <= 0 drops the layer entirely (legacy's separate "×" button is the
 * same operation at count 0, unified here rather than two code paths for one outcome). If removing
 * the layer empties the column, the column itself is dropped from its row — an empty column has no
 * footprint left to render or validate, the same fate `compactLoad` gives an emptied row. Adjusts
 * plan.balance by exactly the count delta in either direction (see adjustBalance's own doc
 * comment) — a decrease genuinely returns pieces to unplaced demand, an increase draws on it.
 *
 * Deliberately does NOT touch state.cart, unlike addRow/addColumn/addLayer — this only ever
 * resizes a layer that one of those three already placed, it never introduces a SKU's first unit.
 * For a parts-library SKU (not in originalSkuIds), a decrease here relies on adjustBalance's own
 * existing "create an entry if none exists and delta > 0" fallback to synthesize a `remaining`
 * balance for the returned units — cartAfterPlacement's cart total was fixed at that SKU's
 * highest-ever-placed count, so the synthesized balance is exactly what keeps placed + remaining ==
 * cartQty true afterward, the same equation a real job SKU's balance satisfies. A later increase
 * draws it back down like any normal balance draw; only a fresh addRow/addColumn/addLayer call (not
 * a setLayerCount increase) can grow that SKU's cart total further. */
export function setLayerCount(state: EditorState, ref: ColumnRef, layerIndex: number, count: number): EditorState {
  const existingColumn = getColumn(state.plan, ref);
  const existingLayer = existingColumn?.layers[layerIndex];
  if (!existingColumn || !existingLayer) return state;
  const priorCount = existingLayer.count;
  let nextCount = Math.max(0, Math.floor(count));
  // lb-edge-01: an on-edge stack holds at most floor(effectiveHeight / 24) boards — clamp.
  if (existingColumn.onEdge) {
    const sku = skuOfColumn(state, existingColumn);
    if (sku) nextCount = Math.min(nextCount, edgeTiers(state, state.plan.trailers[ref.t].dims, sku));
  }
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

  recomputePlan(plan, state.options);
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
  if (!row) return state; // lb-edge-01: on-edge columns go to holding too, onEdge kept

  const plan = clonePlan(state.plan);
  const removedRow = plan.trailers[trailerIndex].rows[rowIndex];
  const movedToHolding = removedRow.columns.map(cloneColumn);
  plan.trailers[trailerIndex].rows.splice(rowIndex, 1);

  recomputePlan(plan, state.options);
  return { ...state, plan, holding: [...state.holding, ...movedToHolding], history: withHistory(state) };
}

// --- lbr-07: tap-to-place customize. Pieces move as a whole stack OR come off the TOP layer only
// (the way the floor actually unstacks), from a trailer stack or a held stack, and land either ON
// another stack (stackOnto) or as a NEW stack in a row slot (moveToSlot). Every op below is pure,
// returns a new EditorState with one history step, and is a no-op (same reference) on bad input —
// the same contract as the operations above. The evaluate* functions are the UI's per-target
// verdicts; stackOnto refuses whatever evaluateStackTarget says "no" to, mirroring validatePlan's
// own column-height / max-skus-per-column thresholds (never new ones). lb-topoff-01: the 3″
// topoff-threshold rule is NOT mirrored — it's auto-pack only (see CUSTOMIZE_EXEMPT_RULES). ---

export type PieceSource =
  | { kind: "column"; ref: ColumnRef } // the whole stack
  | { kind: "top"; ref: ColumnRef; count: number } // N pieces off the TOP layer only
  | { kind: "holding"; index: number } // a whole held stack
  | { kind: "holdingTop"; index: number; count: number }; // N pieces off a held stack's top layer

export interface TargetVerdict {
  level: "ok" | "warn" | "no";
  reason: string;
  heightAfter: number;
}

/** DropTarget.r value meaning "a brand-new row at the rear (doors) end of the trailer". trailer.rows
 * is rear-first (index 0 = the doors row — see TrailerDiagram's header), so the new row is inserted
 * at index 0, next to the free floor the diagram draws at the rear. */
export const NEW_ROW = -1;

const THICKER_ON_THINNER = "thicker pieces on thinner — usually loaded the other way";

function effectiveHeightOf(state: EditorState, dims: Dimensions): number {
  return dims.height - (state.options.runnerHeight ?? 0);
}

function fmtIn(n: number): string {
  return `${fmtInches(n)}″`;
}

function sameRef(a: ColumnRef, b: ColumnRef): boolean {
  return a.t === b.t && a.r === b.r && a.c === b.c;
}

/** Totals, mixed flag, stackKind and rationale for a column whose layers just changed. stackKind
 * becomes "partial" when a pure stack is below full height (fewer pieces than fit the clearance);
 * otherwise the planner's own value is kept. */
function refreshColumn(column: PackColumn, state: EditorState, dims: Dimensions): void {
  const weightOf = (l: PackLayer) => (state.skus.find((s) => s.id === l.skuId)?.weight ?? 0) * l.count;
  column.totalHeight = column.layers.reduce((s, l) => s + l.unitHeight * l.count, 0);
  column.totalWeight = column.layers.reduce((s, l) => s + weightOf(l), 0);
  column.stackCount = column.layers.reduce((s, l) => s + l.count, 0);
  column.mixed = new Set(column.layers.map((l) => l.skuId)).size > 1;
  if (!column.mixed && column.layers.length > 0) {
    const unit = column.layers[0].unitHeight;
    const fullCount = unit > 0 ? Math.floor((effectiveHeightOf(state, dims) + EPS) / unit) : 0;
    if (column.stackCount < fullCount) column.stackKind = "partial";
  }
  if (column.layers.length > 0) column.rationale = describeManualLayers(column);
}

/** Splits `count` pieces off the top layer of `column` (mutating it) and returns them as a new
 * one-layer column with the same footprint. null when count is out of range. */
function splitTop(column: PackColumn, count: number, state: EditorState, dims: Dimensions): PackColumn | null {
  const top = column.layers[column.layers.length - 1];
  const n = Math.floor(count);
  if (!top || n < 1 || n > top.count) return null;
  const piece: PackColumn = {
    posY: 0,
    colWidth: column.colWidth,
    colLength: column.colLength,
    totalHeight: 0,
    totalWeight: 0,
    stackCount: 0,
    layers: [{ ...top, orientation: { ...top.orientation }, count: n }],
    mixed: false,
    rationale: `Taken off the top of a stack — ${n} × ${fmtInches(top.unitHeight)}" = ${fmtInches(top.unitHeight * n)}"`,
  };
  refreshColumn(piece, state, dims);
  if (n === top.count) column.layers.pop();
  else top.count -= n;
  refreshColumn(column, state, dims);
  return piece;
}

interface Extracted {
  plan: PackPlan;
  holding: PackColumn[];
  pieces: PackColumn;
  // The clone of the column at `keepRef` (the caller's target), found BEFORE the removal so index
  // shifts in a shared row can't point the caller at the wrong stack.
  kept: PackColumn | null;
}

/** Clones plan + holding and removes the source's pieces from the clone. A column or held stack
 * that empties is removed; a trailer row that empties stays as a placeholder (pullToHolding's rule). */
function extractPieces(state: EditorState, source: PieceSource, keepRef?: ColumnRef): Extracted | null {
  const plan = clonePlan(state.plan);
  const holding = state.holding.map(cloneColumn);
  const kept = keepRef ? getColumn(plan, keepRef) : null;
  if (source.kind === "column" || source.kind === "top") {
    const row = plan.trailers[source.ref.t]?.rows[source.ref.r];
    const column = row?.columns[source.ref.c];
    if (!row || !column) return null;
    if (source.kind === "column") {
      row.columns.splice(source.ref.c, 1);
      return { plan, holding, pieces: column, kept };
    }
    if (column.onEdge) return null; // lb-edge-01: one layer — nothing to split off the top
    const pieces = splitTop(column, source.count, state, plan.trailers[source.ref.t].dims);
    if (!pieces) return null;
    if (column.layers.length === 0) row.columns.splice(source.ref.c, 1);
    return { plan, holding, pieces, kept };
  }
  const held = holding[source.index];
  if (!held) return null;
  if (source.kind === "holding") {
    holding.splice(source.index, 1);
    return { plan, holding, pieces: held, kept };
  }
  if (held.onEdge) return null;
  const pieces = splitTop(held, source.count, state, state.dims);
  if (!pieces) return null;
  if (held.layers.length === 0) holding.splice(source.index, 1);
  return { plan, holding, pieces, kept };
}

/** The pieces a source would move, without changing anything. */
export function piecesFor(state: EditorState, source: PieceSource): PackColumn | null {
  return extractPieces(state, source)?.pieces ?? null;
}

/** Re-orients every layer of `pieces` onto a target footprint: as-is when it already matches,
 * otherwise each layer's SKU needs a legal orientation with that footprint at the SAME thickness
 * (a 48×24 piece turned 24×48). null when any layer can't. */
function layersOnFootprint(state: EditorState, pieces: PackColumn, length: number, width: number): PackLayer[] | null {
  if (approxEq(pieces.colLength, length) && approxEq(pieces.colWidth, width)) {
    return pieces.layers.map((l) => ({ ...l, orientation: { ...l.orientation } }));
  }
  const out: PackLayer[] = [];
  for (const layer of pieces.layers) {
    const sku = state.skus.find((s) => s.id === layer.skuId);
    if (!sku) return null;
    const o = skuOrientations(sku, state.options).find(
      (x) => approxEq(x.length, length) && approxEq(x.width, width) && approxEq(x.height, layer.unitHeight)
    );
    if (!o) return null;
    out.push({ ...layer, orientation: { ...o } });
  }
  return out;
}

/** Target layers + moved layers, base first; a moved layer of the same SKU as the current top merges. */
function combineLayers(target: PackLayer[], moved: PackLayer[]): PackLayer[] {
  const out = target.map((l) => ({ ...l, orientation: { ...l.orientation } }));
  for (const layer of moved) {
    const top = out[out.length - 1];
    if (top && top.skuId === layer.skuId && approxEq(top.unitHeight, layer.unitHeight)) top.count += layer.count;
    else out.push({ ...layer, orientation: { ...layer.orientation } });
  }
  return out;
}

/** Can `source`'s pieces go ON TOP of the stack at `to`? "no" mirrors validatePlan's column-height
 * and max-skus-per-column (Holey Board exempt, as there) rules on the combined stack; "warn" =
 * allowed, but thicker pieces are going onto thinner ones. lb-topoff-01: a top-off thinner than K
 * (topOffMinInchesPerPiece) is "ok" — a deliberate choice, flagged only in the reason. */
export function evaluateStackTarget(state: EditorState, source: PieceSource, to: ColumnRef): TargetVerdict {
  const target = getColumn(state.plan, to);
  if (!target) return { level: "no", reason: "no such stack", heightAfter: 0 };
  if (target.onEdge) return { level: "no", reason: EDGE_NO_STACK_REASON, heightAfter: target.totalHeight };
  if ((source.kind === "column" || source.kind === "top") && sameRef(source.ref, to)) {
    return { level: "no", reason: "that's the same stack", heightAfter: target.totalHeight };
  }
  const pieces = piecesFor(state, source);
  if (!pieces) return { level: "no", reason: "nothing to move", heightAfter: target.totalHeight };
  if (pieces.onEdge) return { level: "no", reason: EDGE_NO_STACK_REASON, heightAfter: target.totalHeight };
  const heightAfter = target.totalHeight + pieces.totalHeight;

  const moved = layersOnFootprint(state, pieces, target.colLength, target.colWidth);
  if (!moved) {
    return {
      level: "no",
      reason: `different footprint (${fmtInches(pieces.colLength)}×${fmtInches(pieces.colWidth)} vs ${fmtInches(target.colLength)}×${fmtInches(target.colWidth)})`,
      heightAfter,
    };
  }

  const limit = effectiveHeightOf(state, state.plan.trailers[to.t].dims);
  if (heightAfter > limit + EPS) {
    return { level: "no", reason: `would be ${fmtIn(heightAfter)} tall (limit ${fmtIn(limit)})`, heightAfter };
  }

  const combined = combineLayers(target.layers, moved);
  const distinct = new Set(combined.map((l) => l.skuId)).size;
  const baseSku = state.skus.find((s) => s.id === combined[0]?.skuId);
  const isHoley = baseSku?.category === HOLEY_BOARD_CATEGORY;
  if (!isHoley && distinct > state.options.maxSkusPerColumn) {
    return { level: "no", reason: `would be ${distinct} sizes in one stack (max ${state.options.maxSkusPerColumn})`, heightAfter };
  }
  const currentTop = target.layers[target.layers.length - 1];
  if (currentTop && moved[0] && moved[0].unitHeight > currentTop.unitHeight + EPS) {
    return { level: "warn", reason: THICKER_ON_THINNER, heightAfter };
  }
  const k = state.options.topOffMinInchesPerPiece;
  const thin = distinct > 1 && combined.slice(1).some((l) => l.unitHeight < k - EPS);
  if (thin) {
    return { level: "ok", reason: `fits · thin top-off (under ${fmtIn(k)}) · ${fmtIn(heightAfter)} of ${fmtIn(limit)}`, heightAfter };
  }
  return { level: "ok", reason: `fits · ${fmtIn(heightAfter)} of ${fmtIn(limit)}`, heightAfter };
}

/** Puts `source`'s pieces on top of the stack at `to` — refused (same state) when the verdict is
 * "no". Pieces only move, so balance and cart are untouched. */
export function stackOnto(state: EditorState, source: PieceSource, to: ColumnRef): EditorState {
  if (evaluateStackTarget(state, source, to).level === "no") return state;
  const extracted = extractPieces(state, source, to);
  if (!extracted?.kept) return state;
  const { plan, holding, pieces, kept: target } = extracted;
  const moved = layersOnFootprint(state, pieces, target.colLength, target.colWidth);
  if (!moved) return state;
  target.layers = combineLayers(target.layers, moved);
  refreshColumn(target, state, plan.trailers[to.t].dims);
  recomputePlan(plan, state.options);
  return { ...state, plan, holding, history: withHistory(state) };
}

/** Moves `source`'s pieces into a row slot as a NEW stack (`to.r === NEW_ROW` = a new row at the
 * rear). Generalizes moveColumn/placeFromHolding to all four source kinds. Like moveColumn it does
 * not pre-validate — evaluateSlotTarget is the UI's gate, validateForApply the apply gate. */
export function moveToSlot(state: EditorState, source: PieceSource, to: DropTarget): EditorState {
  const trailer = state.plan.trailers[to.t];
  if (!trailer) return state;
  if (to.r !== NEW_ROW && !trailer.rows[to.r]) return state;
  const extracted = extractPieces(state, source);
  if (!extracted) return state;
  const { plan, holding, pieces } = extracted;
  const toTrailer = plan.trailers[to.t];
  if (pieces.onEdge) {
    // lb-edge-01: an on-edge stack only lands in a wall slot, after the slot's existing boards.
    const sku = skuOfColumn(state, pieces);
    if (!sku || !toTrailer.dims.holeyEdgeSlot) return state;
    if (to.r === NEW_ROW) {
      pieces.posY = holeyEdgeSlot(toTrailer.dims, sku.width).flatWidth;
      toTrailer.rows.unshift({ posFromFront: 0, rowLength: 0, rowWidthUsed: 0, wastedFloorArea: 0, columns: [pieces], totalUnits: 0, totalWeight: 0 });
    } else {
      const toRow = toTrailer.rows[to.r];
      toRow.columns.push(pieces);
      packWallSlot(toRow, toTrailer.dims, sku.width);
    }
    recomputePlan(plan, state.options);
    return { ...state, plan, holding, history: withHistory(state) };
  }
  if (to.r === NEW_ROW) {
    toTrailer.rows.unshift({ posFromFront: 0, rowLength: 0, rowWidthUsed: 0, wastedFloorArea: 0, columns: [pieces], totalUnits: 0, totalWeight: 0 });
  } else {
    // The row object survives the source removal (rows are never removed by it), so a same-row
    // reorder clamps against the already-shortened row with no special-casing.
    const toRow = toTrailer.rows[to.r];
    // lb-box-03: on-edge columns stay rightmost (the wall slot) — a new stack lands before them.
    const firstEdge = toRow.columns.findIndex((c) => c.onEdge);
    const maxSlot = firstEdge >= 0 ? firstEdge : toRow.columns.length;
    const slot = Math.max(0, Math.min(to.slot, maxSlot));
    toRow.columns.splice(slot, 0, pieces);
  }
  recomputePlan(plan, state.options);
  return { ...state, plan, holding, history: withHistory(state) };
}

/** Can `source`'s pieces stand as a new stack in this slot? Width (and depth, for a trailer column)
 * from canDrop, plus a simulated move for depth on EVERY source kind — a held stack dropped into a
 * shallow row can push a later row past the doors, which canDrop alone doesn't see (the lb-ui-03
 * holding→trailer gap) — and the column-height limit for a stack built in holding. */
export function evaluateSlotTarget(state: EditorState, source: PieceSource, to: DropTarget): TargetVerdict {
  const trailer = state.plan.trailers[to.t];
  const pieces = piecesFor(state, source);
  if (!trailer || !pieces) return { level: "no", reason: "nothing to move", heightAfter: 0 };
  const heightAfter = pieces.totalHeight;
  const limit = effectiveHeightOf(state, trailer.dims);
  if (heightAfter > limit + EPS) {
    return { level: "no", reason: `would be ${fmtIn(heightAfter)} tall (limit ${fmtIn(limit)})`, heightAfter };
  }

  let reason: string;
  if (pieces.onEdge) {
    const edge = evaluateEdgeSlotTarget(state, source, pieces, to);
    if (edge.level === "no") return edge;
    reason = edge.reason;
  } else if (to.r === NEW_ROW) {
    if (pieces.colWidth > trailer.dims.width + EPS) {
      return { level: "no", reason: `too wide · would be ${fmtInches(pieces.colWidth)}"`, heightAfter };
    }
    reason = `fits · new row ${fmtInches(pieces.colLength)}" deep`;
  } else {
    if (!trailer.rows[to.r]) return { level: "no", reason: "no such row", heightAfter };
    // lb-box-03: no flat stack may run into a row's on-edge slot.
    const toRow = trailer.rows[to.r];
    if (rowHasEdge(toRow)) {
      const slotStart = Math.min(...toRow.columns.filter((c) => c.onEdge).map((c) => c.posY));
      const sourceCol = source.kind === "column" ? getColumn(state.plan, source.ref) : null;
      const flatAfter = toRow.columns.filter((c) => !c.onEdge && c !== sourceCol).reduce((s, c) => s + c.colWidth, 0) + pieces.colWidth;
      if (flatAfter > slotStart + EPS) return { level: "no", reason: "would run into the wall slot", heightAfter };
    }
    // canDrop excludes a same-row column's own width by object identity, so a whole trailer column
    // is passed as the original object.
    const original = source.kind === "column" ? getColumn(state.plan, source.ref) : null;
    const feedback = canDrop(state, original ?? pieces, { t: to.t, r: to.r }, source.kind === "column" ? source.ref : undefined);
    if (!feedback.ok) return { level: "no", reason: feedback.reason, heightAfter };
    reason = feedback.reason;
  }

  const simulated = moveToSlot(state, source, to);
  if (simulated === state) return { level: "no", reason: "can't go there", heightAfter };
  const sourceTrailer = source.kind === "column" || source.kind === "top" ? source.ref.t : to.t;
  const overflow = findOverflowingRows(simulated).find((o) => o.trailerIndex === to.t || o.trailerIndex === sourceTrailer);
  if (overflow) {
    const total = (simulated.plan.trailers[overflow.trailerIndex]?.dims ?? state.dims).length + overflow.overflowBy;
    return { level: "no", reason: `too deep · pushes trailer ${overflow.trailerIndex + 1} to ${fmtInches(total)}"`, heightAfter };
  }
  return { level: "ok", reason, heightAfter };
}

/** lb-edge-01: the width/slot side of evaluateSlotTarget for an on-edge stack. Only a wall slot
 * takes it (a new row on a slot trailer starts its slot at flatWidth); the caller's simulated move
 * still checks depth. */
function evaluateEdgeSlotTarget(state: EditorState, source: PieceSource, pieces: PackColumn, to: DropTarget): TargetVerdict {
  const heightAfter = pieces.totalHeight;
  const trailer = state.plan.trailers[to.t];
  if (!trailer.dims.holeyEdgeSlot) return { level: "no", reason: EDGE_NO_SLOT_REASON, heightAfter };
  const sku = skuOfColumn(state, pieces);
  if (!sku) return { level: "no", reason: "unknown part", heightAfter };
  const slotWidth = holeyEdgeSlot(trailer.dims, sku.width).slotWidth;
  if (to.r === NEW_ROW) return { level: "ok", reason: `fits · new row, wall slot ${fmtInches(pieces.colWidth)}" of ${fmtInches(slotWidth)}"`, heightAfter };
  const free = edgeSlotFree(state, source, to.t, to.r);
  if (free === null) return { level: "no", reason: "no such row", heightAfter };
  if (pieces.colWidth > free + EPS) {
    return { level: "no", reason: `${EDGE_SLOT_ONLY_REASON} · ${free > EPS ? `${fmtInches(free)}" left in this row's slot` : "this row's slot is full"}`, heightAfter };
  }
  return { level: "ok", reason: `fits · wall slot, ${fmtInches(free - pieces.colWidth)}" left`, heightAfter };
}

/** "column" = pullToHolding; "top" = split N pieces off the top into a new held stack. */
export function takeToHolding(
  state: EditorState,
  source: { kind: "column"; ref: ColumnRef } | { kind: "top"; ref: ColumnRef; count: number }
): EditorState {
  if (source.kind === "column") return pullToHolding(state, source.ref);
  const extracted = extractPieces(state, source);
  if (!extracted) return state;
  const { plan, holding, pieces } = extracted;
  recomputePlan(plan, state.options);
  return { ...state, plan, holding: [...holding, pieces], history: withHistory(state) };
}

function swappedPlan(state: EditorState, a: ColumnRef, b: ColumnRef): PackPlan | null {
  if (sameRef(a, b) || !getColumn(state.plan, a) || !getColumn(state.plan, b)) return null;
  const plan = clonePlan(state.plan);
  const rowA = plan.trailers[a.t].rows[a.r];
  const rowB = plan.trailers[b.t].rows[b.r];
  const colA = rowA.columns[a.c];
  rowA.columns[a.c] = rowB.columns[b.c];
  rowB.columns[b.c] = colA;
  // lb-edge-01: two on-edge stacks trade places — re-lay both wall slots from their start.
  if (colA.onEdge && rowA.columns[a.c].onEdge) {
    const sku = skuOfColumn(state, colA);
    if (sku) {
      packWallSlot(rowA, plan.trailers[a.t].dims, sku.width);
      packWallSlot(rowB, plan.trailers[b.t].dims, sku.width);
    }
  }
  recomputePlan(plan, state.options);
  return plan;
}

/** Will swapping the stacks at `a` and `b` still fit both rows' width and both trailers' length? */
export function evaluateSwapTarget(state: EditorState, a: ColumnRef, b: ColumnRef): TargetVerdict {
  const heightAfter = getColumn(state.plan, a)?.totalHeight ?? 0;
  if (sameRef(a, b)) return { level: "no", reason: "that's the same stack", heightAfter };
  const edgeA = getColumn(state.plan, a)?.onEdge === true;
  const edgeB = getColumn(state.plan, b)?.onEdge === true;
  if (edgeA !== edgeB) return { level: "no", reason: EDGE_SWAP_REASON, heightAfter };
  const plan = swappedPlan(state, a, b);
  if (!plan) return { level: "no", reason: "no such stack", heightAfter };
  for (const ref of [a, b]) {
    const trailer = plan.trailers[ref.t];
    const row = trailer.rows[ref.r];
    if (edgeA && !wallSlotFits(row, trailer.dims)) {
      return { level: "no", reason: `won't fit · row R${ref.r + 1}'s wall slot is too narrow`, heightAfter };
    }
    if (row.rowWidthUsed > trailer.dims.width + EPS) {
      return {
        level: "no",
        reason: `won't fit · row R${ref.r + 1} would be ${fmtInches(row.rowWidthUsed)}" wide (limit ${fmtInches(trailer.dims.width)}")`,
        heightAfter,
      };
    }
  }
  const overflow = findOverflowingRows({ ...state, plan }).find((o) => o.trailerIndex === a.t || o.trailerIndex === b.t);
  if (overflow) {
    const total = plan.trailers[overflow.trailerIndex].dims.length + overflow.overflowBy;
    return { level: "no", reason: `too deep · pushes trailer ${overflow.trailerIndex + 1} to ${fmtInches(total)}"`, heightAfter };
  }
  return { level: "ok", reason: "swap places", heightAfter };
}

/** Swaps two stacks' positions — only when evaluateSwapTarget says it fits; same state otherwise. */
export function swapColumns(state: EditorState, a: ColumnRef, b: ColumnRef): EditorState {
  if (evaluateSwapTarget(state, a, b).level !== "ok") return state;
  const plan = swappedPlan(state, a, b);
  if (!plan) return state;
  return { ...state, plan, history: withHistory(state) };
}

/** The one "Add pieces" path: job or library pieces go to HOLDING first, then get placed with the
 * same tap flow. Built in the SKU's flat orientation (skuOrientations[0], as buildColumn does) and
 * split into full-height stacks so no held stack is taller than the trailer's clearance. Job SKUs
 * draw down plan.balance; a library SKU is introduced and grows the cart by the shortfall — the same
 * adjustBalance/cartAfterPlacement accounting addRow uses, so conservation holds exactly. One undo
 * step reverts all of it (history is the TRUE pre-introduction state, as addRowFromLibrary). */
export function addToHolding(state: EditorState, sku: PackSku, count: number): EditorState {
  const n = Math.floor(count);
  if (!sku || !(n > 0)) return state;
  const introduced = introduceSku(state, sku);
  const unit = skuOrientations(sku, state.options)[0]?.height ?? 0;
  if (!(unit > 0)) return state;
  const perStack = Math.max(1, Math.floor((effectiveHeightOf(state, state.dims) + EPS) / unit));
  const source = state.originalSkuIds.has(sku.id) ? "this job" : "the parts library";
  const added: PackColumn[] = [];
  for (let left = n; left > 0; left -= perStack) {
    const column = buildColumn(sku, Math.min(perStack, left), state.options);
    column.rationale = `Added from ${source} — ${column.stackCount} × ${fmtInches(unit)}" = ${fmtInches(column.totalHeight)}"`;
    refreshColumn(column, introduced, state.dims);
    added.push(column);
  }
  const plan = clonePlan(state.plan);
  plan.balance = adjustBalance(plan.balance, sku.id, -n);
  const cart = cartAfterPlacement(introduced, sku.id, n);
  return { ...introduced, plan, cart, holding: [...state.holding.map(cloneColumn), ...added], history: withHistory(state) };
}

// --- lb-edge-01: Lay flat / Stand on edge / held count ---

/** A held stack's layer count (the held-stack counterpart of setLayerCount, same balance
 * bookkeeping): 0 drops the layer, and a held stack left empty leaves holding. An on-edge stack is
 * clamped to its tiers (measured against the first slot trailer). One history step. */
export function setHeldLayerCount(state: EditorState, index: number, layerIndex: number, count: number): EditorState {
  const held = state.holding[index];
  const layer = held?.layers[layerIndex];
  if (!held || !layer) return state;
  let nextCount = Math.max(0, Math.floor(count));
  if (held.onEdge) {
    const sku = skuOfColumn(state, held);
    if (sku) nextCount = Math.min(nextCount, edgeTiers(state, edgeDimsForHolding(state), sku));
  }
  const delta = nextCount - layer.count;
  if (delta === 0) return state;
  const holding = state.holding.map(cloneColumn);
  const column = holding[index];
  if (nextCount === 0) column.layers.splice(layerIndex, 1);
  else column.layers[layerIndex].count = nextCount;
  if (column.layers.length === 0) holding.splice(index, 1);
  else {
    const keepKind = column.stackKind;
    refreshColumn(column, state, held.onEdge ? edgeDimsForHolding(state) : state.dims);
    if (column.onEdge) column.stackKind = keepKind; // refreshColumn's full/partial test reads unitHeight, a tier here
  }
  const plan = clonePlan(state.plan);
  plan.balance = adjustBalance(plan.balance, layer.skuId, -delta);
  return { ...state, plan, holding, history: withHistory(state) };
}

/** Lays an on-edge stack (on a trailer or held) flat: the same boards as a flat Holey Board stack in
 * the SKU's identity orientation, `stackKind: "partial"`, put in holding to be placed like any held
 * stack. Pieces only change shape, so balance and cart are untouched. One history step. */
export function layFlat(state: EditorState, source: WholeStackSource): EditorState {
  const original = source.kind === "column" ? getColumn(state.plan, source.ref) : state.holding[source.index];
  if (!original?.onEdge) return state;
  const sku = skuOfColumn(state, original);
  if (!sku) return state;
  const extracted = extractPieces(state, source);
  if (!extracted) return state;
  const { plan, holding, pieces } = extracted;
  const flat = buildColumn(sku, pieces.stackCount, state.options);
  flat.layers[0].color = pieces.layers[0].color;
  flat.rationale = `Laid flat from ${HOLEY_EDGE_LABEL} — ${flat.stackCount} × ${fmtInches(flat.layers[0].unitHeight)}" = ${fmtInches(flat.totalHeight)}"`;
  flat.stackKind = "partial";
  recomputePlan(plan, state.options);
  return { ...state, plan, holding: [...holding, flat], history: withHistory(state) };
}

/** Why a stack can't stand on edge, or null when it can: one Holey Board SKU in one flat layer, and
 * some row on a slot trailer with a board's thickness of wall slot free. */
export function evaluateStandOnEdge(state: EditorState, source: WholeStackSource): string | null {
  const pieces = piecesFor(state, source);
  const sku = pieces ? skuOfColumn(state, pieces) : undefined;
  if (!pieces || !sku || pieces.onEdge || pieces.layers.length !== 1 || sku.category !== HOLEY_BOARD_CATEGORY) return STAND_NOT_PLAIN_REASON;
  const roomy = state.plan.trailers.some(
    (trailer) =>
      trailer.dims.holeyEdgeSlot &&
      edgeTiers(state, trailer.dims, sku) > 0 &&
      trailer.rows.some((row) => wallSlotRoom(row, trailer.dims, sku.width).free >= sku.height - EPS)
  );
  return roomy ? null : STAND_NO_ROOM_REASON;
}

/** The on-edge columns standing `pieces` in row (t, r) would create: left to right while a board's
 * thickness fits, min(remaining, tiers) boards each. */
function standColumns(state: EditorState, pieces: PackColumn, sku: PackSku, t: number, r: number): PackColumn[] {
  const trailer = state.plan.trailers[t];
  const row = trailer?.rows[r];
  if (!trailer?.dims.holeyEdgeSlot || !row) return [];
  const tiers = edgeTiers(state, trailer.dims, sku);
  let free = wallSlotRoom(row, trailer.dims, sku.width).free;
  let left = pieces.stackCount;
  const base = pieces.layers[0];
  const out: PackColumn[] = [];
  while (left > 0 && tiers > 0 && free >= sku.height - EPS) {
    const count = Math.min(left, tiers);
    out.push({
      posY: 0,
      colWidth: sku.height,
      colLength: sku.length,
      totalHeight: count * sku.width,
      totalWeight: count * sku.weight,
      stackCount: count,
      layers: [
        {
          skuId: sku.id,
          skuName: sku.name,
          skuCode: sku.sku,
          color: base.color,
          unitHeight: sku.width,
          count,
          orientation: { length: sku.length, width: sku.height, height: sku.width, label: HOLEY_EDGE_LABEL },
        },
      ],
      mixed: false,
      rationale: `${HOLEY_EDGE_LABEL}: ${count} × ${fmtInches(sku.height)}" boards stood ${fmtInches(sku.width)}" tall in the wall slot (Customize)`,
      onEdge: true,
    });
    left -= count;
    free -= sku.height;
  }
  return out;
}

/** Stands a plain holey stack on edge in row (t, r)'s wall slot. Boards that don't fit stay in the
 * source stack (reduced; removed only if it empties). Pieces only change shape and place, so balance
 * and cart are untouched. One history step; the same state when nothing fits. */
export function standOnEdge(state: EditorState, source: WholeStackSource, to: { t: number; r: number }): EditorState {
  if (evaluateStandOnEdge(state, source) === STAND_NOT_PLAIN_REASON) return state;
  const pieces = piecesFor(state, source)!;
  const sku = skuOfColumn(state, pieces)!;
  const stood = standColumns(state, pieces, sku, to.t, to.r);
  const boards = stood.reduce((s, c) => s + c.stackCount, 0);
  if (boards === 0) return state;

  const plan = clonePlan(state.plan);
  const holding = state.holding.map(cloneColumn);
  const toRow = plan.trailers[to.t].rows[to.r];
  if (source.kind === "column") {
    const row = plan.trailers[source.ref.t].rows[source.ref.r];
    const column = row.columns[source.ref.c];
    column.layers[0].count -= boards;
    if (column.layers[0].count <= 0) row.columns.splice(source.ref.c, 1);
    else refreshColumn(column, state, plan.trailers[source.ref.t].dims);
  } else {
    const held = holding[source.index];
    held.layers[0].count -= boards;
    if (held.layers[0].count <= 0) holding.splice(source.index, 1);
    else refreshColumn(held, state, state.dims);
  }
  toRow.columns.push(...stood);
  packWallSlot(toRow, plan.trailers[to.t].dims, sku.width);
  recomputePlan(plan, state.options);
  return { ...state, plan, holding, history: withHistory(state) };
}

/** Stand on edge's per-row verdict: how many boards would stand there; no when none fit or the row
 * would push the trailer past its length. */
export function evaluateStandTarget(state: EditorState, source: WholeStackSource, to: { t: number; r: number }): TargetVerdict {
  const why = evaluateStandOnEdge(state, source);
  if (why === STAND_NOT_PLAIN_REASON) return { level: "no", reason: why, heightAfter: 0 };
  const trailer = state.plan.trailers[to.t];
  if (!trailer?.dims.holeyEdgeSlot) return { level: "no", reason: EDGE_NO_SLOT_REASON, heightAfter: 0 };
  const pieces = piecesFor(state, source)!;
  const sku = skuOfColumn(state, pieces)!;
  const stood = standColumns(state, pieces, sku, to.t, to.r);
  const boards = stood.reduce((s, c) => s + c.stackCount, 0);
  const heightAfter = stood[0]?.totalHeight ?? 0;
  if (boards === 0) return { level: "no", reason: "no room in this row's wall slot", heightAfter };
  const simulated = standOnEdge(state, source, to);
  const sourceTrailer = source.kind === "column" ? source.ref.t : to.t;
  const overflow = findOverflowingRows(simulated).find((o) => o.trailerIndex === to.t || o.trailerIndex === sourceTrailer);
  if (overflow) {
    const total = simulated.plan.trailers[overflow.trailerIndex].dims.length + overflow.overflowBy;
    return { level: "no", reason: `too deep · pushes trailer ${overflow.trailerIndex + 1} to ${fmtInches(total)}"`, heightAfter };
  }
  const rest = pieces.stackCount - boards;
  return { level: "ok", reason: `${boards} board${boards === 1 ? "" : "s"} stand here${rest > 0 ? ` · ${rest} stay where they are` : ""}`, heightAfter };
}

// --- lbr-09: Shift to rear. Floor terms (Steve, 2026-10-13): FRONT = doors (trailer.rows[0],
// posFromFront 0, loaded last), REAR = nose (the last row, loaded first). When a move leaves a hole,
// every stack behind it slides toward the rear to fill it. Stacks keep their order — nothing is
// re-sorted, nothing changes trailer, and the free floor ends up at the front (doors) end. ---

/** shiftToRear plus any per-trailer note. The note is returned beside the state rather than stored
 * on EditorState: every op spreads `{ ...state }`, so a note kept there would ride along stale. */
export interface ShiftResult {
  state: EditorState;
  note: string | null;
}

/** Column depth of one row's columns: null when they don't all share one colLength. */
function rowDepth(row: PackRow): number | null {
  const first = row.columns[0];
  if (!first) return null;
  return row.columns.every((c) => approxEq(c.colLength, first.colLength)) ? first.colLength : null;
}

function usedLengthOf(rows: PackRow[]): number {
  return rows.reduce((s, r) => s + (r.columns.length > 0 ? Math.max(...r.columns.map((c) => c.colLength)) : 0), 0);
}

function emptyRow(columns: PackColumn[]): PackRow {
  return { posFromFront: 0, rowLength: 0, rowWidthUsed: 0, wastedFloorArea: 0, columns, totalUnits: 0, totalWeight: 0 };
}

/** New rows for one (already cloned) trailer, or null when nothing changes. Walks the stacks rear →
 * front (last row first, posY order within a row) and refills rows from the rear, closing a row when
 * the next stack doesn't fit the width — or has a different depth, so a refilled row is never mixed-
 * depth. Uniform-depth runs make this next-fit over a fixed order, which never needs more rows than
 * the layout it came from, so used length can't grow; a post-check enforces that (and the width)
 * anyway and falls back to closing empty rows only. A trailer that already has a mixed-depth row
 * (lbr-10) slides stacks with slideMixedTrailer instead — never re-flowed, so footprints never mix. */
function reflowTrailer(trailer: PackTrailer, trailerIndex: number): { rows: PackRow[] | null; note: string | null } {
  const nonEmpty = trailer.rows.filter((r) => r.columns.length > 0);
  const compactOnly = nonEmpty.length === trailer.rows.length ? null : nonEmpty;
  // lb-box-03: stacks don't slide across rows on a trailer with on-edge boards (each sits in its own
  // row's wall slot); empty rows still close. lb-edge-01 left this as is (BACKLOG).
  if (nonEmpty.some(rowHasEdge)) return { rows: compactOnly, note: null };
  if (nonEmpty.some((r) => rowDepth(r) === null)) return slideMixedTrailer(trailer, trailerIndex, compactOnly);

  const width = trailer.dims.width;
  const rearFirst = [...nonEmpty].reverse().map((r) => [...r.columns].sort((a, b) => a.posY - b.posY));
  const refilled: PackColumn[][] = [];
  let current: PackColumn[] = [];
  let currentWidth = 0;
  for (const column of rearFirst.flat()) {
    if (current.length > 0 && (currentWidth + column.colWidth > width + EPS || !approxEq(column.colLength, current[0].colLength))) {
      refilled.push(current);
      current = [];
      currentWidth = 0;
    }
    current.push(column);
    currentWidth += column.colWidth;
  }
  if (current.length > 0) refilled.push(current);

  const unchanged =
    compactOnly === null &&
    refilled.length === rearFirst.length &&
    refilled.every((cols, i) => cols.length === rearFirst[i].length && cols.every((c, j) => c === rearFirst[i][j]));
  if (unchanged) return { rows: null, note: null };

  // Rows were built rear-first; the model stores them front-first (index 0 = doors).
  const rows = refilled.reverse().map(emptyRow);
  const fitsWidth = rows.every((r) => r.columns.length === 1 || r.columns.reduce((s, c) => s + c.colWidth, 0) <= width + EPS);
  if (!fitsWidth || usedLengthOf(rows) > usedLengthOf(trailer.rows) + EPS) return { rows: compactOnly, note: null };
  return { rows, note: null };
}

/** lbr-10 (Steve, 2026-10-13): Shift to rear on a trailer with mixed-footprint rows (the engine's
 * width pairing puts different depths in one row — most regular block loads). Walks the rows rear →
 * front; while a row has free width, it pulls in the NEAREST stack in front of it (rows toward the
 * doors, posY order within a row) whose depth equals the depth of a stack already in that row and
 * whose width fits. So a row never gains a new depth (no new footprint mix) and its rowLength can't
 * grow; the source row only shrinks. Rows left empty are removed. The guard (any row's rowLength or
 * the used length growing → close empty rows only, with a note) can't fire for a well-formed row —
 * it backs the argument above up rather than being a reachable path (see the selfcheck). Stacks
 * never change trailer. Returns null rows when nothing moves and no row is empty. */
function slideMixedTrailer(trailer: PackTrailer, trailerIndex: number, compactOnly: PackRow[] | null): { rows: PackRow[] | null; note: string | null } {
  const width = trailer.dims.width;
  const rows = trailer.rows.map((r) => [...r.columns].sort((a, b) => a.posY - b.posY)); // front-first
  const lengthBefore = trailer.rows.map((r) => (r.columns.length > 0 ? Math.max(...r.columns.map((c) => c.colLength)) : 0));
  let moved = false;
  for (let ri = rows.length - 1; ri >= 0; ri--) {
    const row = rows[ri];
    if (row.length === 0) continue;
    for (;;) {
      const free = width - row.reduce((s, c) => s + c.colWidth, 0);
      let hit: { rj: number; cj: number } | null = null;
      for (let rj = ri - 1; rj >= 0 && !hit; rj--) {
        const cj = rows[rj].findIndex((c) => c.colWidth <= free + EPS && row.some((x) => approxEq(x.colLength, c.colLength)));
        if (cj >= 0) hit = { rj, cj };
      }
      if (!hit) break;
      const [column] = rows[hit.rj].splice(hit.cj, 1);
      row.push(column);
      moved = true;
    }
  }
  if (!moved) return { rows: compactOnly, note: null };

  const grew = rows.some((cols, i) => cols.length > 0 && Math.max(...cols.map((c) => c.colLength)) > lengthBefore[i] + EPS);
  const next = rows.filter((cols) => cols.length > 0).map(emptyRow);
  if (grew || usedLengthOf(next) > usedLengthOf(trailer.rows) + EPS) {
    return { rows: compactOnly, note: `Trailer ${trailerIndex + 1}: couldn't slide stacks without lengthening the trailer — closed empty rows only.` };
  }
  return { rows: next, note: null };
}

/** Shift to rear on one trailer, or every trailer when `trailerIndex` is omitted, with the note (see
 * ShiftResult). One history step; the same `state` reference when nothing moves (like compactLoad). */
export function shiftToRearWithNote(state: EditorState, trailerIndex?: number): ShiftResult {
  const plan = clonePlan(state.plan);
  const notes: string[] = [];
  let changed = false;
  plan.trailers.forEach((trailer, t) => {
    if (trailerIndex !== undefined && t !== trailerIndex) return;
    const { rows, note } = reflowTrailer(trailer, t);
    if (note) notes.push(note);
    if (rows) {
      trailer.rows = rows;
      changed = true;
    }
  });
  const note = notes.length > 0 ? notes.join(" ") : null;
  if (!changed) return { state, note };
  recomputePlan(plan, state.options);
  return { state: { ...state, plan, history: withHistory(state) }, note };
}

/** Shift to rear (see shiftToRearWithNote) when the caller doesn't need the note. */
export function shiftToRear(state: EditorState, trailerIndex?: number): EditorState {
  return shiftToRearWithNote(state, trailerIndex).state;
}

/** Customize's auto-shift: shifts every trailer of `after` (the result of one user action taken on
 * `before`) but keeps `after.history`, so one Undo reverts the action and the shift together. Applied
 * at Customize's call sites, never inside the ops — canDrop / evaluateSlotTarget simulate through
 * moveToSlot and need its unshifted result. */
export function withAutoShift(before: EditorState, after: EditorState): EditorState {
  if (after === before) return after;
  const shifted = shiftToRear(after);
  return shifted === after ? after : { ...shifted, history: after.history };
}
