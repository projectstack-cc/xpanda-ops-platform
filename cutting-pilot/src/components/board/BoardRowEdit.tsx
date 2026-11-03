"use client";
// src/components/board/BoardRowEdit.tsx
// P439 — inline row-expand edit panel for the production board (P343 — restored). Editable
// subset ONLY: ship_date, priority, notes, status — everything else on the order
// (customer, po_number, invoice_number, ship_to_*, method/carrier, line items, cutting/packing
// instructions) is shown read-only here and edited via the full OrderEditModal (P439 modal
// opened from the Edit button). The "Open in order entry →" link is intentionally gone
// because the modal now covers everything /v2/orders would.
import { useState } from "react";
import type { BoardJob } from "./ProductionBoard";
import JobAssigneeChips, { type AssignableUser } from "./JobAssigneeChips";
import JobShiftChips from "./JobShiftChips";
import PrioritySelect from "./PrioritySelect";
import { fromPriorityChoice, toPriorityChoice, type PriorityChoice } from "@/lib/priority";
import { statusOptionsFor } from "@/lib/board/statusOptions";

interface BoardRowEditProps {
  job: BoardJob;
  assignableUsers: AssignableUser[];
  canManageShifts: boolean;
  canChangeStatus: boolean;
  onSaved: () => void;
  onCancel: () => void;
}

const inputClass =
  "w-full min-h-[40px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
const labelClass = "block text-xs font-semibold text-muted mb-1";

export default function BoardRowEdit({ job, assignableUsers, canManageShifts, canChangeStatus, onSaved, onCancel }: BoardRowEditProps) {
  const [shipDate, setShipDate] = useState(job.ship_date || "");
  const [choice, setChoice] = useState<PriorityChoice>(toPriorityChoice(job.priority, job.priority_level));
  const [notes, setNotes] = useState(job.notes || "");
  const [status, setStatus] = useState(job.status);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const statusLocked = job.status === "loading" || job.status === "shipped";

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/v2/api/board/${job.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ship_date: shipDate,
          ...fromPriorityChoice(choice),
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

  return (
    <div className="p-4 bg-[var(--surface-2)] border-t border-[var(--line)] space-y-4">
      {saveError && (
        <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-3 py-2">
          {saveError}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className={labelClass}>Ship date</span>
          <input type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} className={inputClass} />
        </label>
        <PrioritySelect value={choice} onChange={setChoice} className={inputClass} labelClassName={labelClass} />
        <label className="block">
          <span className={labelClass}>Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={statusLocked || !canChangeStatus}
            title={statusLocked ? "Loading/shipped jobs can't be changed from the board." : !canChangeStatus ? "You don't have permission to change job status." : undefined}
            className={`${inputClass} ${(statusLocked || !canChangeStatus) ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            {statusOptionsFor(job.status).map((o) => (
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

      <JobAssigneeChips jobId={job.id} assignableUsers={assignableUsers} canManage={canManageShifts} onChanged={onSaved} />

      {/* jb-10: Shifts moved here from OrderEditModal — writes immediately, no board refetch. */}
      <JobShiftChips jobId={job.id} canManage={canManageShifts} />

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
