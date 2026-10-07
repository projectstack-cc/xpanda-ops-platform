"use client";
// src/components/board/JobShiftChips.tsx
// jb-10 — Job Shifts chip block for the board row dropdown (BoardRowEdit), moved out of
// OrderEditModal. Self-contained: loads GET /v2/api/orders/:id/shifts on mount; add (POST) and
// remove (DELETE /v2/api/orders/:id/shifts/:shift) write immediately. Manager-gated client-side
// via `canManage` (isAdmin || jobs.manage edit); the routes enforce it server-side (403). Shift
// changes don't touch the board — the board doesn't display shifts, so no onSaved/refetch.
import { useEffect, useState } from "react";

export const SHIFT_LABELS: Record<string, string> = { "1st": "1st Shift", "2nd": "2nd Shift", "3rd": "3rd Shift" };

const labelClass = "block text-xs font-semibold text-muted mb-1";

interface JobShiftChipsProps {
  jobId: string;
  canManage: boolean;
}

export default function JobShiftChips({ jobId, canManage }: JobShiftChipsProps) {
  const [shifts, setShifts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingShift, setAddingShift] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/v2/api/orders/${jobId}/shifts`);
        const data = await res.json();
        if (!cancelled && res.ok && data?.ok) {
          setShifts(Array.isArray(data.shifts) ? data.shifts : []);
        }
      } catch {
        // Non-fatal — the row panel still works without shifts.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  async function handleAddShift(shift: string) {
    if (!shift) return;
    setError(null);
    try {
      const res = await fetch(`/v2/api/orders/${jobId}/shifts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shift }),
      });
      const data = await res.json();
      if (res.status === 403) {
        setError("Manager access required to assign shifts.");
        return;
      }
      if (!res.ok || !data.ok) {
        setError(data.error || "Couldn't add shift. Try again.");
        return;
      }
      const r = await fetch(`/v2/api/orders/${jobId}/shifts`);
      const j = await r.json();
      if (r.ok && j?.ok) setShifts(Array.isArray(j.shifts) ? j.shifts : []);
    } catch {
      setError("Network error — couldn't reach the server.");
    }
  }

  async function handleRemoveShift(shift: string) {
    setError(null);
    try {
      const res = await fetch(`/v2/api/orders/${jobId}/shifts/${encodeURIComponent(shift)}`, { method: "DELETE" });
      const data = await res.json();
      if (res.status === 403) {
        setError("Manager access required to assign shifts.");
        return;
      }
      if (!res.ok || !data.ok) {
        setError(data.error || "Couldn't remove shift. Try again.");
        return;
      }
      setShifts((prev) => prev.filter((s) => s !== shift));
    } catch {
      setError("Network error — couldn't reach the server.");
    }
  }

  const availableToAdd = ["1st", "2nd", "3rd"].filter((s) => !shifts.includes(s));

  return (
    <div>
      <span className={labelClass}>Shifts</span>
      {error && <p className="text-xs text-[var(--warn-text)] mb-2">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {loading && <span className="text-xs text-muted">Loading…</span>}
        {!loading && shifts.length === 0 && <span className="text-xs text-muted">No shifts assigned</span>}
        {shifts.map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full bg-[var(--info-bg)] text-xs font-medium text-[var(--info-text)] border border-[var(--info-border)]"
          >
            {SHIFT_LABELS[s] || s}
            {canManage && (
              <button
                type="button"
                onClick={() => handleRemoveShift(s)}
                aria-label={`Remove ${s} shift`}
                className="min-w-[20px] min-h-[20px] inline-flex items-center justify-center rounded-full hover:bg-[var(--card-border)] cursor-pointer text-[var(--info-text)] hover:text-text"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {canManage && !loading && availableToAdd.length > 0 && (
          <select
            value={addingShift}
            onChange={(e) => {
              const v = e.target.value;
              setAddingShift("");
              if (v) handleAddShift(v);
            }}
            className="min-h-[32px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-xs px-2"
          >
            <option value="">Add shift…</option>
            {availableToAdd.map((s) => (
              <option key={s} value={s}>
                {SHIFT_LABELS[s]}
              </option>
            ))}
          </select>
        )}
      </div>
      {!canManage && <p className="text-xs text-muted mt-1">Only managers can assign shifts.</p>}
    </div>
  );
}
