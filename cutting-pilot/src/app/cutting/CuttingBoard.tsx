"use client";
import { useState, useEffect } from "react";
import { AlertCircle, X } from "lucide-react";
import Sheet from "@/components/Sheet";
import JobRow from "./JobRow";
import LineRow from "./LineRow";
import HandoffModal from "./HandoffModal";
import type { CuttingJob } from "./types";

interface Props {
  userId: string;
  userName: string;
  isAdmin: boolean;
}

export default function CuttingBoard({ userId: _userId, userName, isAdmin: _isAdmin }: Props) {
  const [queue, setQueue] = useState<CuttingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [clockOutTarget, setClockOutTarget] = useState<{
    sessionId: string;
    line: string;
  } | null>(null);
  const [acting, setActing] = useState(false);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  async function fetchQueue(silent = false) {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch("/v2/api/cutting/queue");
      const data = await res.json();
      if (data.ok) {
        setQueue(data.queue);
      } else {
        setError(data.error || "Failed to load queue.");
      }
    } catch {
      setError("Network error — check connection.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    fetchQueue();
  }, []);

  const selectedJob = queue.find((j) => j.id === selectedJobId) ?? null;

  async function clockIn(jobId: string, line: string) {
    setActing(true);
    try {
      const res = await fetch("/v2/api/cutting/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, line }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`Clocked in to ${line}.`);
        await fetchQueue(true);
      } else if (data.error === "line_busy") {
        showToast(`${line} is already in use by ${data.operator}.`, false);
      } else {
        showToast(data.error || "Clock-in failed.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  function openClockOut(sessionId: string, line: string) {
    setClockOutTarget({ sessionId, line });
  }

  async function submitClockOut(note: string, qty?: number) {
    if (!clockOutTarget) return;
    setActing(true);
    try {
      const body: Record<string, unknown> = {
        session_id: clockOutTarget.sessionId,
        handoff_note: note,
      };
      if (qty !== undefined) body.qty_done_delta = qty;

      const res = await fetch("/v2/api/cutting/clock-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`Clocked out of ${clockOutTarget.line}.`);
        setClockOutTarget(null);
        await fetchQueue(true);
      } else {
        showToast(data.error || "Clock-out failed.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  async function completeLine(jobId: string, line: string) {
    if (!window.confirm(`Mark ${line} complete? This cannot be undone.`)) return;
    setActing(true);
    try {
      const res = await fetch("/v2/api/cutting/complete-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, line }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(
          data.all_lines_complete
            ? `${line} complete — all lines done, job marked done.`
            : `${line} marked complete.`
        );
        await fetchQueue(true);
      } else {
        showToast(data.error || "Failed.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  // Loading: skeleton rows instead of a centered spinner
  if (loading) {
    return (
      <div className="h-screen flex flex-col bg-bg overflow-hidden">
        <AppHeader userName={userName} />
        <div className="flex flex-1 overflow-hidden">
          <nav className="w-full md:w-72 md:shrink-0 bg-surface md:border-r md:border-border overflow-y-auto">
            <QueueHeader count={0} />
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="border-b border-border px-4 py-3 animate-pulse motion-reduce:animate-none">
                <div className="h-3 bg-[var(--ghost-bg)] rounded w-24 mb-2" />
                <div className="h-4 bg-[var(--ghost-bg)] rounded w-40 mb-2" />
                <div className="h-3 bg-[var(--ghost-bg)] rounded w-20" />
              </div>
            ))}
          </nav>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      {/* Toast notification */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={[
            "fixed top-4 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded text-sm font-medium pointer-events-none",
            toast.ok
              ? "bg-[var(--success-bg)] text-[var(--success-text)]"
              : "bg-[var(--danger-bg)] text-[var(--danger-text)]",
          ].join(" ")}
        >
          {toast.msg}
        </div>
      )}

      <AppHeader userName={userName} />

      <div className="flex flex-1 overflow-hidden">
        {/* Job list — left column */}
        <nav
          aria-label="Job list"
          className="w-full md:w-72 md:shrink-0 bg-surface md:border-r md:border-border overflow-y-auto"
        >
          <QueueHeader count={queue.length} />

          {/* Inline error with retry */}
          {error && (
            <div className="px-4 py-4">
              <div className="border border-border rounded px-3 py-3 space-y-1.5">
                <div className="flex items-start gap-2">
                  <AlertCircle
                    size={14}
                    className="text-[var(--danger-bg)] shrink-0 mt-0.5"
                    aria-hidden="true"
                  />
                  <p className="text-sm text-[var(--danger-bg)] font-medium">{error}</p>
                </div>
                <button
                  type="button"
                  onClick={() => fetchQueue()}
                  className="text-xs text-muted underline underline-offset-2 cursor-pointer hover:text-text"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Designed empty state */}
          {!error && queue.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted">
              No jobs need cutting — check the Job Board.
            </p>
          )}

          {queue.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              isActive={job.id === selectedJobId}
              onClick={() =>
                setSelectedJobId((prev) => (prev === job.id ? null : job.id))
              }
            />
          ))}
        </nav>

        {/* Detail surface — side drawer on md+, bottom sheet on narrow */}
        <Sheet isOpen={!!selectedJob} onClose={() => setSelectedJobId(null)}>
          {!selectedJob ? (
            <div className="hidden md:flex items-center justify-center h-full px-6">
              <p className="text-sm text-muted">Select a job to view its cutting lines.</p>
            </div>
          ) : (
            <div className="flex flex-col h-full">
              {/* Detail header */}
              <div className="px-4 py-3 border-b border-border bg-surface shrink-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-sm text-text">{selectedJob.customer}</h2>
                    <p className="font-mono tabular-nums text-xs text-muted mt-0.5">
                      {selectedJob.invoice_number}
                      {selectedJob.po_number ? ` · PO ${selectedJob.po_number}` : ""}
                      {selectedJob.ship_date ? ` · Ships ${selectedJob.ship_date}` : ""}
                    </p>
                  </div>
                  {/* Dismiss handle — narrow only; md+ has no sheet close affordance */}
                  <button
                    type="button"
                    onClick={() => setSelectedJobId(null)}
                    aria-label="Close detail"
                    className="md:hidden min-w-[44px] min-h-[44px] flex items-center justify-center text-muted hover:text-text cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Line rows */}
              <div className="flex-1 overflow-y-auto">
                {selectedJob.lines.map((lineObj) => (
                  <LineRow
                    key={lineObj.line}
                    lineObj={lineObj}
                    jobId={selectedJob.id}
                    userName={userName}
                    acting={acting}
                    onClockIn={clockIn}
                    onClockOut={openClockOut}
                    onComplete={completeLine}
                  />
                ))}
              </div>
            </div>
          )}
        </Sheet>
      </div>

      {/* Clock-out handoff modal */}
      <HandoffModal
        lineLabel={clockOutTarget?.line ?? ""}
        isOpen={!!clockOutTarget}
        onClose={() => setClockOutTarget(null)}
        onSubmit={submitClockOut}
        acting={acting}
      />
    </div>
  );
}

function AppHeader({ userName }: { userName: string }) {
  return (
    <header className="bg-surface border-b border-border px-4 h-14 flex items-center justify-between shrink-0">
      <h1 className="text-sm font-semibold text-text tracking-tight">Cutting · v2</h1>
      <span className="font-mono tabular-nums text-xs text-muted">{userName}</span>
    </header>
  );
}

function QueueHeader({ count }: { count: number }) {
  return (
    <div className="px-4 py-2 border-b border-border bg-[var(--surface-2)] shrink-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">
        Queue
        {count > 0 && (
          <span className="font-mono tabular-nums font-normal ml-1">({count})</span>
        )}
      </span>
    </div>
  );
}
