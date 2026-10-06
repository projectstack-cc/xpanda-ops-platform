"use client";
// src/components/board/ShipDaysModal.tsx
// jb-03: job-keyed "Assign Ship Days" (split shipment) editor for the /v2/board edit modal — a v2
// port of legacy jobs/index.html openSplitDaysModal/saveSplitDays. Reads GET /api/loading-assignments
// ?job_id= and saves via legacy PUT /api/loading-assignments/load-days (manager-only server-side),
// which only UPDATEs existing assignment rows — a load not yet on the loading board is silently
// skipped, and this modal mirrors that (no rows created). Distinct from logistics/AssignShipDaysModal,
// which is shipment-keyed and saves through the v2 /v2/api/shipments/:id/load-days route.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";

interface ShipDaysModalProps {
  jobId: string | null;
  loadCount: number;
  onClose: () => void;
  onSaved: () => void;
}

const inputCls =
  "flex-1 min-w-0 min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";

const pad = (n: number) => String(n).padStart(2, "0");

export default function ShipDaysModal({ jobId, loadCount, onClose, onSaved }: ShipDaysModalProps) {
  const count = Math.max(Number(loadCount) || 1, 1);
  const [values, setValues] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch + seed one row per load 1..loadCount every time the modal opens for a job.
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setValues([]);
    setLoading(true);
    setLoadError(null);
    setError(null);
    setSaving(false);
    fetch(`/api/loading-assignments?job_id=${encodeURIComponent(jobId)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !json?.ok || !Array.isArray(json.assignments)) {
          setLoadError(json?.error || "Couldn't load this order's loads.");
          return;
        }
        const byLoad: Record<number, string> = {};
        for (const a of json.assignments as { load_number?: number | null; load_ship_date?: string | null }[]) {
          if (a.load_number) byLoad[Number(a.load_number)] = String(a.load_ship_date ?? "").trim().slice(0, 10);
        }
        const seeded: string[] = [];
        for (let n = 1; n <= count; n++) seeded.push(byLoad[n] ?? "");
        setValues(seeded);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Network error — couldn't reach the server.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId, count]);

  const setAt = (i: number, v: string) => setValues((prev) => prev.map((x, j) => (j === i ? v : x)));

  async function save() {
    if (!jobId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/loading-assignments/load-days", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          days: values.map((v, i) => ({ load_number: i + 1, ship_date: v.trim() ? v.trim() : null })),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error || `Save failed (HTTP ${res.status}).`);
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Network error — couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={!!jobId} onClose={onClose} title="Assign Ship Days" size="md">
      <p className="text-xs text-muted">Only loads already on the loading board get a date.</p>

      {loading && <p className="text-sm text-muted py-2">Loading…</p>}

      {!loading && loadError && (
        <div role="alert" className="rounded-md bg-[var(--danger-bg)] text-[var(--danger-text)] text-sm px-3 py-2">
          {loadError}
        </div>
      )}

      {!loading && !loadError && (
        <div className="space-y-3">
          {values.map((v, i) => (
            <div key={i}>
              <label htmlFor={`jb-ship-day-${i + 1}`} className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">
                Load {pad(i + 1)}
              </label>
              <input
                id={`jb-ship-day-${i + 1}`}
                type="date"
                value={v}
                onChange={(e) => setAt(i, e.target.value)}
                className={inputCls}
              />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-md bg-[var(--danger-bg)] text-[var(--danger-text)] text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="min-h-[44px] px-4 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || loading || !!loadError}
          className="min-h-[44px] px-5 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
