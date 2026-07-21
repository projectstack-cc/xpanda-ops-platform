"use client";
import { useState, useEffect, useMemo } from "react";
import { AlertCircle, Calculator, Search, X } from "lucide-react";
import Sheet from "@/components/Sheet";
import Modal from "@/components/Modal";
import PlatformHeader from "@/components/PlatformHeader";
import JobRow from "./JobRow";
import LineRow from "./LineRow";
import WorkQueue from "./WorkQueue";
import HandoffModal from "./HandoffModal";
import PhotoViewer from "./PhotoViewer";
import CompleteLineModal from "./CompleteLineModal";
import PartsPanel from "./PartsPanel";
import BlockPlanner from "./BlockPlanner";
import type { CuttingJob } from "./types";
import { formatDuration, lineLiveSeconds } from "@/lib/time";

interface Props {
  userId: string;
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

export default function CuttingBoard({ userId: _userId, userName, isAdmin, permissions }: Props) {
  const [queue, setQueue] = useState<CuttingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [photosJob, setPhotosJob] = useState<CuttingJob | null>(null);
  const [clockOutTarget, setClockOutTarget] = useState<{
    sessionId: string;
    line: string;
    jobId: string;
  } | null>(null);
  // "You're clocked in elsewhere" confirm prompt (job # + session to resolve).
  const [resolvePrompt, setResolvePrompt] = useState<{
    sessionId: string;
    line: string;
    jobId: string;
    invoice: string;
  } | null>(null);
  const [acting, setActing] = useState(false);
  const [completeTarget, setCompleteTarget] = useState<{
    jobId: string;
    line: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [showAll, setShowAll] = useState(false);
  const [checklistBusy, setChecklistBusy] = useState(false);
  const [plannerOpen, setPlannerOpen] = useState(false);

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

  // Tick for live time-tracking display (minute resolution; 30s is plenty).
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const filteredQueue = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term) {
      return queue.filter(
        (j) =>
          j.customer.toLowerCase().includes(term) ||
          j.invoice_number.toLowerCase().includes(term)
      );
    }
    if (showAll) return queue;
    const { start, end } = thisWeekRange();
    return queue.filter(
      (j) => j.ship_date !== null && j.ship_date >= start && j.ship_date <= end
    );
  }, [queue, search, showAll]);

  const selectedJob = filteredQueue.find((j) => j.id === selectedJobId) ?? null;

  const jobTotalSeconds = selectedJob
    ? selectedJob.lines.reduce((sum, l) => sum + lineLiveSeconds(l, now), 0)
    : 0;

  // The operator's current open session across the whole board (one max — enforced server-side).
  const myOpen = (() => {
    for (const j of queue) {
      const l = j.lines.find(
        (ln) => ln.open_session_id && ln.open_operator_name === userName
      );
      if (l)
        return {
          jobId: j.id,
          invoice: j.invoice_number,
          line: l.line,
          sessionId: l.open_session_id!,
        };
    }
    return null;
  })();
  // The line whose checklist the sidebar shows — only when clocked into THIS job.
  const myLineOnJob =
    myOpen && selectedJob && myOpen.jobId === selectedJob.id ? myOpen.line : null;

  // Unchecked parts on the line being clocked out — for the reconciliation section.
  const clockOutJob = clockOutTarget
    ? queue.find((j) => j.id === clockOutTarget.jobId) ?? null
    : null;
  const clockOutItems =
    clockOutTarget && clockOutJob
      ? (clockOutJob.line_items ?? [])
          .filter((it) => !clockOutJob.progress?.[clockOutTarget.line]?.[it.id]?.completed)
          .map((it) => ({
            id: it.id,
            label: it.part_number || it.description || "Part",
            orderedQty: it.quantity,
            completedQty:
              clockOutJob.progress?.[clockOutTarget.line]?.[it.id]?.completed_qty ?? null,
          }))
      : [];

  async function toggleChecklistItem(line: string, lineItemId: string, completed: boolean) {
    if (!selectedJob) return;
    setChecklistBusy(true);
    try {
      const res = await fetch("/v2/api/cutting/line-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: selectedJob.id, line, line_item_id: lineItemId, completed }),
      });
      const data = await res.json();
      if (!data.ok) showToast(data.error || "Failed to update.", false);
      await fetchQueue(true);
    } catch {
      showToast("Network error.", false);
    } finally {
      setChecklistBusy(false);
    }
  }

  async function setTaperYield(yieldPerChunk: number) {
    if (!selectedJob) return;
    setChecklistBusy(true);
    try {
      const res = await fetch("/v2/api/cutting/taper-yield", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: selectedJob.id, yield: yieldPerChunk }),
      });
      const data = await res.json();
      if (!data.ok) showToast(data.error || "Failed to set yield.", false);
      await fetchQueue(true);
    } catch {
      showToast("Network error.", false);
    } finally {
      setChecklistBusy(false);
    }
  }

  async function setChunkTarget(qtyTarget: number) {
    if (!selectedJob) return;
    setChecklistBusy(true);
    try {
      const res = await fetch("/v2/api/cutting/chunk-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: selectedJob.id, qty_target: qtyTarget }),
      });
      const data = await res.json();
      if (!data.ok) showToast(data.error || "Failed to set chunk target.", false);
      await fetchQueue(true);
    } catch {
      showToast("Network error.", false);
    } finally {
      setChecklistBusy(false);
    }
  }

  async function clockIn(jobId: string, line: string) {
    // Clocked in elsewhere? Don't fire a doomed clock-in. Surface which job the
    // operator is on and offer to clock out of it (→ normal completion screen).
    if (myOpen && !(myOpen.jobId === jobId && myOpen.line === line)) {
      setResolvePrompt({
        sessionId: myOpen.sessionId,
        line: myOpen.line,
        jobId: myOpen.jobId,
        invoice: myOpen.invoice,
      });
      return;
    }
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
      } else if (data.error === "already_clocked_in") {
        showToast(`Finish your current line (${data.line}) before clocking into another.`, false);
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
    setClockOutTarget({ sessionId, line, jobId: selectedJob?.id ?? "" });
  }

  async function submitClockOut(
    note: string,
    qty?: number,
    photo?: File | null,
    itemQtys?: { line_item_id: string; completed_qty: number }[]
  ) {
    if (!clockOutTarget) return;
    setActing(true);
    try {
      // Reconcile unchecked-part quantities — best-effort, never blocks clock-out.
      if (itemQtys && itemQtys.length) {
        try {
          await fetch("/v2/api/cutting/line-progress", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              job_id: clockOutTarget.jobId,
              line: clockOutTarget.line,
              items: itemQtys,
            }),
          });
        } catch {
          showToast("Saving part quantities failed — clocking out anyway.", false);
        }
      }

      // Optional cut-list photo — best-effort, never blocks clock-out.
      if (photo) {
        try {
          const fd = new FormData();
          fd.append("session_id", clockOutTarget.sessionId);
          fd.append("file", photo);
          const pRes = await fetch("/v2/api/cutting/clock-out-photo", {
            method: "POST",
            body: fd,
          });
          if (!pRes.ok) showToast("Photo upload failed — clocking out anyway.", false);
        } catch {
          showToast("Photo upload failed — clocking out anyway.", false);
        }
      }

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

  function completeLine(jobId: string, line: string) {
    setCompleteTarget({ jobId, line });
  }

  async function submitComplete(note: string) {
    if (!completeTarget) return;
    const { jobId, line } = completeTarget;
    setActing(true);
    try {
      const res = await fetch("/v2/api/cutting/complete-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, line, handoff_note: note }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(
          data.all_lines_complete
            ? `${line} complete — all lines done, job marked done.`
            : `${line} marked complete.`
        );
        setCompleteTarget(null);
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
        <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Cutting · v2" />
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

      <PlatformHeader userName={userName} isAdmin={isAdmin} permissions={permissions} title="Cutting · v2" />

      <div className="flex flex-1 overflow-hidden">
        {/* Job list — left column */}
        <nav
          aria-label="Job list"
          className="w-full md:w-72 md:shrink-0 bg-surface md:border-r md:border-border overflow-y-auto"
        >
          <QueueHeader count={filteredQueue.length} />

          <WorkQueue
            jobs={queue}
            selectedJobId={selectedJobId}
            onSelect={(id) => setSelectedJobId((prev) => (prev === id ? null : id))}
            onViewPhotos={(job) => setPhotosJob(job)}
          />

          {/* Search + week filter toolbar */}
          <div className="px-3 py-2 border-b border-border bg-surface space-y-2">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search customer or invoice…"
                aria-label="Search jobs"
                className="w-full min-h-[44px] pl-8 pr-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className={[
                "min-h-[44px] w-full px-3 py-2 rounded text-sm font-semibold cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
                showAll
                  ? "bg-[var(--ghost-bg)] text-text border border-border hover:bg-[var(--border-light)]"
                  : "bg-[var(--primary-bg)] text-[var(--primary-text)] hover:opacity-90",
              ].join(" ")}
            >
              {showAll ? "← This Week" : "Show All"}
            </button>
          </div>

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

          {/* Designed empty states */}
          {!error && queue.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted">
              No jobs need cutting — check the Job Board.
            </p>
          )}
          {!error && queue.length > 0 && filteredQueue.length === 0 && (
            <p className="px-4 py-6 text-sm text-muted">
              No jobs match this week / your search — try Show All.
            </p>
          )}

          {filteredQueue.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              isActive={job.id === selectedJobId}
              onViewPhotos={() => setPhotosJob(job)}
              onClick={() => {
                setSelectedJobId((prev) => (prev === job.id ? null : job.id));
              }}
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
                    <p className="font-mono tabular-nums text-xs text-muted mt-1">
                      Tracked: {formatDuration(jobTotalSeconds)}
                    </p>
                    {selectedJob.blocks_needed != null && (
                      <p className="font-mono tabular-nums text-xs text-muted mt-1">
                        Blocks needed:{" "}
                        <span className="text-text font-semibold">
                          {selectedJob.blocks_needed}
                        </span>
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setPlannerOpen(true)}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text hover:opacity-80 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    >
                      <Calculator size={14} aria-hidden="true" />
                      Cut Plan
                    </button>
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

              {/* Line rows + docked parts sidebar (sidebar only once clocked into this job) */}
              <div className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
                <div className="md:flex-1 md:overflow-y-auto">
                  {selectedJob.lines.map((lineObj) => (
                    <LineRow
                      key={lineObj.line}
                      lineObj={lineObj}
                      jobId={selectedJob.id}
                      userName={userName}
                      acting={acting}
                      clockedInElsewhere={
                        !!myOpen &&
                        !(myOpen.jobId === selectedJob.id && myOpen.line === lineObj.line)
                      }
                      onClockIn={clockIn}
                      onClockOut={openClockOut}
                      onComplete={completeLine}
                      now={now}
                    />
                  ))}
                </div>

                {myLineOnJob && (
                  <aside className="shrink-0 md:w-80 border-t md:border-t-0 md:border-l border-border md:overflow-y-auto">
                    <PartsPanel
                      job={selectedJob}
                      line={myLineOnJob}
                      onToggle={(itemId, completed) =>
                        toggleChecklistItem(myLineOnJob, itemId, completed)
                      }
                      onSetYield={(y) => setTaperYield(y)}
                      onSetChunkTarget={(q) => setChunkTarget(q)}
                      busy={checklistBusy}
                    />
                  </aside>
                )}
              </div>
            </div>
          )}
        </Sheet>
      </div>


      {/* Block-calc planner */}
      {selectedJob && (
        <BlockPlanner
          job={selectedJob}
          isOpen={plannerOpen}
          onClose={() => setPlannerOpen(false)}
          onSaved={() => {
            setPlannerOpen(false);
            fetchQueue(true);
            showToast("Cut plan saved.");
          }}
        />
      )}

      {/* Mark-complete modal */}
      <CompleteLineModal
        lineLabel={completeTarget?.line ?? ""}
        customer={selectedJob?.customer ?? ""}
        invoice={selectedJob?.invoice_number ?? ""}
        isLaminate={completeTarget?.line === "Laminate"}
        isOpen={!!completeTarget}
        onClose={() => setCompleteTarget(null)}
        onSubmit={submitComplete}
        acting={acting}
      />

      {/* Cut-list photo viewer (opened from a job card) */}
      <PhotoViewer
        job={photosJob}
        isOpen={!!photosJob}
        onClose={() => setPhotosJob(null)}
      />

      {/* Clock-out handoff modal */}
      <HandoffModal
        lineLabel={clockOutTarget?.line ?? ""}
        items={clockOutItems}
        isOpen={!!clockOutTarget}
        onClose={() => setClockOutTarget(null)}
        onSubmit={submitClockOut}
        acting={acting}
      />

      {/* "Already clocked in" resolver — surfaces which job, routes to clock-out */}
      <Modal
        isOpen={!!resolvePrompt}
        onClose={() => setResolvePrompt(null)}
        title="Already clocked in"
      >
        <p className="text-sm text-text">
          You&apos;re clocked into{" "}
          <span className="font-mono tabular-nums font-semibold">
            #{resolvePrompt?.invoice}
          </span>
          . Clock out of{" "}
          <span className="font-mono tabular-nums font-semibold">
            #{resolvePrompt?.invoice}
          </span>
          ?
        </p>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setResolvePrompt(null)}
            className="min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (!resolvePrompt) return;
              setClockOutTarget({
                sessionId: resolvePrompt.sessionId,
                line: resolvePrompt.line,
                jobId: resolvePrompt.jobId,
              });
              setResolvePrompt(null);
            }}
            className="min-h-[44px] px-4 py-2 bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Clock Out
          </button>
        </div>
      </Modal>
    </div>
  );
}

function thisWeekRange(): { start: string; end: string } {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun … 6=Sat
  const daysFromMon = dow === 0 ? 6 : dow - 1;
  const mon = new Date(now);
  mon.setDate(now.getDate() - daysFromMon);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: fmt(mon), end: fmt(sun) };
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
