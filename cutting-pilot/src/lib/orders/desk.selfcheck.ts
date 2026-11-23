// src/lib/orders/desk.selfcheck.ts — ord-dash-01
// Self-check for the Orders desk builder (desk.ts). No DB, no network.
// Run with: npx tsx src/lib/orders/desk.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import { etDateKey } from "../etDateTime";
import {
  addDaysEt, buildDesk, dimsDetail, etWeekRange, inAttentionScope, jobAttention, orderAttention, scheduleGaps, validDeskRange,
  type DeskInput, type DeskJobRow, type DeskLineRow, type DeskScheduleRow, type DeskScopeJobRow,
} from "./desk";
import type { AttentionItem } from "../../types/ordersDesk";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}

const TODAY = "2026-11-20"; // Friday
const PROCS = JSON.stringify([{ name: "Main Line", completed: false }]);

function scope(p: Partial<DeskScopeJobRow> & { id: string }): DeskScopeJobRow {
  return {
    invoice_number: `INV-${p.id}`, customer: "Acme", ship_date: "2026-11-25", status: "not_started", archived_at: null,
    method: "Delivery", ship_to_company: "Acme", ship_to_verified: "verified", processes: PROCS, ...p,
  };
}
const goodLine = (job_id: string, sort_order = 0): DeskLineRow => ({ job_id, part_number: "P1", description: "Block", dimensions: '2" x 48" x 96"', sort_order });
const rules = (items: AttentionItem[]) => items.map((i) => i.rule);

// ── ET bucketing, both stored shapes + DST ──────────────────────────────────────────────────────
eq("sqlite shape 03:30 UTC → prev ET day", etDateKey("2026-11-21 03:30:00"), "2026-11-20");
eq("ISO 04:59Z → prev ET day (EST)", etDateKey("2026-11-21T04:59:00.000Z"), "2026-11-20");
eq("ISO 05:00Z → same ET day (EST)", etDateKey("2026-11-21T05:00:00.000Z"), "2026-11-21");
eq("DST: Nov 1 03:59Z (EDT) → Oct 31", etDateKey("2026-11-01T03:59:00.000Z"), "2026-10-31");
eq("DST: Nov 1 04:00Z (EDT) → Nov 1", etDateKey("2026-11-01 04:00:00"), "2026-11-01");
eq("DST: Nov 2 04:30Z (EST) → Nov 1", etDateKey("2026-11-02 04:30:00"), "2026-11-01");
eq("DST: Nov 2 05:00Z (EST) → Nov 2", etDateKey("2026-11-02T05:00:00.000Z"), "2026-11-02");
eq("addDaysEt across DST", addDaysEt("2026-10-31", 2), "2026-11-02");
eq("addDaysEt negative across month", addDaysEt("2026-11-01", -1), "2026-10-31");

// ── etWeekRange ────────────────────────────────────────────────────────────────────────────────
eq("week: Monday", etWeekRange("2026-11-16"), { from: "2026-11-16", to: "2026-11-22" });
eq("week: Wednesday", etWeekRange("2026-11-18"), { from: "2026-11-16", to: "2026-11-22" });
eq("week: Saturday", etWeekRange("2026-11-21"), { from: "2026-11-16", to: "2026-11-22" });
eq("week: Sunday", etWeekRange("2026-11-22"), { from: "2026-11-16", to: "2026-11-22" });

// ── Range validation ───────────────────────────────────────────────────────────────────────────
eq("range ok", validDeskRange("2026-11-01", "2026-11-20").ok, true);
eq("range reversed", validDeskRange("2026-11-20", "2026-11-01").ok, false);
eq("range 92 days ok", validDeskRange("2026-08-21", "2026-11-20").ok, true);
eq("range 93 days", validDeskRange("2026-08-20", "2026-11-20").ok, false);
eq("range bad date", validDeskRange("2026-02-30", "2026-03-01").ok, false);

// ── Scope ──────────────────────────────────────────────────────────────────────────────────────
eq("scope: not_started future", inAttentionScope(scope({ id: "s1" }), TODAY), true);
eq("scope: in_production", inAttentionScope(scope({ id: "s1", status: "in_production" }), TODAY), true);
eq("scope: done", inAttentionScope(scope({ id: "s1", status: "done" }), TODAY), true);
eq("scope: loading excluded", inAttentionScope(scope({ id: "s1", status: "loading" }), TODAY), false);
eq("scope: shipped excluded", inAttentionScope(scope({ id: "s1", status: "shipped" }), TODAY), false);
eq("scope: archived excluded", inAttentionScope(scope({ id: "s1", archived_at: "2026-11-19 10:00:00" }), TODAY), false);
eq("scope: past ship date excluded", inAttentionScope(scope({ id: "s1", ship_date: "2026-11-19" }), TODAY), false);
eq("scope: today's ship date in", inAttentionScope(scope({ id: "s1", ship_date: TODAY }), TODAY), true);
eq("scope: Saturday ship date in", inAttentionScope(scope({ id: "s1", ship_date: "2026-11-21" }), TODAY), true);
eq("scope: no ship date in", inAttentionScope(scope({ id: "s1", ship_date: null }), TODAY), true);

// ── Rules ──────────────────────────────────────────────────────────────────────────────────────
eq("clean job: no rules", rules(jobAttention(scope({ id: "c" }), [goodLine("c")])), []);
eq("no_ship_date positive", rules(jobAttention(scope({ id: "a", ship_date: "  " }), [goodLine("a")])), ["no_ship_date"]);
eq("no_processes positive", rules(jobAttention(scope({ id: "a", processes: "[]" }), [goodLine("a")])), ["no_processes"]);
eq("no_processes null", rules(jobAttention(scope({ id: "a", processes: null }), [goodLine("a")])), ["no_processes"]);
eq("no_processes unknown names only", rules(jobAttention(scope({ id: "a", processes: '[{"name":"Saw","completed":false}]' }), [goodLine("a")])), ["no_processes"]);
{
  const one = jobAttention(scope({ id: "d" }), [goodLine("d", 0), { job_id: "d", part_number: "P2", description: "", dimensions: "", sort_order: 1 }]);
  eq("blank_dims one line", one.map((i) => [i.rule, i.detail]), [["blank_dims", "Line 2"]]);
  const two = jobAttention(scope({ id: "d" }), [
    { job_id: "d", part_number: "P5", description: "x", dimensions: " ", sort_order: 4 },
    goodLine("d", 0),
    { job_id: "d", part_number: "P2", description: "", dimensions: "", sort_order: 1 },
    { job_id: "d", part_number: "", description: "", dimensions: "", sort_order: 2 },  // fully empty: ignored, still numbered
    goodLine("d", 3),
  ]);
  eq("blank_dims two lines, sort_order numbering", two.map((i) => [i.rule, i.detail]), [["blank_dims", "Lines 2, 5"]]);
  eq("blank_dims fully empty row ignored", rules(jobAttention(scope({ id: "d" }), [goodLine("d", 0), { job_id: "d", part_number: "", description: " ", dimensions: "", sort_order: 1 }])), []);
  eq("dimsDetail none", dimsDetail([]), null);
}
eq("address unverified", jobAttention(scope({ id: "u", ship_to_verified: "unverified" }), [goodLine("u")]).map((i) => [i.rule, i.detail]), [["address_unverified", "unverified"]]);
eq("address unverifiable", jobAttention(scope({ id: "u", ship_to_verified: "unverifiable" }), [goodLine("u")]).map((i) => i.detail), ["unverifiable"]);
eq("address null → unverified", jobAttention(scope({ id: "u", ship_to_verified: null }), [goodLine("u")]).map((i) => i.detail), ["unverified"]);
eq("address verified not flagged", rules(jobAttention(scope({ id: "u", ship_to_verified: "verified" }), [goodLine("u")])), []);
eq("address corrected not flagged", rules(jobAttention(scope({ id: "u", ship_to_verified: "corrected" }), [goodLine("u")])), []);
eq("address kept_original not flagged", rules(jobAttention(scope({ id: "u", ship_to_verified: "kept_original" }), [goodLine("u")])), []);
eq("address: customer pickup excluded", rules(jobAttention(scope({ id: "u", ship_to_verified: "unverified", method: "Customer Pickup" }), [goodLine("u")])), []);
eq("address: Marina (ship-to) excluded", rules(jobAttention(scope({ id: "u", ship_to_verified: "unverified", ship_to_company: "Marina Foam LLC" }), [goodLine("u")])), []);
eq("address: Marina (customer) excluded", rules(jobAttention(scope({ id: "u", ship_to_verified: null, customer: "MARINA  FOAM" }), [goodLine("u")])), []);

// ── Schedule gaps ──────────────────────────────────────────────────────────────────────────────
{
  const sched = (p: Partial<DeskScheduleRow>): DeskScheduleRow => ({ invoice_number: "4610", ship_date: "2026-11-24", customer: "Acme", sheet_status: "Scheduled", match_job_id: null, ...p });
  eq("gap basic", scheduleGaps([sched({})], TODAY).map((g) => [g.rule, g.invoice_number, g.detail, g.job_id]), [["schedule_gap", "4610", "Scheduled", null]]);
  eq("gap: matched row dropped", scheduleGaps([sched({ match_job_id: "j1" })], TODAY).length, 0);
  eq("gap: suppressed when a job has the invoice (route has_job flag)", scheduleGaps([sched({ has_job: 1 })], TODAY).length, 0);
  eq("gap: suppressed by archived job invoice", scheduleGaps([sched({ invoice_number: " 4610 " })], TODAY, new Set(["4610"])).length, 0);
  eq("gap: Marina kept", scheduleGaps([sched({ customer: "Marina Foam" })], TODAY).length, 1);
  eq("gap: yesterday kept", scheduleGaps([sched({ ship_date: "2026-11-19" })], TODAY).length, 1);
  eq("gap: day before yesterday dropped", scheduleGaps([sched({ ship_date: "2026-11-18" })], TODAY).length, 0);
  eq("gap: de-duped, earliest ship date", scheduleGaps([sched({ ship_date: "2026-11-26" }), sched({ invoice_number: "4610 ", ship_date: "2026-11-24" })], TODAY).map((g) => g.ship_date), ["2026-11-24"]);
}

// ── Ordering ───────────────────────────────────────────────────────────────────────────────────
{
  const it = (rule: AttentionItem["rule"], ship_date: string | null, invoice_number: string): AttentionItem =>
    ({ rule, ship_date, invoice_number, job_id: rule === "schedule_gap" ? null : "j", customer: null, detail: null });
  eq("ordering: gaps first, ship asc nulls first, then invoice",
    orderAttention([
      it("no_processes", "2026-11-25", "200"),
      it("address_unverified", "2026-11-22", "300"),
      it("schedule_gap", "2026-11-24", "4610"),
      it("no_ship_date", null, "500"),
      it("blank_dims", "2026-11-22", "100"),
      it("schedule_gap", "2026-11-19", "4700"),
    ]).map((i) => `${i.rule}:${i.invoice_number}`),
    ["schedule_gap:4700", "schedule_gap:4610", "no_ship_date:500", "blank_dims:100", "address_unverified:300", "no_processes:200"]);
}

// ── buildDesk: KPIs + recent ───────────────────────────────────────────────────────────────────
{
  const job = (p: Partial<DeskJobRow> & { id: string; created_at: string }): DeskJobRow => ({
    invoice_number: `INV-${p.id}`, customer: "Acme", ship_date: "2026-11-25", status: "not_started", source: "packing_slip",
    total_bdft: 100, load_count: 1, line_count: 2, archived_at: null, ...p,
  });
  const weekJobs = [
    job({ id: "w1", created_at: "2026-11-20 14:00:00", total_bdft: 100.4 }),                     // today
    job({ id: "w2", created_at: "2026-11-21T03:30:00.000Z", total_bdft: null }),                 // today ET (ISO shape)
    job({ id: "w3", created_at: "2026-11-16 06:00:00", total_bdft: 50.3, archived_at: "x" }),     // Monday, archived counts
    job({ id: "w4", created_at: "2026-11-16 04:00:00", total_bdft: 999 }),                        // Sunday 11/15 ET — outside week
  ];
  const input: DeskInput = {
    from: "2026-11-18", to: "2026-11-19",                  // recent range doesn't include the week's Monday or today
    recentJobs: [
      job({ id: "r1", created_at: "2026-11-18T12:00:00.000Z" }),
      job({ id: "r2", created_at: "2026-11-20 03:00:00", line_count: 5 }),   // 11/19 ET
      job({ id: "r3", created_at: "2026-11-20 06:00:00" }),                 // 11/20 ET — outside to
      job({ id: "r4", created_at: "2026-11-18 04:59:00" }),                 // 11/17 ET — outside from
    ],
    weekJobs,
    scopeJobs: [
      scope({ id: "r2", ship_date: null, processes: "[]" }),   // two rules, one job
      scope({ id: "x1", ship_to_verified: "unverified" }),
      scope({ id: "x2", status: "shipped", ship_date: null }),
    ],
    lines: [goodLine("r2"), goodLine("x1")],
    schedule: [{ invoice_number: "4610", ship_date: "2026-11-19", customer: "Marina Foam", sheet_status: "Scheduled", match_job_id: null }],
  };
  const d = buildDesk(input, TODAY);
  eq("recent: exact ET cut, newest first", d.recent.map((r) => [r.id, r.created_et_date]), [["r2", "2026-11-19"], ["r1", "2026-11-18"]]);
  eq("recent: line_count + attention", [d.recent[0].line_count, d.recent[0].attention], [5, ["no_ship_date", "no_processes"]]);
  eq("recent: no attention when clean", d.recent[1].attention, []);
  eq("kpi entered_today (both shapes)", d.kpis.entered_today, 2);
  eq("kpi entered_week ignores from/to, archived counted", d.kpis.entered_week, 3);
  eq("kpi bdft_week null-safe + rounded", d.kpis.bdft_week, 151);
  eq("kpi attention_jobs distinct jobs", d.kpis.attention_jobs, 2);
  eq("kpi schedule_gaps", d.kpis.schedule_gaps, 1);
  eq("attention order", d.attention.map((i) => `${i.rule}:${i.job_id ?? i.invoice_number}`),
    ["schedule_gap:4610", "no_ship_date:r2", "no_processes:r2", "address_unverified:x1"]);
}

const failed = results.filter((r) => !r.pass);
for (const f of failed) console.log(`FAIL ${f.name}: ${f.detail}`);
console.log(`desk selfcheck: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
