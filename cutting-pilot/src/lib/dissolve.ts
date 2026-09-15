// src/lib/dissolve.ts
// lb-ui-03 Part A: dissolve — expand a source trailer's placed pieces into individual units and
// automatically propose moving them onto receiver columns elsewhere in the plan. Two-phase, like
// legacy's planDissolve/assembleDissolve (logistics/load-builder.html:1912/1973): proposeDissolve()
// computes candidate moves without mutating anything; applyDissolve() re-applies only the moves the
// planner didn't exclude — subtractive, it never proposes beyond phase 1.
//
// Unit is the PIECE, not the column — loadEditor.ts's customize editor moves whole columns, a
// deliberate, different unit (see that file's header). Unlike legacy, which only checked height
// headroom and weight, eligibility here mirrors packEngine.ts's validatePlan constraints exactly:
// max-skus-per-column (packEngine.ts, the `distinctSkuIds.size > options.maxSkusPerColumn` check)
// and the topoff-threshold K rule (`approxGte(layer.unitHeight, options.topOffMinInchesPerPiece)` on
// every non-base layer) — so a proposed-and-accepted move can never fail the same apply gate every
// other edit goes through (loadEditor.ts's validateForApply). Legacy's exact footprint match between
// source and receiver is kept, but on the COLUMN's own colLength/colWidth, not the row's rowLength —
// v2 allows mixed-depth rows (PackRow's own comment), so rowLength is only the row's deepest column
// and matching against it can select a receiver column whose actual depth differs from the unit's.
// Dissolve moves a piece into an EXISTING column shape, it never reshapes one.
//
// Geometry recompute is intentionally NOT re-derived a third time here — clonePlan/recomputePlan/
// withHistory are imported from loadEditor.ts, which already re-derives packEngine.ts's own private
// assembleRowFrom/buildTrailer math once for the same reason. A second re-derivation in this file
// would just be a second place for that math to drift. Column-level aggregates (totalHeight/
// totalWeight/stackCount/mixed) are the one piece of derived state loadEditor.ts's recompute never
// had to touch — none of its operations mutate a column's own layers, only which row it sits in —
// so this file owns that one small, additive recompute (recomputeColumnAggregates below), mirroring
// packEngine.ts's buildColumn formula (totalHeight = sum(count*unitHeight), totalWeight =
// sum(count*sku.weight), stackCount = sum(count), mixed = distinct SKU count > 1).
import type { PackColumn, PackSku } from "./packEngine";
import { clonePlan, recomputePlan, withHistory, type EditorState } from "./loadEditor";

const EPS = 1e-6;
function approxGte(a: number, b: number, eps = EPS): boolean {
  return a >= b - eps;
}
function approxEq(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

export interface DissolveMove {
  skuId: string;
  skuName: string;
  skuCode: string;
  color: string;
  unitHeight: number;
  weight: number;
  fromRi: number;
  fromCi: number;
  fromLi: number;
  toTi: number;
  toRi: number;
  toCi: number;
}

export interface DissolveProposal {
  srcTi: number;
  moves: DissolveMove[];
  totalSrcUnits: number;
  /** Distinct receiver columns actually used by `moves` — the "before you run it" count the UI
   * surfaces, per the locked decision that an empty/near-empty proposal must say so plainly rather
   * than opening a preview with nothing useful in it. */
  eligibleReceiverCount: number;
}

/** Group key for the preview's exclude-by-group UI: same SKU, same thickness, same destination
 * trailer are one decision to the planner, not N — mirrors legacy's dissolveGroupKey. */
export function dissolveGroupKey(move: DissolveMove): string {
  return `${move.skuCode}|${move.unitHeight}|${move.toTi}`;
}

function effectiveHeightOf(state: EditorState): number {
  const runner = state.options.runnerHeight;
  if (runner === undefined || !Number.isFinite(runner) || runner <= 0 || runner >= state.dims.height) {
    return state.dims.height;
  }
  return state.dims.height - runner;
}

function recomputeColumnAggregates(col: PackColumn, skuById: Map<string, PackSku>): void {
  const distinctSkuIds = new Set(col.layers.map((l) => l.skuId));
  col.totalHeight = col.layers.reduce((s, l) => s + l.count * l.unitHeight, 0);
  col.totalWeight = col.layers.reduce((s, l) => s + l.count * (skuById.get(l.skuId)?.weight ?? 0), 0);
  col.stackCount = col.layers.reduce((s, l) => s + l.count, 0);
  col.mixed = distinctSkuIds.size > 1;
}

const DISSOLVE_NOTE = "composition changed by dissolve — see layer table";

// packEngine.ts's rationale strings describe a specific fill count/gap (e.g. "3 × 10" = 30", 10"
// left — no other SKU on this footprint"), which dissolve's whole point is to invalidate: it adds
// or removes layers on this exact column. Appending onto that string (as lb-ui-01/02's rationale
// notes do for e.g. stability warnings) would leave the old numbers standing next to a layer table
// that now disagrees with them, on the one panel this codebase designates the trust feature
// (ColumnDetailPanel.tsx). Replace it instead — the layer table below it is always derived fresh
// from column.layers, so it's the authoritative source of truth after a dissolve either way.
// packEngine.ts's applyStabilityWarnings (buildFamilyColumns, :906) appends a bracketed
// "[stability: ...]" note onto a tall/narrow column's rationale — the loader-rearrange flag.
// Dissolve stacks pieces onto receiver columns, i.e. makes them taller, so the receiver is exactly
// the column most likely to carry that flag; replacing the whole rationale would silently drop it,
// and nothing downstream would catch that (stability is a warning, not a validateForApply
// violation). Preserve it across the replace.
function noteDissolved(col: PackColumn): void {
  const stability = col.rationale.match(/\[stability[^\]]*\]/)?.[0];
  col.rationale = stability ? `${DISSOLVE_NOTE} ${stability}` : DISSOLVE_NOTE;
}

interface Unit {
  ri: number;
  ci: number;
  li: number;
  length: number; // source column's own colLength (footprint depth) — NOT the row's rowLength,
  // which is only the row's deepest column and can differ from this column's own depth in a
  // mixed-depth row (PackRow's own comment: "Rows may hold columns of differing depth").
  width: number; // source column's colWidth
  skuId: string;
  skuName: string;
  skuCode: string;
  color: string;
  unitHeight: number;
  weight: number;
}

function expandSourceUnits(state: EditorState, srcTi: number, skuById: Map<string, PackSku>): Unit[] {
  const trailer = state.plan.trailers[srcTi];
  const units: Unit[] = [];
  if (!trailer) return units;
  trailer.rows.forEach((row, ri) => {
    row.columns.forEach((col, ci) => {
      col.layers.forEach((layer, li) => {
        const weight = skuById.get(layer.skuId)?.weight ?? 0;
        for (let n = 0; n < layer.count; n++) {
          units.push({
            ri,
            ci,
            li,
            length: col.colLength,
            width: col.colWidth,
            skuId: layer.skuId,
            skuName: layer.skuName,
            skuCode: layer.skuCode,
            color: layer.color,
            unitHeight: layer.unitHeight,
            weight,
          });
        }
      });
    });
  });
  return units;
}

/** Phase 1 — compute candidate moves without mutating `state.plan`. Works against a scratch clone
 * so later units in the same pass see the headroom/weight already committed by earlier ones,
 * matching legacy's incremental-mutation behaviour (load-builder.html:1945-1950): units are placed
 * greedily, first eligible receiver wins, in source (row, column, layer) order. */
export function proposeDissolve(state: EditorState, srcTi: number): DissolveProposal {
  const skuById = new Map(state.skus.map((s) => [s.id, s]));
  const effHeight = effectiveHeightOf(state);
  const scratch = clonePlan(state.plan);
  const units = expandSourceUnits(state, srcTi, skuById);

  const moves: DissolveMove[] = [];
  const usedReceivers = new Set<string>();
  const trailerRunWeight = new Map<number, number>();

  for (const unit of units) {
    let placed = false;
    for (let ti = 0; ti < scratch.trailers.length && !placed; ti++) {
      if (ti === srcTi) continue;
      const trailer = scratch.trailers[ti];
      for (let ri = 0; ri < trailer.rows.length && !placed; ri++) {
        const row = trailer.rows[ri];
        for (let ci = 0; ci < row.columns.length && !placed; ci++) {
          const col = row.columns[ci];
          // Match the receiver COLUMN's own footprint (colLength/colWidth), not the row's
          // rowLength — a row can hold columns of differing depth, so rowLength is only the
          // deepest column in it and comparing against it can match a column whose actual depth
          // differs from the unit's, producing an orientation the SKU doesn't have (piece-fits-
          // trailer failure at apply). Stacking into an existing column never changes that
          // column's own footprint, so no rowLength check is needed here at all.
          if (!approxEq(col.colLength, unit.length) || !approxEq(col.colWidth, unit.width)) continue;

          const distinctSkuIds = new Set(col.layers.map((l) => l.skuId));
          const isSameSku = distinctSkuIds.has(unit.skuId);
          const headroom = effHeight - col.totalHeight;
          if (!approxGte(headroom, unit.unitHeight)) continue;
          if (!isSameSku) {
            // A different SKU is a top-off, mirroring validatePlan's two rules exactly: the
            // column must not already be at the distinct-SKU cap, and the incoming piece must
            // clear K. Same-SKU stacking (the `isSameSku` branch above) is bound only by headroom.
            if (distinctSkuIds.size >= state.options.maxSkusPerColumn) continue;
            if (!approxGte(unit.unitHeight, state.options.topOffMinInchesPerPiece)) continue;
          }
          const runWeight = trailerRunWeight.get(ti) ?? trailer.usedWeight;
          if (runWeight + unit.weight > state.dims.maxWeight + EPS) continue;

          // Eligible — commit to the scratch column so subsequent units in this same pass see it.
          const existing = col.layers.find((l) => l.skuId === unit.skuId);
          if (existing) {
            existing.count += 1;
          } else {
            col.layers.push({
              skuId: unit.skuId,
              skuName: unit.skuName,
              skuCode: unit.skuCode,
              color: unit.color,
              unitHeight: unit.unitHeight,
              count: 1,
              orientation: { length: col.colLength, width: col.colWidth, height: unit.unitHeight, label: "dissolve" },
            });
          }
          recomputeColumnAggregates(col, skuById);
          trailerRunWeight.set(ti, runWeight + unit.weight);
          usedReceivers.add(`${ti}|${ri}|${ci}`);
          moves.push({
            skuId: unit.skuId,
            skuName: unit.skuName,
            skuCode: unit.skuCode,
            color: unit.color,
            unitHeight: unit.unitHeight,
            weight: unit.weight,
            fromRi: unit.ri,
            fromCi: unit.ci,
            fromLi: unit.li,
            toTi: ti,
            toRi: ri,
            toCi: ci,
          });
          placed = true;
        }
      }
    }
  }

  return { srcTi, moves, totalSrcUnits: units.length, eligibleReceiverCount: usedReceivers.size };
}

/** Phase 2 — subtractive re-apply of the non-excluded subset (legacy: assembleDissolve). Never
 * proposes new moves; only commits some or all of phase 1's. The result still goes through the same
 * validateForApply gate every other edit does — this function does not decide legality, propose()
 * already mirrored it; a proposed-and-accepted move failing here would be a bug in that mirror. */
export function applyDissolve(state: EditorState, proposal: DissolveProposal, excludedKeys: Set<string>): EditorState {
  const selected = proposal.moves.filter((m) => !excludedKeys.has(dissolveGroupKey(m)));
  if (selected.length === 0) return state;

  const skuById = new Map(state.skus.map((s) => [s.id, s]));
  const plan = clonePlan(state.plan);

  const touchedReceivers = new Set<PackColumn>();
  for (const m of selected) {
    const col = plan.trailers[m.toTi]?.rows[m.toRi]?.columns[m.toCi];
    if (!col) continue;
    const existing = col.layers.find((l) => l.skuId === m.skuId);
    if (existing) {
      existing.count += 1;
    } else {
      col.layers.push({
        skuId: m.skuId,
        skuName: m.skuName,
        skuCode: m.skuCode,
        color: m.color,
        unitHeight: m.unitHeight,
        count: 1,
        orientation: { length: col.colLength, width: col.colWidth, height: m.unitHeight, label: "dissolve" },
      });
    }
    touchedReceivers.add(col);
  }
  for (const col of Array.from(touchedReceivers)) {
    recomputeColumnAggregates(col, skuById);
    noteDissolved(col);
  }

  const removeCounts = new Map<string, number>();
  for (const m of selected) {
    removeCounts.set(`${m.fromRi}|${m.fromCi}|${m.fromLi}`, (removeCounts.get(`${m.fromRi}|${m.fromCi}|${m.fromLi}`) ?? 0) + 1);
  }
  const srcTrailer = plan.trailers[proposal.srcTi];
  if (srcTrailer) {
    srcTrailer.rows.forEach((row, ri) => {
      row.columns.forEach((col, ci) => {
        let touched = false;
        col.layers.forEach((layer, li) => {
          const removed = removeCounts.get(`${ri}|${ci}|${li}`) ?? 0;
          if (removed > 0) {
            layer.count -= removed;
            touched = true;
          }
        });
        col.layers = col.layers.filter((l) => l.count > 0);
        if (touched && col.layers.length > 0) {
          recomputeColumnAggregates(col, skuById);
          noteDissolved(col);
        }
      });
      row.columns = row.columns.filter((c) => c.layers.length > 0);
    });
    srcTrailer.rows = srcTrailer.rows.filter((r) => r.columns.length > 0);
  }

  recomputePlan(plan, state.dims, state.options);
  return { ...state, plan, history: withHistory(state) };
}
