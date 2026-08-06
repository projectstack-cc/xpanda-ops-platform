"use client";
// src/components/board/ProductionBoard.tsx
// Production board consuming GET /v2/api/board. Board rows themselves stay read-only; Edit
// expands an inline panel (BoardRowEdit, P343) scoped to the locked editable subset (ship_date,
// priority(+level), notes, status) plus assignment — everything else on the order is read-only
// here and edited in /v2/orders.
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import PlatformHeader from "@/components/PlatformHeader";
import StatusCards, { type StatusBucket } from "./StatusCards";
import StatusModal from "./StatusModal";
import OrderDetailModal from "./OrderDetailModal";
import BoardRowEdit from "./BoardRowEdit";
import { JobStatusBadge, PriorityBadge } from "./badges";

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
  const [detailId, setDetailId] = useState<string | null>(null);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

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

  function handleSelectFromModal(jobId: string) {
    setActiveBucket(null);
    const row = rowRefs.current[jobId];
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(jobId);
    window.setTimeout(() => setHighlightedId((cur) => (cur === jobId ? null : cur)), 2000);
  }

  const bucketTitles: Record<StatusBucket, string> = {
    open: "Open jobs",
    cutting: "Cutting",
    loading: "Loading",
  };

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Production board · v2" currentPath="/v2/board" />

      <div className="flex-1 w-full max-w-screen-2xl mx-auto px-4 py-6 space-y-6">
        <h1 className="text-xl font-semibold text-text">Production board</h1>

        {error && (
          <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-4 py-3">
            {error}
            <button type="button" onClick={load} className="ml-3 underline cursor-pointer">
              Retry
            </button>
          </div>
        )}

        {loading && !data && <p className="text-sm text-muted">Loading board…</p>}

        {data && (
          <>
            <StatusCards counts={data.counts} onSelect={setActiveBucket} />

            <div className="overflow-x-auto rounded-xl border border-[var(--card-border)] bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left text-xs font-semibold text-muted">
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Ship-to</th>
                    <th className="px-3 py-2">Ship date</th>
                    <th className="px-3 py-2">Priority</th>
                    <th className="px-3 py-2">Assigned</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.jobs.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted">
                        No active jobs.
                      </td>
                    </tr>
                  )}
                  {data.jobs.map((job) => (
                    <Fragment key={job.id}>
                      <tr
                        ref={(el) => {
                          rowRefs.current[job.id] = el;
                        }}
                        className={`border-b border-[var(--line)] last:border-0 transition-colors cursor-pointer hover:bg-[var(--ghost-bg)] ${
                          highlightedId === job.id ? "bg-[var(--info-bg)]" : ""
                        }`}
                        onClick={() => setDetailId(job.id)}
                      >
                        <td className="px-3 py-3">
                          <div className="font-medium text-text">{job.customer || "—"}</div>
                          <div className="text-xs text-muted">{job.invoice_number ? `INV# ${job.invoice_number}` : "No INV#"}</div>
                        </td>
                        <td className="px-3 py-3 text-muted">
                          {job.ship_to_city ? `${job.ship_to_city}${job.ship_to_state ? `, ${job.ship_to_state}` : ""}` : "—"}
                        </td>
                        <td className="px-3 py-3 text-muted font-mono tabular-nums">{job.ship_date || "—"}</td>
                        <td className="px-3 py-3">
                          <PriorityBadge priority={job.priority} priorityLevel={job.priority_level} />
                        </td>
                        <td className="px-3 py-3 text-muted">
                          {job.assignees.length ? job.assignees.join(", ") : "Unassigned"}
                        </td>
                        <td className="px-3 py-3">
                          <JobStatusBadge status={job.status} />
                        </td>
                        <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => toggleExpand(job.id)}
                            className="min-h-[36px] px-3 rounded-md border border-[var(--input-border)] text-text text-xs font-semibold cursor-pointer hover:bg-[var(--ghost-bg)]"
                          >
                            {expandedId === job.id ? "Close" : "Edit"}
                          </button>
                        </td>
                      </tr>
                      {expandedId === job.id && (
                        <tr>
                          <td colSpan={7} className="p-0">
                            <BoardRowEdit
                              job={job}
                              assignableUsers={assignableUsers}
                              onCancel={() => setExpandedId(null)}
                              onSaved={() => {
                                setExpandedId(null);
                                load();
                              }}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
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

      <OrderDetailModal jobId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
