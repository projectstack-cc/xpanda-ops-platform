// src/lib/qc/board.selfcheck.ts — qc-01
// Self-check for the pure QC board helpers (board.ts). No DB.
// Run with: npx tsx src/lib/qc/board.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import {
  DEFAULT_TOLERANCE,
  TOLERANCES,
  calcDensity,
  densityVsTarget,
  fmt3,
  groupByShipDay,
  inspectionResult,
  isSampleComplete,
  isStale,
  nominalFromLine,
  orderState,
  outOfTolerance,
  sampleSizeFor,
  type QcLine,
  type QcLineInspection,
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

// orderState — real QcLineInspection objects (qc-02).
function insp(result: "pass" | "fail"): QcLineInspection {
  return { id: `i-${result}`, result, inspector_name: "Tester", inspected_at: "2026-10-16 14:00:00", drive_status: "pending", drive_file_id: null, drive_error: null, drive_attempted_at: null, stale: false };
}
function ln(id: string, result: "pass" | "fail" | null): QcLine {
  return { id, description: id, dimensions: "", quantity: 1, sort_order: 0, inspection: result ? insp(result) : null };
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

// qc-02: nominalFromLine — prompt table, then extra formats seen in D1 (2026-10-15 sample).
const nom = (dims: string, desc = "") => nominalFromLine(dims, desc);
eq('nominal 2" x 48" x 144"', nom('2" x 48" x 144"'), { length: 144, width: 48, height: 2, taper: null });
eq("nominal description fallback 15.5X37.5X3-9/16", nom("", "FOAM-HT1840-4 ~ 15.5X37.5X3-9/16"), { length: 37.5, width: 15.5, height: 3.5625, taper: null });
eq("nominal taper 2.5-4” x 39” x 80”", nom("2.5-4” x 39” x 80”"), { length: 80, width: 39, height: 4, taper: "2.5–4" });
eq('nominal taper 3>5" x 47" x 96"', nom('3>5" x 47" x 96"').taper, "3–5");
eq("nominal 1X42X42", nom("1X42X42"), { length: 42, width: 42, height: 1, taper: null });
eq("nominal garbage", nom("call for size", "misc foam"), { length: null, width: null, height: null, taper: null });
eq('nominal taper with inch mark 2">4" x 55" x 96"', nom('2">4" x 55" x 96"'), { length: 96, width: 55, height: 4, taper: "2–4" });
eq("nominal '' inch marks", nom("120.75''x15.75''x32.25''"), { length: 120.75, width: 32.25, height: 15.75, taper: null });
eq('nominal 0-2" taper', nom('0-2" x 48" x 48"').taper, "0–2");
eq("nominal curly mixed 19-3/4”", nom("19-3/4” x 30-3/4” x 8”"), { length: 30.75, width: 19.75, height: 8, taper: null });
eq("nominal spaced description fallback", nom("", 'Foam Block 1.0# RC - SQUARE CUT 1-1/2" x 11-7/8"" x 144"'), { length: 144, width: 11.875, height: 1.5, taper: null });
eq("nominal ×", nom("48×24×1"), { length: 48, width: 24, height: 1, taper: null });
eq("nominal 2 numbers → height null", nom('48" x 96"'), { length: 96, width: 48, height: null, taper: null });
eq("nominal reversed taper (b < a) → unparsed", nom('4-2" x 53" x 96"').length, null);

// TOLERANCES / outOfTolerance — both sides of the boundary, exactly at it is not out.
eq("tolerance values", TOLERANCES.map((t) => t.value), [0.0625, 0.125, 0.1875, 0.25]);
eq("default tolerance", DEFAULT_TOLERANCE, 0.125);
eq("outOfTolerance just inside", outOfTolerance(48.1, 48, 0.125), false);
eq("outOfTolerance exactly at tol (over)", outOfTolerance(48.125, 48, 0.125), false);
eq("outOfTolerance exactly at tol (under)", outOfTolerance(47.875, 48, 0.125), false);
eq("outOfTolerance just over", outOfTolerance(48.13, 48, 0.125), true);
eq("outOfTolerance just under", outOfTolerance(47.87, 48, 0.125), true);
eq("outOfTolerance null nominal", outOfTolerance(50, null, 0.125), false);

// isSampleComplete / inspectionResult.
const full = { length: 48, width: 24, height: 2, result: "pass" as const };
eq("isSampleComplete full", isSampleComplete(full), true);
eq("isSampleComplete missing H", isSampleComplete({ ...full, height: null }), false);
eq("isSampleComplete missing result", isSampleComplete({ ...full, result: null }), false);
eq("isSampleComplete string L rejected", isSampleComplete({ ...full, length: "48" }), false);
eq("inspectionResult all pass", inspectionResult([{ result: "pass" }, { result: "pass" }]), "pass");
eq("inspectionResult any fail", inspectionResult([{ result: "pass" }, { result: "fail" }]), "fail");

// isStale — qty numeric, dims whitespace-insensitive.
eq("isStale same", isStale(16, '2-4" x 53" x 96"', 16, ' 2-4"  x 53" x  96" '), false);
eq("isStale qty changed", isStale(16, "a", 20, "a"), true);
eq("isStale dims changed", isStale(16, '2" x 48"', 16, '3" x 48"'), true);

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  (${r.detail})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
