// src/lib/reports/scrap.ts — rpt-04
// Pure builder for the v2 Scrap report (/v2/reports/scrap). Input is the raw GET /v2/api/reports/scrap
// payload (scrap_events rows in range, voided included; cutting activity for the per-order
// denominator; closed sessions for the empty state; a fixed last-6-months series). No DB, no React —
// exercised by scrap.selfcheck.ts (`npx tsx src/lib/reports/scrap.selfcheck.ts`).
// Rules: rows bucket by event_date (already an ET calendar date); line / reason / shift filters apply
// to every aggregate; voided rows never count — showVoided only adds them to the entries list; board
// feet are scrap_board_ft as stored (never recomputed). Orders cut ignores the scrap filters.
import { SCRAP_LINES, SCRAP_REASONS, type ScrapReason, type ScrapRow, type ScrapSource } from "../qc/scrap";
import { etDateKey } from "../etDateTime";
import { addMonths, monthLabel, monthOf } from "./incidents";
import { addDaysYmd, eachDay } from "./range";

export { MAX_RANGE_DAYS, validRange } from "./range";
export { SCRAP_LINES, SCRAP_REASONS };

export const SCRAP_PROMPT_LIVE = "2026-10-20";   // qc-05: cutting-board capture went live (ET date)
// The void reason on the 11 legacy test rows (voided 10-23 by the Orchestrator, Steve-approved).
export const TEST_VOID_REASON = "Test data — voided before rpt-04";

export interface ScrapActivity { job_id: string | null; ts: string; kind: "session" | "item"; }
export interface ScrapRaw {
  rows: ScrapRow[];
  activity: ScrapActivity[];
  closedSessions: { ended_at: string }[];
  months: { month: string; boardFt: number; entries: number }[];
}

export interface ScrapListRow extends ScrapRow { size: string; voided: boolean; }
export interface ScrapWeek { weekStart: string; label: string; byReason: Record<ScrapReason, number>; boardFt: number; entries: number; }
export interface ScrapMonth { month: string; label: string; boardFt: number; entries: number; }
export interface ScrapBucket { name: string; boardFt: number; entries: number; }
export interface ScrapKpis {
  boardFt: number;
  pieces: number;
  entries: number;
  voided: number;
  voidedTestOnly: boolean;                         // every voided row in range carries TEST_VOID_REASON
  topReason: { name: ScrapReason; boardFt: number } | null;
  topLine: { name: string; boardFt: number } | null;
  ordersCut: number;
  perOrderCut: number | null;
}
export interface ScrapReport {
  kpis: ScrapKpis;
  weeks: ScrapWeek[];
  byReason: ScrapBucket[];
  byLine: ScrapBucket[];
  byOperator: ScrapBucket[];
  bySource: Record<ScrapSource, number>;
  months: ScrapMonth[];
  list: ScrapListRow[];
  empty: { isEmpty: boolean; closedSessions: number; liveFrom: string | null };
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const OPERATOR_TOP = 8;

const bf = (r: ScrapRow) => Number(r.scrap_board_ft) || 0;

// Monday on or before a calendar date.
export function mondayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  return addDaysYmd(ymd, -dow);
}

// "Wk of Oct 19"
export function weekLabel(monday: string): string {
  return `Wk of ${MONTH_SHORT[Number(monday.slice(5, 7)) - 1]} ${Number(monday.slice(8, 10))}`;
}

// "4 × 2 × 24 × 48" — pieces × T × W × L, missing parts omitted; "—" when all are missing.
export function sizeText(r: Pick<ScrapRow, "pieces" | "thickness_in" | "width_in" | "length_in">): string {
  const parts = [r.pieces, r.thickness_in, r.width_in, r.length_in]
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(Number(v)))
    .map((v) => String(Number(v)));
  return parts.length ? parts.join(" × ") : "—";
}

function zeroReasons(): Record<ScrapReason, number> {
  return Object.fromEntries(SCRAP_REASONS.map((r) => [r, 0])) as Record<ScrapReason, number>;
}

function top<T extends string>(m: Map<T, number>, order: readonly T[]): { name: T; boardFt: number } | null {
  let best: { name: T; boardFt: number } | null = null;
  for (const name of order) {
    const v = m.get(name) ?? 0;
    if (v > 0 && (!best || v > best.boardFt)) best = { name, boardFt: v };
  }
  return best;
}

export function buildScrapReport(raw: ScrapRaw, opts: {
  from: string; to: string;                       // ET YYYY-MM-DD inclusive
  line: string | null; reason: string | null; shift: string | null;
  showVoided: boolean; todayEt: string;
}): ScrapReport {
  const { from, to } = opts;
  const inRange = (d: string | null) => !!d && d >= from && d <= to;
  const matches = (r: ScrapRow) =>
    inRange(r.event_date) &&
    (!opts.line || r.line_machine === opts.line) &&
    (!opts.reason || r.scrap_reason === opts.reason) &&
    (!opts.shift || String(r.shift) === opts.shift);

  const filtered = (raw.rows ?? []).filter(matches);
  const live = filtered.filter((r) => !r.voided_at);
  const voided = filtered.filter((r) => !!r.voided_at);

  // Weeks: every Monday-start week overlapping the range, zero-filled.
  const weeks: ScrapWeek[] = [];
  const weekIdx = new Map<string, number>();
  for (const day of eachDay(from, to)) {
    const mon = mondayOf(day);
    if (weekIdx.has(mon)) continue;
    weekIdx.set(mon, weeks.length);
    weeks.push({ weekStart: mon, label: weekLabel(mon), byReason: zeroReasons(), boardFt: 0, entries: 0 });
  }

  const reasonBf = new Map<ScrapReason, number>();
  const reasonN = new Map<ScrapReason, number>();
  const lineBf = new Map<string, number>();
  const lineN = new Map<string, number>();
  const opBf = new Map<string, number>();
  const opN = new Map<string, number>();
  const bySource: Record<ScrapSource, number> = { cutting: 0, qc: 0, legacy: 0 };
  let boardFt = 0;
  let pieces = 0;

  for (const r of live) {
    const v = bf(r);
    boardFt += v;
    if (r.pieces !== null && r.pieces !== undefined && Number.isFinite(Number(r.pieces))) pieces += Number(r.pieces);
    reasonBf.set(r.scrap_reason, (reasonBf.get(r.scrap_reason) ?? 0) + v);
    reasonN.set(r.scrap_reason, (reasonN.get(r.scrap_reason) ?? 0) + 1);
    lineBf.set(r.line_machine, (lineBf.get(r.line_machine) ?? 0) + v);
    lineN.set(r.line_machine, (lineN.get(r.line_machine) ?? 0) + 1);
    const op = r.operator_name || "—";
    opBf.set(op, (opBf.get(op) ?? 0) + v);
    opN.set(op, (opN.get(op) ?? 0) + 1);
    if (r.source in bySource) bySource[r.source] += 1;
    const w = weekIdx.get(mondayOf(r.event_date));
    if (w !== undefined) {
      const wk = weeks[w];
      wk.boardFt += v;
      wk.entries += 1;
      if (r.scrap_reason in wk.byReason) wk.byReason[r.scrap_reason] += v;
    }
  }

  // Orders cut — distinct jobs with a session started or an item completed on an ET day in range.
  const jobs = new Set<string>();
  for (const a of raw.activity ?? []) {
    if (a.job_id && inRange(etDateKey(a.ts))) jobs.add(a.job_id);
  }
  const ordersCut = jobs.size;

  const lineOrder = [...SCRAP_LINES, ...Array.from(lineBf.keys()).filter((l) => !(SCRAP_LINES as readonly string[]).includes(l))];
  const byLine = lineOrder
    .filter((l) => (lineN.get(l) ?? 0) > 0)
    .map((l) => ({ name: l, boardFt: lineBf.get(l) ?? 0, entries: lineN.get(l) ?? 0 }));
  const byOperator = Array.from(opBf.keys())
    .map((name) => ({ name, boardFt: opBf.get(name) ?? 0, entries: opN.get(name) ?? 0 }))
    .sort((a, b) => b.boardFt - a.boardFt || a.name.localeCompare(b.name))
    .slice(0, OPERATOR_TOP);

  // Months: exactly six calendar months ending with today's (ET) month, zero-filled.
  const lastMonth = monthOf(opts.todayEt);
  const given = new Map((raw.months ?? []).map((m) => [m.month, m]));
  const monthKeys = Array.from({ length: 6 }, (_, i) => addMonths(lastMonth, i - 5));
  const spansYears = monthKeys[0].slice(0, 4) !== lastMonth.slice(0, 4);
  const months = monthKeys.map((m) => ({
    month: m,
    label: monthLabel(m, spansYears),
    boardFt: Number(given.get(m)?.boardFt) || 0,
    entries: Number(given.get(m)?.entries) || 0,
  }));

  const list = (opts.showVoided ? filtered : live)
    .slice()
    .sort((a, b) => (a.event_date === b.event_date
      ? String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
      : b.event_date.localeCompare(a.event_date)))
    .map((r) => ({ ...r, size: sizeText(r), voided: !!r.voided_at }));

  // rpt-05: the closed-sessions line covers the part of the range on/after SCRAP_PROMPT_LIVE (null = none).
  const liveFrom = to >= SCRAP_PROMPT_LIVE ? (from > SCRAP_PROMPT_LIVE ? from : SCRAP_PROMPT_LIVE) : null;
  const closedSessions = liveFrom
    ? (raw.closedSessions ?? []).filter((s) => { const d = etDateKey(s.ended_at); return !!d && d >= liveFrom && d <= to; }).length
    : 0;

  return {
    kpis: {
      boardFt,
      pieces,
      entries: live.length,
      voided: voided.length,
      voidedTestOnly: voided.length > 0 && voided.every((r) => r.void_reason === TEST_VOID_REASON),
      topReason: top(reasonBf, SCRAP_REASONS),
      topLine: top(lineBf, lineOrder),
      ordersCut,
      perOrderCut: boardFt > 0 && ordersCut > 0 ? boardFt / ordersCut : null,
    },
    weeks,
    byReason: SCRAP_REASONS.map((name) => ({ name, boardFt: reasonBf.get(name) ?? 0, entries: reasonN.get(name) ?? 0 })),
    byLine,
    byOperator,
    bySource,
    months,
    list,
    empty: { isEmpty: live.length === 0, closedSessions, liveFrom },
  };
}
