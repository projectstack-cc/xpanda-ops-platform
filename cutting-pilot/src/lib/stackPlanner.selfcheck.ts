// src/lib/stackPlanner.selfcheck.ts
// Guarded dev self-check for stackPlanner.ts (lbr-02). Mirrors packEngine.selfcheck.ts's shape: a
// check()/results table, one exported run*SelfCheck() function. Not part of the production build
// path, and nothing imports it. Covers the golden INV 4472 trailer-1 load (exact nose->doors
// sequence), a load that fits pure, a load where consolidation can't save a truck, the
// consolidate:false pure plan, and the planner's invariants on every case.
import { planStacks, planStacksWithin, type PlannerSku, type PlannedStack, type StackPlan } from "./stackPlanner";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const EPS = 1e-6;

function fmt(st: PlannedStack): string {
  return `${st.base.unitHeight}x${st.base.count}` + (st.top ? `+${st.top.unitHeight}x${st.top.count}` : "");
}

// Run-length "9×13x8, 13x7+9x2, …" form of a sequence, for readable failure details.
function runs(seq: string[]): string {
  const out: Array<[string, number]> = [];
  for (const k of seq) {
    const last = out[out.length - 1];
    if (last && last[0] === k) last[1]++;
    else out.push([k, 1]);
  }
  return out.map(([k, n]) => (n > 1 ? `${n}×${k}` : k)).join(", ");
}

function expand(spec: Array<[number, string]>): string[] {
  const out: string[] = [];
  for (const [n, k] of spec) for (let i = 0; i < n; i++) out.push(k);
  return out;
}

// Invariant problems for a plan (empty = all hold): every stack <= H, <= 2 layers, top strictly
// thinner than base, per-SKU piece counts conserved, and rule 5 order (base height non-increasing;
// within a base size: pure full, then topped full, then partial).
function invariantProblems(plan: StackPlan, skus: PlannerSku[], H: number): string[] {
  const problems: string[] = [];
  const placed = new Map<string, number>();
  plan.stacks.forEach((st, i) => {
    const h = st.base.unitHeight * st.base.count + (st.top ? st.top.unitHeight * st.top.count : 0);
    if (h > H + EPS) problems.push(`stack ${i} ${fmt(st)} is ${h}" > ${H}"`);
    if (st.base.count < 1 || (st.top && st.top.count < 1)) problems.push(`stack ${i} ${fmt(st)} has an empty layer`);
    if (st.top && !(st.top.unitHeight < st.base.unitHeight - EPS)) problems.push(`stack ${i} ${fmt(st)} top not strictly thinner`);
    for (const l of [st.base, ...(st.top ? [st.top] : [])]) placed.set(l.skuId, (placed.get(l.skuId) ?? 0) + l.count);
    if (i > 0) {
      const prev = plan.stacks[i - 1];
      const rank = (s: PlannedStack) => (s.kind === "partial" ? 2 : s.top ? 1 : 0);
      if (st.base.unitHeight > prev.base.unitHeight + EPS) problems.push(`stack ${i} ${fmt(st)} thicker than stack ${i - 1} ${fmt(prev)}`);
      else if (Math.abs(st.base.unitHeight - prev.base.unitHeight) <= EPS && rank(st) < rank(prev))
        problems.push(`stack ${i} ${fmt(st)} (${st.kind}) out of order after ${fmt(prev)} (${prev.kind})`);
    }
  });
  for (const s of skus) {
    if (plan.skippedSkuIds.includes(s.skuId)) continue;
    if ((placed.get(s.skuId) ?? 0) !== s.qty) problems.push(`sku ${s.skuId}: placed ${placed.get(s.skuId) ?? 0} of ${s.qty}`);
  }
  return problems;
}

export function runStackPlannerSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, got: unknown, want: unknown) => check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  const invariants = (name: string, plan: StackPlan, skus: PlannerSku[], H: number) => {
    const problems = invariantProblems(plan, skus, H);
    check(`${name}: invariants (≤H, ≤2 layers, thinner top, pieces conserved, rule 5 order)`, problems.length === 0, problems.slice(0, 5).join("; "));
  };

  // (a) Golden GOLDEN_4472_T1 — INV 4472 trailer 1, all 48x24 Holey Board, H 109, 52 stacks/truck.
  const golden: PlannerSku[] = [
    { skuId: "hb-13", unitHeight: 13, qty: 85 },
    { skuId: "hb-12", unitHeight: 12, qty: 120 },
    { skuId: "hb-11", unitHeight: 11, qty: 195 },
    { skuId: "hb-10", unitHeight: 10, qty: 85 },
    { skuId: "hb-09", unitHeight: 9, qty: 6 },
    { skuId: "hb-08", unitHeight: 8, qty: 1 },
  ];
  const g = planStacks(golden, 109, 52);
  eq("golden: totals", { trucks: g.trucks, pureTrucks: g.pureTrucks, truckLowerBound: g.truckLowerBound, topOffStacks: g.topOffStacks, shortenedStacks: g.shortenedStacks, stacks: g.stacks.length }, {
    trucks: 1,
    pureTrucks: 2,
    truckLowerBound: 1,
    topOffStacks: 30,
    shortenedStacks: 1,
    stacks: 52,
  });
  const goldenWant = expand([
    [9, "13x8"],
    [1, "13x7+9x2"],
    [1, "13x6+10x3"],
    [13, "12x9"],
    [1, "12x3+10x7"],
    [21, "11x9+10x1"],
    [1, "11x6+10x4"],
    [1, "10x10+8x1"],
    [4, "10x10+9x1"],
  ]);
  const goldenGot = g.stacks.map(fmt);
  check("golden: exact nose->doors sequence", JSON.stringify(goldenGot) === JSON.stringify(goldenWant), runs(goldenGot));
  invariants("golden", g, golden, 109);

  // (b) Fits pure: 13" x 40 -> 5 full stacks of 8, no top-offs, 1 truck.
  const pureFit: PlannerSku[] = [{ skuId: "hb-13", unitHeight: 13, qty: 40 }];
  const b = planStacks(pureFit, 109, 52);
  eq("fits pure: totals", { trucks: b.trucks, stacks: b.stacks.length, topOffStacks: b.topOffStacks, shortenedStacks: b.shortenedStacks }, { trucks: 1, stacks: 5, topOffStacks: 0, shortenedStacks: 0 });
  check("fits pure: every stack is a pure full 13x8", b.stacks.every((st) => st.kind === "full" && !st.top && st.base.count === 8), runs(b.stacks.map(fmt)));
  invariants("fits pure", b, pureFit, 109);

  // (c) Can't save a truck: two different SKUs of equal height (50") with one piece each, one
  // stack per truck. Volume says 1 truck (100" <= 109"), but equal heights never top each other
  // (strictly thinner rule) and neither SKU has a full stack to shorten, so the pure 2 stands.
  const noSave: PlannerSku[] = [
    { skuId: "a-50", unitHeight: 50, qty: 1 },
    { skuId: "b-50", unitHeight: 50, qty: 1 },
  ];
  const c = planStacks(noSave, 109, 1);
  check("can't save: premise pureTrucks === trucks > truckLowerBound", c.pureTrucks === c.trucks && c.trucks > c.truckLowerBound, JSON.stringify({ pureTrucks: c.pureTrucks, trucks: c.trucks, lb: c.truckLowerBound }));
  eq("can't save: 0 top-offs, 0 shortened, 2 trucks", { trucks: c.trucks, topOffStacks: c.topOffStacks, shortenedStacks: c.shortenedStacks }, { trucks: 2, topOffStacks: 0, shortenedStacks: 0 });
  invariants("can't save", c, noSave, 109);

  // (d) consolidate:false on the golden load -> the pure plan: 2 trucks, 58 stacks, no top-offs.
  const d = planStacks(golden, 109, 52, { consolidate: false });
  eq("consolidate:false golden: totals", { trucks: d.trucks, pureTrucks: d.pureTrucks, stacks: d.stacks.length, topOffStacks: d.topOffStacks, shortenedStacks: d.shortenedStacks }, {
    trucks: 2,
    pureTrucks: 2,
    stacks: 58,
    topOffStacks: 0,
    shortenedStacks: 0,
  });
  invariants("consolidate:false golden", d, golden, 109);

  // Fractional heights stay on the EPS path: 5.25" x 41 on H 109 -> full = 20 (105"), pure 3 stacks.
  const frac: PlannerSku[] = [{ skuId: "hb-5.25", unitHeight: 5.25, qty: 41 }];
  const e = planStacks(frac, 109, 52);
  eq("fractional: 2x20 + 1x1", e.stacks.map(fmt), ["5.25x20", "5.25x20", "5.25x1"]);
  invariants("fractional", e, frac, 109);

  // A SKU taller than H can't form a stack: reported in skippedSkuIds, not silently dropped.
  const tooTall = planStacks([{ skuId: "x-120", unitHeight: 120, qty: 3 }, ...pureFit], 109, 52);
  eq("too tall: skipped + rest planned", { skipped: tooTall.skippedSkuIds, stacks: tooTall.stacks.length }, { skipped: ["x-120"], stacks: 5 });

  // (f) lbr-03 planStacksWithin: one consolidate(52) run on the golden load is exactly planStacks'
  // golden sequence (same pure -> breaks -> place algorithm and tie-breaks).
  const f = planStacksWithin(golden, 109, 52);
  check("planStacksWithin golden@52: equals planStacks' golden sequence", !!f && JSON.stringify(f.stacks.map(fmt)) === JSON.stringify(goldenWant), f ? runs(f.stacks.map(fmt)) : "null");
  eq("planStacksWithin golden@52: counts (trucks fields 0)", f && { trucks: f.trucks, pureTrucks: f.pureTrucks, truckLowerBound: f.truckLowerBound, topOffStacks: f.topOffStacks, shortenedStacks: f.shortenedStacks }, {
    trucks: 0,
    pureTrucks: 0,
    truckLowerBound: 0,
    topOffStacks: 30,
    shortenedStacks: 1,
  });
  if (f) invariants("planStacksWithin golden@52", f, golden, 109);
  check("planStacksWithin golden@51: can't fit -> null", planStacksWithin(golden, 109, 51) === null);

  // (g) K: a 2" SKU is never a top-off with minTopOffHeight 3. 13x8=104" leaves 5" — room for two
  // 2" pieces — so without K the 2" stack folds into a top-off and saves the truck; with K it can't.
  const kSkus: PlannerSku[] = [
    { skuId: "hb-13", unitHeight: 13, qty: 8 },
    { skuId: "hb-02", unitHeight: 2, qty: 2 },
  ];
  const gNoK = planStacks(kSkus, 109, 1);
  eq("K premise: without K the 2\" pieces top off (1 truck)", { trucks: gNoK.trucks, stacks: gNoK.stacks.map(fmt) }, { trucks: 1, stacks: ["13x8+2x2"] });
  const gK = planStacks(kSkus, 109, 1, { minTopOffHeight: 3 });
  eq("K: with minTopOffHeight 3 the 2\" SKU is never a top-off", { trucks: gK.trucks, topOffStacks: gK.topOffStacks, stacks: gK.stacks.map(fmt) }, { trucks: 2, topOffStacks: 0, stacks: ["13x8", "2x2"] });
  check("K: planStacksWithin also refuses the sub-K top-off", planStacksWithin(kSkus, 109, 1, { minTopOffHeight: 3 }) === null);
  invariants("K", gK, kSkus, 109);

  // (g2) lbr-03 sub-K cut (INV 4351's shape): with K active, a sub-K leftover stack is never the one
  // dropped into the top-off pool — an eligible stack is, so the truck is still saved. 7" x 30 = two
  // 7x15 stacks with a 4" gap each, 3" x 2, 1" x 5; 3 stacks per truck. Pure = 4 stacks (2 trucks).
  // The reference cut would drop the 1" stack (thinnest) and fail at K = 3; the K-aware cut drops
  // the 3" stack and tops each 7" stack with one 3" piece -> 3 stacks, 1 truck.
  const subK: PlannerSku[] = [
    { skuId: "hb-07", unitHeight: 7, qty: 30 },
    { skuId: "hb-03", unitHeight: 3, qty: 2 },
    { skuId: "hb-01", unitHeight: 1, qty: 5 },
  ];
  const g2 = planStacks(subK, 109, 3, { minTopOffHeight: 3 });
  eq("sub-K cut: K = 3 still saves the truck via the eligible 3\" stack", { trucks: g2.trucks, pureTrucks: g2.pureTrucks, stacks: g2.stacks.map(fmt) }, {
    trucks: 1,
    pureTrucks: 2,
    stacks: ["7x15+3x1", "7x15+3x1", "1x5"],
  });
  check("sub-K cut: the 1\" SKU is never a top-off", g2.stacks.every((st) => st.top?.skuId !== "hb-01"));
  invariants("sub-K cut", g2, subK, 109);

  // (h) budget: maxWork 1 on the golden load runs out before the first place() that succeeds is
  // reached — budgetExhausted, and the pure plan comes back intact and valid.
  const h = planStacks(golden, 109, 52, { maxWork: 1 });
  eq("budget: maxWork 1 -> budgetExhausted + pure plan", { budgetExhausted: h.budgetExhausted, trucks: h.trucks, stacks: h.stacks.length, topOffStacks: h.topOffStacks }, {
    budgetExhausted: true,
    trucks: 2,
    stacks: 58,
    topOffStacks: 0,
  });
  invariants("budget", h, golden, 109);
  check("budget: default budget never reports exhaustion on the golden load", g.budgetExhausted === undefined);
  check("budget: planStacksWithin with maxWork 1 -> null", planStacksWithin(golden, 109, 52, { maxWork: 1 }) === null);

  return { pass: results.every((r) => r.pass), results };
}
