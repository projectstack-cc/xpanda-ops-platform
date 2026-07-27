"use client";
import { useState } from "react";
import { ChevronUp, ChevronDown, Pencil, Trash2, Plus } from "lucide-react";
import { LineStatusPill } from "@/components/StatusPill";
import type { CcAssignment, MyOpen } from "./ChunkBoard";

interface Props {
  assignments: CcAssignment[];
  canManage: boolean;
  myOpen: MyOpen | null;
  acting: boolean;
  onStart: (id: string) => void;
  onStop: (id: string, label: string) => void;
  onComplete: (id: string, label: string) => void;
  onCreate: (label: string, targetChunks: number) => void;
  onEdit: (id: string, patch: { label?: string; target_chunks?: number }) => void;
  onDelete: (id: string) => void;
  onReorder: (order: string[]) => void;
}

export default function CrossCutterQueue({
  assignments,
  canManage,
  myOpen,
  acting,
  onStart,
  onStop,
  onComplete,
  onCreate,
  onEdit,
  onDelete,
  onReorder,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newTarget, setNewTarget] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  function startEdit(a: CcAssignment) {
    setEditingId(a.id);
    setEditLabel(a.label);
    setEditTarget(String(a.target_chunks));
  }

  function saveEdit(id: string) {
    const target = parseInt(editTarget, 10);
    onEdit(id, {
      label: editLabel.trim() || undefined,
      target_chunks: !isNaN(target) && target >= 0 ? target : undefined,
    });
    setEditingId(null);
  }

  function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= assignments.length) return;
    const order = assignments.map((a) => a.id);
    [order[index], order[next]] = [order[next], order[index]];
    onReorder(order);
  }

  function submitNew() {
    const target = parseInt(newTarget, 10);
    if (!newLabel.trim() || isNaN(target) || target < 0) return;
    onCreate(newLabel.trim(), target);
    setNewLabel("");
    setNewTarget("");
    setFormOpen(false);
  }

  return (
    <div>
      {canManage && (
        <div className="border-b border-border px-4 py-3">
          {!formOpen ? (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-medium cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              <Plus size={15} aria-hidden="true" />
              New assignment
            </button>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="new-cc-label" className="block text-xs font-medium text-muted mb-1">
                  Label
                </label>
                <input
                  id="new-cc-label"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Order #4821 — 2&quot; blocks"
                  className="min-h-[44px] w-56 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <div>
                <label htmlFor="new-cc-target" className="block text-xs font-medium text-muted mb-1">
                  Target chunks
                </label>
                <input
                  id="new-cc-target"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={newTarget}
                  onChange={(e) => setNewTarget(e.target.value)}
                  className="min-h-[44px] w-28 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
              <button
                type="button"
                disabled={acting}
                onClick={submitNew}
                className="min-h-[44px] px-4 py-2 bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setFormOpen(false);
                  setNewLabel("");
                  setNewTarget("");
                }}
                className="min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {assignments.length === 0 && (
        <p className="px-4 py-6 text-sm text-muted">
          No chunk assignments queued
          {canManage ? " — add one above." : " — check with a supervisor."}
        </p>
      )}

      {assignments.map((a, index) => {
        const isMine = myOpen?.board === "cc" && myOpen.ref_id === a.id;
        const isBusyByOther = !!a.busy_by && !isMine;
        const isEditing = editingId === a.id;
        const isDeleting = deletingId === a.id;

        return (
          <div key={a.id} className="border-b border-border px-4 py-4 last:border-b-0">
            {isEditing ? (
              <div className="flex flex-wrap items-end gap-2 mb-2">
                <input
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                  className="min-h-[44px] flex-1 min-w-[10rem] rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={editTarget}
                  onChange={(e) => setEditTarget(e.target.value)}
                  className="min-h-[44px] w-24 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={() => saveEdit(a.id)}
                  className="min-h-[44px] px-3 py-2 bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditingId(null)}
                  className="min-h-[44px] px-3 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <span className="font-medium text-sm text-text">{a.label}</span>
                  <span className="ml-2 font-mono tabular-nums text-xs text-muted">
                    {a.qty_done}/{a.target_chunks} chunks
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canManage && (
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        disabled={index === 0 || acting}
                        onClick={() => move(index, -1)}
                        aria-label={`Move ${a.label} up`}
                        className="w-9 h-9 flex items-center justify-center rounded text-muted hover:text-text hover:bg-[var(--ghost-bg)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      >
                        <ChevronUp size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={index === assignments.length - 1 || acting}
                        onClick={() => move(index, 1)}
                        aria-label={`Move ${a.label} down`}
                        className="w-9 h-9 flex items-center justify-center rounded text-muted hover:text-text hover:bg-[var(--ghost-bg)] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      >
                        <ChevronDown size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(a)}
                        aria-label={`Edit ${a.label}`}
                        className="w-9 h-9 flex items-center justify-center rounded text-muted hover:text-text hover:bg-[var(--ghost-bg)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      >
                        <Pencil size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingId(a.id)}
                        aria-label={`Delete ${a.label}`}
                        className="w-9 h-9 flex items-center justify-center rounded text-muted hover:text-[var(--danger-bg)] hover:bg-[var(--ghost-bg)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  <LineStatusPill status={a.status === "open" ? "not_started" : "in_progress"} />
                </div>
              </div>
            )}

            {isDeleting && (
              <div className="flex items-center gap-2 mb-2 text-sm bg-[var(--danger-bg)] text-[var(--danger-text)] rounded px-3 py-2">
                <span className="flex-1">Delete this assignment? This can&apos;t be undone.</span>
                <button
                  type="button"
                  onClick={() => {
                    onDelete(a.id);
                    setDeletingId(null);
                  }}
                  className="min-h-[36px] px-3 py-1 bg-[var(--danger-bg)] text-[var(--danger-text)] border border-current rounded text-xs font-semibold cursor-pointer hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setDeletingId(null)}
                  className="min-h-[36px] px-3 py-1 border border-current rounded text-xs font-semibold cursor-pointer hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  Cancel
                </button>
              </div>
            )}

            {isBusyByOther && (
              <p className="text-sm bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)] rounded px-3 py-2 mb-2">
                Running — {a.busy_by}
              </p>
            )}
            {isMine && (
              <p className="text-sm bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)] rounded px-3 py-2 mb-2">
                Running — you
              </p>
            )}

            <div className="flex flex-wrap gap-2 mt-1">
              {!isMine && (
                <button
                  type="button"
                  disabled={acting || isBusyByOther}
                  title={isBusyByOther ? `In use by ${a.busy_by}` : undefined}
                  onClick={() => onStart(a.id)}
                  className="min-h-[44px] px-4 py-2 bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                >
                  Start
                </button>
              )}
              {isMine && (
                <>
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => onStop(a.id, a.label)}
                    className="min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    Stop
                  </button>
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => onComplete(a.id, a.label)}
                    className="min-h-[44px] px-4 py-2 bg-[var(--success-bg)] text-[var(--success-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  >
                    Complete
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
