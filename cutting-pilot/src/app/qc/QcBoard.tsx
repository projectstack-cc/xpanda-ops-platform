"use client";
// src/app/qc/QcBoard.tsx — qc-01
// v2 QC Final Inspection board (read-only). Week of orders grouped by ship day, each expandable to
// its inspectable lines (Holey Board lines are excluded server-side). Composes the shared dashboard
// primitives (DashboardToolbar, WeekSelector, SearchInput, FilterSelect, DayGroupHeader, MetricTile).
// qc-01: every line is "Not inspected"; qc-02 adds the per-line Inspect action + results.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calculator, ChevronDown, ChevronRight, ClipboardList, RefreshCw, TriangleAlert } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import DashboardToolbar from "@/components/dashboard/DashboardToolbar";
import WeekSelector from "@/components/dashboard/WeekSelector";
import SearchInput from "@/components/dashboard/SearchInput";
import FilterSelect from "@/components/dashboard/FilterSelect";
import DayGroupHeader from "@/components/dashboard/DayGroupHeader";
import MetricTile from "@/components/dashboard/MetricTile";
import DensityCalculatorModal from "@/components/qc/DensityCalculatorModal";
import { getMondayForOffset } from "@/lib/week";
import {
  groupByShipDay,
  isLineFailed,
  isLineInspected,
  orderState,
  type QcLine,
  type QcOrder,
  type QcOrderState,
} from "@/lib/qc/board";

interface QcBoardProps {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

const STATE_OPTIONS: { value: QcOrderState; label: string }[] = [
  { value: "open", label: "Not inspected" },
  { value: "partial", label: "In progress" },
  { value: "failed", label: "Failed" },
  { value: "passed", label: "Passed" },
];

const CUTTING_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_production: "In production",
  done: "Done",
  loading: "Loading",
  shipped: "Shipped",
};

function cuttingLabel(status: string): string {
  if (CUTTING_LABELS[status]) return CUTTING_LABELS[status];
  const words = (status || "").replace(/_/g, " ").trim();
  return words ? words.replace(/\b\w/g, (c) => c.toUpperCase()) : "—";
}

const CHIP = "inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border whitespace-nowrap";

function StateChip({ state, failed }: { state: QcOrderState; failed: number }) {
  if (state === "failed") {
    return (
      <span className={`${CHIP} bg-surface text-[var(--danger-ink)] border-[var(--danger-ink)]`}>
        {failed} failed
      </span>
    );
  }
  if (state === "partial") {
    return (
      <span className={`${CHIP} bg-[var(--info-bg)] text-[var(--info-text)] border-[var(--info-border)]`}>
        In progress
      </span>
    );
  }
  if (state === "passed") {
    return (
      <span className={`${CHIP} bg-[var(--loaded-bg)] text-[var(--loaded-text)] border-[var(--loaded-border)]`}>
        Passed
      </span>
    );
  }
  return (
    <span className={`${CHIP} bg-[var(--ghost-bg)] text-text border-[var(--border)]`}>Not inspected</span>
  );
}

// Per-line result chip — same token mapping as the order chip, for a single line.
function LineChip({ line }: { line: QcLine }) {
  if (isLineFailed(line)) return <StateChip state="failed" failed={1} />;
  if (isLineInspected(line)) return <StateChip state="passed" failed={0} />;
  return <StateChip state="open" failed={0} />;
}

const HEADER_BTN =
  "inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[var(--border)] bg-surface text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] no-underline transition-colors cursor-pointer";

export default function QcBoard({ userName, isAdmin, permissions }: QcBoardProps) {
  const [orders, setOrders] = useState<QcOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 0 = This Week. "Show all" isn't offered here: WeekSelector's Show All (null) maps back to 0.
  const [weekOffset, setWeekOffset] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [densityOpen, setDensityOpen] = useState(false);

  const weekInfo = useMemo(() => getMondayForOffset(weekOffset), [weekOffset]);

  // Drops stale responses when the week changes mid-fetch.
  const reqIdRef = useRef(0);
  const load = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/qc/board?week=${encodeURIComponent(weekInfo.mondayStr)}`);
      const json = await res.json().catch(() => null);
      if (reqId !== reqIdRef.current) return;
      if (!res.ok || !json?.ok) {
        setError(json?.error || "Couldn't load the QC board.");
        setOrders(null);
        return;
      }
      setOrders(json.orders ?? []);
    } catch {
      if (reqId !== reqIdRef.current) return;
      setError("Network error — couldn't reach the server.");
      setOrders(null);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [weekInfo.mondayStr]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = useCallback((jobId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  }, []);

  // KPIs describe the whole loaded week — search and filter are ignored on purpose.
  const kpis = useMemo(() => {
    const all = orders ?? [];
    let parts = 0;
    let passed = 0;
    let failed = 0;
    for (const o of all) {
      for (const l of o.lines) {
        parts++;
        if (isLineFailed(l)) failed++;
        else if (isLineInspected(l)) passed++;
      }
    }
    return { orders: all.length, parts, open: parts - passed - failed, passed, failed };
  }, [orders]);

  const filtered = useMemo(() => {
    const all = orders ?? [];
    const q = searchQuery.trim().toLowerCase();
    return all.filter((o) => {
      if (stateFilter && orderState(o) !== stateFilter) return false;
      if (!q) return true;
      return (
        (o.invoice_number || "").toLowerCase().includes(q) ||
        (o.customer || "").toLowerCase().includes(q) ||
        o.lines.some((l) => (l.description || "").toLowerCase().includes(q))
      );
    });
  }, [orders, searchQuery, stateFilter]);

  const dayGroups = useMemo(() => groupByShipDay(filtered), [filtered]);
  const hasOrders = (orders?.length ?? 0) > 0;

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        title="Quality Control · v2"
        currentPath="/v2/qc"
      />

      <div className="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-text">Final Inspection</h1>
            <p className="text-xs text-muted">
              Inspect every part on each order before it ships. Holey Board lines are not inspected.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setDensityOpen(true)} className={HEADER_BTN}>
              <Calculator size={14} className="text-muted" aria-hidden="true" />
              Density calculator
            </button>
            {/* Legacy pages until they port — plain <a>, they leave the v2 app. */}
            <a href="/qc/scrap-log.html" className={HEADER_BTN}>
              <ClipboardList size={14} className="text-muted" aria-hidden="true" />
              Scrap log
            </a>
            <a href="/qc/incident-report.html" className={HEADER_BTN}>
              <TriangleAlert size={14} className="text-muted" aria-hidden="true" />
              Incident report
            </a>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <MetricTile
            label="Orders"
            value={orders ? kpis.orders : undefined}
            caption={orders ? `${kpis.parts} ${kpis.parts === 1 ? "part" : "parts"} to inspect` : undefined}
          />
          <MetricTile label="Not inspected" value={orders ? kpis.open : undefined} unit="parts" />
          <MetricTile label="Passed" value={orders ? kpis.passed : undefined} unit="parts" />
          <MetricTile label="Failed" value={orders ? kpis.failed : undefined} unit="parts" />
        </div>

        <DashboardToolbar
          left={
            <>
              <WeekSelector
                weekOffset={weekOffset}
                onChange={(o) => setWeekOffset(o ?? 0)}
                label={weekInfo.label}
              />
            </>
          }
          right={
            <>
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search INV #, customer, part…"
              />
              <FilterSelect
                value={stateFilter}
                onChange={setStateFilter}
                allLabel="All statuses"
                options={STATE_OPTIONS}
              />
            </>
          }
        />

        {loading ? (
          <div className="rounded-xl border border-[var(--card-border)] bg-surface p-12 text-center text-sm text-muted">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-muted" />
            Loading orders…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <span>{error}</span>
            <button
              type="button"
              onClick={load}
              className="min-h-[44px] px-3 underline cursor-pointer font-semibold text-xs"
            >
              Retry
            </button>
          </div>
        ) : !hasOrders ? (
          <div className="rounded-xl border border-[var(--card-border)] bg-surface p-12 text-center">
            <p className="text-sm font-medium text-text">No orders to inspect this week.</p>
            <p className="text-xs text-muted mt-1">Holey Board lines are not inspected, so Holey-only orders don&apos;t appear.</p>
          </div>
        ) : dayGroups.length === 0 ? (
          <div className="rounded-xl border border-[var(--card-border)] bg-surface p-12 text-center">
            <p className="text-sm font-medium text-text">No orders match.</p>
            <p className="text-xs text-muted mt-1">Try adjusting your search or clearing the status filter.</p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setStateFilter("");
              }}
              className="mt-4 inline-flex items-center min-h-[44px] px-3 rounded-lg border border-[var(--border)] text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] cursor-pointer"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {dayGroups.map(({ dateKey, orders: dayOrders }) => (
              <div key={dateKey} className="space-y-2">
                <DayGroupHeader dateKey={dateKey} count={dayOrders.length} noun={["order", "orders"]} />
                <div className="overflow-x-auto rounded-xl border border-[var(--card-border)] bg-surface shadow-xs">
                  <table className="w-full min-w-[820px] table-fixed text-sm">
                    <thead>
                      <tr className="border-b border-[var(--line)] bg-[var(--ghost-bg)] text-left text-xs font-semibold text-muted">
                        <th className="px-2 py-2.5 w-[56px]">
                          <span className="sr-only">Expand</span>
                        </th>
                        <th className="px-3.5 py-2.5 w-[12%]">INV #</th>
                        <th className="px-3.5 py-2.5 w-[30%]">Customer</th>
                        <th className="px-3.5 py-2.5 w-[15%]">Cutting</th>
                        <th className="px-3.5 py-2.5 w-[18%]">Parts</th>
                        <th className="px-3.5 py-2.5">Inspection</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dayOrders.map((o) => {
                        const isOpen = expanded.has(o.job_id);
                        const inspected = o.lines.filter(isLineInspected).length;
                        const failed = o.lines.filter(isLineFailed).length;
                        return (
                          <Fragment key={o.job_id}>
                            <tr
                              onClick={() => toggle(o.job_id)}
                              className="border-b border-[var(--line)] last:border-b-0 hover:bg-[var(--ghost-bg)] cursor-pointer"
                            >
                              <td className="px-2 py-1">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggle(o.job_id);
                                  }}
                                  aria-expanded={isOpen}
                                  aria-label={`${isOpen ? "Collapse" : "Expand"} parts for INV ${o.invoice_number || "—"}`}
                                  className="flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-muted hover:text-text cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                                >
                                  {isOpen ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                                </button>
                              </td>
                              <td className="px-3.5 py-2.5 font-mono font-semibold">{o.invoice_number || "—"}</td>
                              <td className="px-3.5 py-2.5">{o.customer || "—"}</td>
                              <td className="px-3.5 py-2.5 text-muted">{cuttingLabel(o.status)}</td>
                              <td className="px-3.5 py-2.5 font-mono tabular-nums">
                                {inspected} / {o.lines.length} inspected
                              </td>
                              <td className="px-3.5 py-2.5">
                                <StateChip state={orderState(o)} failed={failed} />
                              </td>
                            </tr>
                            {isOpen && (
                              <tr className="border-b border-[var(--line)] last:border-b-0 bg-[var(--ghost-bg)]">
                                <td colSpan={6} className="px-4 py-3">
                                  <div className="overflow-x-auto rounded-lg border border-[var(--card-border)] bg-surface">
                                    <table className="w-full text-sm">
                                      <thead>
                                        <tr className="border-b border-[var(--line)] text-left text-xs font-semibold text-muted">
                                          <th className="px-3 py-2">Part</th>
                                          <th className="px-3 py-2">Dimensions</th>
                                          <th className="px-3 py-2 text-right">Qty</th>
                                          <th className="px-3 py-2">Result</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {o.lines.map((l) => (
                                          <tr key={l.id} className="border-b border-[var(--line)] last:border-b-0">
                                            <td className="px-3 py-2">{l.description || "—"}</td>
                                            <td className="px-3 py-2 font-mono">{l.dimensions?.trim() || "—"}</td>
                                            <td className="px-3 py-2 font-mono tabular-nums text-right">
                                              {(l.quantity ?? 0).toLocaleString()}
                                            </td>
                                            <td className="px-3 py-2">
                                              <LineChip line={l} />
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
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
              </div>
            ))}
          </div>
        )}
      </div>

      <DensityCalculatorModal isOpen={densityOpen} onClose={() => setDensityOpen(false)} />
    </div>
  );
}
