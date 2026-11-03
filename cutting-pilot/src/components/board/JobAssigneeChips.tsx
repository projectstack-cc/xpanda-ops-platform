"use client";
// src/components/board/JobAssigneeChips.tsx
// jb-14 — people-assignment chip block, moved out of BoardRowEdit (same move jb-10 made for
// JobShiftChips) so the row panel and the order popup share one definition. Self-contained: loads
// GET /api/jobs/:id/assignments on mount; add (POST) and remove (DELETE …/:userId) write
// immediately. Manager-gated client-side via `canManage` (isAdmin || jobs.manage edit); the routes
// enforce it server-side (403). The board shows assignees, so `onChanged` lets the caller refetch.
import { useEffect, useState } from "react";

interface Assignee {
  user_id: string;
  name: string;
}

export interface AssignableUser {
  id: string;
  name: string;
  username: string;
}

const labelClass = "block text-xs font-semibold text-muted mb-1";

interface JobAssigneeChipsProps {
  jobId: string;
  assignableUsers: AssignableUser[];
  canManage: boolean;
  onChanged?: () => void;
}

export default function JobAssigneeChips({ jobId, assignableUsers, canManage, onChanged }: JobAssigneeChipsProps) {
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assigneesLoading, setAssigneesLoading] = useState(true);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [addingUserId, setAddingUserId] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/assignments`);
        const data = await res.json();
        if (!cancelled && res.ok && data.ok) {
          setAssignees(data.assignees || []);
        }
      } catch {
        // Non-fatal — the panel still works for the editable field subset without assignees.
      } finally {
        if (!cancelled) setAssigneesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  async function handleAddAssignee() {
    if (!addingUserId) return;
    setAssignError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: addingUserId }),
      });
      const data = await res.json();
      if (res.status === 403) {
        setAssignError("Manager access required to assign.");
        return;
      }
      if (!res.ok || !data.ok) {
        setAssignError(data.error || "Couldn't assign. Try again.");
        return;
      }
      setAddingUserId("");
      const added = assignableUsers.find((u) => u.id === addingUserId);
      if (added) setAssignees((prev) => [...prev, { user_id: added.id, name: added.name }]);
      onChanged?.();
    } catch {
      setAssignError("Network error — couldn't reach the server.");
    }
  }

  async function handleRemoveAssignee(userId: string) {
    setAssignError(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/assignments/${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (res.status === 403) {
        setAssignError("Manager access required to assign.");
        return;
      }
      if (!res.ok || !data.ok) {
        setAssignError(data.error || "Couldn't remove. Try again.");
        return;
      }
      setAssignees((prev) => prev.filter((a) => a.user_id !== userId));
      onChanged?.();
    } catch {
      setAssignError("Network error — couldn't reach the server.");
    }
  }

  const availableToAdd = assignableUsers.filter((u) => !assignees.some((a) => a.user_id === u.id));

  return (
    <div>
      <span className={labelClass}>Assigned</span>
      {assignError && <p className="text-xs text-[var(--warn-text)] mb-2">{assignError}</p>}
      {/* jb-14: gap-y-4 keeps the × hit areas of wrapped chip rows from overlapping. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-4">
        {assigneesLoading && <span className="text-xs text-muted">Loading…</span>}
        {!assigneesLoading && assignees.length === 0 && (
          <span className="text-xs text-muted">Unassigned</span>
        )}
        {assignees.map((a) => (
          <span
            key={a.user_id}
            className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-[var(--ghost-bg)] text-xs font-medium text-text"
          >
            {a.name}
            {canManage && (
              // jb-14: 44px hit area; negative margins keep the chip at its small visual size.
              <button
                type="button"
                onClick={() => handleRemoveAssignee(a.user_id)}
                aria-label={`Remove ${a.name}`}
                className="group min-w-[44px] min-h-[44px] -mx-3 -my-3 inline-flex items-center justify-center cursor-pointer text-muted hover:text-text"
              >
                <span className="w-5 h-5 inline-flex items-center justify-center rounded-full group-hover:bg-[var(--card-border)]">×</span>
              </button>
            )}
          </span>
        ))}
        {canManage && availableToAdd.length > 0 && (
          <span className="inline-flex items-center gap-1">
            <select
              value={addingUserId}
              onChange={(e) => setAddingUserId(e.target.value)}
              className="min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-xs px-2"
            >
              <option value="">+ Add…</option>
              {availableToAdd.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAddAssignee}
              disabled={!addingUserId}
              className="min-h-[44px] min-w-[44px] px-3 rounded-md border border-[var(--input-border)] text-text text-xs font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add
            </button>
          </span>
        )}
      </div>
      {!canManage && <p className="text-xs text-muted mt-1">Only managers can assign people.</p>}
    </div>
  );
}
