"use client";
// src/components/board/BoardRowEdit.tsx
// P439 — inline row-expand edit panel for the production board (P343 — restored). Editable
// subset ONLY: ship_date, priority(+level), notes, status — everything else on the order
// (customer, po_number, invoice_number, ship_to_*, method/carrier, line items, cutting/packing
// instructions) is shown read-only here and edited via the full OrderEditModal (P439 modal
// opened from the Edit button). The "Open in order entry →" link is intentionally gone
// because the modal now covers everything /v2/orders would.
import { useEffect, useState } from "react";
import type { BoardJob } from "./ProductionBoard";

interface Assignee {
  user_id: string;
  name: string;
}

interface AssignableUser {
  id: string;
  name: string;
  username: string;
}

interface BoardRowEditProps {
  job: BoardJob;
  assignableUsers: AssignableUser[];
  onSaved: () => void;
  onCancel: () => void;
}

const inputClass =
  "w-full min-h-[40px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
const labelClass = "block text-xs font-semibold text-muted mb-1";

const STATUS_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "in_production", label: "In production" },
  { value: "done", label: "Done" },
  { value: "loading", label: "Loading" },
  { value: "shipped", label: "Shipped" },
];

const PRIORITY_LEVEL_OPTIONS = [
  { value: 0, label: "Normal" },
  { value: 1, label: "Elevated" },
  { value: 2, label: "High" },
  { value: 3, label: "Critical" },
];

export default function BoardRowEdit({ job, assignableUsers, onSaved, onCancel }: BoardRowEditProps) {
  const [shipDate, setShipDate] = useState(job.ship_date || "");
  const [priority, setPriority] = useState(job.priority || "normal");
  const [priorityLevel, setPriorityLevel] = useState(job.priority_level ?? 0);
  const [notes, setNotes] = useState(job.notes || "");
  const [status, setStatus] = useState(job.status);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [assigneesLoading, setAssigneesLoading] = useState(true);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [addingUserId, setAddingUserId] = useState("");

  const statusLocked = job.status === "loading" || job.status === "shipped";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/jobs/${job.id}/assignments`);
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
  }, [job.id]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/v2/api/board/${job.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ship_date: shipDate,
          priority,
          priority_level: priorityLevel,
          notes,
          status,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setSaveError(data.error || "Couldn't save. Try again.");
        return;
      }
      onSaved();
    } catch {
      setSaveError("Network error — couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddAssignee() {
    if (!addingUserId) return;
    setAssignError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/assignments`, {
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
      onSaved();
    } catch {
      setAssignError("Network error — couldn't reach the server.");
    }
  }

  async function handleRemoveAssignee(userId: string) {
    setAssignError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/assignments/${userId}`, { method: "DELETE" });
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
      onSaved();
    } catch {
      setAssignError("Network error — couldn't reach the server.");
    }
  }

  const availableToAdd = assignableUsers.filter((u) => !assignees.some((a) => a.user_id === u.id));

  return (
    <div className="p-4 bg-[var(--surface-2)] border-t border-[var(--line)] space-y-4">
      {saveError && (
        <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-3 py-2">
          {saveError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
        <label className="block">
          <span className={labelClass}>Ship date</span>
          <input type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Priority</span>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
            <option value="normal">Normal</option>
            <option value="rush">Rush</option>
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Priority level</span>
          <select
            value={priorityLevel}
            onChange={(e) => setPriorityLevel(Number(e.target.value))}
            className={inputClass}
          >
            {PRIORITY_LEVEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={statusLocked}
            title={statusLocked ? "Loading/shipped jobs can't be changed from the board." : undefined}
            className={`${inputClass} ${statusLocked ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className={labelClass}>Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} />
      </label>

      {/* Assign */}
      <div>
        <span className={labelClass}>Assigned</span>
        {assignError && <p className="text-xs text-[var(--warn-text)] mb-2">{assignError}</p>}
        <div className="flex flex-wrap items-center gap-2">
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
              <button
                type="button"
                onClick={() => handleRemoveAssignee(a.user_id)}
                aria-label={`Remove ${a.name}`}
                className="min-w-[20px] min-h-[20px] inline-flex items-center justify-center rounded-full hover:bg-[var(--card-border)] cursor-pointer text-muted hover:text-text"
              >
                ×
              </button>
            </span>
          ))}
          {availableToAdd.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <select
                value={addingUserId}
                onChange={(e) => setAddingUserId(e.target.value)}
                className="min-h-[32px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-xs px-2"
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
                className="min-h-[32px] px-2 rounded-md border border-[var(--input-border)] text-text text-xs font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add
              </button>
            </span>
          )}
        </div>
      </div>

      {/* Read-only order spec — no more "Open in order entry →" link (the OrderEditModal
          covers the same surface inline). */}
      <div className="rounded-lg border border-[var(--card-border)] bg-surface p-3 space-y-1">
        <span className="text-xs font-semibold text-muted">Order spec (read-only — use Edit to change)</span>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
          <div>
            <dt className="inline font-medium text-text">PO: </dt>
            <dd className="inline">{job.po_number || "—"}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-text">Invoice: </dt>
            <dd className="inline">{job.invoice_number || "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="inline font-medium text-text">Ship-to: </dt>
            <dd className="inline">
              {[job.ship_to_company, job.ship_to_attention, job.ship_to_street, job.ship_to_city, job.ship_to_state]
                .filter(Boolean)
                .join(", ") || "—"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="inline font-medium text-text">Cutting instructions: </dt>
            <dd className="inline">{job.cutting_instructions || "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="inline font-medium text-text">Packing instructions: </dt>
            <dd className="inline">{job.packing_instructions || "—"}</dd>
          </div>
        </dl>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-[40px] px-4 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)]"
        >
          Close
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="min-h-[40px] px-5 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
