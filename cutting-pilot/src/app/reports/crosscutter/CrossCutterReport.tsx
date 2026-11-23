"use client";
// src/app/reports/crosscutter/CrossCutterReport.tsx — cc-blocks-02
// /v2/reports/crosscutter — one row per COMPLETED Cross Cutter assignment in the range: size, target,
// blocks cut, ± target, the block IDs used (cc-blocks-01), operators and run time. Fetches
// GET /v2/api/reports/crosscutter only when from/to change; the search box filters client-side
// through buildCrossCutterReport (label, size, operator or any block ID; "11/20-7" finds "11/20-07").
// Layout follows reports/scrap (rpt kit: PlatformHeader, DashboardToolbar, RangeSelector, MetricTile,
// ../ui table/chip classes). Read-only. Tokens only. English only, like the other v2 reports.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, Download, Printer, RefreshCw, Scissors, TriangleAlert } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import MetricTile from "@/components/dashboard/MetricTile";
import DashboardToolbar from "@/components/dashboard/DashboardToolbar";
import RangeSelector, { type RangeValue } from "@/components/dashboard/RangeSelector";
import SearchInput from "@/components/dashboard/SearchInput";
import { etNowWallClock } from "@/lib/etDateTime";
import { dayLabel, presetRange, rangeLabel } from "@/lib/reports/range";
import {
  buildCrossCutterReport, crossCutterCsv, formatRunTime,
  type CrossCutterRaw, type CrossCutterReport as Report, type CrossCutterRow,
} from "@/lib/reports/crosscutter";
import { CARD, CHIP_GHOST, HEADER_BTN, NUM, ROW, TABLE_WRAP, TD, TH, THEAD_ROW } from "../ui";

interface Props {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

const ID_CHIP = `${CHIP_GHOST} font-mono tabular-nums`;

function Delta({ over }: { over: number | null }) {
  if (over == null) return <span className="text-muted">—</span>;
  if (over > 0) return <span className="font-mono tabular-nums font-semibold text-[var(--info-text)]">+{over}</span>;
  if (over < 0) return <span className="font-mono tabular-nums text-muted">{over}</span>;
  return <span className="font-mono tabular-nums text-muted">0</span>;
}

function BlockIds({ ids }: { ids: string[] }) {
  if (!ids.length) return <span className="text-muted">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <span key={id} className={ID_CHIP}>{id}</span>
      ))}
    </div>
  );
}

function Kpis({ report }: { report: Report }) {
  const t = report.totals;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
      <MetricTile label="Assignments completed" value={t.completed} />
      <MetricTile label="Blocks cut" value={t.blocks} />
      <MetricTile label="Over target" value={t.overTarget} caption={t.overTarget ? "Yield beat the target" : undefined} />
      <MetricTile label="Run time" value={formatRunTime(t.runMinutes)} caption="Closed sessions" />
    </div>
  );
}

function RowsTable({ rows }: { rows: CrossCutterRow[] }) {
  return (
    <div className={`${TABLE_WRAP} hidden md:block print:block print:overflow-visible`}>
      <table className="w-full min-w-[1040px] print:min-w-0 text-sm">
        <thead>
          <tr className={THEAD_ROW}>
            <th className={TH}>Completed</th>
            <th className={TH}>Assignment</th>
            <th className={TH}>Size</th>
            <th className={`${TH} text-right`}>Target</th>
            <th className={`${TH} text-right`}>Blocks cut</th>
            <th className={`${TH} text-right`}>±</th>
            <th className={TH}>Block IDs</th>
            <th className={TH}>Operators</th>
            <th className={`${TH} text-right`}>Run time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={`${ROW} align-top`}>
              <td className={`${TD} whitespace-nowrap font-mono tabular-nums text-xs`}>
                {dayLabel(r.completed_et.date)}
                <div className="text-muted">{r.completed_et.time}</div>
              </td>
              <td className={`${TD} font-medium`}>{r.label}</td>
              <td className={`${TD} text-muted`}>{r.size_text ?? "—"}</td>
              <td className={`${TD} ${NUM}`}>{r.target > 0 ? r.target : "—"}</td>
              <td className={`${TD} ${NUM} font-semibold`}>{r.blocks_cut}</td>
              <td className={`${TD} text-right`}><Delta over={r.over} /></td>
              <td className={`${TD} max-w-[280px]`}><BlockIds ids={r.block_ids} /></td>
              <td className={TD}>{r.operators.length ? r.operators.join(", ") : <span className="text-muted">—</span>}</td>
              <td className={`${TD} ${NUM}`}>{r.run_minutes ? formatRunTime(r.run_minutes) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowsCards({ rows }: { rows: CrossCutterRow[] }) {
  return (
    <ul className="md:hidden print:hidden space-y-3">
      {rows.map((r) => (
        <li key={r.id} className={`${CARD} p-4 space-y-2 min-w-0`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-sm text-text break-words">{r.label}</div>
              {r.size_text && <div className="text-xs text-muted break-words">{r.size_text}</div>}
            </div>
            <div className="text-right text-xs font-mono tabular-nums text-muted shrink-0">
              {dayLabel(r.completed_et.date)}
              <div>{r.completed_et.time}</div>
            </div>
          </div>
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-muted">Blocks cut</dt>
              <dd className="font-mono tabular-nums font-semibold text-sm">{r.blocks_cut}</dd>
            </div>
            <div>
              <dt className="text-muted">Target</dt>
              <dd className="font-mono tabular-nums text-sm">{r.target > 0 ? r.target : "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">±</dt>
              <dd className="text-sm"><Delta over={r.over} /></dd>
            </div>
          </dl>
          <div className="text-xs">
            <div className="text-muted mb-1">Block IDs</div>
            <BlockIds ids={r.block_ids} />
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-xs">
            <span><span className="text-muted">Operators: </span>{r.operators.length ? r.operators.join(", ") : "—"}</span>
            <span className="font-mono tabular-nums"><span className="text-muted font-sans">Run time: </span>{r.run_minutes ? formatRunTime(r.run_minutes) : "—"}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function CrossCutterReport({ userName, isAdmin, permissions }: Props) {
  const [today] = useState(() => etNowWallClock().date);
  const [range, setRange] = useState<RangeValue>(() => ({ preset: "last_30", ...presetRange("last_30", etNowWallClock().date) }));
  const [raw, setRaw] = useState<CrossCutterRaw | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const load = useCallback(async (from: string, to: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/reports/crosscutter?from=${from}&to=${to}`, { signal });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || `Couldn't load the Cross Cutter report (HTTP ${res.status}).`);
        setRaw(null);
      } else {
        setRaw({ assignments: data.assignments ?? [], blockIds: data.blockIds ?? [], sessions: data.sessions ?? [] });
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(`Network error: ${String(e?.message || e)}`);
      setRaw(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    load(range.from, range.to, ac.signal);
    return () => ac.abort();
  }, [load, range.from, range.to]);

  const report = useMemo(
    () => (raw ? buildCrossCutterReport(raw, { from: range.from, to: range.to, search }) : null),
    [raw, range.from, range.to, search]
  );

  function exportCsv() {
    if (!report) return;
    const blob = new Blob([crossCutterCsv(report.rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `crosscutter-${range.from}_${range.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <div className="print:hidden">
        <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Reports · v2" currentPath="/v2/reports" />
      </div>

      <main className="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-6 space-y-5 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-text">Cross Cutter</h1>
            <p className="text-xs text-muted">Completed Cross Cutter assignments: blocks cut against target, and the block IDs used.</p>
            <p className="hidden print:block text-xs text-muted font-mono tabular-nums">
              {rangeLabel(range.from, range.to)}{search.trim() ? ` · search “${search.trim()}”` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link href="/reports/cutting" className={HEADER_BTN}>
              <Scissors size={14} className="text-muted" aria-hidden="true" />
              Cutting
            </Link>
            <Link href="/reports/scrap" className={HEADER_BTN}>
              <ClipboardList size={14} className="text-muted" aria-hidden="true" />
              Scrap
            </Link>
            <Link href="/reports/incidents" className={HEADER_BTN}>
              <TriangleAlert size={14} className="text-muted" aria-hidden="true" />
              Incidents
            </Link>
            <button type="button" className={HEADER_BTN} onClick={exportCsv} disabled={!report || !report.rows.length}>
              <Download size={14} className="text-muted" aria-hidden="true" />
              Export CSV
            </button>
            <button type="button" className={HEADER_BTN} onClick={() => window.print()}>
              <Printer size={14} className="text-muted" aria-hidden="true" />
              Print
            </button>
          </div>
        </div>

        {report && <Kpis report={report} />}

        <div className="print:hidden">
          <DashboardToolbar
            left={<RangeSelector value={range} today={today} onChange={setRange} />}
            right={<SearchInput value={search} onChange={setSearch} placeholder="Assignment, size, operator or block ID" />}
          />
        </div>

        {loading && !report ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading the Cross Cutter report">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="bg-surface border border-[var(--card-border)] rounded p-4 space-y-2 animate-pulse">
                  <div className="h-3 w-2/3 rounded bg-[var(--ghost-bg)]" />
                  <div className="h-6 w-1/3 rounded bg-[var(--ghost-bg)]" />
                </div>
              ))}
            </div>
            <div className={`${CARD} p-5 space-y-3 animate-pulse`}>
              <div className="h-4 w-1/4 rounded bg-[var(--ghost-bg)]" />
              <div className="h-48 rounded bg-[var(--ghost-bg)]" />
            </div>
          </div>
        ) : error ? (
          <div role="alert" className="rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            <button type="button" onClick={() => load(range.from, range.to)} className="min-h-[44px] px-3 underline cursor-pointer font-semibold text-xs">
              Retry
            </button>
          </div>
        ) : !report ? null : (
          <div className={`space-y-3 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
            {loading && (
              <p className="text-xs text-muted inline-flex items-center gap-1.5 print:hidden">
                <RefreshCw size={12} className="animate-spin" aria-hidden="true" /> Updating…
              </p>
            )}
            {report.rows.length === 0 ? (
              <div className={`${CARD} px-5 py-10 text-center text-sm text-muted`}>
                {search.trim() && raw?.assignments.length
                  ? `No completed assignments match “${search.trim()}”.`
                  : "No Cross Cutter assignments completed in this range."}
              </div>
            ) : (
              <>
                <RowsTable rows={report.rows} />
                <RowsCards rows={report.rows} />
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
