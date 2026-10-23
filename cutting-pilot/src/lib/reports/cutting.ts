// src/lib/reports/cutting.ts — rpt-01
// Pure Cutting activity report (no DB, no React): GET /v2/api/reports/cutting returns raw rows and
// the page runs buildCuttingReport client-side, so filters and the exclude toggle never refetch.
// Port of legacy reports/cutting/index.html's client logic onto one session model for all four lines.
//   - ET bucketing: a session belongs to the ET day it STARTED (its whole duration counts there, even
//     past midnight); an item to the ET day of its updated_at. lib/etDateTime does the zone maths.
//   - Duration = ended_at − started_at for closed sessions. Open sessions are "running": counted as
//     sessions (KPI / operator / order tallies) but in no hours, flags or other KPIs.
//   - Flags (closed only, strict): short < 60 s (Start/Stop tapped, no cut), long > 8 h (missed Stop).
//   - excludeFlagged zeroes flagged sessions' hours everywhere hours follow the toggle (KPI `hours`
//     is always incl. flagged, `hoursExclFlagged` always excl. — the UI shows one, captions the other).
//   - Items cut = completed cutting_line_progress rows: a count, never a rate.
import { etDateKey, parseStoredUtc } from "../etDateTime";
import { eachDay } from "./range";

export { MAX_RANGE_DAYS, validRange } from "./range";

export const SHORT_SESSION_SEC = 60;        // closed session < 60 s → flag "short" (Start/Stop tapped, no cut)
export const LONG_SESSION_SEC = 8 * 3600;   // closed session > 8 h → flag "long" (likely missed Stop)
export const LINES = ["Main Line", "Blue Line", "Cross Cutter", "Hole Cutter"] as const;
export type LineName = (typeof LINES)[number];

// ── Raw API rows ─────────────────────────────────────────────────────────────────────────────
export interface RawSessionRow {
  id: string; job_id: string | null; line: string; operator_id: string | null; operator_name: string | null;
  status: string | null; started_at: string; ended_at: string | null; handoff_note: string | null;
  invoice_number: string | null; customer: string | null; operator_shift: string | null;
}
export interface RawItemRow {
  id: string; job_id: string | null; line: string; invoice_number: string | null; customer: string | null;
  description: string | null; dimensions: string | null; part_number: string | null;
  cut_by: string | null; cut_by_shift: string | null; updated_by: string | null; updated_at: string;
}
export interface RawChunkRow {
  id: string; board: string; ref_id: string | null; work_item: string | null; operator_id: string | null;
  operator_name: string | null; operator_shift: string | null; started_at: string; ended_at: string | null; status: string | null;
}
export interface CuttingRaw { sessions: RawSessionRow[]; items: RawItemRow[]; chunk: RawChunkRow[]; }

// ── Report shapes ────────────────────────────────────────────────────────────────────────────
export type SessionFlag = "short" | "long" | null;
export interface ReportSession {
  id: string; kind: "line" | "chunk"; line: string; jobId: string | null; invoice: string | null; customer: string | null;
  workItem: string | null; operator: string; shift: string | null; startedAt: string; endedAt: string | null;
  startMs: number; endMs: number | null; running: boolean; durSec: number; flag: SessionFlag; note: string;
}
export interface ReportItem {
  id: string; jobId: string | null; line: string; invoice: string | null; customer: string | null;
  part: string; dimensions: string; cutBy: string; shift: string | null; at: string; atMs: number;
}
export interface CuttingKpis {
  hours: number; hoursExclFlagged: number; sessions: number; operators: number; orders: number; items: number;
  flaggedShort: number; flaggedLong: number; running: number;
}
// byLine honours excludeFlagged; byLineClean never includes flagged hours (the chart stacks flaggedHours on
// top of it when the toggle is off, so nothing is counted twice); flaggedHours = what was / would be excluded.
export interface CuttingDay { date: string; byLine: Record<LineName, number>; byLineClean: Record<LineName, number>; flaggedHours: number; }
export interface OperatorRow {
  name: string; shift: string | null; sessions: number; hours: number; hoursExclFlagged: number; items: number;
  short: number; long: number; notes: number;
}
export interface OrderGroup {
  jobId: string; invoice: string | null; customer: string | null; operators: string[]; sessions: ReportSession[];
  items: ReportItem[]; hours: number; latestMs: number;
}
export interface CuttingReport {
  kpis: CuttingKpis; days: CuttingDay[]; operators: OperatorRow[]; flags: ReportSession[]; orders: OrderGroup[];
  chunk: ReportSession[]; operatorOptions: string[];
  linesWithHours: LineName[];    // lines with clean (non-flagged) hours in range, LINES order — one chart <Bar> each
  linesWithSessions: LineName[]; // lines with any session (running / flagged included), LINES order
}

const BOARD_LINE: Record<string, LineName> = { cc: "Cross Cutter", hc: "Hole Cutter" };
const s = (v: string | null | undefined) => (v ?? "").trim();
const hrs = (sec: number) => sec / 3600;

function flagOf(running: boolean, durSec: number): SessionFlag {
  if (running) return null;
  if (durSec < SHORT_SESSION_SEC) return "short";
  if (durSec > LONG_SESSION_SEC) return "long";
  return null;
}

function normalizeSession(
  base: Omit<ReportSession, "startMs" | "endMs" | "running" | "durSec" | "flag">, nowMs: number
): ReportSession | null {
  const startMs = parseStoredUtc(base.startedAt);
  if (startMs == null) return null;
  const endMs = parseStoredUtc(base.endedAt);
  const running = endMs == null;
  const durSec = Math.max(0, Math.round(((running ? nowMs : endMs) - startMs) / 1000));
  return { ...base, startMs, endMs, running, durSec, flag: flagOf(running, durSec) };
}

// "16s", "4m", "1h 08m", "18h 12m".
export function formatDuration(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  if (t < 60) return `${t}s`;
  if (t < 3600) return `${Math.floor(t / 60)}m`;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

// A session's contribution to "hours" under the toggle (closed only).
function countedSec(x: ReportSession, excludeFlagged: boolean): number {
  if (x.running) return 0;
  if (excludeFlagged && x.flag) return 0;
  return x.durSec;
}

export function buildCuttingReport(raw: CuttingRaw, opts: {
  from: string; to: string;               // ET YYYY-MM-DD, inclusive
  operator: string | null; line: string | null;
  excludeFlagged: boolean; nowMs: number;
}): CuttingReport {
  const { from, to, excludeFlagged, nowMs } = opts;
  const inRange = (ts: string | null | undefined) => {
    const k = etDateKey(ts);
    return k != null && k >= from && k <= to;
  };

  // Normalise every session (four lines, one model), then the ET range cut.
  const all: ReportSession[] = [];
  for (const r of raw.sessions ?? []) {
    const x = normalizeSession({
      id: r.id, kind: "line", line: s(r.line), jobId: r.job_id || null, invoice: s(r.invoice_number) || null,
      customer: s(r.customer) || null, workItem: null, operator: s(r.operator_name) || "Unknown",
      shift: s(r.operator_shift) || null, startedAt: r.started_at, endedAt: r.ended_at, note: s(r.handoff_note),
    }, nowMs);
    if (x && inRange(r.started_at)) all.push(x);
  }
  for (const r of raw.chunk ?? []) {
    const x = normalizeSession({
      id: r.id, kind: "chunk", line: BOARD_LINE[r.board] ?? s(r.board), jobId: null, invoice: null, customer: null,
      workItem: s(r.work_item) || s(r.ref_id) || null, operator: s(r.operator_name) || "Unknown",
      shift: s(r.operator_shift) || null, startedAt: r.started_at, endedAt: r.ended_at, note: "",
    }, nowMs);
    if (x && inRange(r.started_at)) all.push(x);
  }
  const allItems: ReportItem[] = [];
  for (const r of raw.items ?? []) {
    const atMs = parseStoredUtc(r.updated_at);
    if (atMs == null || !inRange(r.updated_at)) continue;
    allItems.push({
      id: r.id, jobId: r.job_id || null, line: s(r.line), invoice: s(r.invoice_number) || null, customer: s(r.customer) || null,
      part: s(r.part_number) || s(r.description) || "—", dimensions: s(r.dimensions), cutBy: s(r.cut_by) || s(r.updated_by) || "Unknown",
      shift: s(r.cut_by_shift) || null, at: r.updated_at, atMs,
    });
  }

  // Operator choices come before BOTH filters, so picking a line never drops the chosen operator.
  const operatorOptions = Array.from(new Set([...all.map((x) => x.operator), ...allItems.map((i) => i.cutBy)]))
    .sort((a, b) => a.localeCompare(b));

  const opF = opts.operator || null;
  const lineF = opts.line || null;
  const sessions = all.filter((x) => (!opF || x.operator === opF) && (!lineF || x.line === lineF));
  const items = allItems.filter((i) => (!opF || i.cutBy === opF) && (!lineF || i.line === lineF));
  const closed = sessions.filter((x) => !x.running);

  // KPIs
  const sumSec = (xs: ReportSession[], excl: boolean) => xs.reduce((t, x) => t + countedSec(x, excl), 0);
  const kpis: CuttingKpis = {
    hours: hrs(sumSec(closed, false)),
    hoursExclFlagged: hrs(sumSec(closed, true)),
    sessions: sessions.length,
    operators: new Set([...sessions.map((x) => x.operator), ...items.map((i) => i.cutBy)]).size,
    orders: new Set([...sessions.map((x) => x.jobId), ...items.map((i) => i.jobId)].filter((v): v is string => !!v)).size,
    items: items.length,
    flaggedShort: closed.filter((x) => x.flag === "short").length,
    flaggedLong: closed.filter((x) => x.flag === "long").length,
    running: sessions.filter((x) => x.running).length,
  };

  // Days (zero-filled, calendar maths — DST-safe)
  const zero = () => Object.fromEntries(LINES.map((l) => [l, 0])) as Record<LineName, number>;
  const dayMap = new Map<string, CuttingDay>(eachDay(from, to).map((d) => [d, { date: d, byLine: zero(), byLineClean: zero(), flaggedHours: 0 }]));
  for (const x of closed) {
    const day = dayMap.get(etDateKey(x.startedAt) ?? "");
    if (!day) continue;
    if ((LINES as readonly string[]).includes(x.line)) {
      day.byLine[x.line as LineName] += hrs(countedSec(x, excludeFlagged));
      day.byLineClean[x.line as LineName] += hrs(countedSec(x, true));
    }
    if (x.flag) day.flaggedHours += hrs(x.durSec);
  }
  const days = Array.from(dayMap.values());
  const linesWithHours = LINES.filter((l) => days.some((d) => d.byLineClean[l] > 0));
  const linesWithSessions = LINES.filter((l) => sessions.some((x) => x.line === l));

  // Operators
  const ops = new Map<string, OperatorRow>();
  const op = (name: string, shift: string | null) => {
    let row = ops.get(name);
    if (!row) {
      row = { name, shift, sessions: 0, hours: 0, hoursExclFlagged: 0, items: 0, short: 0, long: 0, notes: 0 };
      ops.set(name, row);
    }
    if (!row.shift && shift) row.shift = shift;
    return row;
  };
  for (const x of sessions) {
    const row = op(x.operator, x.shift);
    row.sessions += 1;
    row.hours += hrs(countedSec(x, false));
    row.hoursExclFlagged += hrs(countedSec(x, true));
    if (x.flag === "short") row.short += 1;
    if (x.flag === "long") row.long += 1;
    if (x.note) row.notes += 1;
  }
  for (const i of items) op(i.cutBy, i.shift).items += 1;
  const operators = Array.from(ops.values()).sort((a, b) => b.hours - a.hours || b.items - a.items || a.name.localeCompare(b.name));

  // Flags, newest first
  const flags = closed.filter((x) => x.flag).sort((a, b) => b.startMs - a.startMs);

  // Orders (line sessions with a job + items), newest activity first
  const groups = new Map<string, OrderGroup>();
  const group = (jobId: string, invoice: string | null, customer: string | null) => {
    let g = groups.get(jobId);
    if (!g) {
      g = { jobId, invoice, customer, operators: [], sessions: [], items: [], hours: 0, latestMs: 0 };
      groups.set(jobId, g);
    }
    if (!g.invoice && invoice) g.invoice = invoice;
    if (!g.customer && customer) g.customer = customer;
    return g;
  };
  for (const x of sessions) {
    if (x.kind !== "line" || !x.jobId) continue;
    const g = group(x.jobId, x.invoice, x.customer);
    g.sessions.push(x);
    g.hours += hrs(countedSec(x, excludeFlagged));
    g.latestMs = Math.max(g.latestMs, x.endMs ?? x.startMs, x.startMs);
  }
  for (const i of items) {
    if (!i.jobId) continue;
    const g = group(i.jobId, i.invoice, i.customer);
    g.items.push(i);
    g.latestMs = Math.max(g.latestMs, i.atMs);
  }
  const orders = Array.from(groups.values())
    .map((g) => ({
      ...g,
      operators: Array.from(new Set([...g.sessions.map((x) => x.operator), ...g.items.map((i) => i.cutBy)])).sort((a, b) => a.localeCompare(b)),
      sessions: [...g.sessions].sort((a, b) => a.startMs - b.startMs),
      items: [...g.items].sort((a, b) => a.atMs - b.atMs),
    }))
    .sort((a, b) => b.latestMs - a.latestMs);

  const chunk = sessions.filter((x) => x.kind === "chunk").sort((a, b) => b.startMs - a.startMs);

  return { kpis, days, operators, flags, orders, chunk, operatorOptions, linesWithHours, linesWithSessions };
}
