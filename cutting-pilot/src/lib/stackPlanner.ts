// src/lib/stackPlanner.ts
// lbr-02: pure stack planner for one footprint family. No React, no fetch, no runtime imports.
//
// Encodes the floor's locked loading rules (Steve, 2026-10-12, final — these supersede the
// 2026-09-16 holey-sequential-fill rule, which topped off every column):
//   1. Fewest trucks. If mixing saves a truck, always mix.
//   2. Pure first: every size gets full-height pure stacks plus at most one leftover stack. Mixing
//      happens only to save a truck, and overflow pieces become top-offs on existing stacks.
//   3. At most 2 sizes per stack; the top-off is one size, strictly thinner than the base.
//   4. Shorten a full stack only as a last resort, and as few as possible.
//   5. Thickest at the nose. Within one size: pure full stacks, then topped-off full stacks, then
//      partial (leftover or shortened) stacks last.
//
// Direct port of the Orchestrator's reference algorithm (checked against an exact integer-program
// optimum on the golden INV 4472 load). Tie-breaks are part of the contract — they keep output
// deterministic and golden-exact — so do not "simplify" them.
//
// lbr-03 wires this into packEngine.ts (pure stacks per family via consolidate:false, then
// planStacksWithin to drop a trailer) and adds three additive options: minTopOffHeight (K), a
// deterministic work budget counted in place() attempts (never wall-clock — the lb-harness needs
// byte-identical output), and planStacksWithin. With none of them set, behavior is unchanged.

export interface PlannerSku {
  skuId: string;
  unitHeight: number;
  qty: number;
  maxPerStack?: number; // weight cap (count); default ∞
}

export interface PlannedLayer {
  skuId: string;
  unitHeight: number;
  count: number;
}

export interface PlannedStack {
  base: PlannedLayer;
  top: PlannedLayer | null; // ≤1 top-off layer, strictly thinner than base
  kind: "full" | "partial"; // partial = leftover or shortened
}

export interface StackPlan {
  stacks: PlannedStack[]; // in LOADING ORDER: index 0 = nose
  trucks: number;
  pureTrucks: number; // trucks the all-pure plan would need
  truckLowerBound: number;
  shortenedStacks: number; // rule 4 count ("N stacks shortened to fit on T trucks")
  topOffStacks: number;
  // SKUs that can't form a single-piece stack (unitHeight > effectiveHeight, or maxPerStack < 1).
  // They are left out of the plan entirely; the caller reports them as unplaced.
  skippedSkuIds: string[];
  // lbr-03: true when the work budget ran out mid-consolidation; the plan is the best found so far.
  budgetExhausted?: boolean;
}

/** A work budget shared across several planner calls (lbr-03: one budget per pack() call). */
export interface PlannerBudget {
  remaining: number;
}

export interface PlanStacksOptions {
  consolidate?: boolean;
  maxBreaks?: number;
  // lbr-03: a pool SKU thinner than this is never a top-off candidate (packEngine's K,
  // topOffMinInchesPerPiece). Default 0.
  minTopOffHeight?: number;
  // lbr-03: deterministic budget on place() attempts across one call. Default 50_000.
  maxWork?: number;
  // lbr-03: shared budget object; when given it is used (and decremented) instead of maxWork.
  budget?: PlannerBudget;
}

const EPS = 1e-6;
const DEFAULT_MAX_WORK = 50_000;

interface Size {
  skuId: string;
  unitHeight: number;
  qty: number;
  full: number;
}

type Consolidated = { stacks: PlannedStack[]; breaks: number };

function stackHeight(st: PlannedStack): number {
  return st.base.unitHeight * st.base.count + (st.top ? st.top.unitHeight * st.top.count : 0);
}

// Lexicographic "a > b" over number tuples, with EPS on each component (several are heights).
function keyGreater(a: number[], b: number[]): boolean {
  for (let k = 0; k < a.length; k++) {
    if (a[k] > b[k] + EPS) return true;
    if (a[k] < b[k] - EPS) return false;
  }
  return false;
}

// Visits nondecreasing index tuples of length n over [0, m), in standard lexicographic order,
// stopping as soon as `visit` returns true (so a success or a budget stop never enumerates the
// combinations it won't try). Returns whether a visit stopped it.
function forEachCombinationWithReplacement<T>(items: T[], n: number, visit: (combo: T[]) => boolean): boolean {
  const idx: number[] = [];
  const rec = (start: number): boolean => {
    if (idx.length === n) return visit(idx.map((i) => items[i]));
    for (let i = start; i < items.length; i++) {
      idx.push(i);
      if (rec(i)) return true;
      idx.pop();
    }
    return false;
  };
  return rec(0);
}

// Rule 5 loading order: thickest first; within a size pure full, then topped full, then partial.
function loadingOrder(stacks: PlannedStack[]): PlannedStack[] {
  const rank = (st: PlannedStack) => [-st.base.unitHeight, st.top !== null || st.kind === "partial" ? 1 : 0, st.kind === "partial" ? 1 : 0];
  return stacks
    .map((x, i) => ({ x, i, k: rank(x) }))
    .sort((a, b) => {
      for (let k = 0; k < a.k.length; k++) if (a.k[k] !== b.k[k]) return a.k[k] - b.k[k];
      return a.i - b.i;
    })
    .map((o) => o.x);
}

// The shared core: sizes, pure(), place() and consolidate(), exactly as the reference algorithm
// specifies. planStacks and planStacksWithin are thin drivers over it.
function makePlanner(skus: PlannerSku[], H: number, opts?: PlanStacksOptions) {
  const maxBreaks = opts?.maxBreaks ?? 6;
  const minTopOff = opts?.minTopOffHeight ?? 0;
  const budget: PlannerBudget = opts?.budget ?? { remaining: opts?.maxWork ?? DEFAULT_MAX_WORK };
  const state = { exhausted: false };

  const skippedSkuIds: string[] = [];
  const sizes: Size[] = [];
  for (const s of skus) {
    if (!(s.qty > 0)) continue;
    const full = Math.min(Math.floor((H + EPS) / s.unitHeight), s.maxPerStack ?? Infinity);
    if (!(full >= 1)) {
      skippedSkuIds.push(s.skuId);
      continue;
    }
    sizes.push({ skuId: s.skuId, unitHeight: s.unitHeight, qty: s.qty, full });
  }
  sizes.sort((a, b) => b.unitHeight - a.unitHeight || (a.skuId < b.skuId ? -1 : a.skuId > b.skuId ? 1 : 0));

  function pure(): PlannedStack[] {
    const out: PlannedStack[] = [];
    for (const s of sizes) {
      const q = Math.floor(s.qty / s.full);
      const r = s.qty - q * s.full;
      for (let i = 0; i < q; i++) out.push({ base: { skuId: s.skuId, unitHeight: s.unitHeight, count: s.full }, top: null, kind: "full" });
      if (r > 0) out.push({ base: { skuId: s.skuId, unitHeight: s.unitHeight, count: r }, top: null, kind: "partial" });
    }
    return out;
  }

  function place(kept: PlannedStack[], pool: Map<string, number>): boolean {
    const poolSizes = sizes.filter((s) => (pool.get(s.skuId) ?? 0) > 0); // already unitHeight DESC, skuId ASC
    for (const s of poolSizes) {
      let q = pool.get(s.skuId) ?? 0;
      // lbr-03: below K, a SKU is never a top-off, so pieces of it left in the pool can't be placed.
      if (s.unitHeight < minTopOff - EPS) return false;
      while (q > 0) {
        let best: PlannedStack | null = null;
        let bestKey: number[] | null = null;
        let bestCap = 0;
        kept.forEach((st, i) => {
          if (!(st.base.unitHeight > s.unitHeight + EPS)) return;
          if (st.top !== null && st.top.skuId !== s.skuId) return;
          const gap = H - stackHeight(st);
          if (!(gap + EPS >= s.unitHeight)) return;
          const cap = Math.floor((gap + EPS) / s.unitHeight);
          const key = [
            st.top?.skuId === s.skuId ? 1 : 0, // already topped with s -> no new mixed stack
            -(gap - cap * s.unitHeight), // least wasted gap
            st.kind === "partial" ? 1 : 0, // prefer partial stacks
            -Math.abs(st.base.unitHeight - s.unitHeight), // closest base size
            i, // rear-most
          ];
          if (bestKey === null || keyGreater(key, bestKey)) {
            best = st;
            bestKey = key;
            bestCap = cap;
          }
        });
        if (best === null) return false;
        const chosen: PlannedStack = best;
        const take = Math.min(bestCap, q);
        chosen.top = { skuId: s.skuId, unitHeight: s.unitHeight, count: (chosen.top?.count ?? 0) + take };
        q -= take;
      }
    }
    return true;
  }

  // Try to fit everything into C stacks. Returns null on failure; sets state.exhausted (and
  // returns null) when the budget runs out first.
  function consolidate(C: number): Consolidated | null {
    let found: Consolidated | null = null;
    for (let nb = 0; nb <= maxBreaks; nb++) {
      const stopped = forEachCombinationWithReplacement(sizes, nb, (combo) => {
        const st = pure();
        let ok = true;
        for (const b of combo) {
          // Shorten one full stack of b by one piece.
          const fulls = st.filter((x) => x.base.skuId === b.skuId && x.kind === "full");
          const lo = st.find((x) => x.base.skuId === b.skuId && x.kind === "partial") ?? null; // looked up BEFORE this shortening
          if (fulls.length === 0) {
            ok = false;
            break;
          }
          const f = fulls[fulls.length - 1];
          f.base.count -= 1;
          f.kind = "partial";
          if (lo && lo.base.count < b.full) lo.base.count += 1;
          else st.push({ base: { skuId: b.skuId, unitHeight: b.unitHeight, count: 1 }, top: null, kind: "partial" });
        }
        if (!ok) return false;
        const sorted = st.map((x, i) => ({ x, i })).sort((a, b2) => b2.x.base.unitHeight - a.x.base.unitHeight || a.i - b2.i).map((o) => o.x);
        const E = Math.max(0, sorted.length - C);
        // lbr-03: with minTopOffHeight set, a sub-K stack can never be re-placed as a top-off, so
        // it is never one of the E stacks dropped into the pool — the cut takes the last E
        // K-eligible stacks instead, and kept keeps sorted order (place()'s index tie-break is
        // unchanged). With no minTopOffHeight (default 0) nothing is sub-K and this is exactly the
        // reference algorithm's kept = sorted[0..len-E), gone = the rest.
        const eligible = sorted.filter((x) => !(x.base.unitHeight < minTopOff - EPS));
        if (E > eligible.length) return false;
        const goneSet = new Set(eligible.slice(eligible.length - E));
        const kept = sorted.filter((x) => !goneSet.has(x));
        const gone = sorted.filter((x) => goneSet.has(x));
        const pool = new Map<string, number>();
        for (const g of gone) pool.set(g.base.skuId, (pool.get(g.base.skuId) ?? 0) + g.base.count);
        if (budget.remaining <= 0) {
          state.exhausted = true;
          return true;
        }
        budget.remaining -= 1;
        if (place(kept, pool)) {
          found = { stacks: kept, breaks: nb };
          return true;
        }
        return false;
      });
      if (stopped) return found;
    }
    return null;
  }

  return { sizes, skippedSkuIds, pure, consolidate, state };
}

export function planStacks(skus: PlannerSku[], effectiveHeight: number, stacksPerTruck: number, opts?: PlanStacksOptions): StackPlan {
  const H = effectiveHeight;
  const S = stacksPerTruck;
  const consolidateOn = opts?.consolidate ?? true;
  const planner = makePlanner(skus, H, opts);

  const initial = planner.pure();
  const P = initial.length;
  const pureTrucks = S > 0 ? Math.ceil(P / S) : 0;
  let T = pureTrucks;
  const totalHeight = planner.sizes.reduce((sum, s) => sum + s.unitHeight * s.qty, 0);
  const LB = S > 0 && H > 0 ? Math.ceil(totalHeight / (H * S) - EPS) : 0;
  let best: Consolidated = { stacks: initial, breaks: 0 };
  if (consolidateOn && S > 0) {
    while (T > LB) {
      const r = planner.consolidate((T - 1) * S);
      if (!r) break;
      T -= 1;
      best = r;
    }
  }

  const order = loadingOrder(best.stacks);
  const plan: StackPlan = {
    stacks: order,
    trucks: T,
    pureTrucks,
    truckLowerBound: LB,
    shortenedStacks: best.breaks,
    topOffStacks: order.filter((st) => st.top !== null).length,
    skippedSkuIds: planner.skippedSkuIds,
  };
  if (planner.state.exhausted) plan.budgetExhausted = true;
  return plan;
}

/**
 * lbr-03: one consolidate(maxStacks) run — fit the whole demand into at most `maxStacks` stacks
 * with the same pure -> breaks -> place algorithm and tie-breaks as planStacks. Returns the plan in
 * rule-5 loading order, or null on failure or an exhausted budget. trucks / pureTrucks /
 * truckLowerBound are meaningless here and are 0.
 */
export function planStacksWithin(skus: PlannerSku[], effectiveHeight: number, maxStacks: number, opts?: PlanStacksOptions): StackPlan | null {
  const planner = makePlanner(skus, effectiveHeight, opts);
  const r = planner.consolidate(maxStacks);
  if (!r) return null;
  const order = loadingOrder(r.stacks);
  return {
    stacks: order,
    trucks: 0,
    pureTrucks: 0,
    truckLowerBound: 0,
    shortenedStacks: r.breaks,
    topOffStacks: order.filter((st) => st.top !== null).length,
    skippedSkuIds: planner.skippedSkuIds,
  };
}
