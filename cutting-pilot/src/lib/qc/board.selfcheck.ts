// src/lib/qc/board.selfcheck.ts — qc-01
// Self-check for the pure QC board helpers (board.ts). No DB.
// Run with: npx tsx src/lib/qc/board.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import {
  calcDensity,
  densityVsTarget,
  fmt3,
  groupByShipDay,
  orderState,
  sampleSizeFor,
  type QcLine,
  type QcOrder,
} from "./board";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}

// sampleSizeFor — every boundary of legacy calcSampleSizeRequired.
const sampleCases: [number, number | null][] = [
  [0, null], [1, 1], [2, 2], [3, 3], [50, 3], [51, 5], [150, 5], [151, 8], [500, 8], [501, 10],
];
for (const [lot, want] of sampleCases) eq(`sampleSizeFor(${lot})`, sampleSizeFor(lot), want);
eq("sampleSizeFor(-1)", sampleSizeFor(-1), null);
eq("sampleSizeFor(NaN)", sampleSizeFor(NaN), null);
eq("sampleSizeFor(Infinity)", sampleSizeFor(Infinity), null);

// calcDensity — 48×24×12 block at 8.1 lb.
const d = calcDensity(8.1, 48, 24, 12);
eq("calcDensity in³", d?.cubicInches, 13824);
eq("calcDensity ft³", d?.cubicFeet, 8);
check("calcDensity lb/ft³ ≈ 1.0125", !!d && Math.abs(d.density - 1.0125) < 1e-12, `got ${d?.density}`);
eq("calcDensity displays 1.013", d ? fmt3(d.density) : null, "1.013");
eq("calcDensity ft³ displays 8.000", d ? fmt3(d.cubicFeet) : null, "8.000");
eq("calcDensity null: zero weight", calcDensity(0, 48, 24, 12), null);
eq("calcDensity null: negative length", calcDensity(8.1, -48, 24, 12), null);
eq("calcDensity null: NaN height", calcDensity(8.1, 48, 24, NaN), null);
eq("calcDensity null: Infinity width", calcDensity(8.1, 48, Infinity, 12), null);

// densityVsTarget — all three verdicts, compared at 3-decimal rounding.
const on = densityVsTarget(1.0125, 1.013);
eq("densityVsTarget on: verdict", on.verdict, "on");
eq("densityVsTarget on: variance", on.variance, 0);
const below = densityVsTarget(1.0125, 1.1);
eq("densityVsTarget below: verdict", below.verdict, "below");
eq("densityVsTarget below: variance", below.variance, -0.087);
check("densityVsTarget below: pct ≈ -7.909", Math.abs(below.variancePct - -7.909090909) < 1e-6, `got ${below.variancePct}`);
const above = densityVsTarget(1.0125, 1.0);
eq("densityVsTarget above: verdict", above.verdict, "above");
eq("densityVsTarget above: variance", above.variance, 0.013);
eq("densityVsTarget on after rounding (1.0004 vs 1.0)", densityVsTarget(1.0004, 1.0).verdict, "on");

// orderState — hand-built qc-02-style inspections cast through the qc-01 `null` type.
function ln(id: string, result: "pass" | "fail" | null): QcLine {
  return {
    id,
    description: id,
    dimensions: "",
    quantity: 1,
    sort_order: 0,
    inspection: (result ? { result } : null) as unknown as null,
  };
}
function ord(job_id: string, ship_date: string, lines: QcLine[]): QcOrder {
  return { job_id, invoice_number: job_id, customer: "C", ship_date, status: "done", lines };
}
eq("orderState open", orderState(ord("a", "", [ln("1", null), ln("2", null)])), "open");
eq("orderState partial", orderState(ord("a", "", [ln("1", "pass"), ln("2", null)])), "partial");
eq("orderState passed", orderState(ord("a", "", [ln("1", "pass"), ln("2", "pass")])), "passed");
eq("orderState failed (beats open)", orderState(ord("a", "", [ln("1", "fail"), ln("2", null)])), "failed");

// groupByShipDay — ascending, "No Date" last.
const groups = groupByShipDay([
  ord("x", "2026-10-14", []),
  ord("y", "", []),
  ord("z", "2026-10-12", []),
  ord("w", "2026-10-14", []),
  ord("v", null as unknown as string, []),
]);
eq("groupByShipDay keys", groups.map((g) => g.dateKey), ["2026-10-12", "2026-10-14", "No Date"]);
eq("groupByShipDay members", groups.map((g) => g.orders.map((o) => o.job_id)), [["z"], ["x", "w"], ["y", "v"]]);

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  (${r.detail})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
