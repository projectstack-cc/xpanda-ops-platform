"use client";
// src/components/board/ZoneEditorModal.tsx
// jb-07 — manual offload-zone editor, mirroring legacy openZoneEditorModal(): one row per line
// item (zone label w/ datalist of existing labels + delivery order), label input adopts another
// row's order, order input propagates to every row sharing the label. Saves through the legacy
// PUT /api/jobs/:id/zones { enabled: true, items } (one source of server truth, `jobs` edit gate).
// Fetches FRESH line items on open — ids from the edit modal's local state can be stale.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { validateZoneRows } from "@/lib/offloadZones";

interface FreshLineItem {
  id: string;
  part_number: string | null;
  description: string | null;
  quantity: number | string | null;
  offload_seq: number | null;
  zone_label: string | null;
}

interface EditorRow {
  id: string;
  desc: string;
  qty: string;
  zone_label: string;
  offload_seq: string;
}

interface ZoneEditorModalProps {
  isOpen: boolean;
  jobId: string;
  /** saved=true only after a successful PUT; any other close (×, backdrop, Esc, Cancel) is false. */
  onClose: (saved: boolean) => void;
}

const inputClass =
  "min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-2 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";

export default function ZoneEditorModal({ isOpen, jobId, onClose }: ZoneEditorModalProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<EditorRow[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setError(null);
    setRows([]);
    setLabels([]);
    (async () => {
      try {
        const res = await fetch(`/v2/api/board/${encodeURIComponent(jobId)}`);
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data?.ok) {
          setLoadError(data?.error || "Couldn't load this order's line items.");
          return;
        }
        const items: FreshLineItem[] = Array.isArray(data.line_items) ? data.line_items : [];
        if (!items.length) {
          setLoadError("Add line items before enabling offload zones.");
          return;
        }
        setLabels(Array.from(new Set(items.map((li) => (li.zone_label || "").trim()).filter(Boolean))));
        setRows(items.map((li) => ({
          id: li.id,
          desc: li.description || li.part_number || "Untitled",
          qty: li.quantity == null ? "" : String(li.quantity),
          zone_label: li.zone_label || "",
          offload_seq: li.offload_seq == null ? "" : String(li.offload_seq),
        })));
      } catch {
        if (!cancelled) setLoadError("Network error — couldn't reach the server.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, jobId]);

  // Legacy onZoneLabelInput: if another row already uses this label with an order set, adopt it.
  // A brand-new label keeps whatever order the row had — the user fills it in.
  function handleLabelChange(idx: number, value: string) {
    setRows((prev) => {
      const label = value.trim();
      let order = prev[idx].offload_seq;
      if (label) {
        const match = prev.find((r, i) => i !== idx && r.zone_label.trim() === label && r.offload_seq !== "");
        if (match) order = match.offload_seq;
      }
      return prev.map((r, i) => (i === idx ? { ...r, zone_label: value, offload_seq: order } : r));
    });
  }

  // Legacy onZoneOrderInput: delivery order is a property of the zone — propagate to every row
  // currently sharing this row's label.
  function handleOrderChange(idx: number, value: string) {
    setRows((prev) => {
      const label = prev[idx].zone_label.trim();
      return prev.map((r, i) =>
        i === idx || (label && r.zone_label.trim() === label) ? { ...r, offload_seq: value } : r,
      );
    });
  }

  async function handleSave() {
    setError(null);
    const collected = rows.map((r) => ({ id: r.id, zone_label: r.zone_label.trim(), offload_seq: r.offload_seq }));
    const validationError = validateZoneRows(collected);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/zones`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          items: collected.map((r) => ({ id: r.id, zone_label: r.zone_label, offload_seq: Number(r.offload_seq) })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Couldn't save offload zones.");
        return;
      }
      onClose(true);
    } catch {
      setError("Network error — couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  const datalistId = `zone-editor-labels-${jobId}`;

  return (
    <Modal isOpen={isOpen} onClose={() => onClose(false)} title="Edit Offload Zones" size="lg">
      <p className="text-sm text-muted">
        Assign each line item to a delivery zone. Give each zone a delivery order — editing one
        line&apos;s order updates every line in that zone.
      </p>

      {loading && <p className="text-sm text-muted py-2">Loading line items…</p>}
      {!loading && loadError && <p className="text-sm text-[var(--warn-text)] py-2">{loadError}</p>}

      {!loading && !loadError && rows.length > 0 && (
        <>
          <datalist id={datalistId}>
            {labels.map((l) => <option key={l} value={l} />)}
          </datalist>
          <div className="divide-y divide-[var(--card-border)]">
            {rows.map((r, idx) => (
              <div key={r.id} className="flex items-center gap-2 py-2">
                <div className="flex-[2] min-w-0">
                  <div className="text-sm font-semibold text-text truncate">{r.desc}</div>
                  <div className="text-xs text-muted">Qty: {r.qty}</div>
                </div>
                <input
                  type="text"
                  list={datalistId}
                  value={r.zone_label}
                  onChange={(e) => handleLabelChange(idx, e.target.value)}
                  placeholder="e.g. Dock A"
                  aria-label={`Zone for ${r.desc}`}
                  className={`${inputClass} flex-1 min-w-0`}
                />
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={r.offload_seq}
                  onChange={(e) => handleOrderChange(idx, e.target.value)}
                  placeholder="Order"
                  aria-label={`Delivery order for ${r.desc}`}
                  className={`${inputClass} w-[72px] text-center`}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {error && (
        <div className="rounded-md border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => onClose(false)}
          disabled={saving}
          className="min-h-[44px] px-4 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || loading || !!loadError || !rows.length}
          className="min-h-[44px] px-5 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save zones"}
        </button>
      </div>
    </Modal>
  );
}
