"use client";
// Design read: chunk-task board for Cross Cutter / Hole Cutter operators on a shared floor
// tablet, cockpit-dense, two-tab layout (manager-ordered queue + two fixed inventory slots).
// Fully decoupled from jobs — no job_id anywhere in this surface.
import { useCallback, useEffect, useState } from "react";
import { Scissors, CircleDot } from "lucide-react";
import Modal from "@/components/Modal";
import CrossCutterQueue from "./CrossCutterQueue";
import HoleCutterSlots from "./HoleCutterSlots";
import ChunkStopModal from "./ChunkStopModal";

export type Board = "cc" | "hc";

export interface CcAssignment {
  id: string;
  label: string;
  target_chunks: number;
  qty_done: number;
  status: "open" | "in_progress" | "complete";
  sort_order: number;
  busy_by: string | null;
}

export interface HcSlot {
  slot_key: string;
  label: string;
  on_hand: number;
  total_holed: number;
  busy_by: string | null;
}

export interface MyOpen {
  board: Board;
  ref_id: string;
}

export default function ChunkBoard() {
  const [tab, setTab] = useState<Board>("cc");
  const [assignments, setAssignments] = useState<CcAssignment[]>([]);
  const [slots, setSlots] = useState<HcSlot[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [myOpen, setMyOpen] = useState<MyOpen | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const [stopTarget, setStopTarget] = useState<{
    board: Board;
    ref_id: string;
    label: string;
    currentOnHand?: number;
  } | null>(null);
  const [completeTarget, setCompleteTarget] = useState<{
    board: Board;
    ref_id: string;
    label: string;
  } | null>(null);

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  const fetchAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [ccRes, hcRes] = await Promise.all([
        fetch("/v2/api/cutting/cc-assignments"),
        fetch("/v2/api/cutting/hc-slots"),
      ]);
      const [ccData, hcData] = await Promise.all([ccRes.json(), hcRes.json()]);

      if (ccData.ok) {
        setAssignments(ccData.assignments);
        setCanManage(!!ccData.can_manage);
      } else {
        setError(ccData.error || "Failed to load Cross Cutter queue.");
      }
      if (hcData.ok) {
        setSlots(hcData.slots);
        setMyOpen(hcData.my_open ?? null);
      } else if (!ccData.ok) {
        // keep the first error already set
      } else {
        setError(hcData.error || "Failed to load Hole Cutter slots.");
      }
    } catch {
      setError("Network error — check connection.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  function errorLabel(errCode: string, fallback: string): string {
    if (errCode === "already_running") return "You're already running something else — stop it first.";
    if (errCode === "line_busy") return "Already in use by another operator.";
    return fallback;
  }

  async function start(board: Board, refId: string) {
    setActing(true);
    try {
      const res = await fetch("/v2/api/cutting/chunk-session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board, ref_id: refId }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Started.");
        await fetchAll(true);
      } else if (data.error === "line_busy") {
        showToast(`Already in use by ${data.operator}.`, false);
      } else {
        showToast(errorLabel(data.error, data.error || "Start failed."), false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  function openStop(board: Board, refId: string, label: string, currentOnHand?: number) {
    setStopTarget({ board, ref_id: refId, label, currentOnHand });
  }

  async function submitStop(values: { qty_done_delta?: number; holed_delta?: number; on_hand?: number }) {
    if (!stopTarget) return;
    setActing(true);
    try {
      const res = await fetch("/v2/api/cutting/chunk-session/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("Stopped.");
        setStopTarget(null);
        await fetchAll(true);
      } else {
        showToast(data.error || "Stop failed.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  function openComplete(board: Board, refId: string, label: string) {
    setCompleteTarget({ board, ref_id: refId, label });
  }

  async function submitComplete() {
    if (!completeTarget) return;
    const { board, ref_id } = completeTarget;
    setActing(true);
    try {
      const res = await fetch("/v2/api/cutting/chunk-session/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ board, ref_id }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast(board === "cc" ? "Assignment complete." : "Run complete.");
        setCompleteTarget(null);
        await fetchAll(true);
      } else {
        showToast(data.error || "Failed.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  async function createAssignment(label: string, targetChunks: number) {
    setActing(true);
    try {
      const res = await fetch("/v2/api/cutting/manage/cc-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, target_chunks: targetChunks }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchAll(true);
      } else {
        showToast(data.error || "Failed to create assignment.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  async function updateAssignment(id: string, patch: { label?: string; target_chunks?: number }) {
    setActing(true);
    try {
      const res = await fetch(`/v2/api/cutting/manage/cc-assignments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchAll(true);
      } else {
        showToast(data.error || "Failed to update assignment.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  async function deleteAssignment(id: string) {
    setActing(true);
    try {
      const res = await fetch(`/v2/api/cutting/manage/cc-assignments/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.ok) {
        await fetchAll(true);
      } else {
        showToast(data.error || "Failed to delete assignment.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  async function reorder(order: string[]) {
    setActing(true);
    try {
      const res = await fetch("/v2/api/cutting/manage/cc-assignments/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchAll(true);
      } else {
        showToast(data.error || "Reorder failed.", false);
      }
    } catch {
      showToast("Network error.", false);
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
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

      {/* Tab bar */}
      <div className="shrink-0 flex border-b border-border bg-surface" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "cc"}
          onClick={() => setTab("cc")}
          className={[
            "flex-1 md:flex-none min-h-[44px] px-5 flex items-center justify-center gap-2 text-sm font-semibold cursor-pointer border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
            tab === "cc"
              ? "border-[var(--brand)] text-[var(--brand)]"
              : "border-transparent text-muted hover:text-text",
          ].join(" ")}
        >
          <Scissors size={16} aria-hidden="true" />
          Cross Cutter
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "hc"}
          onClick={() => setTab("hc")}
          className={[
            "flex-1 md:flex-none min-h-[44px] px-5 flex items-center justify-center gap-2 text-sm font-semibold cursor-pointer border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
            tab === "hc"
              ? "border-[var(--brand)] text-[var(--brand)]"
              : "border-transparent text-muted hover:text-text",
          ].join(" ")}
        >
          <CircleDot size={16} aria-hidden="true" />
          Hole Cutter
        </button>
      </div>

      {/* Loading: skeleton rows instead of a centered spinner */}
      {loading ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="border border-border rounded px-4 py-3 animate-pulse motion-reduce:animate-none"
            >
              <div className="h-4 bg-[var(--ghost-bg)] rounded w-40 mb-2" />
              <div className="h-3 bg-[var(--ghost-bg)] rounded w-24" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="px-4 py-4">
              <div className="border border-border rounded px-3 py-3 space-y-1.5">
                <p className="text-sm text-[var(--danger-bg)] font-medium">{error}</p>
                <button
                  type="button"
                  onClick={() => fetchAll()}
                  className="text-xs text-muted underline underline-offset-2 cursor-pointer hover:text-text"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {!error && tab === "cc" && (
            <CrossCutterQueue
              assignments={assignments}
              canManage={canManage}
              myOpen={myOpen}
              acting={acting}
              onStart={(id) => start("cc", id)}
              onStop={(id, label) => openStop("cc", id, label)}
              onComplete={(id, label) => openComplete("cc", id, label)}
              onCreate={createAssignment}
              onEdit={updateAssignment}
              onDelete={deleteAssignment}
              onReorder={reorder}
            />
          )}

          {!error && tab === "hc" && (
            <HoleCutterSlots
              slots={slots}
              myOpen={myOpen}
              acting={acting}
              onStart={(slotKey) => start("hc", slotKey)}
              onStop={(slotKey, label, onHand) => openStop("hc", slotKey, label, onHand)}
              onComplete={(slotKey, label) => openComplete("hc", slotKey, label)}
            />
          )}
        </div>
      )}

      <ChunkStopModal
        isOpen={!!stopTarget}
        onClose={() => setStopTarget(null)}
        variant={stopTarget?.board ?? "cc"}
        label={stopTarget?.label ?? ""}
        currentOnHand={stopTarget?.currentOnHand}
        onSubmit={submitStop}
        acting={acting}
      />

      {/* Complete confirm — shared by both boards, composes the Modal primitive */}
      <Modal
        isOpen={!!completeTarget}
        onClose={() => setCompleteTarget(null)}
        title={completeTarget?.board === "hc" ? "Complete run" : "Complete assignment"}
      >
        <p className="text-sm text-text">
          {completeTarget?.board === "hc" ? (
            <>
              Complete just ends your run on <span className="font-semibold">{completeTarget?.label}</span> —
              counts stay.
            </>
          ) : (
            <>
              Mark <span className="font-semibold">{completeTarget?.label}</span> complete? It will
              drop off the queue.
            </>
          )}
        </p>
        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={() => setCompleteTarget(null)}
            className="min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={acting}
            onClick={submitComplete}
            className="min-h-[44px] px-4 py-2 bg-[var(--success-bg)] text-[var(--success-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {acting ? "Saving…" : "Complete"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
