"use client";
import { useState, useEffect } from "react";
import Modal from "@/components/Modal";

const STATUS_LABEL: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  complete: "Complete",
};

interface CuttingLine {
  line: string;
  line_status: "not_started" | "in_progress" | "complete";
  sort_order: number;
  open_session_id: string | null;
  open_operator_name: string | null;
  last_handoff_note: string;
}

interface CuttingJob {
  id: string;
  customer: string;
  invoice_number: string;
  po_number: string;
  ship_date: string;
  status: string;
  priority: string;
  lines: CuttingLine[];
}

interface Props {
  userId: string;
  userName: string;
  isAdmin: boolean;
}

export default function CuttingBoard({ userId, userName, isAdmin }: Props) {
  const [queue, setQueue] = useState<CuttingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [clockOutTarget, setClockOutTarget] = useState<{
    sessionId: string;
    line: string;
  } | null>(null);
  const [handoffNote, setHandoffNote] = useState("");
  const [qtyDone, setQtyDone] = useState("");
  const [acting, setActing] = useState(false);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  async function refetch() {
    try {
      const res = await fetch("/v2/api/cutting/queue");
      const data = await res.json();
      if (data.ok) setQueue(data.queue);
    } catch {
      showToast("Failed to refresh queue.", false);
    }
  }

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch("/v2/api/cutting/queue");
        const data = await res.json();
        if (!mounted) return;
        if (data.ok) {
          setQueue(data.queue);
          setSelectedJobId(data.queue[0]?.id ?? null);
        } else {
          showToast("Failed to load queue.", false);
        }
      } catch {
        if (mounted) showToast("Network error.", false);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
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
        await refetch();
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
    setHandoffNote("");
    setQtyDone("");
    setClockOutTarget({ sessionId, line });
  }

  async function submitClockOut() {
    if (!clockOutTarget) return;
    setActing(true);
    try {
      const body: Record<string, unknown> = {
        session_id: clockOutTarget.sessionId,
        handoff_note: handoffNote,
      };
      const qty = parseInt(qtyDone, 10);
      if (!isNaN(qty) && qty > 0) body.qty_done_delta = qty;

      const res = await fetch("/v2/api/cutting/clock-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(`Clocked out of ${clockOutTarget.line}.`);
        setClockOutTarget(null);
        await refetch();
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
        const msg = data.all_lines_complete
          ? `${line} complete — all lines done, job marked done.`
          : `${line} marked complete.`;
        showToast(msg);
        await refetch();
      } else {
        showToast(data.error || "Failed.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  function StatusPill({ status }: { status: string }) {
    let cls = "text-xs font-semibold px-2 py-0.5 rounded-full";
    if (status === "complete") cls += " bg-green text-white";
    else if (status === "in_progress")
      cls += " bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)]";
    else cls += " bg-[var(--ghost-bg)] text-muted";
    return <span className={cls}>{STATUS_LABEL[status] ?? status}</span>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen text-muted">
        Loading queue…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg font-sans text-text">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
            toast.ok
              ? "bg-[var(--success-bg)] text-[var(--success-text)]"
              : "bg-[var(--danger-bg)] text-[var(--danger-text)]"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <header className="bg-surface border-b border-border px-4 py-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-text">Cutting — v2</h1>
        <span className="text-sm text-muted">{userName}</span>
      </header>

      <div className="flex flex-col sm:flex-row min-h-[calc(100vh-65px)]">
        {/* Job list */}
        <aside className="sm:w-72 sm:min-w-[18rem] bg-surface border-b sm:border-b-0 sm:border-r border-border overflow-y-auto">
          <div className="p-3 text-xs font-semibold uppercase tracking-wide text-muted border-b border-border">
            Jobs ({queue.length})
          </div>
          {queue.length === 0 && (
            <p className="p-4 text-sm text-muted">No active cutting jobs.</p>
          )}
          {queue.map((job) => {
            const doneCount = job.lines.filter((l) => l.line_status === "complete").length;
            const active = job.id === selectedJobId;
            return (
              <button
                key={job.id}
                onClick={() => setSelectedJobId(job.id)}
                className={`w-full text-left px-4 py-4 border-b border-border transition-colors min-h-[64px] ${
                  active
                    ? "bg-[var(--accent-soft)] border-l-4 border-l-[var(--accent)]"
                    : "hover:bg-[var(--ghost-bg)]"
                }`}
              >
                <div className="font-semibold text-sm text-text truncate">
                  {job.customer}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  {job.invoice_number}
                  {job.po_number ? ` · PO ${job.po_number}` : ""}
                </div>
                <div className="text-xs text-text-hint mt-1">
                  {doneCount}/{job.lines.length} lines done
                  {job.ship_date ? ` · Ships ${job.ship_date}` : ""}
                </div>
              </button>
            );
          })}
        </aside>

        {/* Line detail */}
        <main className="flex-1 p-4 sm:p-6 space-y-3">
          {!selectedJob ? (
            <p className="text-muted">Select a job to see its lines.</p>
          ) : (
            <>
              <div className="mb-2">
                <h2 className="text-base font-bold text-text">{selectedJob.customer}</h2>
                <p className="text-sm text-muted">
                  {selectedJob.invoice_number}
                  {selectedJob.po_number ? ` · PO ${selectedJob.po_number}` : ""}
                  {selectedJob.ship_date ? ` · Ships ${selectedJob.ship_date}` : ""}
                </p>
              </div>

              {selectedJob.lines.map((lineObj) => {
                const mySession =
                  lineObj.open_session_id && lineObj.open_operator_name === userName
                    ? lineObj.open_session_id
                    : null;
                const busyByOther =
                  lineObj.open_session_id && !mySession;

                return (
                  <div
                    key={lineObj.line}
                    className="bg-surface rounded-xl border border-border p-4 space-y-3"
                    style={{ boxShadow: "var(--shadow)" }}
                  >
                    {/* Line header */}
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-semibold text-text">{lineObj.line}</span>
                      <StatusPill status={lineObj.line_status} />
                    </div>

                    {/* Busy indicator */}
                    {busyByOther && (
                      <p className="text-sm text-[var(--info-text)] bg-[var(--info-bg)] border border-[var(--info-border)] rounded-lg px-3 py-2">
                        In progress — {lineObj.open_operator_name}
                      </p>
                    )}

                    {/* Last handoff note (resume hint) */}
                    {lineObj.last_handoff_note && (
                      <div className="text-sm text-muted bg-[var(--warn-bg)] border border-[var(--warn-border)] rounded-lg px-3 py-2">
                        <span className="font-medium text-[var(--warn-text)]">Last handoff: </span>
                        <span className="text-[var(--warn-text)]">{lineObj.last_handoff_note}</span>
                      </div>
                    )}

                    {/* Actions */}
                    {lineObj.line_status !== "complete" && (
                      <div className="flex flex-wrap gap-2">
                        {/* Clock In — available if no open session */}
                        {!lineObj.open_session_id && (
                          <button
                            disabled={acting}
                            onClick={() => clockIn(selectedJob.id, lineObj.line)}
                            className="min-h-[44px] px-4 py-2 bg-[var(--primary-bg)] text-[var(--primary-text)] rounded-lg text-sm font-semibold disabled:opacity-50 active:opacity-70"
                          >
                            Clock In
                          </button>
                        )}

                        {/* Clock Out + Mark Complete — only for my open session */}
                        {mySession && (
                          <>
                            <button
                              disabled={acting}
                              onClick={() => openClockOut(mySession, lineObj.line)}
                              className="min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded-lg text-sm font-semibold disabled:opacity-50 active:opacity-70"
                            >
                              Clock Out
                            </button>
                            <button
                              disabled={acting}
                              onClick={() => completeLine(selectedJob.id, lineObj.line)}
                              className="min-h-[44px] px-4 py-2 bg-green text-white rounded-lg text-sm font-semibold disabled:opacity-50 active:opacity-70"
                            >
                              Mark Complete
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </main>
      </div>

      {/* Clock-out handoff modal */}
      <Modal
        isOpen={!!clockOutTarget}
        onClose={() => setClockOutTarget(null)}
        title={`Clock Out — ${clockOutTarget?.line ?? ""}`}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text mb-1">
              Handoff note
              <span className="ml-1 text-xs text-muted font-normal">
                (where you stopped, what to watch for)
              </span>
            </label>
            <textarea
              value={handoffNote}
              onChange={(e) => setHandoffNote(e.target.value)}
              rows={4}
              placeholder="e.g. Stopped at 3rd stack — glue needs to cure before resuming. Watch blade tension."
              className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">
              Pieces completed this session
              <span className="ml-1 text-xs text-muted font-normal">(optional)</span>
            </label>
            <input
              type="number"
              min="0"
              value={qtyDone}
              onChange={(e) => setQtyDone(e.target.value)}
              placeholder="0"
              className="w-32 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button
              disabled={acting}
              onClick={submitClockOut}
              className="flex-1 min-h-[44px] bg-[var(--primary-bg)] text-[var(--primary-text)] rounded-lg text-sm font-semibold disabled:opacity-50"
            >
              {acting ? "Saving…" : "Clock Out"}
            </button>
            <button
              onClick={() => setClockOutTarget(null)}
              className="min-h-[44px] px-4 bg-[var(--ghost-bg)] text-text border border-border rounded-lg text-sm font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
