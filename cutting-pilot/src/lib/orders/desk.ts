// src/lib/orders/desk.ts — ord-dash-01
// Pure builder for GET /v2/api/orders/desk (Orders intake desk): KPIs, recent intake list and the
// needs-attention rules. No DB, no clock — `todayEt` is passed in. The route only fetches rows.
// jobs.created_at comes in two UTC shapes ("2026-10-01T01:38:53.048Z" older, "2026-11-20 13:41:51"
// current); always bucket with etDateKey, never compare created_at strings to ET dates.
// Exercised by desk.selfcheck.ts (`npx tsx src/lib/orders/desk.selfcheck.ts` from cutting-pilot/).
import { etDateKey, parseStoredUtc } from "../etDateTime";
import { linesMissingDims } from "../orderLineDims";
import { parseProcesses } from "../processes";
import { isSisterCompanyDelivery } from "../logistics/toLoadSheet";
import type { AttentionItem, AttentionRule, DeskKpis, DeskRecentRow } from "../../types/ordersDesk";

export const DESK_MAX_RANGE_DAYS = 92;
export const ATTENTION_STATUSES = ["not_started", "in_production", "done"] as const;

// ── Date helpers (YYYY-MM-DD, UTC-noon based so DST never shifts a day) ─────────────────────────
export function isYmd(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ""));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function addDaysEt(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
}

/** Current ET week Monday → Sunday for an ET date. A Sunday belongs to the week starting six days earlier. */
export function etWeekRange(todayEt: string): { from: string; to: string } {
  const [y, m, d] = todayEt.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() + 6) % 7; // 0 = Mon … 6 = Sun
  const from = addDaysEt(todayEt, -dow);
  return { from, to: addDaysEt(from, 6) };
}

export function validDeskRange(from: string, to: string): { ok: true } | { ok: false; error: string } {
  if (!isYmd(from) || !isYmd(to)) return { ok: false, error: "from and to must be dates (YYYY-MM-DD)." };
  if (from > to) return { ok: false, error: "The start date is after the end date." };
  const [a, b] = [from, to].map((s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); });
  if (Math.round((b - a) / 86400000) + 1 > DESK_MAX_RANGE_DAYS) {
    return { ok: false, error: `Pick a range of ${DESK_MAX_RANGE_DAYS} days or fewer.` };
  }
  return { ok: true };
}

// ── Input rows ──────────────────────────────────────────────────────────────────────────────────
export interface DeskJobRow {
  id: string;
  invoice_number: string | null;
  customer: string | null;
  ship_date: string | null;
  status: string;
  source: string | null;
  total_bdft: number | null;
  load_count: number | null;
  line_count?: number | null;
  created_at: string;
  archived_at: string | null;
}
export interface DeskScopeJobRow {
  id: string;
  invoice_number: string | null;
  customer: string | null;
  ship_date: string | null;
  status: string;
  archived_at: string | null;
  method: string | null;
  ship_to_company: string | null;
  ship_to_verified: string | null;
  processes: unknown;
}
export interface DeskLineRow {
  job_id: string;
  part_number: string | null;
  description: string | null;
  dimensions: string | null;
  sort_order: number | null;
}
export interface DeskScheduleRow {
  invoice_number: string | null;
  ship_date: string | null;
  customer: string | null;
  sheet_status: string | null;
  match_job_id: string | null;
  has_job?: number | boolean | null;   // route's LEFT JOIN result; rows with a job are dropped
}
export interface DeskInput {
  from: string;
  to: string;
  recentJobs: DeskJobRow[];     // superset; exact ET cut happens here
  weekJobs: DeskJobRow[];       // superset for the current ET week
  scopeJobs: DeskScopeJobRow[]; // candidates for the attention rules (filtered again here)
  lines: DeskLineRow[];
  schedule: DeskScheduleRow[];  // unmatched schedule rows with no job (route-filtered)
}

const blank = (v: unknown) => String(v ?? "").trim() === "";

/** archived_at null AND status ∈ {not_started, in_production, done} AND (no ship date OR ship_date ≥ today ET). */
export function inAttentionScope(
  job: { archived_at: string | null; status: string | null; ship_date: string | null },
  todayEt: string
): boolean {
  if (job.archived_at) return false;
  if (!(ATTENTION_STATUSES as readonly string[]).includes(String(job.status ?? ""))) return false;
  const sd = String(job.ship_date ?? "").trim();
  return sd === "" || sd >= todayEt;
}

export function dimsDetail(lines: number[]): string | null {
  if (!lines.length) return null;
  return lines.length === 1 ? `Line ${lines[0]}` : `Lines ${lines.join(", ")}`;
}

const ADDRESS_FLAGGED = new Set(["unverified", "unverifiable"]);

/** Job-level rules for one in-scope job (scope is NOT checked here). */
export function jobAttention(job: DeskScopeJobRow, jobLines: DeskLineRow[]): AttentionItem[] {
  const base = { job_id: job.id, invoice_number: job.invoice_number, customer: job.customer, ship_date: blank(job.ship_date) ? null : String(job.ship_date).trim() };
  const out: AttentionItem[] = [];
  if (blank(job.ship_date)) out.push({ rule: "no_ship_date", ...base, detail: null });
  if (parseProcesses(job.processes).length === 0) out.push({ rule: "no_processes", ...base, detail: null });
  const ordered = [...jobLines].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  const missing = linesMissingDims(ordered);
  if (missing.length) out.push({ rule: "blank_dims", ...base, detail: dimsDetail(missing) });
  const verified = blank(job.ship_to_verified) ? "unverified" : String(job.ship_to_verified).trim();
  const pickup = String(job.method ?? "").trim().toLowerCase() === "customer pickup";
  if (ADDRESS_FLAGGED.has(verified) && !pickup && !isSisterCompanyDelivery(job.customer, job.ship_to_company)) {
    out.push({ rule: "address_unverified", ...base, detail: verified });
  }
  return out;
}

/** Unmatched schedule rows with ship_date ≥ yesterday ET and no job (archived or not) for the invoice; de-duped by invoice (earliest ship date). */
export function scheduleGaps(rows: DeskScheduleRow[], todayEt: string, jobInvoices: ReadonlySet<string> = new Set()): AttentionItem[] {
  const yesterday = addDaysEt(todayEt, -1);
  const byInv = new Map<string, AttentionItem>();
  for (const r of rows) {
    if (r.match_job_id) continue;
    if (r.has_job) continue;
    const inv = String(r.invoice_number ?? "").trim();
    const sd = String(r.ship_date ?? "").trim();
    if (!inv || !sd || sd < yesterday) continue;
    if (jobInvoices.has(inv)) continue;
    const prev = byInv.get(inv);
    if (!prev || sd < String(prev.ship_date)) {
      byInv.set(inv, { rule: "schedule_gap", job_id: null, invoice_number: inv, customer: r.customer, ship_date: sd, detail: r.sheet_status });
    }
  }
  return Array.from(byInv.values());
}

function cmpItems(a: AttentionItem, b: AttentionItem): number {
  const ga = a.rule === "schedule_gap" ? 0 : 1;
  const gb = b.rule === "schedule_gap" ? 0 : 1;
  if (ga !== gb) return ga - gb;
  const sa = a.ship_date ?? "";
  const sb = b.ship_date ?? "";
  if (sa !== sb) {
    if (!sa) return -1; // nulls first
    if (!sb) return 1;
    return sa < sb ? -1 : 1;
  }
  const ia = a.invoice_number ?? "";
  const ib = b.invoice_number ?? "";
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

export function orderAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort(cmpItems);
}

export function buildDesk(input: DeskInput, todayEt: string): {
  kpis: DeskKpis;
  recent: DeskRecentRow[];
  attention: AttentionItem[];
} {
  // Attention
  const linesBy = new Map<string, DeskLineRow[]>();
  for (const l of input.lines ?? []) {
    const list = linesBy.get(l.job_id) ?? [];
    list.push(l);
    linesBy.set(l.job_id, list);
  }
  const jobItems: AttentionItem[] = [];
  const rulesBy = new Map<string, AttentionRule[]>();
  for (const j of input.scopeJobs ?? []) {
    if (!inAttentionScope(j, todayEt)) continue;
    const items = jobAttention(j, linesBy.get(j.id) ?? []);
    if (items.length) rulesBy.set(j.id, items.map((i) => i.rule));
    jobItems.push(...items);
  }
  const gaps = scheduleGaps(input.schedule ?? [], todayEt);
  const attention = orderAttention([...gaps, ...jobItems]);

  // Recent (exact ET cut on created_at)
  const recent: DeskRecentRow[] = [];
  for (const j of input.recentJobs ?? []) {
    const et = etDateKey(j.created_at);
    if (!et || et < input.from || et > input.to) continue;
    recent.push({
      id: j.id,
      invoice_number: j.invoice_number,
      customer: j.customer,
      ship_date: j.ship_date,
      status: j.status,
      source: j.source,
      total_bdft: j.total_bdft == null ? null : Number(j.total_bdft),
      load_count: j.load_count == null ? null : Number(j.load_count),
      line_count: Number(j.line_count) || 0,
      created_at: j.created_at,
      created_et_date: et,
      archived: !!j.archived_at,
      attention: rulesBy.get(j.id) ?? [],
    });
  }
  recent.sort((a, b) => (parseStoredUtc(b.created_at) ?? 0) - (parseStoredUtc(a.created_at) ?? 0));

  // KPIs (week is the current ET week, independent of from/to)
  const week = etWeekRange(todayEt);
  let enteredToday = 0;
  let enteredWeek = 0;
  let bdftWeek = 0;
  const seen = new Set<string>();
  for (const j of input.weekJobs ?? []) {
    if (seen.has(j.id)) continue;
    seen.add(j.id);
    const et = etDateKey(j.created_at);
    if (!et) continue;
    if (et === todayEt) enteredToday += 1;
    if (et >= week.from && et <= week.to) {
      enteredWeek += 1;
      bdftWeek += Number(j.total_bdft) || 0;
    }
  }

  return {
    kpis: {
      entered_today: enteredToday,
      entered_week: enteredWeek,
      bdft_week: Math.round(bdftWeek),
      attention_jobs: rulesBy.size,
      schedule_gaps: gaps.length,
    },
    recent,
    attention,
  };
}
