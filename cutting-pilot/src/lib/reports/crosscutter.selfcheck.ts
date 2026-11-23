// src/lib/reports/crosscutter.selfcheck.ts — cc-blocks-02
// Self-check for the pure Cross Cutter report (crosscutter.ts).
// Run with: npx tsx cutting-pilot/src/lib/reports/crosscutter.selfcheck.ts (any cwd). Exits 1 on any failure.
import {
  CSV_HEADERS, buildCrossCutterReport, crossCutterCsv, formatRunTime, validRange,
  type CcReportAssignment, type CrossCutterRaw,
} from "./crosscutter";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  results.push({ name, pass: a === e, detail: `got ${a}, expected ${e}` });
}

function asg(p: Partial<CcReportAssignment> & { id: string; completed_at: string }): CcReportAssignment {
  return { label: `A ${p.id}`, size_text: null, target_chunks: 0, qty_done: 0, created_by: "Mgr", created_at: "2026-11-01 12:00:00", ...p };
}

const raw: CrossCutterRaw = {
  assignments: [
    // 03:30 UTC Nov 21 = 10:30 PM ET Nov 20 (EST, UTC−5) → lands on 11-20.
    asg({ id: "a1", label: "Order 4821", size_text: "174/24 (82/82)", target_chunks: 4, qty_done: 6, completed_at: "2026-11-21 03:30:00" }),
    asg({ id: "a2", label: "Order 4900", target_chunks: 10, qty_done: 7, completed_at: "2026-11-19 15:00:00" }),
    asg({ id: "a3", label: "Pallet foam", target_chunks: 0, qty_done: 3, completed_at: "2026-11-18 14:00:00" }),
    // legacy row (completed before cc-blocks-01): no ID rows, no sessions.
    asg({ id: "a4", label: "Legacy run", target_chunks: 5, qty_done: 5, completed_at: "2026-11-10 13:00:00" }),
    // out of range: 05:30 UTC Nov 23 = 12:30 AM ET Nov 23 (> to).
    asg({ id: "a5", label: "Too late", qty_done: 1, completed_at: "2026-11-23 05:30:00" }),
    // out of range: before from.
    asg({ id: "a6", label: "Too early", qty_done: 1, completed_at: "2026-11-09 23:00:00" }),
  ],
  blockIds: [
    { assignment_id: "a1", block_id: "11/20-08", event: "stop", operator_name: "Ana", created_at: "2026-11-20 18:00:00" },
    { assignment_id: "a1", block_id: "11/20-07", event: "stop", operator_name: "Ana", created_at: "2026-11-20 18:00:00" },
    { assignment_id: "a1", block_id: "11/20-09", event: "complete", operator_name: "Ben", created_at: "2026-11-21 03:30:00" },
    { assignment_id: "a2", block_id: "11/18-01", event: "complete", operator_name: "Cy", created_at: "2026-11-19 15:00:00" },
  ],
  sessions: [
    { ref_id: "a1", operator_name: "Ben", started_at: "2026-11-21 02:00:00", ended_at: "2026-11-21 03:30:00" }, // 90 min
    { ref_id: "a1", operator_name: "Ana", started_at: "2026-11-20 17:00:00", ended_at: "2026-11-20 18:00:00" }, // 60 min, earlier
    { ref_id: "a1", operator_name: "Ana", started_at: "2026-11-20 19:00:00", ended_at: "2026-11-20 19:15:00" }, // 15 min
    { ref_id: "a3", operator_name: "Dee", started_at: "2026-11-18 13:00:00", ended_at: "2026-11-18 14:00:00" }, // 60 min
  ],
};
const opts = { from: "2026-11-10", to: "2026-11-22" };

{
  const r = buildCrossCutterReport(raw, opts);
  eq("in-range rows newest first", r.rows.map((x) => x.id), ["a1", "a2", "a3", "a4"]);
  const a1 = r.rows[0];
  eq("ET boundary: 03:30 UTC → previous ET day", a1.completed_et, { date: "2026-11-20", time: "10:30 PM" });
  eq("multi-session run minutes", a1.run_minutes, 165);
  eq("operators in first-session order", a1.operators, ["Ana", "Ben"]);
  eq("block ids by created_at then id", a1.block_ids, ["11/20-07", "11/20-08", "11/20-09"]);
  eq("over target", [a1.target, a1.blocks_cut, a1.over], [4, 6, 2]);
  eq("under target", r.rows[1].over, -3);
  eq("zero target → over null", r.rows[2].over, null);
  eq("ID-only operator listed", r.rows[1].operators, ["Cy"]);
  eq("legacy row: no ids, no run time", [r.rows[3].block_ids, r.rows[3].run_minutes, r.rows[3].operators], [[], 0, []]);
  eq("size_text kept", a1.size_text, "174/24 (82/82)");
  eq("totals", r.totals, { completed: 4, blocks: 21, overTarget: 1, runMinutes: 225 });
}
{
  eq("search un-padded block ID", buildCrossCutterReport(raw, { ...opts, search: "11/20-7" }).rows.map((x) => x.id), ["a1"]);
  eq("search padded block ID", buildCrossCutterReport(raw, { ...opts, search: "11/18-01" }).rows.map((x) => x.id), ["a2"]);
  eq("search partial block ID prefix", buildCrossCutterReport(raw, { ...opts, search: "11/20" }).rows.map((x) => x.id), ["a1"]);
  eq("search label case-insensitive", buildCrossCutterReport(raw, { ...opts, search: "PALLET" }).rows.map((x) => x.id), ["a3"]);
  eq("search size", buildCrossCutterReport(raw, { ...opts, search: "82/82" }).rows.map((x) => x.id), ["a1"]);
  eq("search operator", buildCrossCutterReport(raw, { ...opts, search: "dee" }).rows.map((x) => x.id), ["a3"]);
  const s = buildCrossCutterReport(raw, { ...opts, search: "11/20-7" });
  eq("totals follow search", s.totals, { completed: 1, blocks: 6, overTarget: 1, runMinutes: 165 });
  eq("no match", buildCrossCutterReport(raw, { ...opts, search: "zzz" }).rows.length, 0);
}
{
  eq("range 92 days ok", validRange("2026-08-23", "2026-11-22").ok, true);
  eq("range 93 days → error", validRange("2026-08-22", "2026-11-22").ok, false);
  eq("from > to → error", validRange("2026-11-22", "2026-11-21").ok, false);
}
{
  eq("formatRunTime", [formatRunTime(0), formatRunTime(45), formatRunTime(165), formatRunTime(600)], ["0m", "45m", "2h 45m", "10h 00m"]);
  const csv = crossCutterCsv(buildCrossCutterReport(raw, { ...opts, search: "11/20-7" }).rows).split("\r\n");
  eq("csv header columns", csv[0].split(",").length, CSV_HEADERS.length);
  eq("csv row", csv[1], `2026-11-20,10:30 PM,Order 4821,174/24 (82/82),4,6,+2,11/20-07; 11/20-08; 11/20-09,Ana; Ben,165`);
  eq("csv quotes commas", crossCutterCsv([{ ...buildCrossCutterReport(raw, opts).rows[0], label: 'A, "b"' }]).split("\r\n")[1].split(",")[2], '"A');
}

const failed = results.filter((r) => !r.pass);
for (const f of failed) console.log(`FAIL ${f.name}: ${f.detail}`);
console.log(`crosscutter selfcheck: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
