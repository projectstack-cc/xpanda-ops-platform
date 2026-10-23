"use client";
// src/app/reports/incidents/IncidentsReport.tsx — rpt-03
// /v2/reports/incidents — customer and internal quality incidents (qc_incidents, D1 only) and the
// share of shipped orders they hit. Fetches GET /v2/api/reports/incidents only when the year switch
// changes; buildIncidentReport (lib/reports/incidents.ts) applies the category / risk / search
// filters client-side. Layout follows the claude.ai "v2 Reports" canvas (Incidents — desktop) with
// rpt-01's kit: PlatformHeader, MetricTile, DashboardToolbar, SearchInput, FilterSelect, QcBoard
// table/chip classes. Scrap stays a plain <a> to the legacy report until rpt-04. Direct URL only (rpt-05).
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronRight, ClipboardList, FileText, Printer, RefreshCw, Scissors } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import MetricTile from "@/components/dashboard/MetricTile";
import DashboardToolbar from "@/components/dashboard/DashboardToolbar";
import FilterSelect from "@/components/dashboard/FilterSelect";
import SearchInput from "@/components/dashboard/SearchInput";
import { useTokenColors } from "@/components/charts/useTokenColors";
import { etNowWallClock } from "@/lib/etDateTime";
import type { Category, IncidentRow } from "@/lib/qc/incident";
import { rangeLabel } from "@/lib/reports/range";
import {
  CATEGORIES, RISK_LEVELS, buildIncidentReport, incidentRange, yearOptions,
  type IncidentListRow, type IncidentMonth, type IncidentRangeKey, type IncidentReport,
} from "@/lib/reports/incidents";
import { CARD, CHIP, CHIP_GHOST, CHIP_WARN, GHOST_BTN, HEADER_BTN, NUM, ROW, TABLE_WRAP, TD, TH, THEAD_ROW } from "../ui";

interface Props {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

interface Raw { rows: IncidentRow[]; shipped: Record<string, number>; earliest: string | null; }

// Hook fallbacks only (light-theme values) — the live colors come from the design tokens.
const TOKENS = {
  Delivery: { var: "--link", fallback: "#0074cc" },
  Tolerances: { var: "--accent", fallback: "#0f172a" },
  Fusion: { var: "--warn-text", fallback: "#92400e" },
  Packaging: { var: "--loading-text", fallback: "#0e7490" },
  Density: { var: "--success-ink", fallback: "#15803d" },
  Other: { var: "--muted", fallback: "#4b5563" },
  brand: { var: "--brand", fallback: "#e31837" },
  grid: { var: "--border-light", fallback: "#f3f4f6" },
  muted: { var: "--muted", fallback: "#4b5563" },
  surface: { var: "--surface", fallback: "#ffffff" },
};
// The same mapping for plain HTML bars (CSS vars work there).
const CAT_BG: Record<Category, string> = {
  Delivery: "bg-[var(--link)]",
  Tolerances: "bg-[var(--accent)]",
  Fusion: "bg-[var(--warn-text)]",
  Packaging: "bg-[var(--loading-text)]",
  Density: "bg-[var(--success-ink)]",
  Other: "bg-[var(--muted)]",
};
const RISK_BG: Record<string, string> = {
  High: "bg-[var(--danger-ink)]",
  Medium: "bg-[var(--warn-text)]",
  Low: "bg-[var(--muted)]",
};
const CHIP_HIGH = `${CHIP} bg-surface text-[var(--danger-ink)] border-[var(--danger-ink)]`;
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: c }));
const RISK_OPTIONS = RISK_LEVELS.map((r) => ({ value: r, label: r }));
const PAGE = 50;
const FULL_MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const pct1 = (x: number) => (x * 100).toFixed(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function mdy(ymd: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd ?? "");
  return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : "—";
}

function RiskChip({ risk }: { risk: string }) {
  if (risk === "High") return <span className={CHIP_HIGH}>High</span>;
  if (risk === "Medium") return <span className={CHIP_WARN}>Medium</span>;
  return <span className={CHIP_GHOST}>{risk || "—"}</span>;
}

export default function IncidentsReport({ userName, isAdmin, permissions }: Props) {
  const [today] = useState(() => etNowWallClock().date);
  const [rangeKey, setRangeKey] = useState<IncidentRangeKey>(() => Number(etNowWallClock().date.slice(0, 4)));
  const range = useMemo(() => incidentRange(rangeKey, today), [rangeKey, today]);
  const [raw, setRaw] = useState<Raw | null>(null);
  const [earliest, setEarliest] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [risk, setRisk] = useState("");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (from: string, to: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/reports/incidents?from=${from}&to=${to}`, { signal });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || `Couldn't load incidents (HTTP ${res.status}).`);
        setRaw(null);
      } else {
        setRaw({ rows: data.rows ?? [], shipped: data.shipped ?? {}, earliest: data.earliest ?? null });
        setEarliest(data.earliest ?? null);
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
    setShowAll(false);
    load(range.from, range.to, ac.signal);
    return () => ac.abort();
  }, [load, range.from, range.to]);

  const report = useMemo(
    () => (raw ? buildIncidentReport(raw.rows, raw.shipped, { from: range.from, to: range.to, category: category || null, risk: risk || null, q, todayEt: today }) : null),
    [raw, range.from, range.to, category, risk, q, today]
  );
  const years = useMemo(() => yearOptions(earliest, today), [earliest, today]);

  const toggle = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearFilters = () => { setCategory(""); setRisk(""); setQ(""); };

  const filterNote = [category && `${category} only`, risk && `${risk} risk only`, q.trim() && `matching “${q.trim()}”`].filter(Boolean).join(" · ");
  const rangeEmpty = !!report && report.rangeIncidents === 0;
  const filteredEmpty = !!report && !rangeEmpty && report.kpis.incidents === 0;

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <div className="print:hidden">
        <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Reports · v2" currentPath="/v2/reports" />
      </div>

      <main className="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-6 space-y-5 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-text">Incidents</h1>
            <p className="text-xs text-muted">Customer and internal quality incidents, and the share of shipped orders they hit.</p>
            <p className="hidden print:block text-xs text-muted font-mono tabular-nums">
              {rangeLabel(range.from, range.to)}{filterNote ? ` · ${filterNote}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link href="/reports/cutting" className={HEADER_BTN}>
              <Scissors size={14} className="text-muted" aria-hidden="true" />
              Cutting
            </Link>
            <a href="/reports/scrap/" className={HEADER_BTN}>
              <ClipboardList size={14} className="text-muted" aria-hidden="true" />
              Scrap
            </a>
            <button type="button" className={HEADER_BTN} onClick={() => window.print()}>
              <Printer size={14} className="text-muted" aria-hidden="true" />
              Print
            </button>
          </div>
        </div>

        {report && !rangeEmpty && <Kpis report={report} filterNote={filterNote} />}

        <div className="print:hidden">
          <DashboardToolbar
            left={
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] p-0.5 bg-[var(--ghost-bg)]" role="group" aria-label="Date range">
                  {[...years, "last_12" as const].map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setRangeKey(k)}
                      aria-pressed={rangeKey === k}
                      className={`min-h-[44px] px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
                        rangeKey === k ? "bg-[var(--brand)] text-white shadow-xs" : "text-muted hover:text-text"
                      }`}
                    >
                      {k === "last_12" ? "Last 12 months" : k}
                    </button>
                  ))}
                </div>
                <span className="text-xs font-medium text-text px-1 font-mono tabular-nums" aria-live="polite">
                  {rangeLabel(range.from, range.to)}
                </span>
              </div>
            }
            right={
              <>
                {/* Own row below md — the shared SearchInput is flex-1 and the two selects would squeeze it. */}
                <div className="flex w-full md:w-auto">
                  <SearchInput value={q} onChange={setQ} placeholder="Search INV #, customer, details…" />
                </div>
                <FilterSelect value={category} onChange={setCategory} allLabel="All categories" options={CATEGORY_OPTIONS} />
                <FilterSelect value={risk} onChange={setRisk} allLabel="All risk levels" options={RISK_OPTIONS} />
              </>
            }
          />
        </div>

        {loading && !report ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading incidents">
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
            <p className="text-sm font-medium text-text">No incidents in this range.</p>
            <p className="text-xs text-muted mt-1">Pick another year, or file one from QC → Incident report.</p>
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
                <button type="button" onClick={clearFilters} className={`mt-4 ${GHOST_BTN}`}>
                  Clear filters
                </button>
              </div>
            ) : (
              <>
                <MonthsCard months={report.months} from={range.from} to={range.to} />
                <div className="flex flex-wrap gap-5 items-stretch">
                  <ByCategoryCard report={report} />
                  <ByRiskCard report={report} />
                  <TopCustomersCard report={report} />
                </div>
                <IncidentsTable
                  rows={report.list}
                  expanded={expanded}
                  onToggle={toggle}
                  showAll={showAll}
                  onShowAll={() => setShowAll(true)}
                />
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ── KPIs ─────────────────────────────────────────────────────────────────────────────────────

function Kpis({ report, filterNote }: { report: IncidentReport; filterNote: string }) {
  const k = report.kpis;
  const suffix = filterNote ? ` · ${filterNote}` : "";
  return (
    <section aria-label="Totals" className="grid grid-cols-2 md:grid-cols-5 gap-3.5 break-inside-avoid">
      <MetricTile label="Incidents" value={k.incidents} caption={`on ${plural(k.orders, "order")}`} />
      {k.rate === null ? (
        <MetricTile label="Incident rate" value={undefined} caption="No shipment data for this range" />
      ) : (
        <MetricTile label="Incident rate" value={pct1(k.rate)} unit="%" caption={`${k.orders} of ${k.shipped} orders shipped${suffix}`} />
      )}
      <MetricTile label="High risk" value={k.high} caption={`${k.medium} medium · ${k.low} low`} />
      <MetricTile
        label="Top category"
        value={k.topCategory?.name}
        caption={
          k.topCategory
            ? `${k.topCategory.count} of ${k.incidents}${k.secondCategory ? ` · ${k.secondCategory.name} ${k.secondCategory.count}` : ""}`
            : undefined
        }
      />
      <MetricTile
        label="Customers"
        value={k.customers}
        caption={k.topCustomer ? `Top ${k.topCustomer.name} · ${k.topCustomer.count}` : undefined}
      />
    </section>
  );
}

// ── Chart ────────────────────────────────────────────────────────────────────────────────────

type ChartRow = { m: IncidentMonth; [key: string]: IncidentMonth | number | string | null };

function ChartTip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload.m;
  const cats = CATEGORIES.filter((c) => m.byCategory[c] > 0);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-surface text-text text-xs px-3 py-2 shadow-sm space-y-1">
      <div className="font-semibold">{m.label}{m.partial ? " (in progress)" : ""}</div>
      <div className="font-mono tabular-nums">{plural(m.incidents, "incident")}</div>
      {cats.map((c) => (
        <div key={c} className="flex justify-between gap-4">
          <span className="text-muted">{c}</span>
          <span className="font-mono tabular-nums">{m.byCategory[c]}</span>
        </div>
      ))}
      <div className="font-mono tabular-nums text-muted pt-1 border-t border-[var(--line)]">
        {m.shipped === null ? "No shipment data" : `${m.orders} of ${m.shipped} orders · ${m.rate === null ? "—" : `${pct1(m.rate)}%`}`}
      </div>
    </div>
  );
}

function MonthsCard({ months, from, to }: { months: IncidentMonth[]; from: string; to: string }) {
  const c = useTokenColors(TOKENS);
  const present = CATEGORIES.filter((cat) => months.some((m) => m.byCategory[cat] > 0));
  const pi = months.findIndex((m) => m.partial);
  const data: ChartRow[] = months.map((m, i) => {
    const row: ChartRow = { m, label: m.label };
    for (const cat of present) row[cat] = m.byCategory[cat];
    const pct = m.rate === null ? null : Number((m.rate * 100).toFixed(2));
    // Solid line: every complete month. Dashed: only the last complete month → the partial one.
    row.rate = m.partial ? null : pct;
    row.ratePartial = pi >= 0 && (i === pi || i === pi - 1) ? pct : null;
    return row;
  });
  const partial = pi >= 0 ? months[pi] : null;
  const summary = `Incidents per month by category, with incident rate, ${rangeLabel(from, to)}. ` +
    months.map((m) => `${m.label}: ${plural(m.incidents, "incident")}${m.rate === null ? "" : `, rate ${pct1(m.rate)}%`}${m.partial ? " (in progress)" : ""}`).join("; ") + ".";
  const axisProps = { stroke: c.muted, tick: { fontSize: 11, fill: c.muted } };

  return (
    <section aria-labelledby="h-month" className={`${CARD} px-5 py-4 break-inside-avoid`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="h-month" className="text-sm font-semibold text-text">Incidents and incident rate by month</h2>
        <div className="flex flex-wrap gap-3.5 text-xs text-muted" aria-hidden="true">
          {present.map((cat) => (
            <span key={cat} className="inline-flex items-center gap-1.5">
              <span className={`inline-block w-2.5 h-2.5 rounded-sm ${CAT_BG[cat]}`} />
              {cat}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <svg width="16" height="10" aria-hidden="true"><line x1="0" y1="5" x2="16" y2="5" stroke={c.brand} strokeWidth="2" /></svg>
            Incident rate
          </span>
        </div>
      </div>
      <div role="img" aria-label={summary} className="mt-4 h-[260px]">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis yAxisId="n" allowDecimals={false} width={32} {...axisProps} />
            <YAxis yAxisId="r" orientation="right" width={44} tickFormatter={(v) => `${v}%`} {...axisProps} />
            <Tooltip content={<ChartTip />} cursor={{ fill: c.grid }} />
            {present.map((cat, i) => (
              <Bar
                key={cat}
                yAxisId="n"
                dataKey={cat}
                name={cat}
                stackId="i"
                fill={c[cat]}
                radius={i === present.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                isAnimationActive={false}
              >
                {data.map((d, j) => (
                  <Cell key={j} fillOpacity={d.m.partial ? 0.45 : 1} />
                ))}
              </Bar>
            ))}
            <Line yAxisId="r" dataKey="rate" name="Incident rate" stroke={c.brand} strokeWidth={2} dot={{ r: 3, fill: c.brand }} connectNulls={false} isAnimationActive={false} />
            <Line yAxisId="r" dataKey="ratePartial" name="Incident rate (in progress)" stroke={c.brand} strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3, fill: c.surface, stroke: c.brand }} connectNulls={false} isAnimationActive={false} legendType="none" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted font-mono tabular-nums" aria-hidden="true">
        {months.map((m) => (
          <span key={m.month}>{m.label} {m.rate === null ? "—" : `${pct1(m.rate)}%`}</span>
        ))}
      </p>
      <p className="mt-2 text-xs text-muted">
        Rate = orders with an incident ÷ orders shipped that month.
        {partial && ` ${FULL_MONTH[Number(partial.month.slice(5, 7)) - 1]} is in progress — shipments not yet marked shipped aren't counted, so its rate will fall.`}
      </p>
    </section>
  );
}

// ── Breakdowns ───────────────────────────────────────────────────────────────────────────────

function HBar({ label, count, max, bg }: { label: string; count: number; max: number; bg: string }) {
  return (
    <li className="grid grid-cols-[minmax(0,7.5rem)_1fr_2.5rem] items-center gap-2 text-xs">
      <span className="truncate text-text" title={label}>{label}</span>
      <span className="h-2.5 rounded-sm bg-[var(--ghost-bg)] overflow-hidden">
        <span className={`block h-full rounded-sm ${bg}`} style={{ width: max ? `${(count / max) * 100}%` : 0 }} />
      </span>
      <span className={`${NUM} text-text`}>{count}</span>
    </li>
  );
}

function ByCategoryCard({ report }: { report: IncidentReport }) {
  const max = Math.max(0, ...report.byCategory.map((c) => c.count));
  return (
    <section aria-labelledby="h-cat" className={`${CARD} flex-[1_1_300px] min-w-0 px-5 py-4 break-inside-avoid`}>
      <h2 id="h-cat" className="text-sm font-semibold text-text">By category</h2>
      <ul className="mt-3 space-y-2.5">
        {report.byCategory.map((c) => (
          <HBar key={c.name} label={c.name} count={c.count} max={max} bg={CAT_BG[c.name]} />
        ))}
      </ul>
    </section>
  );
}

function ByRiskCard({ report }: { report: IncidentReport }) {
  const total = report.kpis.incidents;
  return (
    <section aria-labelledby="h-risk" className={`${CARD} flex-[1_1_300px] min-w-0 px-5 py-4 break-inside-avoid`}>
      <h2 id="h-risk" className="text-sm font-semibold text-text">By risk</h2>
      <div className="mt-4 flex h-3 rounded-sm overflow-hidden bg-[var(--ghost-bg)]" aria-hidden="true">
        {report.byRisk.map((r) => (r.count > 0 ? <span key={r.name} className={RISK_BG[r.name]} style={{ width: `${(r.count / total) * 100}%` }} /> : null))}
      </div>
      <ul className="mt-4 flex flex-wrap gap-2">
        {report.byRisk.map((r) => (
          <li key={r.name} className="inline-flex items-center gap-2">
            <RiskChip risk={r.name} />
            <span className="text-xs font-mono tabular-nums text-text">{r.count}</span>
            <span className="text-xs font-mono tabular-nums text-muted">{Math.round(r.pct * 100)}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TopCustomersCard({ report }: { report: IncidentReport }) {
  const max = Math.max(0, ...report.topCustomers.map((c) => c.count));
  const others = report.otherCustomers;
  return (
    <section aria-labelledby="h-cust" className={`${CARD} flex-[1_1_300px] min-w-0 px-5 py-4 break-inside-avoid`}>
      <h2 id="h-cust" className="text-sm font-semibold text-text">Top customers</h2>
      <ul className="mt-3 space-y-2.5">
        {report.topCustomers.map((c) => (
          <HBar key={c.name} label={c.name} count={c.count} max={max} bg="bg-[var(--accent)]" />
        ))}
      </ul>
      {others > 0 && (
        <p className="mt-3 text-xs text-muted">
          {report.otherIncidents === others
            ? `+ ${plural(others, "customer")} with 1 incident`
            : `+ ${plural(others, "more customer")} · ${plural(report.otherIncidents, "incident")}`}
        </p>
      )}
    </section>
  );
}

// ── All incidents ────────────────────────────────────────────────────────────────────────────

function IncidentsTable({
  rows, expanded, onToggle, showAll, onShowAll,
}: {
  rows: IncidentListRow[];
  expanded: Set<string>;
  onToggle: (id: string) => void;
  showAll: boolean;
  onShowAll: () => void;
}) {
  const shown = showAll ? rows : rows.slice(0, PAGE);
  return (
    <section aria-labelledby="h-list" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="h-list" className="text-sm font-semibold text-text">All incidents</h2>
        <span className="text-xs text-muted">{plural(rows.length, "incident")} · newest first</span>
      </div>
      <div className={TABLE_WRAP}>
        <table className="w-full min-w-[900px] table-fixed text-sm">
          <thead>
            <tr className={THEAD_ROW}>
              <th className="px-2 py-2.5 w-[56px]"><span className="sr-only">Expand</span></th>
              <th className={`${TH} w-[92px]`}>Date</th>
              <th className={`${TH} w-[120px]`}>INV #</th>
              <th className={`${TH} w-[20%]`}>Customer</th>
              <th className={`${TH} w-[108px]`}>Category</th>
              <th className={`${TH} w-[88px]`}>Risk</th>
              <th className={TH}>Details</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const isOpen = expanded.has(r.id);
              return (
                <Fragment key={r.id}>
                  <tr
                    onClick={() => onToggle(r.id)}
                    className={`${ROW} hover:bg-[var(--ghost-bg)] cursor-pointer break-inside-avoid ${isOpen ? "bg-[var(--ghost-bg)]" : ""}`}
                  >
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggle(r.id);
                        }}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "Collapse" : "Expand"} incident ${mdy(r.incident_date)} ${r.customer}`}
                        className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-muted hover:text-text cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      >
                        {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                      </button>
                    </td>
                    <td className={`${TD} font-mono tabular-nums`}>{mdy(r.incident_date)}</td>
                    <td className={`${TD} font-mono font-semibold truncate`}>{r.job_ref || "—"}</td>
                    <td className={`${TD} truncate`} title={r.customer}>{r.customer || "—"}</td>
                    <td className={TD}>{r.incident_category}</td>
                    <td className={TD}><RiskChip risk={r.risk_level} /></td>
                    <td className={`${TD} truncate text-muted`} title={r.incident_details}>{r.incident_details}</td>
                  </tr>
                  {isOpen && <DetailRow r={r} />}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {!showAll && rows.length > PAGE && (
        <button type="button" className={`${GHOST_BTN} print:hidden`} onClick={onShowAll}>
          Show all {rows.length}
        </button>
      )}
    </section>
  );
}

function Para({ label, text }: { label: string; text: string | null }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-muted">{label}</h3>
      <p className="mt-0.5 text-sm text-text whitespace-pre-line">{text?.trim() ? text : "—"}</p>
    </div>
  );
}

function DetailRow({ r }: { r: IncidentListRow }) {
  const items: [string, React.ReactNode][] = [
    ["Order", <span key="o" className="font-mono">{r.job_ref || "—"}</span>],
    ["Product", r.imported ? <span key="p" className="text-muted">— (not recorded)</span> : r.product_delivered || "—"],
    ["Delivery date", <span key="d" className="font-mono tabular-nums">{mdy(r.delivery_date)}</span>],
    ["Departments", r.departments.length ? r.departments.join(", ") : "—"],
    ["Reported by", r.reporting_individual || "—"],
    ["Completed by", r.imported ? "—" : r.person_completing || "—"],
    [
      "Report",
      r.drive_file_id ? (
        <a
          key="r"
          href={`https://docs.google.com/document/d/${encodeURIComponent(r.drive_file_id)}/edit`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-semibold text-[var(--link)] hover:underline"
        >
          <FileText size={12} aria-hidden="true" />
          {r.drive_file_name || "Open Doc"}
        </a>
      ) : (
        r.drive_file_name || "—"
      ),
    ],
    ["Source", r.imported ? "Tracker import" : `Incident form · ${r.created_by_name || "—"}`],
  ];
  return (
    <tr className="border-b border-[var(--line)] bg-[var(--ghost-bg)] break-inside-avoid">
      <td colSpan={7} className="px-4 py-3">
        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <div className="flex-[2_1_380px] min-w-0 space-y-3">
            <Para label="Details" text={r.incident_details} />
            <Para label="Root cause" text={r.root_cause} />
            <Para label="Corrective actions" text={r.corrective_actions} />
          </div>
          <dl className="flex-[1_1_260px] min-w-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm content-start">
            {items.map(([k, v]) => (
              <Fragment key={k}>
                <dt className="text-xs font-semibold text-muted pt-0.5">{k}</dt>
                <dd className="text-text min-w-0 break-words">{v}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      </td>
    </tr>
  );
}
