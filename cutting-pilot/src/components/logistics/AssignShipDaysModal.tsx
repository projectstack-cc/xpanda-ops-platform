"use client";
// src/components/logistics/AssignShipDaysModal.tsx
// split-days-02: manager-only per-load ship-day editor for a split shipment (v2 port of the legacy Job Board
// "Assign Ship Days" modal, P318). One date per load; an empty date means the load ships on the order's date.
// Saves via PUT /v2/api/shipments/:id/load-days (split-days-01), which writes loading_assignments.ship_date only.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import type { ShipmentLoad } from "./types";

interface AssignShipDaysModalProps {
  isOpen: boolean;
  shipmentId: string;
  loadCount: number;
  loads: ShipmentLoad[];
  orderShipDate: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const inputCls =
  "flex-1 min-w-0 min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";

export function fmtDay(dateStr: string | null | undefined): string {
  const s = String(dateStr ?? "").slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return "—";
  const dt = new Date(y, m - 1, d);
  return `${dt.toLocaleDateString("en-US", { weekday: "short" })} ${m}/${d}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

export default function AssignShipDaysModal({
  isOpen,
  shipmentId,
  loadCount,
  loads,
  orderShipDate,
  onClose,
  onSaved,
}: AssignShipDaysModalProps) {
  const count = Math.max(loadCount || 0, 1);
  const [values, setValues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed from the loads every time the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    const seeded: string[] = [];
    for (let n = 1; n <= count; n++) {
      const ld = loads.find((l) => Number(l.load_number) === n);
      seeded.push(String(ld?.load_ship_date ?? "").trim().slice(0, 10));
    }
    setValues(seeded);
    setError(null);
    setSaving(false);
  }, [isOpen, count, loads]);

  const setAt = (i: number, v: string) => setValues((prev) => prev.map((x, j) => (j === i ? v : x)));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/shipments/${encodeURIComponent(shipmentId)}/load-days`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          days: values.map((v, i) => ({ load_number: i + 1, ship_date: v.trim() ? v.trim() : null })),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        let msg = json?.error || `Save failed (HTTP ${res.status}).`;
        if (json?.code === "missing_load_rows" && Array.isArray(json.missing) && json.missing.length) {
          msg += ` Missing: ${json.missing.map((n: number) => `Load ${pad(n)}`).join(", ")}.`;
        }
        setError(msg);
        setSaving(false);
        return;
      }
      setSaving(false);
      onSaved();
      onClose();
    } catch {
      setError("Network error — couldn't reach the server.");
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Assign Ship Days" size="md">
      <p className="text-sm text-muted">
        Set a ship day per load. Leave a load empty to ship it on the order date ({fmtDay(orderShipDate)}).
      </p>
      <div className="space-y-3">
        {values.map((v, i) => (
          <div key={i}>
            <label htmlFor={`ship-day-${i + 1}`} className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1">
              Load {pad(i + 1)}
            </label>
            <div className="flex items-center gap-2">
              <input
                id={`ship-day-${i + 1}`}
                type="date"
                value={v}
                onChange={(e) => setAt(i, e.target.value)}
                className={inputCls}
              />
              <button
                type="button"
                onClick={() => setAt(i, "")}
                disabled={!v || saving}
                className="min-h-[44px] px-3 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm text-text disabled:opacity-40 cursor-pointer"
                aria-label={`Clear Load ${pad(i + 1)} ship day`}
              >
                Clear
              </button>
            </div>
            {!v && <div className="mt-1 text-xs text-muted">Uses order date ({fmtDay(orderShipDate)})</div>}
          </div>
        ))}
      </div>
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
          className="min-h-[44px] px-4 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm font-semibold text-text disabled:opacity-40 cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="min-h-[44px] px-5 rounded-md bg-[var(--brand)] text-white text-sm font-semibold disabled:opacity-50 cursor-pointer hover:opacity-90"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Modal>
  );
}
