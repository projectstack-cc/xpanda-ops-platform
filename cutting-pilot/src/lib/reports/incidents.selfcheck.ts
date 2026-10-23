// src/lib/reports/incidents.selfcheck.ts — rpt-03
// Self-check for the pure Incidents report (incidents.ts).
// Run with: npx tsx cutting-pilot/src/lib/reports/incidents.selfcheck.ts (any cwd). Exits 1 on any failure.
import type { IncidentRow } from "../qc/incident";
import {
  IMPORTED_BY, buildIncidentReport, customerKey, customerNames, eachMonth, endOfMonth, incidentRange, monthLabel,
  orderKey, ordersShipped, yearOptions,
} from "./incidents";
import { validRange } from "./range";

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
function inc(p: Partial<IncidentRow> & { incident_date: string }): IncidentRow {
  n += 1;
  return {
    id: `r${n}`, person_completing: "", reporting_individual: null, customer: "DiversiTech", job_id: null,
    job_ref: `INV ${3000 + n}`, product_delivered: "Other", delivery_date: null, incident_category: "Delivery",
    risk_level: "Low", incident_details: "Damaged corner", root_cause: null, implicated_departments: null,
    corrective_actions: null, created_by_id: null, created_by_name: IMPORTED_BY, created_at: `${p.incident_date} 12:00:00`,
    drive_status: "synced", drive_error: null, drive_synced_at: null, drive_file_id: null, drive_file_name: null,
    drive_customer: null, drive_attempted_at: null, drive_attempts: 0, ...p,
  };
}
const TODAY = "2026-10-23";
const base = { category: null as string | null, risk: null as string | null, q: "", todayEt: TODAY };
const build = (rows: IncidentRow[], d1: Record<string, number>, o: Partial<typeof base & { from: string; to: string }> = {}) =>
  buildIncidentReport(rows, d1, { from: "2025-01-01", to: "2025-12-31", ...base, ...o });

// ── Denominator ──────────────────────────────────────────────────────────────────────────────
eq("Jan 2025 baseline", ordersShipped("2025-01", {}), 63);
eq("May 2026 seam = 66 + D1 May", ordersShipped("2026-05", { "2026-05": 12 }), 78);
eq("June 2026 = D1 only", ordersShipped("2026-06", { "2026-06": 95 }), 95);
{
  const r = build([inc({ incident_date: "2024-12-10" }), inc({ incident_date: "2025-01-10" })], {}, { from: "2024-12-01", to: "2025-01-31" });
  eq("Dec 2024 has no denominator → shipped null", r.months[0].shipped, null);
  eq("Dec 2024 rate null (not 0)", r.months[0].rate, null);
  eq("range shipped excludes Dec 2024", r.kpis.shipped, 63);
  near("range rate counts only months with a denominator", r.kpis.rate, 1 / 63);
  eq("both incidents still count as incidents/orders", [r.kpis.incidents, r.kpis.orders], [2, 2]);
  const none = build([inc({ incident_date: "2024-06-10" })], {}, { from: "2024-06-01", to: "2024-06-30" });
  eq("range with no denominator → rate null", none.kpis.rate, null);
}

// ── Jan 2025 fixture: 6 incidents on 5 INVs, incl. a split load ──────────────────────────────
const jan = [
  inc({ incident_date: "2025-01-06", job_ref: "INV 3374-001" }),
  inc({ incident_date: "2025-01-07", job_ref: "INV 3374-002" }),
  inc({ incident_date: "2025-01-09", job_ref: "INV 3380" }),
  inc({ incident_date: "2025-01-14", job_ref: "INV 3391", incident_category: "Tolerances", risk_level: "High" }),
  inc({ incident_date: "2025-01-20", job_ref: "INV 3402", incident_category: "Fusion", risk_level: "Medium" }),
  inc({ incident_date: "2025-01-28", job_ref: "INV 3410", customer: "Lansing" }),
];
{
  const r = build(jan, {}, { from: "2025-01-01", to: "2025-01-31" });
  eq("Jan 2025 incidents", r.kpis.incidents, 6);
  eq("Jan 2025 orders (split load collapses)", r.kpis.orders, 5);
  near("Jan 2025 rate 5/63", r.kpis.rate, 5 / 63);
  near("Jan 2025 month rate", r.months[0].rate, 5 / 63);
  eq("risk counts", [r.kpis.high, r.kpis.medium, r.kpis.low], [1, 1, 4]);
  eq("top category", r.kpis.topCategory, { name: "Delivery", count: 4 });
  eq("second category (ties → CATEGORIES order)", r.kpis.secondCategory, { name: "Fusion", count: 1 });
  eq("byCategory all six in order", r.byCategory.map((c) => c.name), ["Fusion", "Density", "Tolerances", "Packaging", "Delivery", "Other"]);
  near("byRisk pct", r.byRisk[2].pct, 4 / 6);
}
eq("orderKey split load", orderKey("INV 3374-001"), "3374");
eq("orderKey bare number", orderKey("4529"), "4529");
eq("orderKey none", [orderKey(null), orderKey(""), orderKey("Internal")], [null, null, null]);
{
  const r = build([inc({ incident_date: "2025-03-03", job_ref: null, customer: "Internal" }), inc({ incident_date: "2025-03-04" })], {});
  eq("no ref → incident, not an order", [r.kpis.incidents, r.kpis.orders], [2, 1]);
}

// ── Filters change the numerator, never the denominator ──────────────────────────────────────
{
  const all = build(jan, {}, { from: "2025-01-01", to: "2025-01-31" });
  const del = build(jan, {}, { from: "2025-01-01", to: "2025-01-31", category: "Delivery" });
  eq("category filter: incidents", del.kpis.incidents, 4);
  eq("category filter: orders (numerator)", del.kpis.orders, 3);
  eq("category filter: shipped unchanged", [del.kpis.shipped, del.months[0].shipped], [all.kpis.shipped, 63]);
  near("category filter: rate 3/63", del.kpis.rate, 3 / 63);
  const hi = build(jan, {}, { from: "2025-01-01", to: "2025-01-31", risk: "High" });
  eq("risk filter", [hi.kpis.incidents, hi.kpis.orders, hi.kpis.shipped], [1, 1, 63]);
  const q1 = build(jan, {}, { from: "2025-01-01", to: "2025-01-31", q: "3374" });
  eq("search by INV", q1.kpis.incidents, 2);
  const q2 = build(jan, {}, { from: "2025-01-01", to: "2025-01-31", q: "lansing building" });
  eq("search matches canonical customer", q2.kpis.incidents, 1);
  const q3 = build(jan, {}, { from: "2025-01-01", to: "2025-01-31", q: "DAMAGED" });
  eq("search details, case-insensitive", q3.kpis.incidents, 6);
  eq("rangeIncidents ignores filters", q1.rangeIncidents, 6);
}

// ── Customer grouping ────────────────────────────────────────────────────────────────────────
eq("customerKey trims/collapses/lowercases", customerKey("  Acme   Foam  "), "acme foam");
eq("customerKey drops one suffix", [customerKey("Acme Inc."), customerKey("Acme, Inc"), customerKey("Acme LLC"), customerKey("Acme Corp"), customerKey("Acme Co.")], ["acme", "acme", "acme", "acme", "acme"]);
{
  const aliasCases: [string, string][] = [
    ["YANAEX", "YanaEx"], ["Yanaex Inc.", "YanaEx"],
    ["Blue Water Spa Cover", "Blue Water Spa Covers"], ["blue water spa covers", "Blue Water Spa Covers"],
    ["Lansing", "Lansing Building Products"], ["Lansing Building Products, Inc.", "Lansing Building Products"],
    ["Bellingham Marine", "Bellingham Marine"], ["Bellingham Marine Industries", "Bellingham Marine"],
    ["Accudock", "AccuDock"], ["ACCUDOCK LLC", "AccuDock"],
  ];
  const names = customerNames(aliasCases.map(([c]) => ({ customer: c })));
  for (const [raw, want] of aliasCases) {
    const r = build([inc({ incident_date: "2025-02-02", customer: raw })], {});
    eq(`alias ${raw} → ${want}`, r.list[0].canonicalCustomer, want);
  }
  eq("five alias groups", new Set(names.values()).size, 5);
  const r = build([
    inc({ incident_date: "2025-02-02", customer: "TCI Tampa #783" }),
    inc({ incident_date: "2025-02-03", customer: "TCI ORL" }),
    inc({ incident_date: "2025-02-04", customer: "Ocala Arch Foam" }),
    inc({ incident_date: "2025-02-05", customer: "ocala arch foam " }),
    inc({ incident_date: "2025-02-06", customer: "Ocala Arch Foam" }),
  ], {});
  eq("branches stay separate", r.kpis.customers, 3);
  eq("canonical = most frequent spelling", r.kpis.topCustomer, { name: "Ocala Arch Foam", count: 3 });
  eq("list keeps the stored name", r.list.find((x) => x.incident_date === "2025-02-05")?.customer, "ocala arch foam ");
}
{
  const rows = ["A", "B", "C", "D", "E", "F", "G", "H"].map((c, i) => inc({ incident_date: `2025-04-${String(i + 1).padStart(2, "0")}`, customer: c }));
  rows.push(inc({ incident_date: "2025-04-20", customer: "A" }));
  const r = build(rows, {});
  eq("top customers capped at 6", r.topCustomers.length, 6);
  eq("top customer first", r.topCustomers[0], { name: "A", count: 2 });
  eq("other customers summarised", [r.otherCustomers, r.otherIncidents], [2, 2]);
}

// ── Months: partial, zero-fill across a year boundary, labels ────────────────────────────────
{
  const r = build([inc({ incident_date: "2026-10-05" })], { "2026-10": 40 }, { from: "2025-11-01", to: TODAY });
  eq("zero-filled months across a year boundary", r.months.map((m) => m.month),
    ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  eq("zero month incidents", r.months[0].incidents, 0);
  eq("labels with year when spanning", [r.months[0].label, r.months[11].label], ["Nov '25", "Oct '26"]);
  eq("partial only on the current month", r.months.map((m) => m.partial).filter(Boolean).length, 1);
  eq("current month is partial", r.months[11].partial, true);
  near("current month rate 1/40", r.months[11].rate, 1 / 40);
  eq("month with D1 0 and no baseline → rate null (nothing shipped)", build([], {}, { from: "2026-07-01", to: "2026-07-31" }).months[0].rate, null);
  const one = build([], {}, { from: "2026-01-01", to: TODAY });
  eq("single-year labels", one.months[0].label, "Jan");
  eq("year months run to the current one", one.months.length, 10);
}
eq("monthLabel", [monthLabel("2025-03", false), monthLabel("2025-03", true)], ["Mar", "Mar '25"]);
eq("eachMonth", eachMonth("2025-12-15", "2026-02-01"), ["2025-12", "2026-01", "2026-02"]);
eq("endOfMonth Feb 2028 leap", endOfMonth("2028-02-10"), "2028-02-29");

// ── List order + derived fields ──────────────────────────────────────────────────────────────
{
  const r = build([
    inc({ id: "a", incident_date: "2025-05-01", created_at: "2025-05-01 09:00:00" }),
    inc({ id: "b", incident_date: "2025-05-03", created_at: "2025-05-03 09:00:00" }),
    inc({ id: "c", incident_date: "2025-05-01", created_at: "2025-05-01 15:00:00", created_by_name: "Steve", implicated_departments: '["Cutting","Delivery"]' }),
  ], {});
  eq("list newest first, then created_at desc", r.list.map((x) => x.id), ["b", "c", "a"]);
  eq("imported flag", r.list.map((x) => x.imported), [true, false, true]);
  eq("departments parsed", r.list[1].departments, ["Cutting", "Delivery"]);
}

// ── Year options + ranges ────────────────────────────────────────────────────────────────────
eq("yearOptions from rows", yearOptions([{ incident_date: "2026-03-01" }, { incident_date: "2025-01-06" }], TODAY), [2025, 2026]);
eq("yearOptions from earliest string", yearOptions("2025-01-06", TODAY), [2025, 2026]);
eq("yearOptions with no incidents", yearOptions(null, TODAY), [2026]);
eq("year range capped at today", incidentRange(2026, TODAY), { from: "2026-01-01", to: TODAY });
eq("past year range", incidentRange(2025, TODAY), { from: "2025-01-01", to: "2025-12-31" });
eq("last 12 months", incidentRange("last_12", TODAY), { from: "2025-11-01", to: TODAY });
eq("731-day span accepted", validRange("2024-10-23", "2026-10-23", 731).ok, true);
eq("732-day span rejected", validRange("2024-10-22", "2026-10-23", 731).ok, false);
eq("default validRange still 92", validRange("2026-01-01", "2026-04-03").ok, false);

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : ` — ${r.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
