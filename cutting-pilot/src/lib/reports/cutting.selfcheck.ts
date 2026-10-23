// src/lib/reports/cutting.selfcheck.ts — rpt-01
// Self-check for the pure Cutting activity report (cutting.ts) and the range helpers (range.ts).
// Run with: npx tsx cutting-pilot/src/lib/reports/cutting.selfcheck.ts (any cwd). Exits 1 on any failure.
import {
  LINES, LONG_SESSION_SEC, MAX_RANGE_DAYS, SHORT_SESSION_SEC, buildCuttingReport, formatDuration, validRange,
  type CuttingRaw, type RawChunkRow, type RawItemRow, type RawSessionRow,
} from "./cutting";
import { addDaysYmd, dayLabel, eachDay, presetRange, rangeLabel, spanDays } from "./range";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}
const near = (name: string, a: number, b: number) => check(name, Math.abs(a - b) < 1e-6, `got ${a}, expected ${b}`);

// "YYYY-MM-DD HH:MM:SS" (SQLite / the cutting APIs) + seconds.
function plus(ts: string, sec: number): string {
  const ms = Date.parse(ts.replace(" ", "T") + "Z") + sec * 1000;
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}
let n = 0;
function sess(p: Partial<RawSessionRow> & { started_at: string; durSec?: number | null }): RawSessionRow {
  n += 1;
  const { durSec, ...rest } = p;
  return {
    id: `s${n}`, job_id: "J1", line: "Main Line", operator_id: "u1", operator_name: "Lee", status: "closed",
    ended_at: durSec == null ? null : plus(p.started_at, durSec), handoff_note: "", invoice_number: "4529",
    customer: "DiversiTech", operator_shift: "1st", ...rest,
  };
}
function item(p: Partial<RawItemRow> & { updated_at: string }): RawItemRow {
  n += 1;
  return {
    id: `i${n}`, job_id: "J1", line: "Main Line", invoice_number: "4529", customer: "DiversiTech", description: "Panel",
    dimensions: "27.5X27.5X3-9/16", part_number: "FOAM-1", cut_by: "Lee", cut_by_shift: "1st", updated_by: "u1", ...p,
  };
}
function chunk(p: Partial<RawChunkRow> & { started_at: string; durSec?: number | null }): RawChunkRow {
  n += 1;
  const { durSec, ...rest } = p;
  return {
    id: `c${n}`, board: "cc", ref_id: "A1", work_item: "Taper run", operator_id: "u2", operator_name: "Ariel",
    operator_shift: "2nd", ended_at: durSec == null ? null : plus(p.started_at, durSec), status: "closed", ...rest,
  };
}
const NOW = Date.parse("2026-11-03T15:00:00Z");
const base: { operator: string | null; line: string | null; excludeFlagged: boolean; nowMs: number } =
  { operator: null, line: null, excludeFlagged: true, nowMs: NOW };
const build = (raw: Partial<CuttingRaw>, o: Partial<typeof base & { from: string; to: string }> = {}) =>
  buildCuttingReport({ sessions: [], items: [], chunk: [], ...raw }, { from: "2026-10-16", to: "2026-11-02", ...base, ...o });

// ── ET bucketing (DST + both timestamp shapes) ───────────────────────────────────────────────
{
  // 03:30 UTC Nov 2 = 22:30 EST Nov 1 (DST ended 2am Nov 1).
  const a = build({ sessions: [sess({ started_at: "2026-11-02 03:30:00", durSec: 3600 })] }, { from: "2026-11-01", to: "2026-11-01" });
  eq("2026-11-02 03:30 UTC → ET Nov 1", a.kpis.sessions, 1);
  near("…its hour lands on Nov 1", a.days[0].byLine["Main Line"], 1);
  const b = build({ sessions: [sess({ started_at: "2026-11-02 03:30:00", durSec: 3600 })] }, { from: "2026-11-02", to: "2026-11-02" });
  eq("…and not on Nov 2", b.kpis.sessions, 0);
  // 01:25:49 UTC Oct 17 = 21:25 EDT Oct 16.
  const c = build({ sessions: [sess({ started_at: "2026-10-17 01:25:49", durSec: 600 })] }, { from: "2026-10-16", to: "2026-10-16" });
  eq("2026-10-17 01:25:49 UTC → ET Oct 16", c.kpis.sessions, 1);
  const d = build({ sessions: [sess({ started_at: "2026-10-17T01:25:49.000Z", ended_at: "2026-10-17T01:35:49.000Z" })] }, { from: "2026-10-16", to: "2026-10-16" });
  eq("ISO Z shape buckets the same", [d.kpis.sessions, Math.round(d.kpis.hours * 60)], [1, 10]);
  const e = build({ items: [item({ updated_at: "2026-10-17 03:59:00" }), item({ updated_at: "2026-10-17 04:00:00" })] }, { from: "2026-10-16", to: "2026-10-16" });
  eq("items bucket by ET updated_at (23:59 EDT in, 00:00 out)", e.kpis.items, 1);
  // A session that starts before ET midnight and runs past it counts wholly on its start day.
  const f = build({ sessions: [sess({ started_at: "2026-10-21 03:00:00", durSec: 7200 })] }, { from: "2026-10-20", to: "2026-10-21" });
  near("midnight-crossing session → its start day (Oct 20)", f.days[0].byLine["Main Line"], 2);
  near("…nothing on Oct 21", f.days[1].byLine["Main Line"], 0);
}

// ── Flags (strict edges) ─────────────────────────────────────────────────────────────────────
{
  const r = build({
    sessions: [
      sess({ started_at: "2026-10-20 12:00:00", durSec: SHORT_SESSION_SEC - 1 }),
      sess({ started_at: "2026-10-20 13:00:00", durSec: SHORT_SESSION_SEC }),
      sess({ started_at: "2026-10-21 12:00:00", durSec: LONG_SESSION_SEC }),
      sess({ started_at: "2026-10-22 12:00:00", durSec: LONG_SESSION_SEC + 1 }),
    ],
  });
  eq("59 s short / 60 s not / 8 h not / 8 h + 1 s long", [r.kpis.flaggedShort, r.kpis.flaggedLong], [1, 1]);
  eq("flags newest first", r.flags.map((x) => x.flag), ["long", "short"]);
  near("hours incl. flagged", r.kpis.hours, (59 + 60 + LONG_SESSION_SEC + LONG_SESSION_SEC + 1) / 3600);
  near("hours excl. flagged", r.kpis.hoursExclFlagged, (60 + LONG_SESSION_SEC) / 3600);
  near("flaggedHours on the long day", r.days.find((d) => d.date === "2026-10-22")!.flaggedHours, (LONG_SESSION_SEC + 1) / 3600);
}

// ── Running sessions ─────────────────────────────────────────────────────────────────────────
{
  const r = build({ sessions: [sess({ started_at: "2026-11-02 12:00:00", durSec: null }), sess({ started_at: "2026-11-02 10:00:00", durSec: 3600 })] });
  eq("open session: counted as a session + running", [r.kpis.sessions, r.kpis.running], [2, 1]);
  near("…but no hours", r.kpis.hours, 1);
  eq("…and never flagged (even past 8 h of running)", r.kpis.flaggedLong, 0);
  const run = r.orders[0].sessions.find((x) => x.running)!;
  eq("running duration measured to nowMs", run.durSec, Math.round((NOW - Date.parse("2026-11-02T12:00:00Z")) / 1000));
  eq("running counts in operator sessions", r.operators[0].sessions, 2);
}

// ── Exclude toggle ───────────────────────────────────────────────────────────────────────────
{
  const raw = {
    sessions: [
      sess({ started_at: "2026-10-20 12:00:00", durSec: 3600 }),
      sess({ started_at: "2026-10-20 14:00:00", durSec: LONG_SESSION_SEC + 3600, operator_name: "Israel" }),
      sess({ started_at: "2026-10-20 23:00:00", durSec: 5 }),
    ],
  };
  const on = build(raw, { excludeFlagged: true });
  const off = build(raw, { excludeFlagged: false });
  const day = (r: typeof on) => r.days.find((d) => d.date === "2026-10-20")!;
  near("toggle on: byLine excludes flagged", day(on).byLine["Main Line"], 1);
  near("toggle off: byLine includes flagged", day(off).byLine["Main Line"], 1 + 9 + 5 / 3600);
  near("flaggedHours the same either way", day(on).flaggedHours, day(off).flaggedHours);
  near("byLineClean excludes flagged even with the toggle off", day(off).byLineClean["Main Line"], 1);
  near("…so clean + flagged = toggle-off byLine (no double count)", day(off).byLineClean["Main Line"] + day(off).flaggedHours, day(off).byLine["Main Line"]);
  eq("sessions unchanged by the toggle", [on.kpis.sessions, off.kpis.sessions], [3, 3]);
  near("KPI hours / hoursExclFlagged don't depend on the toggle", on.kpis.hours, off.kpis.hours);
  near("order hours follow the toggle (on)", on.orders[0].hours, 1);
  near("order hours follow the toggle (off)", off.orders[0].hours, 10 + 5 / 3600);
  eq("operators sorted by incl. hours desc", on.operators.map((o) => o.name), ["Israel", "Lee"]);
  eq("operator short / long / hours", [on.operators[1].short, on.operators[0].long], [1, 1]);
  near("operator hoursExclFlagged", on.operators[0].hoursExclFlagged, 0);
}

// ── Filters ──────────────────────────────────────────────────────────────────────────────────
{
  const raw = {
    sessions: [
      sess({ started_at: "2026-10-20 12:00:00", durSec: 3600 }),
      sess({ started_at: "2026-10-20 12:00:00", durSec: 1800, line: "Blue Line", operator_name: "Joseph", job_id: "J2", invoice_number: "4530" }),
    ],
    items: [item({ updated_at: "2026-10-20 13:00:00" }), item({ updated_at: "2026-10-20 13:00:00", cut_by: "Joseph", line: "Blue Line", job_id: "J2" })],
    chunk: [chunk({ started_at: "2026-10-20 15:00:00", durSec: 900 })],
  };
  const op = build(raw, { operator: "Joseph" });
  eq("operator filter: sessions + items", [op.kpis.sessions, op.kpis.items, op.kpis.orders], [1, 1, 1]);
  eq("operatorOptions before the filter", op.operatorOptions, ["Ariel", "Joseph", "Lee"]);
  const ln = build(raw, { line: "Blue Line" });
  eq("line filter", [ln.kpis.sessions, ln.kpis.items, ln.linesWithHours], [1, 1, ["Blue Line"]]);
  eq("operatorOptions ignore the line filter too", ln.operatorOptions.length, 3);
  const cc = build(raw, { line: "Cross Cutter" });
  eq("line filter reaches chunk sessions", [cc.kpis.sessions, cc.chunk.length, cc.orders.length], [1, 1, 0]);
  const both = build(raw);
  eq("distinct operators across sessions + items + chunk", both.kpis.operators, 3);
  eq("linesWithHours in LINES order", both.linesWithHours, ["Main Line", "Blue Line", "Cross Cutter"]);
  const onlyFlagged = build({ sessions: [sess({ started_at: "2026-10-20 12:00:00", durSec: 5, line: "Blue Line" })] });
  eq("a line with only a flagged session: sessions yes, clean hours no", [onlyFlagged.linesWithSessions, onlyFlagged.linesWithHours], [["Blue Line"], []]);
}

// ── Zero-filled days ─────────────────────────────────────────────────────────────────────────
{
  const r = build({}, { from: "2026-10-30", to: "2026-11-02" });
  eq("every date zero-filled (across DST)", r.days.map((d) => d.date), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  eq("byLine has every line at 0", Object.values(r.days[0].byLine), [0, 0, 0, 0]);
  eq("LINES", LINES, ["Main Line", "Blue Line", "Cross Cutter", "Hole Cutter"]);
}

// ── Orders + chunk ───────────────────────────────────────────────────────────────────────────
{
  const r = build({
    sessions: [sess({ started_at: "2026-10-20 12:00:00", durSec: 3600 })],
    items: [
      item({ updated_at: "2026-10-20 13:00:00" }),
      item({ updated_at: "2026-10-22 13:00:00", job_id: "J9", invoice_number: "4600", customer: "Kramer", cut_by: null, updated_by: "u7" }),
    ],
    chunk: [
      chunk({ started_at: "2026-10-21 12:00:00", durSec: 30, board: "hc", work_item: null, ref_id: "8_hole" }),
      chunk({ started_at: "2026-10-21 14:00:00", durSec: 1200 }),
    ],
  });
  eq("order with items but no session", r.orders.map((o) => [o.invoice, o.sessions.length, o.items.length]), [["4600", 0, 1], ["4529", 1, 1]]);
  eq("cut by falls back to updated_by", r.orders[0].items[0].cutBy, "u7");
  eq("orders KPI counts both", r.kpis.orders, 2);
  eq("chunk: cc → Cross Cutter, hc → Hole Cutter, newest first", r.chunk.map((x) => x.line), ["Cross Cutter", "Hole Cutter"]);
  eq("chunk work item falls back to ref_id", r.chunk[1].workItem, "8_hole");
  eq("chunk sessions never join an order", r.orders.every((o) => o.sessions.every((x) => x.kind === "line")), true);
  eq("short chunk session flagged", r.flags.map((x) => [x.kind, x.flag]), [["chunk", "short"]]);
}

// ── validRange / range helpers / formatDuration ──────────────────────────────────────────────
eq("MAX_RANGE_DAYS", MAX_RANGE_DAYS, 92);
eq("92 days accepted", validRange("2026-08-03", addDaysYmd("2026-08-03", 91)).ok, true);
eq("93 days rejected", validRange("2026-08-03", addDaysYmd("2026-08-03", 92)).ok, false);
eq("same day ok", validRange("2026-10-23", "2026-10-23").ok, true);
eq("reversed rejected", validRange("2026-10-24", "2026-10-23").ok, false);
eq("bad date rejected", validRange("2026-02-30", "2026-03-01").ok, false);
eq("garbage rejected", validRange("10/16/2026", "2026-10-23").ok, false);
eq("spanDays inclusive", spanDays("2026-10-16", "2026-10-23"), 8);
eq("eachDay across DST", eachDay("2026-10-31", "2026-11-02").length, 3);
eq("Last 7 days on Fri Oct 23", presetRange("last_7", "2026-10-23"), { from: "2026-10-16", to: "2026-10-23" });
eq("Last 30 days", presetRange("last_30", "2026-10-23"), { from: "2026-09-23", to: "2026-10-23" });
eq("This week (Mon → today)", presetRange("this_week", "2026-10-23"), { from: "2026-10-19", to: "2026-10-23" });
eq("This week on a Monday", presetRange("this_week", "2026-10-19"), { from: "2026-10-19", to: "2026-10-19" });
eq("This week on a Sunday", presetRange("this_week", "2026-10-25"), { from: "2026-10-19", to: "2026-10-25" });
eq("rangeLabel", rangeLabel("2026-10-16", "2026-10-23"), "Fri Oct 16 – Fri Oct 23");
eq("dayLabel never shifts", dayLabel("2026-11-01"), "Sun Nov 1");
eq("formatDuration", [5, 59, 60, 754, 4080, 65520].map(formatDuration), ["5s", "59s", "1m", "12m", "1h 08m", "18h 12m"]);

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  (${r.detail})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
