"use client";
// src/app/reports/cutting/CuttingReport.tsx — rpt-01
// /v2/reports/cutting — who ran which line, for how long, and what got cut (ET days). Fetches raw rows
// from GET /v2/api/reports/cutting only when from/to change; buildCuttingReport (lib/reports/cutting.ts)
// applies the operator / line filters and the "Exclude flagged from hours" toggle client-side.
// Layout follows the claude.ai "v2 Reports" canvas (Cutting activity — desktop) with the live kit:
// PlatformHeader, MetricTile, DashboardToolbar, RangeSelector, FilterSelect, QcBoard table/chip classes.
// Incidents links the v2 report (rpt-03), Scrap too (rpt-04). Linked from the home card + navs since rpt-05.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronRight, ClipboardList, Printer, RefreshCw, TriangleAlert } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import MetricTile from "@/components/dashboard/MetricTile";
import DashboardToolbar from "@/components/dashboard/DashboardToolbar";
import FilterSelect from "@/components/dashboard/FilterSelect";
import RangeSelector, { type RangeValue } from "@/components/dashboard/RangeSelector";
import { useTokenColors } from "@/components/charts/useTokenColors";
import { etNowWallClock, formatEtClock, formatEtDateTime, weekdayShort } from "@/lib/etDateTime";
import { presetRange, rangeLabel } from "@/lib/reports/range";
import {
  LINES, buildCuttingReport, formatDuration, type CuttingRaw, type LineName, type OperatorRow, type ReportSession,
} from "@/lib/reports/cutting";
import {
  CARD, CHIP_GHOST, CHIP_INFO, CHIP_WARN, GHOST_BTN, HEADER_BTN, NUM, ROW, TABLE_WRAP, TD, TH, THEAD_ROW,
} from "../ui";

interface Props {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

// Hook fallbacks only (light-theme values) — the live colors come from the design tokens.
const TOKENS = {
  main: { var: "--brand", fallback: "#e31837" },
  blue: { var: "--link", fallback: "#0074cc" },
  cross: { var: "--accent", fallback: "#0f172a" },
  hole: { var: "--muted", fallback: "#4b5563" },
  warn: { var: "--warn-text", fallback: "#92400e" },
  grid: { var: "--border-light", fallback: "#f3f4f6" },
  muted: { var: "--muted", fallback: "#4b5563" },
  surface: { var: "--surface", fallback: "#ffffff" },
  text: { var: "--text", fallback: "#111827" },
  border: { var: "--border", fallback: "#e5e7eb" },
};
const LINE_COLOR: Record<LineName, keyof typeof TOKENS> = {
  "Main Line": "main", "Blue Line": "blue", "Cross Cutter": "cross", "Hole Cutter": "hole",
};
const LINE_OPTIONS = LINES.map((l) => ({ value: l, label: l }));

const h1 = (n: number) => n.toFixed(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortDay = (ymd: string) => `${weekdayShort(ymd)} ${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const fmtWhen = (ts: string | null) => formatEtDateTime(ts, { weekday: true }) ?? "—";

function listJoin(xs: string[]): string {
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;
}

function flagText(short: number, long: number): string {
  const parts = [];
  if (long) parts.push(`${long} over 8 h`);
  if (short) parts.push(`${short} under 1 min`);
  return parts.join(" · ");
}

function FlagChip({ x }: { x: ReportSession }) {
  if (x.running) return <span className={CHIP_INFO}>Running</span>;
  if (x.flag === "long") return <span className={CHIP_WARN}>Over 8 h</span>;
  if (x.flag === "short") return <span className={CHIP_WARN}>Under 1 min</span>;
  return null;
}

export default function CuttingReport({ userName, isAdmin, permissions }: Props) {
  const [today] = useState(() => etNowWallClock().date);
  const [range, setRange] = useState<RangeValue>(() => ({ preset: "last_7", ...presetRange("last_7", etNowWallClock().date) }));
  const [raw, setRaw] = useState<CuttingRaw | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [excludeFlagged, setExcludeFlagged] = useState(true);
  const [operator, setOperator] = useState("");
  const [line, setLine] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [loadedAt, setLoadedAt] = useState(() => Date.now());

  const load = useCallback(async (from: string, to: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/reports/cutting?from=${from}&to=${to}`, { signal });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || `Couldn't load cutting activity (HTTP ${res.status}).`);
        setRaw(null);
      } else {
        setRaw({ sessions: data.sessions ?? [], items: data.items ?? [], chunk: data.chunk ?? [] });
        setLoadedAt(Date.now());
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
    () => (raw ? buildCuttingReport(raw, { from: range.from, to: range.to, operator: operator || null, line: line || null, excludeFlagged, nowMs: loadedAt }) : null),
    [raw, range.from, range.to, operator, line, excludeFlagged, loadedAt]
  );

  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rangeEmpty = !!report && report.operatorOptions.length === 0;
  const filteredEmpty = !!report && !rangeEmpty && report.kpis.sessions === 0 && report.kpis.items === 0;

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <div className="print:hidden">
        <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Reports · v2" currentPath="/v2/reports" />
      </div>

      <main className="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-6 space-y-5 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-text">Cutting activity</h1>
            <p className="text-xs text-muted">Who ran which line, for how long, and what got cut. Days are Eastern time.</p>
            <p className="hidden print:block text-xs text-muted font-mono tabular-nums">{rangeLabel(range.from, range.to)}</p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link href="/reports/incidents" className={HEADER_BTN}>
              <TriangleAlert size={14} className="text-muted" aria-hidden="true" />
              Incidents
            </Link>
            <Link href="/reports/scrap" className={HEADER_BTN}>
              <ClipboardList size={14} className="text-muted" aria-hidden="true" />
              Scrap
            </Link>
            <button type="button" className={HEADER_BTN} onClick={() => window.print()}>
              <Printer size={14} className="text-muted" aria-hidden="true" />
              Print
            </button>
          </div>
        </div>

        {report && !rangeEmpty && <Kpis report={report} excludeFlagged={excludeFlagged} />}

        <div className="print:hidden">
          <DashboardToolbar
            left={<RangeSelector value={range} today={today} onChange={setRange} />}
            right={
              <>
                <label className="inline-flex items-center gap-2 min-h-[44px] px-1 text-xs font-semibold text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={excludeFlagged}
                    onChange={(e) => setExcludeFlagged(e.target.checked)}
                    className="w-[18px] h-[18px] accent-[var(--brand)] cursor-pointer"
                  />
                  Exclude flagged from hours
                </label>
                <span className="sr-only" id="f-operator">Operator</span>
                <FilterSelect
                  value={operator}
                  onChange={setOperator}
                  allLabel="All operators"
                  options={(report?.operatorOptions ?? (operator ? [operator] : [])).map((o) => ({ value: o, label: o }))}
                />
                <FilterSelect value={line} onChange={setLine} allLabel="All lines" options={LINE_OPTIONS} />
              </>
            }
          />
        </div>

        {loading && !report ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading cutting activity">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
              {[0, 1, 2, 3, 4].map((i) => (
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
        ) : !report ? null : rangeEmpty ? (
          <div className={`${CARD} p-12 text-center`}>
            <p className="text-sm font-medium text-text">No cutting activity in this range.</p>
            <p className="text-xs text-muted mt-1">Try a longer range, or check the cutting boards were clocked in.</p>
          </div>
        ) : (
          <div className={`space-y-5 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
            {loading && (
              <p className="text-xs text-muted inline-flex items-center gap-1.5 print:hidden">
                <RefreshCw size={12} className="animate-spin" aria-hidden="true" /> Updating…
              </p>
            )}
            {filteredEmpty ? (
              <div className={`${CARD} p-12 text-center`}>
                <p className="text-sm font-medium text-text">Nothing matches these filters.</p>
                <button
                  type="button"
                  onClick={() => { setOperator(""); setLine(""); }}
                  className={`mt-4 ${GHOST_BTN}`}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-5 items-stretch">
                  <RunHoursCard report={report} excludeFlagged={excludeFlagged} from={range.from} to={range.to} />
                  <FlaggedCard flags={report.flags} />
                </div>
                <OperatorsTable rows={report.operators} excludeFlagged={excludeFlagged} />
                <OrdersTable
                  orders={report.orders}
                  expanded={expanded}
                  onToggle={toggle}
                  onExpandAll={() => setExpanded(new Set(report.orders.map((o) => o.jobId)))}
                  onCollapseAll={() => setExpanded(new Set())}
                />
                <ChunkTable rows={report.chunk} />
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ── KPIs ─────────────────────────────────────────────────────────────────────────────────────

function Kpis({ report, excludeFlagged }: { report: NonNullable<ReturnType<typeof buildCuttingReport>>; excludeFlagged: boolean }) {
  const k = report.kpis;
  const shown = excludeFlagged ? k.hoursExclFlagged : k.hours;
  const other = excludeFlagged ? `${h1(k.hours)} incl. flagged` : `${h1(k.hoursExclFlagged)} excl. flagged`;
  const flagged = k.flaggedShort + k.flaggedLong;
  const flagCaption = [k.flaggedShort ? `${k.flaggedShort} under 1 min` : "", k.flaggedLong ? `${k.flaggedLong} over 8 h` : ""]
    .filter(Boolean).join(" · ") || "None";
  return (
    <section aria-label="Totals" className="grid grid-cols-2 md:grid-cols-5 gap-3.5 break-inside-avoid">
      <MetricTile label="Run hours" value={Number(h1(shown))} unit="h" caption={other} />
      <MetricTile
        label="Sessions"
        value={k.sessions}
        caption={`${plural(k.operators, "operator")}${k.running > 0 ? ` · ${k.running} running` : ""}`}
      />
      <MetricTile label="Orders touched" value={k.orders} />
      <MetricTile label="Items cut" value={k.items} unit="lines" caption="Marked complete" />
      <MetricTile label="Flagged sessions" value={flagged} caption={flagCaption} tone="warn" />
    </section>
  );
}

// ── Chart ────────────────────────────────────────────────────────────────────────────────────

function RunHoursCard({
  report, excludeFlagged, from, to,
}: { report: NonNullable<ReturnType<typeof buildCuttingReport>>; excludeFlagged: boolean; from: string; to: string }) {
  const c = useTokenColors(TOKENS);
  const showFlagged = !excludeFlagged && report.days.some((d) => d.flaggedHours > 0);
  const series: { key: string; name: string; fill: string }[] = report.linesWithHours.map((l) => ({ key: l, name: l, fill: c[LINE_COLOR[l]] }));
  if (showFlagged) series.push({ key: "Flagged", name: "Flagged", fill: "url(#cut-flag-hatch)" });
  const data = report.days.map((d) => {
    const row: Record<string, number | string> = { day: shortDay(d.date) };
    for (const l of report.linesWithHours) row[l] = Number(d.byLineClean[l].toFixed(2));
    if (showFlagged) row.Flagged = Number(d.flaggedHours.toFixed(2));
    return row;
  });
  const total = (d: (typeof report.days)[number]) =>
    LINES.reduce((t, l) => t + d.byLineClean[l], 0) + (showFlagged ? d.flaggedHours : 0);
  const summary = `Run hours per day, ${rangeLabel(from, to)}, Eastern time${excludeFlagged ? ", flagged sessions excluded" : ""}. ` +
    report.days.map((d) => `${shortDay(d.date)} ${h1(total(d))}${showFlagged && d.flaggedHours > 0 ? ` (${h1(d.flaggedHours)} flagged)` : ""}`).join("; ") + ".";
  const idle = LINES.filter((l) => !report.linesWithSessions.includes(l));
  const tooltipStyle = { backgroundColor: c.surface, border: `1px solid ${c.border}`, color: c.text, fontSize: 12 };
  const axisProps = { stroke: c.muted, tick: { fontSize: 11, fill: c.muted } };

  return (
    <section aria-labelledby="h-day" className={`${CARD} flex-[3_1_560px] min-w-0 px-5 py-4 break-inside-avoid`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="h-day" className="text-sm font-semibold text-text">Run hours by day</h2>
        <div className="flex flex-wrap gap-3.5 text-xs text-muted" aria-hidden="true">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <svg width="10" height="10" aria-hidden="true">
                <rect width="10" height="10" rx="2" fill={s.fill} stroke={s.key === "Flagged" ? c.warn : "none"} />
              </svg>
              {s.name}
            </span>
          ))}
        </div>
      </div>
      <div role="img" aria-label={summary} className="mt-4 h-[240px]">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <defs>
              <pattern id="cut-flag-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill={c.surface} />
                <line x1="0" y1="0" x2="0" y2="6" stroke={c.warn} strokeWidth="3" />
              </pattern>
            </defs>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="day" {...axisProps} />
            <YAxis allowDecimals={false} width={32} {...axisProps} />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: c.grid }}
              formatter={(v, name) => [`${Number(v ?? 0).toFixed(1)} h`, String(name)]}
            />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                stackId="h"
                fill={s.fill}
                stroke={s.key === "Flagged" ? c.warn : undefined}
                radius={i === series.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {idle.length > 0 && idle.length < LINES.length && (
        <p className="mt-3 text-xs text-muted">No sessions on {listJoin(idle)} in this range.</p>
      )}
    </section>
  );
}

// ── Flagged list ─────────────────────────────────────────────────────────────────────────────

function FlaggedCard({ flags }: { flags: ReportSession[] }) {
  return (
    <section aria-labelledby="h-flag" className={`${CARD} flex-[2_1_380px] min-w-0 overflow-hidden flex flex-col break-inside-avoid`}>
      <div className="px-5 pt-4 pb-3">
        <h2 id="h-flag" className="text-sm font-semibold text-text">Flagged sessions</h2>
        <p className="mt-0.5 text-xs text-muted">Under 1 min: Start/Stop tapped without cutting. Over 8 h: likely a missed Stop.</p>
      </div>
      {flags.length === 0 ? (
        <p className="border-t border-[var(--line)] px-5 py-6 text-sm text-muted">No flagged sessions.</p>
      ) : (
        <ul className="border-t border-[var(--line)] max-h-[420px] overflow-y-auto print:max-h-none">
          {flags.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-5 py-2.5 border-b border-[var(--line)] last:border-b-0">
              <span className={`${f.flag === "long" ? CHIP_WARN : CHIP_GHOST} font-mono tabular-nums min-w-[64px] justify-center`}>
                {formatDuration(f.durSec)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-text truncate">{f.operator}</div>
                <div className="text-xs text-muted truncate">
                  {f.kind === "chunk" ? (
                    <>{f.line} · {f.workItem ?? "—"}</>
                  ) : (
                    <><span className="font-mono font-semibold">{f.invoice ?? "—"}</span> · {f.customer ?? "—"}</>
                  )}
                </div>
              </div>
              <span className="text-xs text-muted font-mono tabular-nums whitespace-nowrap">{fmtWhen(f.startedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Operators ────────────────────────────────────────────────────────────────────────────────

function OperatorsTable({ rows, excludeFlagged }: { rows: OperatorRow[]; excludeFlagged: boolean }) {
  return (
    <section aria-labelledby="h-ops" className="space-y-2 break-inside-avoid">
      <h2 id="h-ops" className="text-sm font-semibold text-text">Operators</h2>
      <div className={TABLE_WRAP}>
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className={THEAD_ROW}>
              <th className={TH}>Operator</th>
              <th className={TH}>Shift</th>
              <th className={`${TH} text-right`}>Sessions</th>
              <th className={`${TH} text-right`}>Run hours</th>
              <th className={`${TH} text-right`}>Items cut</th>
              <th className={TH}>Flags</th>
              <th className={`${TH} text-right`}>Handoff notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const shown = excludeFlagged ? o.hoursExclFlagged : o.hours;
              const differs = Math.abs(o.hours - o.hoursExclFlagged) >= 0.05;
              const flags = flagText(o.short, o.long);
              return (
                <tr key={o.name} className={ROW}>
                  <td className={`${TD} font-medium`}>{o.name}</td>
                  <td className={`${TD} text-muted`}>{o.shift ?? "—"}</td>
                  <td className={`${TD} ${NUM}`}>{o.sessions}</td>
                  <td className={`${TD} ${NUM}`}>
                    {h1(shown)}
                    {differs && (
                      <div className="font-sans text-[11px] text-muted">
                        {excludeFlagged ? `${h1(o.hours)} incl. flagged` : `${h1(o.hoursExclFlagged)} excl. flagged`}
                      </div>
                    )}
                  </td>
                  <td className={`${TD} ${NUM}`}>{o.items}</td>
                  <td className={TD}>{flags ? <span className={CHIP_WARN}>{flags}</span> : <span className="text-muted">—</span>}</td>
                  <td className={`${TD} ${NUM}`}>{o.notes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── By order ─────────────────────────────────────────────────────────────────────────────────

function OrdersTable({
  orders, expanded, onToggle, onExpandAll, onCollapseAll,
}: {
  orders: NonNullable<ReturnType<typeof buildCuttingReport>>["orders"];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  return (
    <section aria-labelledby="h-inv" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 id="h-inv" className="text-sm font-semibold text-text">By order</h2>
          <span className="text-xs text-muted">{plural(orders.length, "order")} · newest first</span>
        </div>
        {orders.length > 0 && (
          <div className="flex gap-2 print:hidden">
            <button type="button" className={GHOST_BTN} onClick={onExpandAll}>Expand all</button>
            <button type="button" className={GHOST_BTN} onClick={onCollapseAll}>Collapse all</button>
          </div>
        )}
      </div>
      {orders.length === 0 ? (
        <div className={`${CARD} p-8 text-center`}>
          <p className="text-sm font-medium text-text">No order work in this range.</p>
        </div>
      ) : (
        <div className={TABLE_WRAP}>
          <table className="w-full min-w-[820px] table-fixed text-sm">
            <thead>
              <tr className={THEAD_ROW}>
                <th className="px-2 py-2.5 w-[56px]"><span className="sr-only">Expand</span></th>
                <th className={`${TH} w-[11%]`}>INV #</th>
                <th className={`${TH} w-[32%]`}>Customer</th>
                <th className={`${TH} w-[18%]`}>Operators</th>
                <th className={`${TH} text-right`}>Sessions</th>
                <th className={`${TH} text-right`}>Run hours</th>
                <th className={`${TH} text-right`}>Items cut</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const isOpen = expanded.has(o.jobId);
                return (
                  <Fragment key={o.jobId}>
                    <tr
                      onClick={() => onToggle(o.jobId)}
                      className={`${ROW} hover:bg-[var(--ghost-bg)] cursor-pointer break-inside-avoid ${isOpen ? "bg-[var(--ghost-bg)]" : ""}`}
                    >
                      <td className="px-2 py-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggle(o.jobId);
                          }}
                          aria-expanded={isOpen}
                          aria-label={`${isOpen ? "Collapse" : "Expand"} sessions and items for INV ${o.invoice || "—"}`}
                          className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-muted hover:text-text cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                        >
                          {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                        </button>
                      </td>
                      <td className={`${TD} font-mono font-semibold`}>{o.invoice || "—"}</td>
                      <td className={`${TD} truncate`}>{o.customer || "—"}</td>
                      <td className={`${TD} text-muted truncate`}>{o.operators.join(", ") || "—"}</td>
                      <td className={`${TD} ${NUM}`}>{o.sessions.length}</td>
                      <td className={`${TD} ${NUM}`}>{h1(o.hours)}</td>
                      <td className={`${TD} ${NUM}`}>{o.items.length}</td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-[var(--line)] bg-[var(--ghost-bg)] break-inside-avoid">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="flex flex-wrap gap-4">
                            <SubTable
                              label="Sessions"
                              empty="No sessions — items only."
                              head={["Operator", "Start", "Stop", "Duration", "Handoff note"]}
                              rightCols={[3]}
                              rows={o.sessions.map((x) => [
                                x.operator,
                                <span key="s" className="font-mono tabular-nums">{fmtWhen(x.startedAt)}</span>,
                                x.running ? <span key="e" className={CHIP_INFO}>Running</span> : <span key="e" className="font-mono tabular-nums">{formatEtClock(x.endedAt) ?? "—"}</span>,
                                <span key="d" className="inline-flex items-center justify-end gap-1.5">
                                  <FlagChip x={x} />
                                  <span className="font-mono tabular-nums">{formatDuration(x.durSec)}</span>
                                </span>,
                                x.note ? x.note : <span key="n" className="text-muted">—</span>,
                              ])}
                            />
                            <SubTable
                              label="Items cut"
                              empty="No items marked complete."
                              head={["Part", "Dimensions", "Cut by", "At"]}
                              rows={o.items.map((i) => [
                                i.part,
                                <span key="dm" className="font-mono">{i.dimensions || "—"}</span>,
                                i.cutBy,
                                <span key="at" className="font-mono tabular-nums">{fmtWhen(i.at)}</span>,
                              ])}
                            />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SubTable({
  label, head, rows, empty, rightCols = [],
}: { label: string; head: string[]; rows: React.ReactNode[][]; empty: string; rightCols?: number[] }) {
  return (
    <div className="relative flex-[1_1_380px] min-w-0 overflow-x-auto rounded-lg border border-[var(--card-border)] bg-surface">
      <table className="w-full text-sm" aria-label={label}>
        <thead>
          <tr className="border-b border-[var(--line)] text-left text-xs font-semibold text-muted">
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-2 ${rightCols.includes(i) ? "text-right" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={head.length} className="px-3 py-2 text-muted">{empty}</td></tr>
          ) : (
            rows.map((r, ri) => (
              <tr key={ri} className={ROW}>
                {r.map((cell, ci) => (
                  <td key={ci} className={`px-3 py-2 ${rightCols.includes(ci) ? "text-right" : ""}`}>{cell}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Cross Cutter / Hole Cutter ───────────────────────────────────────────────────────────────

function ChunkTable({ rows }: { rows: ReportSession[] }) {
  if (rows.length === 0) {
    return (
      <section aria-labelledby="h-chunk" className={`${CARD} p-8 text-center break-inside-avoid`}>
        <h2 id="h-chunk" className="text-sm font-medium text-text">Cross Cutter / Hole Cutter</h2>
        <p className="mt-1 text-xs text-muted">No sessions in this range.</p>
      </section>
    );
  }
  return (
    <section aria-labelledby="h-chunk" className="space-y-2 break-inside-avoid">
      <h2 id="h-chunk" className="text-sm font-semibold text-text">Cross Cutter / Hole Cutter</h2>
      <div className={TABLE_WRAP}>
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className={THEAD_ROW}>
              <th className={TH}>Operator</th>
              <th className={TH}>Board</th>
              <th className={TH}>Work item</th>
              <th className={TH}>Start</th>
              <th className={TH}>Stop</th>
              <th className={`${TH} text-right`}>Duration</th>
              <th className={TH}><span className="sr-only">Flag</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.id} className={ROW}>
                <td className={`${TD} font-medium`}>{x.operator}</td>
                <td className={TD}>{x.line}</td>
                <td className={TD}>{x.workItem ?? "—"}</td>
                <td className={`${TD} font-mono tabular-nums`}>{fmtWhen(x.startedAt)}</td>
                <td className={`${TD} font-mono tabular-nums`}>{x.running ? "—" : formatEtClock(x.endedAt) ?? "—"}</td>
                <td className={`${TD} ${NUM}`}>{formatDuration(x.durSec)}</td>
                <td className={TD}><FlagChip x={x} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
