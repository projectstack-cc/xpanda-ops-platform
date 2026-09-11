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
  Search,
  X,
  Calendar as CalendarIcon,
  List as ListIcon,
  ChevronLeft,
  ChevronRight,
  Truck,
  CheckCircle2,
  Clock,
  Navigation,
  RefreshCw,
} from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import ShipmentRow from "@/components/logistics/ShipmentRow";
import ShipmentCalendar from "./ShipmentCalendar";
import BolViewerModal from "@/components/logistics/BolViewerModal";
import BolGenerateModal from "@/components/logistics/BolGenerateModal";
import BolEditorModal, { type EditorTarget } from "@/components/logistics/BolEditorModal";
import ShipmentEditModal from "@/components/logistics/ShipmentEditModal";
import StatBreakdownModal from "@/components/logistics/StatBreakdownModal";
import type { ShipmentListItem, LogisticsStats } from "@/components/logistics/types";
import type { BolRecord } from "@/lib/bolShared";

interface ShipmentDashboardProps {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

function getMondayForOffset(offset: number): { mondayStr: string; label: string } {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMon + offset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const mondayStr = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
  const startLabel = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endLabel = sunday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return { mondayStr, label: `${startLabel} – ${endLabel}` };
}

function formatDayHeader(dateStr: string): { title: string; isToday: boolean } {
  if (!dateStr || dateStr === "No Date") {
    return { title: "Unscheduled / No Date", isToday: false };
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return { title: dateStr, isToday: false };

  const date = new Date(y, m - 1, d);
  const now = new Date();
  const isToday =
    now.getFullYear() === y && now.getMonth() === m - 1 && now.getDate() === d;

  const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
  const formatted = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return { title: `${weekday} — ${formatted}`, isToday };
}

// Matches shipments/route.ts's STAT_PREDICATES keys exactly -- the KPI tile drilldown
// (StatBreakdownModal) fetches GET /v2/api/shipments?stat=<key> with these.
const STAT_LABELS: Record<string, string> = {
  outbound_this_week: "Outbound This Week",
  pending_outbound: "Pending Outbound",
  in_transit: "In Transit",
  delivered_30d: "Delivered (30d)",
};

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

  // Mirrors DockBoard.tsx's existing client-side pattern for this exact permission key -- the
  // Shipment Edit Modal gates Trailer # editability on it, matching the server's
  // X-User-Can-Manage-Loading check in shipments/[id]/route.ts.
  const canManageLoading = isAdmin || permissions?.["logistics.loading.manage"]?.edit === true;

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

    const pendingIds = rows
      .filter((r) => r.distance_status === "pending" && !warmAttemptedRef.current.has(r.id))
      .map((r) => r.id);
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
      load(); // Refreshes bol_count so the row flips to "View BOL"
    }
  }

  function handleShipmentEditClose(saved: boolean) {
    setEditingShipment(null);
    if (saved) {
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
      const trailer = (s.trailer_number || "").toLowerCase();
      const bol = (s.bol_number || "").toLowerCase();
      const carrier = (s.carrier || "").toLowerCase();
      const method = (s.method || "").toLowerCase();
      return (
        cust.includes(q) ||
        inv.includes(q) ||
        trailer.includes(q) ||
        bol.includes(q) ||
        carrier.includes(q) ||
        method.includes(q)
      );
    });
  }, [rows, searchQuery]);

  // Grouped by ship_date for daily breakdown
  const dayGroups = useMemo(() => {
    const map = new Map<string, ShipmentListItem[]>();

    for (const s of filteredRows) {
      const key = s.ship_date || "No Date";
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

        {/* Top KPI Stats Widgets */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <div
            {...statTileProps("outbound_this_week")}
            className="bg-surface border border-[var(--card-border)] rounded-xl p-4 shadow-sm flex items-center justify-between cursor-pointer hover:border-[var(--brand)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            <div>
              <div className="text-xs font-semibold text-muted uppercase tracking-wider">Outbound This Week</div>
              <div className="text-2xl font-bold tabular-nums text-text mt-1">
                {stats?.outboundThisWeek ?? "—"}
              </div>
              <div className="text-[11px] text-muted mt-0.5">scheduled Mon–Sun</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-[var(--info-bg)]/20 border border-[var(--info-border)] flex items-center justify-center text-[var(--brand)]">
              <Truck size={20} />
            </div>
          </div>

          <div
            {...statTileProps("pending_outbound")}
            className="bg-surface border border-[var(--card-border)] rounded-xl p-4 shadow-sm flex items-center justify-between cursor-pointer hover:border-[var(--brand)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            <div>
              <div className="text-xs font-semibold text-muted uppercase tracking-wider">Pending Outbound</div>
              <div className="text-2xl font-bold tabular-nums text-text mt-1">
                {stats?.pendingOutbound ?? "—"}
              </div>
              <div className="text-[11px] text-muted mt-0.5">production / ready to ship</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-[var(--warn-bg)]/30 border border-[var(--warn-border)] flex items-center justify-center text-[var(--warn-text)]">
              <Clock size={20} />
            </div>
          </div>

          <div
            {...statTileProps("in_transit")}
            className="bg-surface border border-[var(--card-border)] rounded-xl p-4 shadow-sm flex items-center justify-between cursor-pointer hover:border-[var(--brand)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            <div>
              <div className="text-xs font-semibold text-muted uppercase tracking-wider">In Transit</div>
              <div className="text-2xl font-bold tabular-nums text-text mt-1">
                {stats?.inTransit ?? "—"}
              </div>
              <div className="text-[11px] text-muted mt-0.5">en route to customer</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-[var(--success-bg)]/20 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Navigation size={20} />
            </div>
          </div>

          <div
            {...statTileProps("delivered_30d")}
            className="bg-surface border border-[var(--card-border)] rounded-xl p-4 shadow-sm flex items-center justify-between cursor-pointer hover:border-[var(--brand)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            <div>
              <div className="text-xs font-semibold text-muted uppercase tracking-wider">Delivered (30d)</div>
              <div className="text-2xl font-bold tabular-nums text-text mt-1">
                {stats?.delivered30d ?? "—"}
              </div>
              <div className="text-[11px] text-muted mt-0.5">completed past 30 days</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-[var(--ghost-bg)] border border-[var(--border)] flex items-center justify-center text-muted">
              <CheckCircle2 size={20} />
            </div>
          </div>
        </div>

        {/* Toolbar: View Switcher, Week Controls, Search & Filter */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-surface border border-[var(--card-border)] rounded-xl p-3 shadow-sm">
          {/* Left: View Mode Toggle + Week Controls */}
          <div className="flex flex-wrap items-center gap-2">
            {/* View Mode Buttons */}
            <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5 bg-[var(--ghost-bg)]">
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  viewMode === "list"
                    ? "bg-surface text-text shadow-xs"
                    : "text-muted hover:text-text"
                }`}
              >
                <ListIcon size={14} />
                List
              </button>
              <button
                type="button"
                onClick={() => setViewMode("calendar")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                  viewMode === "calendar"
                    ? "bg-surface text-text shadow-xs"
                    : "text-muted hover:text-text"
                }`}
              >
                <CalendarIcon size={14} />
                Calendar
              </button>
            </div>

            {/* Week Toggles (Visible in List View) */}
            {viewMode === "list" && (
              <div className="flex items-center gap-1 ml-1">
                <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5 bg-[var(--ghost-bg)]">
                  <button
                    type="button"
                    onClick={() => setWeekOffset(0)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      weekOffset === 0
                        ? "bg-[var(--brand)] text-white shadow-xs"
                        : "text-muted hover:text-text"
                    }`}
                  >
                    This Week
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeekOffset(1)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      weekOffset === 1
                        ? "bg-[var(--brand)] text-white shadow-xs"
                        : "text-muted hover:text-text"
                    }`}
                  >
                    Next Week
                  </button>
                  <button
                    type="button"
                    onClick={() => setWeekOffset(null)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      weekOffset === null
                        ? "bg-surface text-text shadow-xs"
                        : "text-muted hover:text-text"
                    }`}
                  >
                    Show All
                  </button>
                </div>

                {weekOffset !== null && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setWeekOffset((prev) => (prev ?? 0) - 1)}
                      className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-muted hover:text-text hover:bg-[var(--ghost-bg)] cursor-pointer"
                      title="Previous week"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span className="text-xs font-medium text-text px-1">
                      {activeWeekInfo?.label}
                    </span>
                    <button
                      type="button"
                      onClick={() => setWeekOffset((prev) => (prev ?? 0) + 1)}
                      className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-muted hover:text-text hover:bg-[var(--ghost-bg)] cursor-pointer"
                      title="Next week"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right: Search Box & Status Filter */}
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Search Input */}
            <div className="relative flex-1 md:w-64">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search customer, invoice, trailer, BOL…"
                className="w-full h-9 pl-9 pr-8 text-xs rounded-lg border border-[var(--border)] bg-surface text-text placeholder:text-muted focus:outline-hidden focus:border-[var(--brand)] transition-colors"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text text-sm cursor-pointer"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Status Select */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 px-3 text-xs rounded-lg border border-[var(--border)] bg-surface text-text focus:outline-hidden focus:border-[var(--brand)] cursor-pointer"
            >
              <option value="">All Statuses</option>
              <option value="not_started">Not Started</option>
              <option value="in_production">In Production</option>
              <option value="ready_to_ship">Ready to Ship</option>
              <option value="loading">Loading</option>
              <option value="loaded">Loaded</option>
              <option value="in_transit">In Transit</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
        </div>

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
                const { title, isToday } = formatDayHeader(dateKey);
                const totalBdft = shipments.reduce((sum, s) => {
                  const val = typeof s.total_bdft === "string" ? parseFloat(s.total_bdft) : s.total_bdft;
                  return sum + (val || 0);
                }, 0);

                return (
                  <div key={dateKey} className="space-y-2">
                    {/* Day Section Header */}
                    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-bold text-text flex items-center gap-2">
                          {title}
                          {isToday && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-[var(--brand)] text-white">
                              Today
                            </span>
                          )}
                        </h2>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted">
                        <span>
                          <strong className="text-text tabular-nums">{shipments.length}</strong>{" "}
                          {shipments.length === 1 ? "shipment" : "shipments"}
                        </span>
                        {totalBdft > 0 && (
                          <span>
                            <strong className="text-text tabular-nums font-mono">
                              {totalBdft.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                            </strong>{" "}
                            BDFT
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Day Table */}
                    <div className="overflow-x-auto rounded-xl border border-[var(--card-border)] bg-surface shadow-xs">
                      <table className="w-full min-w-[900px] table-fixed text-sm">
                        <thead>
                          <tr className="border-b border-[var(--line)] bg-[var(--ghost-bg)] text-left text-xs font-semibold text-muted">
                            <th className="px-3.5 py-2.5 w-[22%]">Customer</th>
                            <th className="px-3.5 py-2.5 w-[10%]">Ship date</th>
                            <th className="px-3.5 py-2.5 w-[14%]">Method / Carrier</th>
                            <th className="px-3.5 py-2.5 w-[10%]">Distance / ETA</th>
                            <th className="px-3.5 py-2.5 w-[9%]">Trailer</th>
                            <th className="px-3.5 py-2.5 w-[7%]">BDFT</th>
                            <th className="px-3.5 py-2.5 w-[10%]">BOL #</th>
                            <th className="px-3.5 py-2.5 w-[10%]">Status</th>
                            <th className="px-3.5 py-2.5 w-[8%] text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shipments.map((s) => (
                            <ShipmentRow
                              key={s.id}
                              shipment={s}
                              onViewBol={setViewerJobId}
                              onGenerateBol={setGenerateJobId}
                              onEdit={setEditingShipment}
                            />
                          ))}
                        </tbody>
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

