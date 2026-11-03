"use client";
// src/components/board/JobQuickEdit.tsx
// jb-14 — "Status & crew" block for the board's OrderDetailModal popup. Status saves instantly via
// PUT /v2/api/board/:id with { status } only (optimistic, reverts + shows the server's error on
// failure); people and shifts reuse the row panel's chip components. Still renders read-only when
// the user has no edit rights, so a supervisor with the wrong role sees why instead of nothing.
import { useEffect, useState } from "react";
import JobAssigneeChips, { type AssignableUser } from "./JobAssigneeChips";
import JobShiftChips from "./JobShiftChips";

export const STATUS_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "in_production", label: "In production" },
  { value: "done", label: "Done" },
  { value: "loading", label: "Loading" },
  { value: "shipped", label: "Shipped" },
];

interface JobQuickEditProps {
  jobId: string;
  status: string;
  assignableUsers: AssignableUser[];
  canManage: boolean;
  canChangeStatus: boolean;
  onChanged: (patch: { status?: string }) => void;
}

export default function JobQuickEdit({ jobId, status, assignableUsers, canManage, canChangeStatus, onChanged }: JobQuickEditProps) {
  const [value, setValue] = useState(status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(status);
  }, [status]);

  const statusLocked = status === "loading" || status === "shipped";
  const disabled = statusLocked || !canChangeStatus;

  async function handleStatusChange(next: string) {
    setValue(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/board/${jobId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setValue(status);
        setError(data.error || "Couldn't save. Try again.");
        return;
      }
      onChanged({ status: next });
    } catch {
      setValue(status);
      setError("Network error — couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-[var(--card-border)] p-3 text-sm space-y-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">Status &amp; crew</div>

      <label className="block">
        <span className="flex items-center gap-2 text-xs font-semibold text-muted mb-1">
          Status
          {saving && <span className="font-normal">Saving…</span>}
        </span>
        <select
          value={value}
          onChange={(e) => handleStatusChange(e.target.value)}
          disabled={disabled || saving}
          title={statusLocked ? "Loading/shipped jobs can't be changed from the board." : !canChangeStatus ? "You don't have permission to change job status." : undefined}
          className={`w-full sm:w-64 min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-xs text-[var(--warn-text)]">{error}</p>}

      <JobAssigneeChips jobId={jobId} assignableUsers={assignableUsers} canManage={canManage} onChanged={() => onChanged({})} />
      <JobShiftChips jobId={jobId} canManage={canManage} />
    </div>
  );
}
