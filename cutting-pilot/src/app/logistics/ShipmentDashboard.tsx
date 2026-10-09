"use client";
// src/app/logistics/ShipmentDashboard.tsx
// Outbound shipment logistics dashboard.
// Features:
// - Operational KPI stats widgets at the top (This Week, Pending, In Transit, Delivered 30d)
// - View switcher: Daily Breakdown List vs Interactive Month Calendar
// - Week selector: This Week (default) ↔ Next Week toggle, with week arrows and Show All
// - Instant client-side search across customer, invoice, trailer, carrier, BOL
// - Daily grouping of shipments with day headers, piece/bdft sums, and status badges
// - Alternating Generate BOL ↔ View BOL actions with live refresh on generation
import { useCallback, useEffect, useState, useMemo, useRef, type KeyboardEvent } from "react";
import {
  Truck,
  CheckCircle2,
  Clock,
  Navigation,
  RefreshCw,
  Mail,
  Receipt,
} from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import ShipmentRow from "@/components/logistics/ShipmentRow";
import LinkedTableGroups from "@/components/linked/LinkedTableGroups";
import ShipmentCalendar from "./ShipmentCalendar";
import BolViewerModal from "@/components/logistics/BolViewerModal";
import BolGenerateModal from "@/components/logistics/BolGenerateModal";
import BolEditorModal, { type EditorTarget } from "@/components/logistics/BolEditorModal";
import ShipmentEditModal from "@/components/logistics/ShipmentEditModal";
import LoadingSheetButton from "@/components/logistics/LoadingSheetButton";
import ToLoadSheetButton from "@/components/logistics/ToLoadSheetButton";
import FuelSurchargeControl from "@/components/logistics/FuelSurchargeControl";
import StatTile from "@/components/dashboard/StatTile";
import DashboardToolbar from "@/components/dashboard/DashboardToolbar";
import ViewModeToggle from "@/components/dashboard/ViewModeToggle";
import WeekSelector from "@/components/dashboard/WeekSelector";
import SearchInput from "@/components/dashboard/SearchInput";
import FilterSelect from "@/components/dashboard/FilterSelect";
import DayGroupHeader from "@/components/dashboard/DayGroupHeader";
import { getMondayForOffset } from "@/lib/week";
import StatBreakdownModal from "@/components/logistics/StatBreakdownModal";
import type { ShipmentDetail, ShipmentListItem, LogisticsStats } from "@/components/logistics/types";
import type { BolRecord } from "@/lib/bolShared";

interface ShipmentDashboardProps {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

// Matches shipments/route.ts's STAT_PREDICATES keys exactly -- the KPI tile drilldown
// (StatBreakdownModal) fetches GET /v2/api/shipments?stat=<key> with these.
const STAT_LABELS: Record<string, string> = {
  outbound_this_week: "Outbound This Week",
  pending_outbound: "Pending Outbound",
  in_transit: "In Transit",
  delivered_30d: "Delivered (30d)",
};

// Status filter options (same 8, same order as before board-ui-01's toolbar extraction).
const SHIPMENT_STATUS_OPTIONS = [
  { value: "not_started", label: "Not Started" },
  { value: "in_production", label: "In Production" },
  { value: "ready_to_ship", label: "Ready to Ship" },
  { value: "loading", label: "Loading" },
  { value: "loaded", label: "Loaded" },
  { value: "in_transit", label: "In Transit" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
];

export default function ShipmentDashboard({
  userName,
  isAdmin,
  permissions,
}: ShipmentDashboardProps) {
  const [rows, setRows] = useState<ShipmentListItem[] | null>(null);
  const [calendarRows, setCalendarRows] = useState<ShipmentListItem[] | null>(null);
  const [stats, setStats] = useState<LogisticsStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // View mode: 'list' or 'calendar'
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");

  // Week offset: 0 = This Week, 1 = Next Week, null = Show All
  const [weekOffset, setWeekOffset] = useState<number | null>(0);

  // Search and status filter
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Modals
  const [viewerJobId, setViewerJobId] = useState<string | null>(null);
  const [generateJobId, setGenerateJobId] = useState<string | null>(null);
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [editingShipment, setEditingShipment] = useState<ShipmentListItem | null>(null);
  const [statModalKey, setStatModalKey] = useState<string | null>(null);

  // Inline row drill-down (replaces the old "View job →" navigate-away link). Single-expand,
  // matching ProductionBoard.tsx's expandedId pattern. detailCacheRef is a plain Map (not
  // state) -- mirrors ShippingInfoModal.tsx's jobCache -- so re-expanding an already-fetched
  // row is instant and doesn't trigger a re-render for every other row.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const detailCacheRef = useRef<Map<string, ShipmentDetail>>(new Map());
  const handleToggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  // Mirrors DockBoard.tsx's existing client-side pattern for this exact permission key -- the
  // Shipment Edit Modal gates Trailer # editability on it, matching the server's
  // X-User-Can-Manage-Loading check in shipments/[id]/route.ts.
  const canManageLoading = isAdmin || permissions?.["logistics.loading.manage"]?.edit === true;
  const canEditDashboard = isAdmin || permissions?.["logistics.dashboard"]?.edit === true;
  // Invoice Analytics link mirrors middleware (lgx-roll-01): page + /v2/api/logistics are logistics.dashboard.
  const canSeeInvoiceAnalytics = isAdmin || permissions?.["logistics.dashboard"]?.view === true;

  const activeWeekInfo = useMemo(() => {
    if (weekOffset === null) return null;
    return getMondayForOffset(weekOffset);
  }, [weekOffset]);

  // Primary loader
  const load = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();

      if (viewMode === "list" && weekOffset !== null) {
        const { mondayStr } = getMondayForOffset(weekOffset);
        params.set("week", mondayStr);
      } else {
        // Calendar view or Show All: load wider window
        params.set("days", "90");
      }

      if (statusFilter) {
        params.set("status", statusFilter);
      }

      const res = await fetch(`/v2/api/shipments?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "Couldn't load the shipment list.");
        return;
      }
      setError(null);
      setRows(json.data ?? []);
      if (json.stats) {
        setStats(json.stats);
      }
    } catch {
      setError("Network error — couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, [weekOffset, viewMode, statusFilter]);

  // Load calendar-specific broader dataset if switching to calendar
  useEffect(() => {
    if (viewMode === "calendar") {
      (async () => {
        try {
          const res = await fetch("/v2/api/shipments?days=365");
          const json = await res.json();
          if (res.ok && json.ok) {
            setCalendarRows(json.data ?? []);
          }
        } catch {
          // fallback to standard rows
        }
      })();
    }
  }, [viewMode]);

  useEffect(() => {
    load();
  }, [load]);

  // Bounded distance/ETA cache warm-up -- list view ONLY, never Calendar (whose 365-day fetch
  // can hold hundreds of rows -- warming that inline would risk an ORS quota burn that degrades
  // Invoice Analytics' own mileage stats). Caps at 2 sequential batches of 8 ids per mount/load
  // and never re-attempts an id already tried this session (warmAttemptedRef), so re-renders
  // triggered by this effect's own setRows merge don't loop.
  const warmAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (viewMode !== "list" || !rows || !rows.length) return;

    // split-days-02: a split order appears once per day -- dedupe its id.
    const pendingIds = Array.from(new Set(rows
      .filter((r) => r.distance_status === "pending" && !warmAttemptedRef.current.has(r.id))
      .map((r) => r.id)));
    if (!pendingIds.length) return;

    const idsToWarm = pendingIds.slice(0, 16); // 2 server batches of MAX_IDS_PER_CALL (8)
    idsToWarm.forEach((id) => warmAttemptedRef.current.add(id));

    let cancelled = false;
    (async () => {
      for (let i = 0; i < idsToWarm.length; i += 8) {
        if (cancelled) return;
        const batch = idsToWarm.slice(i, i + 8);
        try {
          const res = await fetch(`/v2/api/shipments/distances?ids=${batch.join(",")}`);
          const json = await res.json();
          if (cancelled || !res.ok || !json.ok) continue;
          setRows((prev) =>
            prev
              ? prev.map((r) => {
                  const d = json.results?.[r.id];
                  return d
                    ? { ...r, miles_from_origin: d.miles, duration_sec: d.durationSec, distance_status: d.status }
                    : r;
                })
              : prev
          );
        } catch {
          // best-effort warm -- id stays marked attempted for this session, ok to leave "pending"
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [viewMode, rows]);

  function handleEditFromViewer(bols: BolRecord[], jobId: string, index: number) {
    setViewerJobId(null);
    setEditorTarget({ jobId, bols, index });
  }

  function handleEditorCancel() {
    if (editorTarget) setViewerJobId(editorTarget.jobId);
    setEditorTarget(null);
  }

  function handleEditorSaved() {
    if (editorTarget) setViewerJobId(editorTarget.jobId);
    setEditorTarget(null);
    load();
  }

  function handleGenerateDone(generated: boolean) {
    setGenerateJobId(null);
    if (generated) {
      // lgx-minimap-01: edits can change address/carrier/loads — drop cached drill-downs so they refetch.
      detailCacheRef.current.clear();
      load(); // Refreshes bol_count so the row flips to "View BOL"
    }
  }

  // split-days-02: per-load ship days changed -- drop cached drill-downs and refetch so split rows regroup.
  function handleShipDaysSaved() {
    detailCacheRef.current.clear();
    load();
  }

  function handleShipmentEditClose(saved: boolean) {
    setEditingShipment(null);
    if (saved) {
      // lgx-minimap-01: edits can change address/carrier/loads — drop cached drill-downs so they refetch.
      detailCacheRef.current.clear();
      load();
    }
  }

  // Shared click + keyboard-activation props for the 4 clickable KPI tiles (Task 5) -- opens
  // StatBreakdownModal with the matching key from shipments/route.ts's STAT_PREDICATES map.
  function statTileProps(key: string) {
    return {
      role: "button" as const,
      tabIndex: 0,
      onClick: () => setStatModalKey(key),
      onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setStatModalKey(key);
        }
      },
    };
  }

  // Filtered rows for list view
  const filteredRows = useMemo(() => {
    if (!rows) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return rows;

    return rows.filter((s) => {
      const cust = (s.customer || "").toLowerCase();
      const inv = (s.invoice_number || "").toLowerCase();
      const trailer = (s.trailer_numbers || s.trailer_number || "").toLowerCase();
      const bol = (s.bol_number || "").toLowerCase();
      const carrier = (s.carrier || "").toLowerCase();
      return (
        cust.includes(q) ||
        inv.includes(q) ||
        trailer.includes(q) ||
        bol.includes(q) ||
        carrier.includes(q)
      );
    });
  }, [rows, searchQuery]);

  // Grouped by ship_date for daily breakdown
  const dayGroups = useMemo(() => {
    const map = new Map<string, ShipmentListItem[]>();

    for (const s of filteredRows) {
      const key = (s.day_date ?? s.ship_date) || "No Date";
      const list = map.get(key) ?? [];
      list.push(s);
      map.set(key, list);
    }

    const sortedKeys = Array.from(map.keys()).sort((a, b) => {
      if (a === "No Date") return 1;
      if (b === "No Date") return -1;
      return a.localeCompare(b);
    });

    return sortedKeys.map((dateKey) => ({
      dateKey,
      shipments: map.get(dateKey) ?? [],
    }));
  }, [filteredRows]);

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        title="Logistics · v2"
        currentPath="/v2/logistics"
      />

      <div className="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        {/* Title & Quick Links */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-text">Shipment Dashboard</h1>
            <p className="text-xs text-muted">Manage outbound shipping schedules, trailer loads, and BOL records</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/logistics/load-builder.html"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border)] bg-surface text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] no-underline transition-colors"
            >
              <Truck size={14} className="text-muted" />
              Load Builder
            </a>
            <a
              href="/v2/logistics/loading"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border)] bg-surface text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] no-underline transition-colors"
            >
              Dock Loading
            </a>
            <a
              href="/logistics/bol-email.html"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border)] bg-surface text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] no-underline transition-colors"
            >
              <Mail size={14} className="text-muted" />
              BOL Email Queue
            </a>
            {canSeeInvoiceAnalytics && (
              <a
                href="/v2/logistics/invoice-analytics"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border)] bg-surface text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] no-underline transition-colors"
              >
                <Receipt size={14} className="text-muted" />
                Invoice Analytics
              </a>
            )}
            <LoadingSheetButton mode="day" />
            <ToLoadSheetButton />
            <button
              type="button"
              onClick={load}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] bg-surface text-muted hover:text-text hover:bg-[var(--ghost-bg)] transition-colors cursor-pointer"
              title="Refresh"
              aria-label="Refresh dashboard"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <FuelSurchargeControl canEdit={canEditDashboard} />

        {/* Top KPI Stats Widgets */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <StatTile
            tileProps={statTileProps("outbound_this_week")}
            label="Outbound This Week"
            orders={stats?.outboundThisWeek}
            loads={stats?.outboundThisWeekLoads}
            caption="scheduled Mon–Sun"
            iconWrapClassName="w-10 h-10 rounded-lg bg-[var(--info-bg)]/20 border border-[var(--info-border)] flex items-center justify-center text-[var(--brand)]"
            icon={<Truck size={20} />}
          />
          <StatTile
            tileProps={statTileProps("pending_outbound")}
            label="Pending Outbound"
            orders={stats?.pendingOutbound}
            loads={stats?.pendingOutboundLoads}
            caption="production / ready to ship"
            iconWrapClassName="w-10 h-10 rounded-lg bg-[var(--warn-bg)]/30 border border-[var(--warn-border)] flex items-center justify-center text-[var(--warn-text)]"
            icon={<Clock size={20} />}
          />
          <StatTile
            tileProps={statTileProps("in_transit")}
            label="In Transit"
            orders={stats?.inTransit}
            loads={stats?.inTransitLoads}
            caption="en route to customer"
            iconWrapClassName="w-10 h-10 rounded-lg bg-[var(--success-bg)]/20 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400"
            icon={<Navigation size={20} />}
          />
          <StatTile
            tileProps={statTileProps("delivered_30d")}
            label="Delivered (30d)"
            orders={stats?.delivered30d}
            loads={stats?.delivered30dLoads}
            caption="completed past 30 days"
            iconWrapClassName="w-10 h-10 rounded-lg bg-[var(--ghost-bg)] border border-[var(--border)] flex items-center justify-center text-muted"
            icon={<CheckCircle2 size={20} />}
          />
        </div>

        {/* Toolbar: View Switcher, Week Controls, Search & Filter */}
        <DashboardToolbar
          left={
            <>
              <ViewModeToggle value={viewMode} onChange={setViewMode} />
              {/* Week Toggles (Visible in List View) */}
              {viewMode === "list" && (
                <WeekSelector weekOffset={weekOffset} onChange={setWeekOffset} label={activeWeekInfo?.label} />
              )}
            </>
          }
          right={
            <>
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search customer, invoice, trailer, BOL…"
              />
              <FilterSelect
                value={statusFilter}
                onChange={setStatusFilter}
                allLabel="All Statuses"
                options={SHIPMENT_STATUS_OPTIONS}
              />
            </>
          }
        />

        {/* Error Alert */}
        {error && (
          <div className="rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3 flex items-center justify-between">
            <span>{error}</span>
            <button
              type="button"
              onClick={load}
              className="underline cursor-pointer font-semibold text-xs ml-3"
            >
              Retry
            </button>
          </div>
        )}

        {/* Main Content Area */}
        {loading && !rows ? (
          <div className="rounded-xl border border-[var(--card-border)] bg-surface p-12 text-center text-sm text-muted">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-muted" />
            Loading shipments…
          </div>
        ) : viewMode === "calendar" ? (
          /* Calendar View */
          <ShipmentCalendar
            shipments={calendarRows || rows || []}
            onViewBol={setViewerJobId}
            onGenerateBol={setGenerateJobId}
            onFilterDate={(dateStr) => {
              setSearchQuery(dateStr);
              setViewMode("list");
            }}
          />
        ) : (
          /* Daily Breakdown List View */
          <div className="space-y-6">
            {dayGroups.length === 0 ? (
              <div className="rounded-xl border border-[var(--card-border)] bg-surface p-12 text-center">
                <p className="text-sm font-medium text-text">No outbound shipments found.</p>
                <p className="text-xs text-muted mt-1">
                  {searchQuery
                    ? "Try adjusting your search keywords or clearing filters."
                    : weekOffset === 0
                    ? "No shipments are scheduled for this week. Switch to Next Week or Show All."
                    : "No shipments scheduled for this period."}
                </p>
                {(searchQuery || statusFilter || weekOffset !== 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setStatusFilter("");
                      setWeekOffset(0);
                    }}
                    className="mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--border)] text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] cursor-pointer"
                  >
                    Reset to This Week
                  </button>
                )}
              </div>
            ) : (
              dayGroups.map(({ dateKey, shipments }) => {
                // split-days-02: a split entry contributes its share of the order total (prorated evenly by
                // load -- no per-load BDFT exists yet), so a split order isn't counted in full on every day.
                const hasSplit = shipments.some((s) => s.day_loads);
                const totalBdft = shipments.reduce((sum, s) => {
                  const val = typeof s.total_bdft === "string" ? parseFloat(s.total_bdft) : s.total_bdft;
                  const share = s.day_loads ? s.day_loads.length / Math.max(s.load_count ?? 1, 1) : 1;
                  return sum + (val || 0) * share;
                }, 0);

                return (
                  <div key={dateKey} className="space-y-2">
                    {/* Day Section Header */}
                    <DayGroupHeader
                      dateKey={dateKey}
                      count={shipments.length}
                      noun={["shipment", "shipments"]}
                      extra={
                        totalBdft > 0 && (
                          <span title={hasSplit ? "Split orders prorated evenly by load" : undefined}>
                            <strong className="text-text tabular-nums font-mono">
                              {hasSplit ? "≈" : ""}
                              {totalBdft.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                            </strong>{" "}
                            BDFT
                          </span>
                        )
                      }
                    />

                    {/* Day Table */}
                    <div className="overflow-x-auto rounded-xl border border-[var(--card-border)] bg-surface shadow-xs">
                      <table className="w-full min-w-[900px] table-fixed text-sm">
                        <thead>
                          <tr className="border-b border-[var(--line)] bg-[var(--ghost-bg)] text-left text-xs font-semibold text-muted">
                            <th className="px-3.5 py-2.5 w-[18%]">Customer</th>
                            <th className="px-3.5 py-2.5 w-[10%]">Ship date / time</th>
                            <th className="px-3.5 py-2.5 w-[12%]">Carrier</th>
                            <th className="px-3.5 py-2.5 w-[9%]">Distance / ETA</th>
                            <th className="px-3.5 py-2.5 w-[9%]">Trailer</th>
                            <th className="px-3.5 py-2.5 w-[6%]">BDFT</th>
                            <th className="px-3.5 py-2.5 w-[9%]">BOL #</th>
                            <th className="px-3.5 py-2.5 w-[9%]">Status</th>
                            {/* lgx-rows-01: fixed width = four 38px icons + 3 gaps + cell padding, never wraps. */}
                            <th className="px-3.5 py-2.5 w-[200px] text-right">Actions</th>
                          </tr>
                        </thead>
                        <LinkedTableGroups
                          rows={shipments}
                          colSpan={9}
                          keyOf={(s) => s.entry_key ?? String(s.id)}
                          renderRow={(s) => (
                            <ShipmentRow
                              shipment={s}
                              onViewBol={setViewerJobId}
                              onGenerateBol={setGenerateJobId}
                              onEdit={setEditingShipment}
                              expanded={expandedId === (s.entry_key ?? s.id)}
                              onToggleExpand={handleToggleExpand}
                              detailCache={detailCacheRef.current}
                              canManageLoading={canManageLoading}
                              onShipDaysSaved={handleShipDaysSaved}
                            />
                          )}
                        />
                      </table>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      <BolViewerModal
        jobId={viewerJobId}
        onClose={() => setViewerJobId(null)}
        onEdit={handleEditFromViewer}
        canManageLoading={canManageLoading}
        onDeleted={load}
      />

      <BolGenerateModal
        jobId={generateJobId}
        onClose={handleGenerateDone}
      />

      <BolEditorModal
        target={editorTarget}
        onCancel={handleEditorCancel}
        onSaved={handleEditorSaved}
      />

      <ShipmentEditModal
        shipment={editingShipment}
        canManageLoading={canManageLoading}
        onClose={handleShipmentEditClose}
      />

      <StatBreakdownModal
        statKey={statModalKey}
        label={statModalKey ? STAT_LABELS[statModalKey] ?? "" : ""}
        onClose={() => setStatModalKey(null)}
      />
    </div>
  );
}

