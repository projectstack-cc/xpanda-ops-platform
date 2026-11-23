// src/lib/reports/crosscutter.ts — cc-blocks-02
// Pure builder for the v2 Cross Cutter report (/v2/reports/crosscutter). Input is the raw
// GET /v2/api/reports/crosscutter payload: completed cc_assignments windowed in UTC (the day before
// `from` to two days after `to`), their cc_block_ids rows (cc-blocks-01) and their closed cc
// chunk_sessions. This lib does the exact ET-day cut on completed_at, so a 9 PM ET completion lands on
// its ET date. No DB, no React — exercised by crosscutter.selfcheck.ts
// (`npx tsx cutting-pilot/src/lib/reports/crosscutter.selfcheck.ts`).
// Assignments completed before cc-blocks-01 have no ID rows → block_ids: [] (rendered "—").
import { etDateKey, formatEtClock, parseStoredUtc } from "../etDateTime";
import { normalizeBlockId } from "../cutting/blockIds";

export { MAX_RANGE_DAYS, validRange } from "./range";

export interface CcReportAssignment {
  id: string;
  label: string;
  size_text: string | null;
  target_chunks: number;
  qty_done: number;
  created_by: string | null;
  created_at: string;
  completed_at: string;
}
export interface CcReportBlockId {
  assignment_id: string;
  block_id: string;
  event: string;
  operator_name: string | null;
  created_at: string;
}
export interface CcReportSession {
  ref_id: string;
  operator_name: string | null;
  started_at: string;
  ended_at: string;
}
export interface CrossCutterRaw {
  assignments: CcReportAssignment[];
  blockIds: CcReportBlockId[];
  sessions: CcReportSession[];
}

export interface CrossCutterRow {
  id: string;
  completed_at: string;                            // stored UTC, for sorting
  completed_et: { date: string; time: string };    // ET "YYYY-MM-DD" + "9:05 PM"
  label: string;
  size_text: string | null;
  target: number;
  blocks_cut: number;                              // = qty_done
  over: number | null;                             // blocks_cut − target when target > 0
  block_ids: string[];
  operators: string[];                             // distinct, first-session order
  run_minutes: number;                             // sum of closed session durations
}
export interface CrossCutterTotals {
  completed: number;
  blocks: number;
  overTarget: number;
  runMinutes: number;
}
export interface CrossCutterReport {
  rows: CrossCutterRow[];
  totals: CrossCutterTotals;
}

export function buildCrossCutterReport(
  raw: CrossCutterRaw,
  opts: { from: string; to: string; search?: string }
): CrossCutterReport {
  const { from, to } = opts;

  const idsBy = new Map<string, CcReportBlockId[]>();
  for (const b of [...(raw.blockIds ?? [])].sort((x, y) =>
    x.created_at === y.created_at ? (x.block_id < y.block_id ? -1 : 1) : x.created_at < y.created_at ? -1 : 1
  )) {
    const list = idsBy.get(b.assignment_id) ?? [];
    list.push(b);
    idsBy.set(b.assignment_id, list);
  }
  const sessionsBy = new Map<string, CcReportSession[]>();
  for (const s of [...(raw.sessions ?? [])].sort((x, y) => (x.started_at < y.started_at ? -1 : x.started_at > y.started_at ? 1 : 0))) {
    const list = sessionsBy.get(s.ref_id) ?? [];
    list.push(s);
    sessionsBy.set(s.ref_id, list);
  }

  const all: CrossCutterRow[] = [];
  for (const a of raw.assignments ?? []) {
    const date = etDateKey(a.completed_at);
    if (!date || date < from || date > to) continue;

    const sessions = sessionsBy.get(a.id) ?? [];
    const ids = idsBy.get(a.id) ?? [];
    const operators: string[] = [];
    const addOp = (name: string | null) => {
      const n = (name ?? "").trim();
      if (n && !operators.includes(n)) operators.push(n);
    };
    let runMs = 0;
    for (const s of sessions) {
      addOp(s.operator_name);
      const st = parseStoredUtc(s.started_at);
      const en = parseStoredUtc(s.ended_at);
      if (st != null && en != null && en > st) runMs += en - st;
    }
    // An operator who only entered IDs (e.g. completed without an open session) still counts.
    for (const b of ids) addOp(b.operator_name);

    const blocks = Number(a.qty_done) || 0;
    const target = Number(a.target_chunks) || 0;
    const blockIds: string[] = [];
    for (const b of ids) if (!blockIds.includes(b.block_id)) blockIds.push(b.block_id);

    all.push({
      id: a.id,
      completed_at: a.completed_at,
      completed_et: { date, time: formatEtClock(a.completed_at) ?? "" },
      label: a.label,
      size_text: a.size_text && a.size_text.trim() ? a.size_text : null,
      target,
      blocks_cut: blocks,
      over: target > 0 ? blocks - target : null,
      block_ids: blockIds,
      operators,
      run_minutes: Math.round(runMs / 60000),
    });
  }

  all.sort((x, y) => {
    const a = parseStoredUtc(x.completed_at) ?? 0;
    const b = parseStoredUtc(y.completed_at) ?? 0;
    return b - a;
  });

  const rows = filterRows(all, opts.search ?? "");
  return {
    rows,
    totals: {
      completed: rows.length,
      blocks: rows.reduce((s, r) => s + r.blocks_cut, 0),
      overTarget: rows.filter((r) => r.over != null && r.over > 0).length,
      runMinutes: rows.reduce((s, r) => s + r.run_minutes, 0),
    },
  };
}

// Case-insensitive match on label, size, operator or any block ID. A search that parses as a block ID
// is normalized first, so "11/20-7" finds "11/20-07" (traceability: which assignment used a block?).
function filterRows(rows: CrossCutterRow[], search: string): CrossCutterRow[] {
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  const asId = normalizeBlockId(q);
  return rows.filter((r) => {
    if (asId && r.block_ids.includes(asId)) return true;
    if (r.label.toLowerCase().includes(q)) return true;
    if (r.size_text && r.size_text.toLowerCase().includes(q)) return true;
    if (r.operators.some((o) => o.toLowerCase().includes(q))) return true;
    return r.block_ids.some((b) => b.toLowerCase().includes(q));
  });
}

// "3h 05m" / "45m" / "0m"
export function formatRunTime(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_HEADERS = [
  "Completed (ET date)", "Completed (ET time)", "Assignment", "Size", "Target", "Blocks cut", "±", "Block IDs", "Operators", "Run time (min)",
];

// One row per assignment; block IDs joined with "; ". Same columns as the table.
export function crossCutterCsv(rows: CrossCutterRow[]): string {
  const lines = [CSV_HEADERS.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([
      r.completed_et.date,
      r.completed_et.time,
      r.label,
      r.size_text ?? "",
      r.target,
      r.blocks_cut,
      r.over == null ? "" : r.over > 0 ? `+${r.over}` : String(r.over),
      r.block_ids.join("; "),
      r.operators.join("; "),
      r.run_minutes,
    ].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
