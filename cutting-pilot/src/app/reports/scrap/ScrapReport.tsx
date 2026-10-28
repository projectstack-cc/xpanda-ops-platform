"use client";
// src/app/reports/scrap/ScrapReport.tsx — rpt-04
// /v2/reports/scrap — scrap logged at the cutting board (qc-05) and in QC (qc-04), in board feet, read
// from scrap_events (never the scrap_log VIEW). Fetches GET /v2/api/reports/scrap only when from/to
// change; buildScrapReport (lib/reports/scrap.ts) applies the line / reason / shift filters and
// Show voided client-side. Layout follows the claude.ai "v2 Reports" canvas (Scrap — desktop) with
// rpt-01's kit: PlatformHeader, MetricTile, DashboardToolbar, RangeSelector, FilterSelect, QcBoard
// table/chip classes. Empty state is the real first impression (prod has 0 live rows at launch).
// Linked from the home card + navs since rpt-05.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ClipboardList, Printer, RefreshCw, Scissors, TriangleAlert } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import MetricTile from "@/components/dashboard/MetricTile";
import DashboardToolbar from "@/components/dashboard/DashboardToolbar";
import FilterSelect from "@/components/dashboard/FilterSelect";
import RangeSelector, { type RangeValue } from "@/components/dashboard/RangeSelector";
import { useTokenColors } from "@/components/charts/useTokenColors";
import { etNowWallClock } from "@/lib/etDateTime";
import { SHIFT_LABELS, SHIFT_VALUES, type ScrapReason, type ScrapSource } from "@/lib/qc/scrap";
import { dayLabel, presetRange, rangeLabel } from "@/lib/reports/range";
import {
  SCRAP_LINES, SCRAP_PROMPT_LIVE, SCRAP_REASONS, buildScrapReport, type ScrapBucket, type ScrapListRow, type ScrapMonth, type ScrapRaw,
  type ScrapReport as Report, type ScrapWeek,
} from "@/lib/reports/scrap";
import { CARD, CHIP_GHOST, CHIP_WARN, GHOST_BTN, HEADER_BTN, NUM, ROW, TABLE_WRAP, TD, TH, THEAD_ROW } from "../ui";

interface Props {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

// Hook fallbacks only (light-theme values) — the live colors come from the design tokens.
const TOKENS = {
  "Incorrect Cut": { var: "--accent", fallback: "#0f172a" },
  "Hole Pass Issue": { var: "--loading-text", fallback: "#0e7490" },
  "Dirty / Wet Foam": { var: "--warn-text", fallback: "#92400e" },
  "Equipment Issue": { var: "--link", fallback: "#0074cc" },
  "Setup Error": { var: "--success-ink", fallback: "#15803d" },
  Other: { var: "--muted", fallback: "#4b5563" },
  brand: { var: "--brand", fallback: "#e31837" },
  grid: { var: "--border-light", fallback: "#f3f4f6" },
  muted: { var: "--muted", fallback: "#4b5563" },
  text: { var: "--text", fallback: "#111827" },
  surface: { var: "--surface", fallback: "#ffffff" },
  border: { var: "--border", fallback: "#e5e7eb" },
};
// The same mapping for plain HTML bars (CSS vars work there).
const REASON_BG: Record<ScrapReason, string> = {
  "Incorrect Cut": "bg-[var(--accent)]",
  "Hole Pass Issue": "bg-[var(--loading-text)]",
  "Dirty / Wet Foam": "bg-[var(--warn-text)]",
  "Equipment Issue": "bg-[var(--link)]",
  "Setup Error": "bg-[var(--success-ink)]",
  Other: "bg-[var(--muted)]",
};
const LINE_OPTIONS = SCRAP_LINES.map((l) => ({ value: l, label: l }));
const REASON_OPTIONS = SCRAP_REASONS.map((r) => ({ value: r, label: r }));
const SHIFT_OPTIONS = SHIFT_VALUES.map((s) => ({ value: s, label: SHIFT_LABELS[s] }));
const SHIFT_SHORT: Record<string, string> = { "1": "1st", "2": "2nd", "3": "3rd" };
const SOURCE_LABEL: Record<ScrapSource, string> = { cutting: "Cutting board", qc: "QC log", legacy: "Legacy form" };
const PAGE = 50;

const f1 = (n: number) => n.toFixed(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const md = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}`;

export default function ScrapReport({ userName, isAdmin, permissions }: Props) {
  const [today] = useState(() => etNowWallClock().date);
  const [range, setRange] = useState<RangeValue>(() => ({ preset: "last_30", ...presetRange("last_30", etNowWallClock().date) }));
  const [raw, setRaw] = useState<ScrapRaw | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showVoided, setShowVoided] = useState(false);
  const [line, setLine] = useState("");
  const [reason, setReason] = useState("");
  const [shift, setShift] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async (from: string, to: string, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/reports/scrap?from=${from}&to=${to}`, { signal });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || `Couldn't load the scrap report (HTTP ${res.status}).`);
        setRaw(null);
      } else {
        setRaw({ rows: data.rows ?? [], activity: data.activity ?? [], closedSessions: data.closedSessions ?? [], months: data.months ?? [] });
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
    () => (raw ? buildScrapReport(raw, { from: range.from, to: range.to, line: line || null, reason: reason || null, shift: shift || null, showVoided, todayEt: today }) : null),
    [raw, range.from, range.to, line, reason, shift, showVoided, today]
  );

  const filtered = !!(line || reason || shift);
  const clearFilters = () => { setLine(""); setReason(""); setShift(""); };
  const filterNote = [line && `${line} only`, reason && `${reason} only`, shift && `${SHIFT_SHORT[shift]} shift only`].filter(Boolean).join(" · ");
  const isEmpty = !!report && report.empty.isEmpty;

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <div className="print:hidden">
        <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Reports · v2" currentPath="/v2/reports" />
      </div>

      <main className="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-6 space-y-5 min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight text-text">Scrap</h1>
            <p className="text-xs text-muted">Scrap logged at the cutting board and in QC, in board feet (pieces × T × W × L ÷ 144).</p>
            <p className="hidden print:block text-xs text-muted font-mono tabular-nums">
              {rangeLabel(range.from, range.to)}{filterNote ? ` · ${filterNote}` : ""}{showVoided ? " · voided shown" : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link href="/reports/cutting" className={HEADER_BTN}>
              <Scissors size={14} className="text-muted" aria-hidden="true" />
              Cutting
            </Link>
            <Link href="/reports/incidents" className={HEADER_BTN}>
              <TriangleAlert size={14} className="text-muted" aria-hidden="true" />
              Incidents
            </Link>
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
            right={
              <>
                <label className="inline-flex items-center gap-2 min-h-[44px] px-1 text-xs font-semibold text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showVoided}
                    onChange={(e) => setShowVoided(e.target.checked)}
                    className="w-[18px] h-[18px] accent-[var(--brand)] cursor-pointer"
                  />
                  Show voided
                </label>
                <FilterSelect value={line} onChange={setLine} allLabel="All lines" options={LINE_OPTIONS} />
                <FilterSelect value={reason} onChange={setReason} allLabel="All reasons" options={REASON_OPTIONS} />
                <FilterSelect value={shift} onChange={setShift} allLabel="All shifts" options={SHIFT_OPTIONS} />
              </>
            }
          />
        </div>

        {loading && !report ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading the scrap report">
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
        ) : !report ? null : (
          <div className={`space-y-5 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
            {loading && (
              <p className="text-xs text-muted inline-flex items-center gap-1.5 print:hidden">
                <RefreshCw size={12} className="animate-spin" aria-hidden="true" /> Updating…
              </p>
            )}
            {isEmpty ? (
              <>
                {filtered ? (
                  <div className={`${CARD} p-12 text-center`}>
                    <p className="text-sm font-medium text-text">Nothing matches these filters.</p>
                    <button type="button" onClick={clearFilters} className={`mt-4 ${GHOST_BTN}`}>
                      Clear filters
                    </button>
                  </div>
                ) : (
                  <EmptyCard report={report} from={range.from} />
                )}
                <MonthsCard months={report.months} wide />
                {/* Show voided still reveals voided rows in an otherwise empty range (e.g. the March test data). */}
                {showVoided && report.list.length > 0 && (
                  <EntriesTable rows={report.list} showAll={showAll} onShowAll={() => setShowAll(true)} />
                )}
              </>
            ) : (
              <>
                <div className="flex flex-wrap gap-5 items-stretch">
                  <WeeksCard weeks={report.weeks} from={range.from} to={range.to} />
                  <ByReasonCard rows={report.byReason} />
                </div>
                <div className="flex flex-wrap gap-5 items-stretch">
                  <BarsCard id="h-line" title="By line" rows={report.byLine} bg="bg-[var(--brand)]" />
                  <BarsCard id="h-op" title="By operator" rows={report.byOperator} bg="bg-[var(--accent)]" />
                  <MonthsCard months={report.months} />
                </div>
                <EntriesTable rows={report.list} showAll={showAll} onShowAll={() => setShowAll(true)} />
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ── KPIs ─────────────────────────────────────────────────────────────────────────────────────

function Kpis({ report }: { report: Report }) {
  const k = report.kpis;
  const total = f1(k.boardFt);
  return (
    <section aria-label="Totals" className="grid grid-cols-2 md:grid-cols-5 gap-3.5 break-inside-avoid">
      <MetricTile
        label="Scrap"
        value={f1(k.boardFt)}
        unit="bd ft"
        caption={k.entries ? `${plural(k.pieces, "piece")} · ${plural(k.entries, "entry", "entries")}` : "No entries"}
      />
      <MetricTile
        label="Entries"
        value={k.entries}
        caption={k.voided > 0 ? `${k.voided} voided${k.voidedTestOnly ? " (test data, Mar)" : ""}` : undefined}
      />
      <MetricTile
        label="Top reason"
        value={k.topReason?.name}
        caption={k.topReason ? `${f1(k.topReason.boardFt)} of ${total} bd ft` : undefined}
      />
      <MetricTile
        label="Top line"
        value={k.topLine?.name}
        caption={k.topLine ? `${f1(k.topLine.boardFt)} of ${total} bd ft` : undefined}
      />
      {k.perOrderCut === null ? (
        <MetricTile label="Scrap per order cut" value={undefined} caption="No scrap logged" />
      ) : (
        <MetricTile
          label="Scrap per order cut"
          value={f1(k.perOrderCut)}
          unit="bd ft"
          caption={`${total} bd ft over ${plural(k.ordersCut, "order")} cut`}
        />
      )}
    </section>
  );
}

// ── Empty state ──────────────────────────────────────────────────────────────────────────────

function EmptyCard({ report, from }: { report: Report; from: string }) {
  const { closedSessions, liveFrom } = report.empty;
  // rpt-05: a range reaching back past the live date only counts sessions since then — say so.
  const leadIn = liveFrom === SCRAP_PROMPT_LIVE && from < SCRAP_PROMPT_LIVE
    ? `Since ${dayLabel(SCRAP_PROMPT_LIVE).replace(/^\S+ /, "")}:`
    : "In this range:";
  return (
    <div className={`${CARD} p-12 text-center break-inside-avoid`}>
      <ClipboardList size={28} className="mx-auto text-muted" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-text">No scrap logged in this range.</p>
      <p className="mt-1 text-xs text-muted max-w-xl mx-auto">
        Operators log scrap on the cutting board when they tap Mark Complete or Stop. QC can add it from Quality
        Control → Scrap log. Entries show up here as soon as they&apos;re saved.
      </p>
      {liveFrom && closedSessions > 0 && (
        <p className="mt-3 text-xs text-muted">
          {leadIn} <strong className="font-semibold text-text font-mono tabular-nums">{closedSessions}</strong>{" "}
          {closedSessions === 1 ? "cutting session" : "cutting sessions"} closed,{" "}
          <strong className="font-semibold text-text font-mono tabular-nums">0</strong> with scrap entered.
        </p>
      )}
    </div>
  );
}

// ── Charts ───────────────────────────────────────────────────────────────────────────────────

type WeekRow = { w: ScrapWeek; label: string; [key: string]: ScrapWeek | number | string };

function WeekTip({ active, payload }: { active?: boolean; payload?: { payload: WeekRow }[] }) {
  if (!active || !payload?.length) return null;
  const w = payload[0].payload.w;
  const reasons = SCRAP_REASONS.filter((r) => w.byReason[r] > 0);
  return (
    <div className="rounded-lg border border-[var(--border)] bg-surface text-text text-xs px-3 py-2 shadow-sm space-y-1">
      <div className="font-semibold">{w.label}</div>
      <div className="font-mono tabular-nums">{f1(w.boardFt)} bd ft · {plural(w.entries, "entry", "entries")}</div>
      {reasons.map((r) => (
        <div key={r} className="flex justify-between gap-4">
          <span className="text-muted">{r}</span>
          <span className="font-mono tabular-nums">{f1(w.byReason[r])}</span>
        </div>
      ))}
    </div>
  );
}

function WeeksCard({ weeks, from, to }: { weeks: ScrapWeek[]; from: string; to: string }) {
  const c = useTokenColors(TOKENS);
  const present = SCRAP_REASONS.filter((r) => weeks.some((w) => w.byReason[r] > 0));
  const data: WeekRow[] = weeks.map((w) => {
    const row: WeekRow = { w, label: w.label.replace("Wk of ", ""), total: Number(f1(w.boardFt)) };
    for (const r of present) row[r] = Number(w.byReason[r].toFixed(3));
    // The week total rides on the topmost non-zero segment (recharts drops labels on zero-height bars).
    const top = [...present].reverse().find((r) => w.byReason[r] > 0);
    if (top) row[`top:${top}`] = Number(f1(w.boardFt));
    return row;
  });
  const summary = `Scrap board feet per week by reason, ${rangeLabel(from, to)}. ` +
    weeks.map((w) => `${w.label}: ${f1(w.boardFt)} bd ft`).join("; ") + ".";
  const axisProps = { stroke: c.muted, tick: { fontSize: 11, fill: c.muted } };

  return (
    <section aria-labelledby="h-week" className={`${CARD} flex-[3_1_560px] min-w-0 px-5 py-4 break-inside-avoid`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="h-week" className="text-sm font-semibold text-text">Scrap by week</h2>
        <div className="flex flex-wrap gap-3.5 text-xs text-muted" aria-hidden="true">
          {present.map((r) => (
            <span key={r} className="inline-flex items-center gap-1.5">
              <span className={`inline-block w-2.5 h-2.5 rounded-sm ${REASON_BG[r]}`} />
              {r}
            </span>
          ))}
        </div>
      </div>
      <div role="img" aria-label={summary} className="mt-4 h-[260px]">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 20, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis width={36} {...axisProps} />
            <Tooltip content={<WeekTip />} cursor={{ fill: c.grid }} />
            {present.map((r, i) => (
              <Bar
                key={r}
                dataKey={r}
                name={r}
                stackId="s"
                fill={c[r]}
                radius={i === present.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey={`top:${r}`}
                  position="top"
                  fontSize={11}
                  fill={c.text}
                  formatter={(v: unknown) => f1(Number(v))}
                />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-muted">Weeks start Monday. Board feet as logged.</p>
    </section>
  );
}

function HBar({ label, value, max, bg }: { label: string; value: number; max: number; bg: string }) {
  return (
    <li className="grid grid-cols-[minmax(0,8rem)_1fr_3rem] items-center gap-2 text-xs">
      <span className="truncate text-text" title={label}>{label}</span>
      <span className="h-2.5 rounded-sm bg-[var(--ghost-bg)] overflow-hidden">
        <span className={`block h-full rounded-sm ${bg}`} style={{ width: max ? `${(value / max) * 100}%` : 0 }} />
      </span>
      <span className={`${NUM} text-text`}>{f1(value)}</span>
    </li>
  );
}

function ByReasonCard({ rows }: { rows: ScrapBucket[] }) {
  const max = Math.max(0, ...rows.map((r) => r.boardFt));
  return (
    <section aria-labelledby="h-reason" className={`${CARD} flex-[2_1_320px] min-w-0 px-5 py-4 break-inside-avoid`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="h-reason" className="text-sm font-semibold text-text">By reason</h2>
        <span className="text-xs text-muted">bd ft</span>
      </div>
      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <HBar key={r.name} label={r.name} value={r.boardFt} max={max} bg={REASON_BG[r.name as ScrapReason]} />
        ))}
      </ul>
    </section>
  );
}

function BarsCard({ id, title, rows, bg }: { id: string; title: string; rows: ScrapBucket[]; bg: string }) {
  const max = Math.max(0, ...rows.map((r) => r.boardFt));
  return (
    <section aria-labelledby={id} className={`${CARD} flex-[1_1_300px] min-w-0 px-5 py-4 break-inside-avoid`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-sm font-semibold text-text">{title}</h2>
        <span className="text-xs text-muted">bd ft</span>
      </div>
      <ul className="mt-3 space-y-2.5">
        {rows.map((r) => (
          <HBar key={r.name} label={r.name} value={r.boardFt} max={max} bg={bg} />
        ))}
      </ul>
    </section>
  );
}

function MonthsCard({ months, wide = false }: { months: ScrapMonth[]; wide?: boolean }) {
  const c = useTokenColors(TOKENS);
  const data = months.map((m) => ({ label: m.label, boardFt: Number(f1(m.boardFt)) }));
  const summary = "Scrap board feet per month, last six months. " + months.map((m) => `${m.label}: ${f1(m.boardFt)} bd ft`).join("; ") + ".";
  const axisProps = { stroke: c.muted, tick: { fontSize: 11, fill: c.muted } };
  return (
    <section aria-labelledby="h-month" className={`${CARD} ${wide ? "" : "flex-[1_1_300px]"} min-w-0 px-5 py-4 break-inside-avoid`}>
      <h2 id="h-month" className="text-sm font-semibold text-text">Last 6 months</h2>
      <div role="img" aria-label={summary} className="mt-3 h-[140px]">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="label" {...axisProps} />
            <YAxis width={32} allowDecimals={false} {...axisProps} />
            <Bar dataKey="boardFt" fill={c.brand} radius={[3, 3, 0, 0]} isAnimationActive={false}>
              <LabelList dataKey="boardFt" position="top" fontSize={10} fill={c.muted} formatter={(v: unknown) => (Number(v) > 0 ? f1(Number(v)) : "")} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-muted">Monthly total, independent of the range above.</p>
    </section>
  );
}

// ── Entries ──────────────────────────────────────────────────────────────────────────────────

function EntriesTable({ rows, showAll, onShowAll }: { rows: ScrapListRow[]; showAll: boolean; onShowAll: () => void }) {
  const shown = showAll ? rows : rows.slice(0, PAGE);
  return (
    <section aria-labelledby="h-list" className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 id="h-list" className="text-sm font-semibold text-text">Entries</h2>
        <span className="text-xs text-muted">{plural(rows.length, "entry", "entries")} · newest first</span>
      </div>
      <div className="relative">
        <div className={`${TABLE_WRAP} max-h-[640px] overflow-y-auto print:max-h-none print:overflow-visible`}>
          <table className="w-full min-w-[1040px] print:min-w-0 text-sm">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={TH}>Date</th>
                <th className={TH}>Shift</th>
                <th className={TH}>Line</th>
                <th className={TH}>Operator</th>
                <th className={TH}>INV #</th>
                <th className={TH}>Part</th>
                <th className={TH}>Size</th>
                <th className={`${TH} text-right`}>Bd ft</th>
                <th className={TH}>Reason</th>
                <th className={TH}>From</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const strike = r.voided ? "line-through text-muted" : "";
                return (
                  <tr key={r.id} className={`${ROW} break-inside-avoid`}>
                    <td className={`${TD} font-mono tabular-nums ${strike}`}>{md(r.event_date)}</td>
                    <td className={`${TD} ${strike}`}>{SHIFT_SHORT[String(r.shift)] ?? r.shift}</td>
                    <td className={`${TD} ${strike}`}>{r.line_machine}</td>
                    <td className={`${TD} ${strike}`}>{r.operator_name || "—"}</td>
                    <td className={`${TD} font-mono font-semibold ${strike}`}>{r.inv_number || "—"}</td>
                    <td className={`${TD} max-w-[260px]`}>
                      <div className={`truncate ${strike}`} title={r.part_product}>{r.part_product || "—"}</div>
                      {r.material_density && <div className={`text-xs text-muted truncate ${r.voided ? "line-through" : ""}`}>{r.material_density}</div>}
                      {r.notes && <div className="text-xs text-muted truncate" title={r.notes}>{r.notes}</div>}
                    </td>
                    <td className={`${TD} font-mono tabular-nums whitespace-nowrap ${strike}`}>{r.size}</td>
                    <td className={`${TD} ${NUM} ${strike}`}>{f1(Number(r.scrap_board_ft) || 0)}</td>
                    <td className={TD}>
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        <span className={`${CHIP_GHOST} ${r.voided ? "line-through" : ""}`}>{r.scrap_reason}</span>
                        {r.voided && <span className={CHIP_WARN} title={r.void_reason ?? undefined}>Voided</span>}
                      </span>
                    </td>
                    <td className={`${TD} text-muted whitespace-nowrap ${r.voided ? "line-through" : ""}`}>{SOURCE_LABEL[r.source] ?? r.source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {!showAll && rows.length > PAGE && (
        <button type="button" className={`${GHOST_BTN} print:hidden`} onClick={onShowAll}>
          Show all {rows.length}
        </button>
      )}
    </section>
  );
}
