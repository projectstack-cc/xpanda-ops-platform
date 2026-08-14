"use client";
import { useState, useEffect, useMemo } from "react";
import { AlertCircle, Calculator, Search, X } from "lucide-react";
import Sheet from "@/components/Sheet";
import PlatformHeader from "@/components/PlatformHeader";
import JobRow from "./JobRow";
import LineRow from "./LineRow";
import WorkQueue from "./WorkQueue";
import HandoffModal from "./HandoffModal";
import PhotoViewer from "./PhotoViewer";
import CompleteLineModal from "./CompleteLineModal";
import PartsPanel from "./PartsPanel";
import ConfirmCompleteModal from "./ConfirmCompleteModal";
import BlockPlanner from "./BlockPlanner";
import ClockedInBar from "@/components/ClockedInBar";
import type { CuttingJob } from "./types";
import { formatDuration, lineLiveSeconds } from "@/lib/time";

interface Props {
  userId: string;
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

export default function CuttingBoard({ userId, userName, isAdmin, permissions }: Props) {
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
  const [acting, setActing] = useState(false);
  const [completeTarget, setCompleteTarget] = useState<{
    jobId: string;
    line: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [showAll, setShowAll] = useState(false);
  const [checklistBusy, setChecklistBusy] = useState(false);
  const [pendingComplete, setPendingComplete] =
    useState<{ line: string; itemId: string; label: string } | null>(null);
  const [plannerOpen, setPlannerOpen] = useState(false);
  // Authoritative "am I clocked in?" — bypasses the queue's job-status filter, so it survives
  // an archived/shipped/dropped job that queue-derived state would silently lose. P309: an
  // operator may hold several open sessions at once (different jobs), so this is an array.
  const [mySessions, setMySessions] = useState<
    {
      session_id: string;
      job_id: string;
      line: string;
      started_at: string;
      invoice_number: string | null;
      customer: string | null;
      job_status: string | null;
      orphaned: boolean;
    }[]
  >([]);

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
    // Same refresh cycle as the queue — the sticky bar's source of truth, unfiltered by job status.
    try {
      const sRes = await fetch("/v2/api/cutting/my-session");
      const sData = await sRes.json();
      if (sData.ok) setMySessions(sData.sessions ?? []);
    } catch {
      // best-effort — the bar just won't update this cycle
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
    let result: typeof queue;
    if (term) {
      result = queue.filter(
        (j) =>
          j.customer.toLowerCase().includes(term) ||
          j.invoice_number.toLowerCase().includes(term)
      );
    } else if (showAll) {
      result = queue;
    } else {
      const { start, end } = thisWeekRange();
      result = queue.filter(
        (j) => j.ship_date !== null && j.ship_date >= start && j.ship_date <= end
      );
    }
    // The operator's open-session jobs must always be visible, regardless of week/search —
    // otherwise the in-progress job vanishes from the list after a refresh (only the bottom
    // strip remains). Only jobs actually present in `queue` apply; orphaned sessions (job
    // archived/shipped, not in `queue`) stay handled by the strip's own orphaned banner.
    const myOpenJobIds = new Set(mySessions.map((s) => s.job_id));
    if (myOpenJobIds.size === 0) return result;
    const present = new Set(result.map((j) => j.id));
    const missing = queue.filter((j) => myOpenJobIds.has(j.id) && !present.has(j.id));
    return missing.length ? [...result, ...missing] : result;
  }, [queue, search, showAll, mySessions]);

  const selectedJob = queue.find((j) => j.id === selectedJobId) ?? null;

  const jobTotalSeconds = selectedJob
    ? selectedJob.lines.reduce((sum, l) => sum + lineLiveSeconds(l, now), 0)
    : 0;

  // The line whose checklist the sidebar shows — only when clocked into THIS job. P309: an
  // operator can be clocked into lines on several different jobs at once, so this must be
  // derived from the selected job's own lines, not a single board-wide "current" session.
  const myLineOnJob =
    (selectedJob &&
      !!userId &&
      selectedJob.lines.find((ln) => ln.open_operator_id === userId)?.line) ||
    null;

  // The line the bottom cut-list dock shows: the operator's clocked-in line if any, else the
  // first required line. Only interactive when it's the operator's own clocked-in line.
  const dockLine =
    myLineOnJob ??
    selectedJob?.requiredLines?.[0] ??
    selectedJob?.lines?.[0]?.line ??
    null;
  const dockReadOnly = !myLineOnJob || myLineOnJob !== dockLine;

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
    setActing(true);
    try {
      const res = await fetch("/v2/api/cutting/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: jobId, line }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`Started ${line}.`);
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

  function openClockOut(sessionId: string, line: string, jobId?: string) {
    setClockOutTarget({ sessionId, line, jobId: jobId ?? selectedJob?.id ?? "" });
  }

  async function submitClockOut(
    note: string,
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

      const res = await fetch("/v2/api/cutting/clock-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: clockOutTarget.sessionId,
          handoff_note: note,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`Stopped ${clockOutTarget.line}.`);
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
                    {selectedJob.cutting_instructions?.trim() && (
                      <p className="text-sm bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)] rounded px-3 py-2 mt-2 whitespace-pre-wrap">
                        <span className="font-medium">Cutting Instructions: </span>
                        {selectedJob.cutting_instructions}
                      </p>
                    )}
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

              {/* Line rows — the cut list is a persistent bottom dock, rendered outside the Sheet. */}
              <div className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
                <div className="md:flex-1 md:overflow-y-auto">
                  {selectedJob.lines.map((lineObj) => (
                    <LineRow
                      key={lineObj.line}
                      lineObj={lineObj}
                      jobId={selectedJob.id}
                      userId={userId}
                      userName={userName}
                      acting={acting}
                      // P309: operators may hold sessions on other jobs concurrently — that's
                      // no longer a reason to flag this line, so this is always false now.
                      clockedInElsewhere={false}
                      onClockIn={clockIn}
                      onClockOut={openClockOut}
                      onComplete={completeLine}
                      now={now}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </Sheet>
      </div>

      {/* Persistent bottom cut-list dock — shown whenever a job is selected, spans the full
          board width, own scroll. Read-only unless clocked into the shown line. */}
      {selectedJob && dockLine && (
        <section
          aria-label="Cut list"
          className="border-t border-border bg-surface max-h-[38vh] overflow-y-auto"
        >
          <PartsPanel
            job={selectedJob}
            line={dockLine}
            readOnly={dockReadOnly}
            onToggle={(itemId, completed) => {
              if (completed) {
                const it = selectedJob?.line_items?.find((li) => li.id === itemId);
                const label = [it?.part_number, it?.description].filter(Boolean).join(" — ");
                setPendingComplete({ line: dockLine, itemId, label });
              } else {
                toggleChecklistItem(dockLine, itemId, false);
              }
            }}
            onSetYield={(y) => setTaperYield(y)}
            onSetChunkTarget={(q) => setChunkTarget(q)}
            busy={checklistBusy}
          />
        </section>
      )}

      <ConfirmCompleteModal
        isOpen={!!pendingComplete}
        itemLabel={pendingComplete?.label}
        onCancel={() => setPendingComplete(null)}
        onConfirm={() => {
          if (pendingComplete) toggleChecklistItem(pendingComplete.line, pendingComplete.itemId, true);
          setPendingComplete(null);
        }}
      />

      {/* Sticky clocked-in bar(s) — reads mySessions (unfiltered), not queue-derived state.
          P309: an operator may have several open sessions; stack one bar per session. This
          wrapper owns the fixed/bottom-anchored positioning — ClockedInBar itself is layout-neutral. */}
      {mySessions.length > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 flex flex-col"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {mySessions.map((session) => (
            <ClockedInBar
              key={session.session_id}
              invoice={session.invoice_number}
              customer={session.customer}
              line={session.line}
              startedAt={session.started_at}
              orphaned={session.orphaned}
              onClockOut={() =>
                openClockOut(session.session_id, session.line, session.job_id)
              }
              onOpen={session.orphaned ? undefined : () => setSelectedJobId(session.job_id)}
              disabled={acting}
            />
          ))}
        </div>
      )}

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
