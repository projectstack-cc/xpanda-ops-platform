// src/lib/reports/incidents.ts — rpt-03
// Pure Incidents report for /v2/reports/incidents: qc_incidents rows (native since qc-08, history
// backfilled by rpt-02) + orders shipped per month → KPIs, months (incidents by category + incident
// rate), breakdowns and the list. Category / risk / search filters change every aggregate incl. the
// rate's numerator; the denominator (orders shipped) never changes with filters. No DB, no React —
// exercised by incidents.selfcheck.ts (`npx tsx src/lib/reports/incidents.selfcheck.ts`).
import { CATEGORIES, RISK_LEVELS, parseDepartments, type Category, type IncidentRow, type RiskLevel } from "../qc/incident";
import { addDaysYmd } from "./range";

// Orders shipped per month before D1 had jobs — copied from the "XPanda Incident Tracker v2" Sheet,
// Monthly Summary tab, column "Total Orders Shipped" (exported 2026-10-23). Historical, never changes.
// May 2026 covers May 1–17 only; D1 jobs cover May 18 on (D1_SHIPMENTS_FROM).
export const SHIPPED_BASELINE: Readonly<Record<string, number>> = {
  "2025-01": 63, "2025-02": 54, "2025-03": 72, "2025-04": 89, "2025-05": 76, "2025-06": 111,
  "2025-07": 83, "2025-08": 81, "2025-09": 95, "2025-10": 106, "2025-11": 88, "2025-12": 99,
  "2026-01": 100, "2026-02": 86, "2026-03": 108, "2026-04": 111, "2026-05": 66,
};
export const D1_SHIPMENTS_FROM = "2026-05-18";
export const IMPORTED_BY = "Tracker import (rpt-02)";
// The first month with a denominator (the tracker baseline starts here).
export const FIRST_SHIPPED_MONTH = "2025-01";
// Incidents spans: a year or the last 12 months, plus slack — validRange(from, to, INCIDENT_MAX_DAYS).
export const INCIDENT_MAX_DAYS = 731;

// ── Months (YYYY-MM) ─────────────────────────────────────────────────────────────────────────

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const monthOf = (ymd: string) => String(ymd ?? "").slice(0, 7);
export const firstOfMonth = (ymd: string) => `${monthOf(ymd)}-01`;

export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}`;
}

export function endOfMonth(ymd: string): string {
  return addDaysYmd(`${addMonths(monthOf(ymd), 1)}-01`, -1);
}

// Every calendar month overlapping [from, to] (empty when reversed).
export function eachMonth(from: string, to: string): string[] {
  const out: string[] = [];
  const last = monthOf(to);
  for (let m = monthOf(from); m <= last && out.length < 1200; m = addMonths(m, 1)) out.push(m);
  return out;
}

// "Jan", or "Jan '25" when the range spans years.
export function monthLabel(month: string, spansYears: boolean): string {
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
  return spansYears ? `${name} '${month.slice(2, 4)}` : name;
}

// ── Denominator ──────────────────────────────────────────────────────────────────────────────

export function hasDenominator(month: string): boolean {
  return month >= FIRST_SHIPPED_MONTH;
}

// Tracker baseline + D1 jobs (May 2026 adds both). Only meaningful when hasDenominator(month).
export function ordersShipped(month: string, d1Counts: Record<string, number>): number {
  return (SHIPPED_BASELINE[month] ?? 0) + (Number(d1Counts[month]) || 0);
}

// ── Keys ─────────────────────────────────────────────────────────────────────────────────────

// "INV 3374-001" → "3374" (split loads count as one order); bare "3374" works too; null when no ref.
export function orderKey(jobRef: string | null | undefined): string | null {
  const m = /^\s*(?:INV\s*#?\s*)?(\d+)/i.exec(String(jobRef ?? ""));
  return m ? m[1] : null;
}

const SUFFIX = /[\s,]+(inc\.?|llc|corp|co\.)$/;

// trim, collapse whitespace, lowercase, drop one trailing inc / inc. / llc / corp / co.
export function customerKey(name: string | null | undefined): string {
  const k = String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return k.replace(SUFFIX, "").replace(/,$/, "").trim();
}

// Known spellings of one customer (keys as customerKey produces them). Different branches stay
// separate (TCI Tampa #783 ≠ TCI ORL). Display only — stored names are never touched.
export const CUSTOMER_ALIASES: Readonly<Record<string, string>> = {
  "yanaex": "YanaEx",
  "blue water spa cover": "Blue Water Spa Covers",
  "blue water spa covers": "Blue Water Spa Covers",
  "lansing": "Lansing Building Products",
  "lansing building products": "Lansing Building Products",
  "bellingham marine": "Bellingham Marine",
  "bellingham marine industries": "Bellingham Marine",
  "accudock": "AccuDock",
};

const groupOf = (name: string) => {
  const k = customerKey(name);
  return CUSTOMER_ALIASES[k] ? `alias:${CUSTOMER_ALIASES[k]}` : k;
};

// group → display name: the alias value, else the group's most frequent raw spelling (ties → the
// spelling seen first, rows newest first).
export function customerNames(rows: Pick<IncidentRow, "customer">[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const raw = String(r.customer ?? "").trim().replace(/\s+/g, " ");
    const g = groupOf(raw);
    if (!counts.has(g)) counts.set(g, new Map());
    const c = counts.get(g)!;
    c.set(raw, (c.get(raw) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  counts.forEach((c, g) => {
    if (g.startsWith("alias:")) {
      out.set(g, g.slice(6));
      return;
    }
    let best = "";
    let bestN = -1;
    c.forEach((n, raw) => {
      if (n > bestN) { best = raw; bestN = n; }
    });
    out.set(g, best);
  });
  return out;
}

// ── Report ───────────────────────────────────────────────────────────────────────────────────

export interface IncidentListRow extends IncidentRow {
  imported: boolean;
  departments: string[];
  canonicalCustomer: string;
}

export interface IncidentMonth {
  month: string;
  label: string;
  byCategory: Record<Category, number>;
  incidents: number;
  orders: number;
  shipped: number | null;
  rate: number | null;          // orders ÷ shipped (0–1); null with no denominator / nothing shipped
  partial: boolean;             // the month containing todayEt
}

export interface IncidentKpis {
  incidents: number;
  orders: number;
  shipped: number;
  rate: number | null;
  high: number;
  medium: number;
  low: number;
  topCategory: { name: Category; count: number } | null;
  secondCategory: { name: Category; count: number } | null;
  customers: number;
  topCustomer: { name: string; count: number } | null;
}

export interface IncidentReport {
  kpis: IncidentKpis;
  months: IncidentMonth[];
  byCategory: { name: Category; count: number }[];
  byRisk: { name: RiskLevel; count: number; pct: number }[];
  topCustomers: { name: string; count: number }[];
  otherCustomers: number;       // customers past the top 6
  otherIncidents: number;       // their incidents (== otherCustomers when each has 1)
  list: IncidentListRow[];
  rangeIncidents: number;       // in [from, to] before filters (empty-state choice)
}

const TOP_CUSTOMERS = 6;

function emptyByCategory(): Record<Category, number> {
  return Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
}

export function buildIncidentReport(rows: IncidentRow[], d1Shipped: Record<string, number>, opts: {
  from: string; to: string;               // ET YYYY-MM-DD inclusive, on incident_date
  category: string | null; risk: string | null; q: string;   // filters
  todayEt: string;
}): IncidentReport {
  const names = customerNames(rows);
  const canonical = (name: string) => names.get(groupOf(String(name ?? "").trim().replace(/\s+/g, " "))) ?? name;

  const inRange = rows.filter((r) => r.incident_date >= opts.from && r.incident_date <= opts.to);
  const q = opts.q.trim().toLowerCase();
  const filtered = inRange.filter((r) => {
    if (opts.category && r.incident_category !== opts.category) return false;
    if (opts.risk && r.risk_level !== opts.risk) return false;
    if (!q) return true;
    return [r.job_ref, r.customer, canonical(r.customer), r.incident_details]
      .some((v) => String(v ?? "").toLowerCase().includes(q));
  });

  // Months, zero-filled.
  const monthKeys = eachMonth(opts.from, opts.to);
  const spansYears = monthKeys.length > 0 && monthKeys[0].slice(0, 4) !== monthKeys[monthKeys.length - 1].slice(0, 4);
  const todayMonth = monthOf(opts.todayEt);
  const byMonth = new Map<string, { byCategory: Record<Category, number>; incidents: number; orders: Set<string> }>();
  for (const m of monthKeys) byMonth.set(m, { byCategory: emptyByCategory(), incidents: 0, orders: new Set() });
  for (const r of filtered) {
    const b = byMonth.get(monthOf(r.incident_date));
    if (!b) continue;
    b.incidents += 1;
    if ((CATEGORIES as readonly string[]).includes(r.incident_category)) b.byCategory[r.incident_category as Category] += 1;
    const k = orderKey(r.job_ref);
    if (k) b.orders.add(k);
  }
  const months: IncidentMonth[] = monthKeys.map((m) => {
    const b = byMonth.get(m)!;
    const shipped = hasDenominator(m) ? ordersShipped(m, d1Shipped) : null;
    return {
      month: m,
      label: monthLabel(m, spansYears),
      byCategory: b.byCategory,
      incidents: b.incidents,
      orders: b.orders.size,
      shipped,
      rate: shipped ? b.orders.size / shipped : null,
      partial: m === todayMonth,
    };
  });

  // KPIs. The range rate counts only months with a denominator (numerator and denominator alike).
  const orders = new Set<string>();
  const rateOrders = new Set<string>();
  for (const r of filtered) {
    const k = orderKey(r.job_ref);
    if (!k) continue;
    orders.add(k);
    if (hasDenominator(monthOf(r.incident_date))) rateOrders.add(k);
  }
  const shipped = months.reduce((t, m) => t + (m.shipped ?? 0), 0);

  const catCounts = CATEGORIES.map((name) => ({ name, count: filtered.filter((r) => r.incident_category === name).length }));
  const ranked = [...catCounts].filter((c) => c.count > 0).sort((a, b) => b.count - a.count); // stable → CATEGORIES order on ties
  const riskCount = (lvl: RiskLevel) => filtered.filter((r) => r.risk_level === lvl).length;

  const custCounts = new Map<string, number>();
  for (const r of filtered) {
    const name = canonical(r.customer);
    custCounts.set(name, (custCounts.get(name) ?? 0) + 1);
  }
  const custRanked = Array.from(custCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const rest = custRanked.slice(TOP_CUSTOMERS);

  const n = filtered.length;
  const list: IncidentListRow[] = [...filtered]
    .sort((a, b) =>
      a.incident_date === b.incident_date
        ? String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
        : b.incident_date.localeCompare(a.incident_date)
    )
    .map((r) => ({
      ...r,
      imported: r.created_by_name === IMPORTED_BY,
      departments: parseDepartments(r.implicated_departments),
      canonicalCustomer: canonical(r.customer),
    }));

  return {
    kpis: {
      incidents: n,
      orders: orders.size,
      shipped,
      rate: shipped > 0 ? rateOrders.size / shipped : null,
      high: riskCount("High"),
      medium: riskCount("Medium"),
      low: riskCount("Low"),
      topCategory: ranked[0] ?? null,
      secondCategory: ranked[1] ?? null,
      customers: custRanked.length,
      topCustomer: custRanked[0] ?? null,
    },
    months,
    byCategory: catCounts,
    byRisk: (["High", "Medium", "Low"] as RiskLevel[]).map((name) => {
      const count = riskCount(name);
      return { name, count, pct: n ? count / n : 0 };
    }),
    topCustomers: custRanked.slice(0, TOP_CUSTOMERS),
    otherCustomers: rest.length,
    otherIncidents: rest.reduce((t, c) => t + c.count, 0),
    list,
    rangeIncidents: inRange.length,
  };
}

// Years from the earliest incident's year to the current year (ascending). Takes the rows, or the
// API's MIN(incident_date) when the page only holds one year's rows.
export function yearOptions(source: Pick<IncidentRow, "incident_date">[] | string | null, todayEt: string): number[] {
  const current = Number(todayEt.slice(0, 4));
  const earliest = typeof source === "string" || source === null
    ? source
    : source.reduce<string | null>((min, r) => (r.incident_date && (!min || r.incident_date < min) ? r.incident_date : min), null);
  const first = earliest && /^\d{4}/.test(earliest) ? Math.min(Number(earliest.slice(0, 4)), current) : current;
  return Array.from({ length: current - first + 1 }, (_, i) => first + i);
}

// Year → Jan 1 → Dec 31 (capped at today); "last_12" → the 12 calendar months ending with this one.
export type IncidentRangeKey = number | "last_12";
export function incidentRange(key: IncidentRangeKey, todayEt: string): { from: string; to: string } {
  if (key === "last_12") return { from: `${addMonths(monthOf(todayEt), -11)}-01`, to: todayEt };
  const end = `${key}-12-31`;
  return { from: `${key}-01-01`, to: end < todayEt ? end : todayEt };
}

// Exported for the selfcheck / page (re-exported so callers import one module).
export { CATEGORIES, RISK_LEVELS };
