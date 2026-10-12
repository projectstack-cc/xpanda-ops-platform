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
// deterministic and golden-exact — so do not "simplify" them. lbr-03 wires this into packEngine.ts.

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
}

export interface PlanStacksOptions {
  consolidate?: boolean;
  maxBreaks?: number;
}

const EPS = 1e-6;

interface Size {
  skuId: string;
  unitHeight: number;
  qty: number;
  full: number;
}

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

// Nondecreasing index tuples of length n over [0, m), in standard lexicographic order.
function combinationsWithReplacement<T>(items: T[], n: number): T[][] {
  const out: T[][] = [];
  const idx: number[] = [];
  const rec = (start: number) => {
    if (idx.length === n) {
      out.push(idx.map((i) => items[i]));
      return;
    }
    for (let i = start; i < items.length; i++) {
      idx.push(i);
      rec(i);
      idx.pop();
    }
  };
  rec(0);
  return out;
}

export function planStacks(skus: PlannerSku[], effectiveHeight: number, stacksPerTruck: number, opts?: PlanStacksOptions): StackPlan {
  const H = effectiveHeight;
  const S = stacksPerTruck;
  const consolidateOn = opts?.consolidate ?? true;
  const maxBreaks = opts?.maxBreaks ?? 6;

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

  function consolidate(C: number): { stacks: PlannedStack[]; breaks: number } | null {
    for (let nb = 0; nb <= maxBreaks; nb++) {
      for (const combo of combinationsWithReplacement(sizes, nb)) {
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
        if (!ok) continue;
        const sorted = st.map((x, i) => ({ x, i })).sort((a, b2) => b2.x.base.unitHeight - a.x.base.unitHeight || a.i - b2.i).map((o) => o.x);
        const E = Math.max(0, sorted.length - C);
        const kept = sorted.slice(0, sorted.length - E);
        const gone = sorted.slice(sorted.length - E);
        const pool = new Map<string, number>();
        for (const g of gone) pool.set(g.base.skuId, (pool.get(g.base.skuId) ?? 0) + g.base.count);
        if (place(kept, pool)) return { stacks: kept, breaks: nb };
      }
    }
    return null;
  }

  const initial = pure();
  const P = initial.length;
  const pureTrucks = S > 0 ? Math.ceil(P / S) : 0;
  let T = pureTrucks;
  const totalHeight = sizes.reduce((sum, s) => sum + s.unitHeight * s.qty, 0);
  const LB = S > 0 && H > 0 ? Math.ceil(totalHeight / (H * S) - EPS) : 0;
  let best: { stacks: PlannedStack[]; breaks: number } = { stacks: initial, breaks: 0 };
  if (consolidateOn && S > 0) {
    while (T > LB) {
      const r = consolidate((T - 1) * S);
      if (!r) break;
      T -= 1;
      best = r;
    }
  }

  const rank = (st: PlannedStack) => [-st.base.unitHeight, st.top !== null || st.kind === "partial" ? 1 : 0, st.kind === "partial" ? 1 : 0];
  const order = best.stacks
    .map((x, i) => ({ x, i, k: rank(x) }))
    .sort((a, b) => {
      for (let k = 0; k < a.k.length; k++) if (a.k[k] !== b.k[k]) return a.k[k] - b.k[k];
      return a.i - b.i;
    })
    .map((o) => o.x);

  return {
    stacks: order,
    trucks: T,
    pureTrucks,
    truckLowerBound: LB,
    shortenedStacks: best.breaks,
    topOffStacks: order.filter((st) => st.top !== null).length,
    skippedSkuIds,
  };
}
