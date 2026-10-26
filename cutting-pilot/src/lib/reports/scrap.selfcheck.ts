// src/lib/reports/scrap.selfcheck.ts — rpt-04
// Self-check for the pure Scrap report (scrap.ts).
// Run with: npx tsx cutting-pilot/src/lib/reports/scrap.selfcheck.ts (any cwd). Exits 1 on any failure.
import type { ScrapRow } from "../qc/scrap";
import { SCRAP_PROMPT_LIVE, TEST_VOID_REASON, buildScrapReport, mondayOf, sizeText, weekLabel, type ScrapRaw } from "./scrap";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}
const near = (name: string, a: number | null, b: number) => check(name, a !== null && Math.abs(a - b) < 1e-9, `got ${a}, expected ${b}`);

let n = 0;
function row(p: Partial<ScrapRow> & { event_date: string }): ScrapRow {
  n += 1;
  return {
    id: `s${n}`, week_number: 1, month_name: "October", shift: "1", source: "cutting", job_id: `job${n}`,
    line_item_id: null, cutting_line_id: null, inv_number: `${4000 + n}`, customer: "Acme", line_machine: "Main Line",
    operator_id: null, operator_name: "Ana", part_product: "Block", material_density: "1.0 lb", pieces: 2,
    thickness_in: 2, width_in: 24, length_in: 48, scrap_cubic_in: 4608, scrap_board_ft: 32, scrap_reason: "Incorrect Cut",
    notes: null, created_by_id: null, created_by_name: null, created_at: `${p.event_date} 12:00:00`, voided_at: null,
    voided_by_name: null, void_reason: null, ...p,
  };
}
const TODAY = "2026-10-23";
const base = { line: null as string | null, reason: null as string | null, shift: null as string | null, showVoided: false, todayEt: TODAY };
const raw = (p: Partial<ScrapRaw>): ScrapRaw => ({ rows: [], activity: [], closedSessions: [], months: [], ...p });
const build = (r: Partial<ScrapRaw>, o: Partial<typeof base & { from: string; to: string }> = {}) =>
  buildScrapReport(raw(r), { from: "2026-10-01", to: "2026-10-23", ...base, ...o });

// ── Voided never counts ──────────────────────────────────────────────────────────────────────
const fixture = [
  row({ event_date: "2026-10-05", scrap_board_ft: 10, pieces: 3, line_machine: "Main Line", scrap_reason: "Incorrect Cut", shift: "1", source: "cutting" }),
  row({ event_date: "2026-10-14", scrap_board_ft: 7.25, pieces: null, line_machine: "Blue Line", scrap_reason: "Setup Error", shift: "2", source: "qc", operator_name: "Ben" }),
  row({ event_date: "2026-10-20", scrap_board_ft: 4.5, pieces: 1, line_machine: "Blue Line", scrap_reason: "Incorrect Cut", shift: "1", source: "cutting", operator_name: "Ben" }),
  row({ event_date: "2026-10-21", scrap_board_ft: 100, pieces: 9, line_machine: "Main Line", voided_at: "2026-10-22 10:00:00", void_reason: "typo" }),
  row({ event_date: "2026-09-30", scrap_board_ft: 50 }),   // out of range
];
{
  const r = build({ rows: fixture });
  near("boardFt excludes voided + out of range", r.kpis.boardFt, 21.75);
  eq("entries", r.kpis.entries, 3);
  eq("voided counted separately", r.kpis.voided, 1);
  eq("pieces null-safe", r.kpis.pieces, 4);
  eq("voided not in list by default", r.list.map((x) => x.id), ["s3", "s2", "s1"]);
  eq("topReason", r.kpis.topReason, { name: "Incorrect Cut", boardFt: 14.5 });
  eq("topLine (Blue 11.75 > Main 10)", r.kpis.topLine, { name: "Blue Line", boardFt: 11.75 });
  eq("byReason all six in order", r.byReason.map((b) => b.name), ["Incorrect Cut", "Hole Pass Issue", "Dirty / Wet Foam", "Equipment Issue", "Setup Error", "Other"]);
  eq("byLine only lines with scrap", r.byLine.map((b) => b.name), ["Main Line", "Blue Line"]);
  eq("byOperator by bd ft", r.byOperator.map((b) => [b.name, b.boardFt]), [["Ben", 11.75], ["Ana", 10]]);
  eq("bySource", r.bySource, { cutting: 2, qc: 1, legacy: 0 });
  eq("voidedTestOnly false for other reasons", r.kpis.voidedTestOnly, false);

  const v = build({ rows: fixture }, { showVoided: true });
  near("showVoided doesn't change totals", v.kpis.boardFt, 21.75);
  eq("showVoided entries unchanged", [v.kpis.entries, v.kpis.voided], [3, 1]);
  eq("showVoided adds the voided row (flagged) to the list", v.list.map((x) => [x.id, x.voided]), [["s4", true], ["s3", false], ["s2", false], ["s1", false]]);
  eq("showVoided byLine unchanged", v.byLine.map((b) => b.boardFt), r.byLine.map((b) => b.boardFt));
}
{
  const t = [
    row({ event_date: "2026-03-18", voided_at: "2026-10-23 12:00:00", void_reason: TEST_VOID_REASON, source: "legacy" }),
    row({ event_date: "2026-03-20", voided_at: "2026-10-23 12:00:00", void_reason: TEST_VOID_REASON, source: "legacy" }),
  ];
  const r = build({ rows: t }, { from: "2026-03-01", to: "2026-03-31" });
  eq("all-test voided → voidedTestOnly", [r.kpis.voided, r.kpis.voidedTestOnly], [2, true]);
  eq("all voided → empty", [r.kpis.entries, r.empty.isEmpty, r.kpis.boardFt], [0, true, 0]);
  eq("no voided → voidedTestOnly false", build({ rows: [] }).kpis.voidedTestOnly, false);
}

// ── Filters ──────────────────────────────────────────────────────────────────────────────────
{
  const l = build({ rows: fixture }, { line: "Blue Line" });
  near("line filter", l.kpis.boardFt, 11.75);
  const rs = build({ rows: fixture }, { reason: "Setup Error" });
  near("reason filter", rs.kpis.boardFt, 7.25);
  eq("reason filter byLine", rs.byLine.map((b) => b.name), ["Blue Line"]);
  const s = build({ rows: fixture }, { shift: "1" });
  near("shift filter", s.kpis.boardFt, 14.5);
  eq("shift filter list", s.list.map((x) => x.id), ["s3", "s1"]);
  const vs = build({ rows: fixture }, { line: "Blue Line", showVoided: true });
  eq("voided count respects filters", vs.kpis.voided, 0);
  const none = build({ rows: fixture }, { line: "Laminate" });
  eq("filter with no match", [none.kpis.entries, none.kpis.topReason, none.kpis.topLine], [0, null, null]);
}

// ── Stored bd ft used as-is ──────────────────────────────────────────────────────────────────
{
  const r = build({ rows: [row({ event_date: "2026-10-06", pieces: 1, thickness_in: 1, width_in: 1, length_in: 144, scrap_board_ft: 3.333 })] });
  near("stored bd ft, not recomputed (would be 1)", r.kpis.boardFt, 3.333);
}

// ── Orders cut ───────────────────────────────────────────────────────────────────────────────
{
  const activity = [
    { job_id: "A", ts: "2026-10-21 02:30:00", kind: "session" as const },   // ET 10-20 22:30
    { job_id: "A", ts: "2026-10-21T15:00:00.000Z", kind: "item" as const }, // dup job
    { job_id: "B", ts: "2026-10-24 03:00:00", kind: "session" as const },   // ET 10-23 23:00 → in
    { job_id: "C", ts: "2026-10-24 05:00:00", kind: "item" as const },      // ET 10-24 → out
    { job_id: "D", ts: "2026-10-01 03:00:00", kind: "session" as const },   // ET 09-30 → out
    { job_id: null, ts: "2026-10-10 15:00:00", kind: "item" as const },
  ];
  const r = build({ rows: fixture, activity }, { from: "2026-10-20", to: "2026-10-23" });
  eq("orders cut, ET bucketing + distinct", r.kpis.ordersCut, 2);
  const only = build({ rows: [], activity }, { from: "2026-10-20", to: "2026-10-20" });
  eq("02:30 UTC 10-21 session → ET 10-20", only.kpis.ordersCut, 1);
  const f = build({ rows: fixture, activity }, { from: "2026-10-20", to: "2026-10-23", line: "Main Line", reason: "Other", shift: "3" });
  eq("orders cut unaffected by filters", f.kpis.ordersCut, 2);
  near("perOrderCut", r.kpis.perOrderCut, 4.5 / 2);
  eq("perOrderCut null when no scrap", f.kpis.perOrderCut, null);
  eq("perOrderCut null when no orders", build({ rows: fixture }).kpis.perOrderCut, null);
}

// ── Weeks ────────────────────────────────────────────────────────────────────────────────────
eq("mondayOf Sunday", mondayOf("2026-11-01"), "2026-10-26");
eq("mondayOf Monday", mondayOf("2026-10-19"), "2026-10-19");
eq("weekLabel", weekLabel("2026-10-19"), "Wk of Oct 19");
{
  const r = build(
    { rows: [row({ event_date: "2026-10-01", scrap_board_ft: 2 }), row({ event_date: "2026-11-02", scrap_board_ft: 3, scrap_reason: "Other" })] },
    { from: "2026-09-29", to: "2026-11-03" }
  );
  eq("Monday weeks across a month boundary", r.weeks.map((w) => w.weekStart), ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"]);
  eq("weeks zero-filled", r.weeks.map((w) => w.boardFt), [2, 0, 0, 0, 0, 3]);
  eq("week byReason", [r.weeks[0].byReason["Incorrect Cut"], r.weeks[5].byReason.Other], [2, 3]);
  eq("week entries", r.weeks.map((w) => w.entries), [1, 0, 0, 0, 0, 1]);
}

// ── Six months ───────────────────────────────────────────────────────────────────────────────
{
  const r = build({ months: [{ month: "2026-10", boardFt: 21.75, entries: 3 }, { month: "2026-03", boardFt: 1, entries: 1 }] });
  eq("6 months ending today's month", r.months.map((m) => m.month), ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  eq("zero-filled, out-of-window month dropped", r.months.map((m) => m.boardFt), [0, 0, 0, 0, 0, 21.75]);
  eq("labels", r.months.map((m) => m.label), ["May", "Jun", "Jul", "Aug", "Sep", "Oct"]);
  const y = buildScrapReport(raw({ months: [{ month: "2025-12", boardFt: 4, entries: 2 }] }), { from: "2026-02-01", to: "2026-02-20", ...base, todayEt: "2026-02-20" });
  eq("across a year boundary", y.months.map((m) => m.month), ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
  eq("year-boundary values", y.months.map((m) => m.entries), [0, 0, 0, 2, 0, 0]);
  eq("year-boundary labels", y.months.map((m) => m.label), ["Sep '25", "Oct '25", "Nov '25", "Dec '25", "Jan '26", "Feb '26"]);
}

// ── Size text ────────────────────────────────────────────────────────────────────────────────
eq("size full", sizeText({ pieces: 4, thickness_in: 2, width_in: 24.5, length_in: 48 }), "4 × 2 × 24.5 × 48");
eq("size missing pieces", sizeText({ pieces: null, thickness_in: 2, width_in: 24, length_in: 48 }), "2 × 24 × 48");
eq("size missing parts", sizeText({ pieces: 3, thickness_in: null, width_in: null, length_in: 10 }), "3 × 10");
eq("size all missing", sizeText({ pieces: null, thickness_in: null, width_in: null, length_in: null }), "—");

// ── Empty state ──────────────────────────────────────────────────────────────────────────────
{
  const closed = [
    { ended_at: "2026-10-21 02:00:00" },   // ET 10-20 → in
    { ended_at: "2026-10-22 18:00:00" },   // in
    { ended_at: "2026-10-20 03:00:00" },   // ET 10-19 → out
  ];
  const r = build({ closedSessions: closed }, { from: SCRAP_PROMPT_LIVE, to: TODAY });
  eq("empty: isEmpty, closedSessions, sinceLive", r.empty, { isEmpty: true, closedSessions: 2, sinceLive: true });
  const before = build({ closedSessions: closed }, { from: "2026-09-24", to: TODAY });
  eq("range before live → sinceLive false", [before.empty.sinceLive, before.empty.closedSessions], [false, 3]);
  eq("not empty with a live row", build({ rows: fixture }).empty.isEmpty, false);
  eq("empty weeks still zero-filled", build({}, { from: "2026-10-19", to: "2026-10-23" }).weeks.length, 1);
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  — ${r.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
