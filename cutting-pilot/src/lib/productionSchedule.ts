// src/lib/productionSchedule.ts
// Production schedule (prod-d-02): per-day planning lines whose progress is DERIVED from the logs,
// never checked off. Molding line = block_type + qty blocks; expansion line = supplier + bead type
// + density + qty silos filled. Pure helpers + one batched loader + the TV DashboardData contract.
// Client-safe: only a type import from workers-types; no server-only modules.
import type { D1Database } from "@cloudflare/workers-types";
import { normDensity } from "./productionRecipes";

export type ScheduleKind = "molding" | "expansion";

export const EDIT_WINDOW_DAYS = 14;
export const MAX_READ_SPAN_DAYS = 31;
export const QTY_MAX = 999;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ET calendar date (same as the private copies in the production routes).
export function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function isRealDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Next Mon–Fri date strictly after `date` (YYYY-MM-DD). Fri/Sat/Sun → Monday. No holiday calendar. */
export function nextBusinessDay(date: string): string {
  let next = addDays(date, 1);
  for (;;) {
    const [y, m, d] = next.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow !== 0 && dow !== 6) return next;
    next = addDays(next, 1);
  }
}

// Days from a to b (b - a), both YYYY-MM-DD.
export function dayDiff(a: string, b: string): number {
  const ms = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / 86400000);
}

const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

// ET wall-clock minus UTC at a given instant (e.g. -4 h in EDT, -5 h in EST). Derived from Intl —
// never a hardcoded offset.
function etOffsetMs(utcMs: number): number {
  const p: Record<string, number> = {};
  for (const part of ET_PARTS.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return wall - utcMs;
}

// UTC instant of ET midnight starting `date`. DST switches at 02:00, so midnight is never ambiguous;
// two passes settle the offset.
function etMidnightUtcMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d);
  let t = naive - etOffsetMs(naive);
  t = naive - etOffsetMs(t);
  return t;
}

const stamp = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

// [start, nextStart) of an ET calendar day as UTC `YYYY-MM-DD HH:MM:SS` strings — the same format
// now() writes to created_at, so plain string comparison works. 23 h / 25 h on DST days.
export function etDayBoundsUtc(date: string): [string, string] {
  return [stamp(etMidnightUtcMs(date)), stamp(etMidnightUtcMs(addDays(date, 1)))];
}

// null when OK; else the error code. Editable window = [today, today + 14].
export function validatePlanDate(date: unknown, today: string): "invalid_plan_date" | "date_out_of_range" | null {
  if (typeof date !== "string" || !isRealDate(date)) return "invalid_plan_date";
  if (date < today || date > addDays(today, EDIT_WINDOW_DAYS)) return "date_out_of_range";
  return null;
}

// Integer 1..999, else null.
export function normQty(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= QTY_MAX ? n : null;
}

export interface ScheduleLineInput {
  kind: ScheduleKind;
  block_type: string | null;
  bead_supplier: string | null;
  bead_type: string | null;
  density: number | null;
  qty: number;
  note: string | null;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

// Shape/format validation only — option existence (active production_options) is checked in the
// route, reusing unknown_block_type / unknown_bead_type.
export function validateLineInput(
  kind: unknown,
  body: Record<string, unknown>
):
  | { ok: true; value: ScheduleLineInput }
  | { ok: false; error: "invalid_kind" | "qty_invalid" | "density_required" | "unknown_block_type" | "unknown_bead_type" } {
  if (kind !== "molding" && kind !== "expansion") return { ok: false, error: "invalid_kind" };
  const qty = normQty(body.qty);
  if (qty === null) return { ok: false, error: "qty_invalid" };
  const note = text(body.note);
  if (kind === "molding") {
    const block_type = text(body.block_type);
    if (!block_type) return { ok: false, error: "unknown_block_type" };
    return { ok: true, value: { kind, block_type, bead_supplier: null, bead_type: null, density: null, qty, note } };
  }
  const bead_supplier = text(body.bead_supplier);
  const bead_type = text(body.bead_type);
  if (!bead_supplier || !bead_type) return { ok: false, error: "unknown_bead_type" };
  const density = normDensity(body.density);
  if (density === null) return { ok: false, error: "density_required" };
  return { ok: true, value: { kind, block_type: null, bead_supplier, bead_type, density, qty, note } };
}

export interface ScheduleLine {
  id: string;
  plan_date: string;
  kind: ScheduleKind;
  block_type: string | null;
  bead_supplier: string | null;
  bead_type: string | null;
  density: number | null;
  qty: number;
  sort_order: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}

export type ScheduleLineWithProgress = ScheduleLine & {
  done: number;
  in_progress: number; // expansion only, today only: silos currently filling with this key
  running: boolean; // an open, non-deleted sheet with this key exists for today
};

// Stable key for a line / sheet / silo event. Densities compared at 2 dp, never as raw floats.
export function expansionKey(supplier: string | null, beadType: string | null, density: number | null): string {
  const d = density === null || density === undefined ? null : normDensity(density);
  return `${supplier ?? ""}|${beadType ?? ""}|${d === null ? "" : d.toFixed(2)}`;
}
export function lineKey(l: Pick<ScheduleLine, "kind" | "block_type" | "bead_supplier" | "bead_type" | "density">): string {
  return l.kind === "molding" ? `m|${l.block_type ?? ""}` : `e|${expansionKey(l.bead_supplier, l.bead_type, l.density)}`;
}

// Lines in [from, to] with derived progress. Six fixed statements in one DB.batch — no per-line
// queries. Expansion `done` counts `full` silo events whose ET day (bucketed in JS via
// etDayBoundsUtc) is the plan date and whose bead snapshot matches.
export async function loadScheduleWithProgress(
  DB: D1Database,
  from: string,
  to: string,
  today: string
): Promise<ScheduleLineWithProgress[]> {
  const [rangeStart] = etDayBoundsUtc(from);
  const [, rangeEnd] = etDayBoundsUtc(to);
  const [linesRes, moldRes, expRes, fillRes, runMoldRes, runExpRes] = await DB.batch([
    DB.prepare(
      `SELECT * FROM production_schedule WHERE plan_date BETWEEN ? AND ?
        ORDER BY plan_date, kind, sort_order, created_at`
    ).bind(from, to),
    DB.prepare(
      `SELECT s.log_date, s.block_type, COUNT(b.id) AS n
         FROM production_molding_blocks b
         JOIN production_molding_sessions s ON s.id = b.session_id AND s.deleted_at IS NULL
        WHERE s.log_date BETWEEN ? AND ?
        GROUP BY s.log_date, s.block_type`
    ).bind(from, to),
    // Grouped per UTC hour: ET offsets are whole hours, so an hour never straddles an ET day.
    DB.prepare(
      `SELECT bead_supplier, bead_type, ROUND(density, 2) AS d, substr(created_at, 1, 13) AS hr, COUNT(*) AS n
         FROM production_silo_events
        WHERE to_state = 'full' AND created_at >= ? AND created_at < ?
        GROUP BY bead_supplier, bead_type, ROUND(density, 2), substr(created_at, 1, 13)`
    ).bind(rangeStart, rangeEnd),
    DB.prepare(
      `SELECT bead_supplier, bead_type, ROUND(density, 2) AS d, COUNT(*) AS n
         FROM production_silos WHERE state = 'filling' AND active = 1
        GROUP BY bead_supplier, bead_type, ROUND(density, 2)`
    ),
    DB.prepare(
      `SELECT DISTINCT block_type FROM production_molding_sessions
        WHERE status = 'open' AND deleted_at IS NULL AND log_date = ?`
    ).bind(today),
    DB.prepare(
      `SELECT DISTINCT bead_supplier, bead_type, ROUND(density, 2) AS d FROM production_expansion_sessions
        WHERE status = 'open' AND deleted_at IS NULL AND log_date = ?`
    ).bind(today),
  ]);

  const moldDone = new Map<string, number>();
  for (const r of (moldRes.results ?? []) as { log_date: string; block_type: string | null; n: number }[]) {
    moldDone.set(`${r.log_date}|m|${r.block_type ?? ""}`, Number(r.n) || 0);
  }

  const days: { date: string; start: string; end: string }[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const [start, end] = etDayBoundsUtc(d);
    days.push({ date: d, start, end });
  }
  const expDone = new Map<string, number>();
  for (const r of (expRes.results ?? []) as { bead_supplier: string | null; bead_type: string | null; d: number | null; hr: string; n: number }[]) {
    const hourStart = `${r.hr}:00:00`;
    const day = days.find((x) => hourStart >= x.start && hourStart < x.end);
    if (!day) continue;
    const k = `${day.date}|e|${expansionKey(r.bead_supplier, r.bead_type, r.d)}`;
    expDone.set(k, (expDone.get(k) ?? 0) + (Number(r.n) || 0));
  }

  const filling = new Map<string, number>();
  for (const r of (fillRes.results ?? []) as { bead_supplier: string | null; bead_type: string | null; d: number | null; n: number }[]) {
    filling.set(`e|${expansionKey(r.bead_supplier, r.bead_type, r.d)}`, Number(r.n) || 0);
  }
  const running = new Set<string>();
  for (const r of (runMoldRes.results ?? []) as { block_type: string | null }[]) running.add(`m|${r.block_type ?? ""}`);
  for (const r of (runExpRes.results ?? []) as { bead_supplier: string | null; bead_type: string | null; d: number | null }[]) {
    running.add(`e|${expansionKey(r.bead_supplier, r.bead_type, r.d)}`);
  }

  return ((linesRes.results ?? []) as unknown as ScheduleLine[]).map((l) => {
    const k = lineKey(l);
    const isToday = l.plan_date === today;
    const done = l.kind === "molding" ? moldDone.get(`${l.plan_date}|${k}`) ?? 0 : expDone.get(`${l.plan_date}|${k}`) ?? 0;
    return {
      ...l,
      done,
      in_progress: l.kind === "expansion" && isToday ? filling.get(k) ?? 0 : 0,
      running: isToday && running.has(k),
    };
  });
}

// GET /v2/api/production/dashboard — the single endpoint the production TV polls.
export interface DashboardData {
  ok: true;
  server_now: string; // ISO, for idle timers — the TV never trusts its own clock
  date: string; // ET today
  molding: Array<{
    session_id: string;
    log_date: string;
    block_type: string | null;
    opened_at: string;
    recipe_version: number | null;
    recipe_rc_pct_open: number | null;
    recipe_rc_speed: number | null;
    recipe_virgin_pct_open: number | null;
    recipe_virgin_speed: number | null;
    block_count: number;
    last_block: { block_no: string | null; silo: number | null; lot_no: string | null; created_at: string } | null;
  }>;
  expansion: Array<{
    session_id: string;
    log_date: string;
    opened_at: string;
    bead_supplier: string | null;
    bead_type: string | null;
    density: number | null;
    recipe_version: number | null;
    recipe_heating_time_s: number | null;
    batch_count: number;
    total_kg: number;
    last_batch: { silo: number | null; lot_no: string | null; created_at: string } | null;
  }>;
  silos: Array<{
    silo_no: number;
    label: string;
    active: number;
    state: string;
    lot_no: string | null;
    bead_supplier: string | null;
    bead_type: string | null;
    density: number | null;
    full_at: string | null;
  }>;
  schedule: { molding: ScheduleLineWithProgress[]; expansion: ScheduleLineWithProgress[] };
  today: { block_count: number; total_lbs: number; batch_count: number; total_kg: number };
}
