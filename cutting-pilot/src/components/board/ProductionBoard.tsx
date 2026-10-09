"use client";
// src/components/board/ProductionBoard.tsx
// P439 — Job Board (/v2/board) consuming GET /v2/api/board. Three affordances per row, matching
// the legacy job-board UX:
//   1. Clicking a row (or the row's Edit button) — expands the inline BoardRowEdit panel
//      (P343) for the locked editable subset (ship_date / priority(+level) / notes / status
//      + assignment chips). The same panel that shipped pre-P439, with the "Open in order
//      entry →" link removed (the OrderEditModal now covers that surface inline).
//   2. Edit button — opens OrderEditModal, the new full in-place edit modal (P439). Mirrors
//      what the legacy /jobs/ "Edit Job" modal edits (customer, PO, INV, ship-to,
//      cutting/packing instructions, line items, shifts, etc.) — POSTs to PUT
//      /v2/api/orders/:id.
//   3. View button — opens OrderDetailModal, the read-only viewer (shipping + line items +
//      cut-list + packing-slip dropdowns). Mirrors the previous behavior.
// board-ui-01: renamed "Job Board" (legacy parity) and rebuilt on the shared dashboard kit to
// mirror /v2/logistics — title block, StatTile status cards, toolbar (List/Calendar, week
// selector, search, status filter), and day-grouped tables. Filtering is client-side, list only.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import DashboardToolbar from "@/components/dashboard/DashboardToolbar";
import ViewModeToggle from "@/components/dashboard/ViewModeToggle";
import WeekSelector from "@/components/dashboard/WeekSelector";
import SearchInput from "@/components/dashboard/SearchInput";
import FilterSelect from "@/components/dashboard/FilterSelect";
import DayGroupHeader from "@/components/dashboard/DayGroupHeader";
import { fmtShortDate, getMondayForOffset, toIsoDate, weekRange } from "@/lib/week";
import StatusCards, { type StatusBucket } from "./StatusCards";
import StatusModal from "./StatusModal";
import OrderDetailModal from "./OrderDetailModal";
import OrderEditModal from "./OrderEditModal";
import BolViewerModal from "@/components/logistics/BolViewerModal";
import CalendarView from "./CalendarView";
import BoardRowEdit from "./BoardRowEdit";
import LinkedTableGroups from "@/components/linked/LinkedTableGroups";
import { JobStatusBadge, PriorityBadge, STATUS_VARIANTS } from "./badges";
import LinePills from "./LinePills";
import { PROCESSES, type JobProcess } from "@/lib/processes";

export interface BoardJob {
  id: string;
  customer: string | null;
  po_number: string | null;
  invoice_number: string | null;
  status: string;
  priority: string | null;
  priority_level: number | null;
  ship_date: string | null;
  notes: string | null;
  cutting_instructions: string | null;
  packing_instructions: string | null;
  ship_to_company: string | null;
  ship_to_attention: string | null;
  ship_to_street: string | null;
  ship_to_city: string | null;
  ship_to_state: string | null;
  ship_to_zip: string | null;
  in_cutting: boolean;
  is_loading: boolean;
  assignees: string[];
  processes: JobProcess[];
  // jb-06: trailer-group candidates in the edit modal (legacy filter needs it).
  trailer_group_id: string | null;
}

interface AssignableUser {
  id: string;
  name: string;
  username: string;
}

interface BoardResponse {
  jobs: BoardJob[];
  counts: { open: number; cutting: number; loading: number };
}

interface ProductionBoardProps {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

// The only statuses GET /v2/api/board returns.
const BOARD_STATUS_OPTIONS = ["not_started", "in_production", "done", "loading"].map((value) => ({
  value,
  label: STATUS_VARIANTS[value].label,
}));

// quickwin-02: cutting-line filter. Process names are data values — never translate/rename them.
const BOARD_LINE_OPTIONS = [
  { value: "__none__", label: "No lines assigned" },
  ...PROCESSES.map((p) => ({ value: p.name, label: p.name })),
];

const actionBtnClass =
  "inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border)] bg-surface text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] cursor-pointer";

function isOpenStatus(status: string) {
  return status === "not_started" || status === "in_production";
}

export default function ProductionBoard({ userName, isAdmin, permissions }: ProductionBoardProps) {
  const [data, setData] = useState<BoardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeBucket, setActiveBucket] = useState<StatusBucket | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [bolJobId, setBolJobId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  // jb-10: same manager rule as the shifts routes (server enforces 403 too).
  const canManageShifts = isAdmin || !!permissions["jobs.manage"]?.edit;
  const canChangeStatus = isAdmin || !!permissions["jobs.status"]?.edit;

  // Week offset: 0 = This Week (default), 1 = Next Week, null = Show All — logistics parity.
  const [weekOffset, setWeekOffset] = useState<number | null>(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [lineFilter, setLineFilter] = useState("");
  // Set when a status-modal pick targets a row that wasn't rendered; scrolled to after re-render.
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);

  const activeWeekInfo = useMemo(() => {
    if (weekOffset === null) return null;
    return getMondayForOffset(weekOffset);
  }, [weekOffset]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/board");
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || "Couldn't load the board.");
        return;
      }
      setError(null);
      setData({ jobs: json.jobs ?? [], counts: json.counts ?? { open: 0, cutting: 0, loading: 0 } });
    } catch {
      setError("Network error — couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // jb-01: deep link — /v2/board?job=<id> opens that job's read-only detail modal. Uses
  // OrderDetailModal's own GET /v2/api/board/:id fetch, so it works even when the job is outside
  // the current week, filtered out, or archived. The param is stripped so a refresh/back doesn't reopen.
  useEffect(() => {
    const url = new URL(window.location.href);
    const jobParam = url.searchParams.get("job");
    if (!jobParam) return;
    setViewId(jobParam);
    url.searchParams.delete("job");
    window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
  }, []);

  async function toggleExpand(jobId: string) {
    if (expandedId === jobId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(jobId);
    // Lazy, cached once — the assignable-users list rarely changes within a session.
    if (assignableUsers.length === 0) {
      try {
        const res = await fetch("/api/assignable-users");
        const data = await res.json();
        if (res.ok && data.ok) setAssignableUsers(data.users || []);
      } catch {
        // Non-fatal — the panel still allows removing existing assignees without this list.
      }
    }
  }

  function bucketJobs(bucket: StatusBucket): BoardJob[] {
    if (!data) return [];
    if (bucket === "open") return data.jobs.filter((j) => isOpenStatus(j.status));
    if (bucket === "cutting") return data.jobs.filter((j) => j.in_cutting);
    return data.jobs.filter((j) => j.is_loading);
  }

  function scrollToAndHighlight(jobId: string) {
    const row = rowRefs.current[jobId];
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(jobId);
    window.setTimeout(() => setHighlightedId((cur) => (cur === jobId ? null : cur)), 2000);
  }

  function handleSelectFromModal(jobId: string) {
    setActiveBucket(null);
    if (rowRefs.current[jobId]) {
      scrollToAndHighlight(jobId);
      return;
    }
    // board-ui-01: the row is filtered out, in another week, or the calendar is showing — widen
    // the list to everything, then scroll once it has rendered.
    setSearchQuery("");
    setStatusFilter("");
    setLineFilter("");
    setWeekOffset(null);
    setView("list");
    setPendingScrollId(jobId);
  }

  useEffect(() => {
    if (!pendingScrollId) return;
    const jobId = pendingScrollId;
    const raf = window.requestAnimationFrame(() => {
      setPendingScrollId(null);
      scrollToAndHighlight(jobId);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [pendingScrollId]);

  const bucketTitles: Record<StatusBucket, string> = {
    open: "Open jobs",
    cutting: "Cutting",
    loading: "Loading",
  };

  // Client-side list filtering: status → search → week. Show All keeps null ship dates.
  const filteredJobs = useMemo(() => {
    if (!data) return [];
    let jobs = data.jobs;
    if (statusFilter) jobs = jobs.filter((j) => j.status === statusFilter);
    if (lineFilter === "__none__") jobs = jobs.filter((j) => j.processes.length === 0);
    else if (lineFilter) jobs = jobs.filter((j) => j.processes.some((p) => p.name === lineFilter));
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      jobs = jobs.filter((j) =>
        [
          j.customer,
          j.invoice_number,
          j.po_number,
          j.ship_to_company,
          j.ship_to_city,
          j.ship_to_state,
          j.assignees.join(" "),
          // board-lines-01: match line names + abbreviations ("BL", "Blue").
          j.processes.map((p) => `${p.name} ${PROCESSES.find((d) => d.name === p.name)?.abbr ?? ""}`).join(" "),
        ].some((v) => (v || "").toLowerCase().includes(q))
      );
    }
    if (weekOffset !== null) {
      const { start, end } = weekRange(weekOffset);
      jobs = jobs.filter((j) => {
        const iso = toIsoDate(j.ship_date);
        return !!iso && iso >= start && iso <= end;
      });
    }
    return jobs;
  }, [data, statusFilter, lineFilter, searchQuery, weekOffset]);

  // Grouped by ship date; "No Date" last. Within a day, the API's order (priority_level DESC).
  const dayGroups = useMemo(() => {
    const map = new Map<string, BoardJob[]>();
    for (const j of filteredJobs) {
      const key = toIsoDate(j.ship_date) ?? "No Date";
      const list = map.get(key) ?? [];
      list.push(j);
      map.set(key, list);
    }
    const sortedKeys = Array.from(map.keys()).sort((a, b) => {
      if (a === "No Date") return 1;
      if (b === "No Date") return -1;
      return a.localeCompare(b);
    });
    return sortedKeys.map((dateKey) => ({ dateKey, jobs: map.get(dateKey) ?? [] }));
  }, [filteredJobs]);

  return (
    <div className="min-h-screen flex flex-col bg-bg text-text">
      <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Job board · v2" currentPath="/v2/board" />

      <div className="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-6 space-y-5">
        {/* Title */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-text">Job Board</h1>
            <p className="text-xs text-muted">Track orders from intake through production to loading</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={load}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-[var(--border)] bg-surface text-muted hover:text-text hover:bg-[var(--ghost-bg)] transition-colors cursor-pointer"
              title="Refresh"
              aria-label="Refresh board"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        {data && <StatusCards counts={data.counts} onSelect={setActiveBucket} />}

        {/* Toolbar: View Switcher, Week Controls, Search & Filter */}
        <DashboardToolbar
          left={
            <>
              <ViewModeToggle value={view} onChange={setView} />
              {view === "list" && (
                <WeekSelector weekOffset={weekOffset} onChange={setWeekOffset} label={activeWeekInfo?.label} />
              )}
            </>
          }
          right={
            <>
              <SearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search customer, INV#, PO#, ship-to, assignee…"
              />
              <FilterSelect
                value={statusFilter}
                onChange={setStatusFilter}
                allLabel="All Statuses"
                options={BOARD_STATUS_OPTIONS}
              />
              <FilterSelect
                value={lineFilter}
                onChange={setLineFilter}
                allLabel="All Lines"
                options={BOARD_LINE_OPTIONS}
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
        {loading && !data ? (
          <div className="rounded-xl border border-[var(--card-border)] bg-surface p-12 text-center text-sm text-muted">
            <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-muted" />
            Loading jobs…
          </div>
        ) : view === "calendar" ? (
          <CalendarView jobs={data?.jobs ?? []} onSelectJob={setViewId} />
        ) : (
          /* Daily Breakdown List View */
          <div className="space-y-6">
            {dayGroups.length === 0 ? (
              <div className="rounded-xl border border-[var(--card-border)] bg-surface p-12 text-center">
                <p className="text-sm font-medium text-text">No jobs found.</p>
                <p className="text-xs text-muted mt-1">
                  {searchQuery
                    ? "Try adjusting your search keywords or clearing filters."
                    : weekOffset === 0
                    ? "No jobs are scheduled for this week. Switch to Next Week or Show All."
                    : "No jobs scheduled for this period."}
                </p>
                {(searchQuery || statusFilter || lineFilter || weekOffset !== 0) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery("");
                      setStatusFilter("");
                      setLineFilter("");
                      setWeekOffset(0);
                    }}
                    className="mt-4 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-[var(--border)] text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] cursor-pointer"
                  >
                    Reset to This Week
                  </button>
                )}
              </div>
            ) : (
              dayGroups.map(({ dateKey, jobs }) => (
                <div key={dateKey} className="space-y-2">
                  <DayGroupHeader dateKey={dateKey} count={jobs.length} noun={["job", "jobs"]} />

                  {/* Day Table */}
                  <div className="overflow-x-auto rounded-xl border border-[var(--card-border)] bg-surface shadow-xs">
                    <table className="w-full min-w-[900px] table-fixed text-sm">
                      <thead>
                        <tr className="border-b border-[var(--line)] bg-[var(--ghost-bg)] text-left text-xs font-semibold text-muted">
                          <th className="px-3.5 py-2.5 w-[19%]">Customer</th>
                          <th className="px-3.5 py-2.5 w-[13%]">Ship-to</th>
                          <th className="px-3.5 py-2.5 w-[10%]">Ship date</th>
                          <th className="px-3.5 py-2.5 w-[8%]">Priority</th>
                          <th className="px-3.5 py-2.5 w-[13%]">Assigned</th>
                          <th className="px-3.5 py-2.5 w-[12%]">Lines</th>
                          <th className="px-3.5 py-2.5 w-[10%]">Status</th>
                          {/* Fixed width = two buttons + gap + cell padding, never wraps. */}
                          <th className="px-3.5 py-2.5 w-[160px] text-right">Actions</th>
                        </tr>
                      </thead>
                      <LinkedTableGroups
                        rows={jobs}
                        colSpan={8}
                        keyOf={(job) => job.id}
                        renderRow={(job) => (
                          <>
                            <tr
                              ref={(el) => {
                                rowRefs.current[job.id] = el;
                              }}
                              className={`border-b border-[var(--line)] last:border-0 transition-colors cursor-pointer hover:bg-[var(--ghost-bg)] ${
                                highlightedId === job.id ? "bg-[var(--info-bg)]" : ""
                              }`}
                              onClick={() => toggleExpand(job.id)}
                            >
                              <td className="px-3 py-[8.8px] align-top">
                                <div className="font-medium text-text truncate">{job.customer || "—"}</div>
                                <div className="flex items-center gap-1 text-xs text-muted">
                                  {expandedId === job.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                  {job.invoice_number ? `INV# ${job.invoice_number}` : "No INV#"}
                                </div>
                              </td>
                              <td className="px-3 py-[8.8px] align-top text-muted">
                                {job.ship_to_city ? `${job.ship_to_city}${job.ship_to_state ? `, ${job.ship_to_state}` : ""}` : "—"}
                              </td>
                              <td className="px-3 py-[8.8px] align-top text-muted tabular-nums">{fmtShortDate(job.ship_date)}</td>
                              <td className="px-3 py-[8.8px] align-top">
                                <PriorityBadge priority={job.priority} priorityLevel={job.priority_level} />
                              </td>
                              <td className="px-3 py-[8.8px] align-top text-muted">
                                {job.assignees.length ? job.assignees.join(", ") : "Unassigned"}
                              </td>
                              <td className="px-3 py-[8.8px] align-top">
                                <LinePills processes={job.processes} />
                              </td>
                              <td className="px-3 py-[8.8px] align-top">
                                <JobStatusBadge status={job.status} />
                              </td>
                              <td className="px-3 py-[8.8px] align-top text-right" onClick={(e) => e.stopPropagation()}>
                                <div className="inline-flex items-center gap-2 justify-end">
                                  <button type="button" onClick={() => setViewId(job.id)} className={actionBtnClass}>
                                    View
                                  </button>
                                  <button type="button" onClick={() => setEditId(job.id)} className={actionBtnClass}>
                                    Edit
                                  </button>
                                </div>
                              </td>
                            </tr>
                            {expandedId === job.id && (
                              <tr>
                                <td colSpan={8} className="p-0">
                                  <BoardRowEdit
                                    job={job}
                                    assignableUsers={assignableUsers}
                                    canManageShifts={canManageShifts}
                                    canChangeStatus={canChangeStatus}
                                    onCancel={() => setExpandedId(null)}
                                    onSaved={() => {
                                      setExpandedId(null);
                                      load();
                                    }}
                                  />
                                </td>
                              </tr>
                            )}
                          </>
                        )}
                      />
                    </table>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {activeBucket && (
        <StatusModal
          isOpen={!!activeBucket}
          onClose={() => setActiveBucket(null)}
          title={bucketTitles[activeBucket]}
          jobs={bucketJobs(activeBucket)}
          onSelectJob={handleSelectFromModal}
        />
      )}

      <OrderDetailModal jobId={viewId} onClose={() => setViewId(null)} onViewBol={setBolJobId} />
      {/* jb-02: mounted after OrderDetailModal so it stacks above it (same z-50, later DOM wins). */}
      <BolViewerModal jobId={bolJobId} onClose={() => setBolJobId(null)} viewOnly onEdit={() => {}} />

      <OrderEditModal
        jobId={editId}
        onClose={() => setEditId(null)}
        onSaved={load}
        boardJobs={data?.jobs ?? []}
        isAdmin={isAdmin}
        permissions={permissions}
      />
    </div>
  );
}
