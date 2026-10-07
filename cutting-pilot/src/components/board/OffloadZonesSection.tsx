"use client";
// src/components/board/OffloadZonesSection.tsx
// jb-07 — "Offload Zones" toggle + Edit zones for the v2 edit modal, mirroring legacy
// onOffloadZonesToggle(): turning ON with line items that fail validateZoneRows opens the editor
// (Cancel leaves the switch off); turning ON with valid data, or turning OFF, persists right away
// via PUT /api/jobs/:id/zones { enabled, items: [] } (OFF keeps the zone data, just not applied).
// Immediate writes, independent of the main Save — so the parent disables this while its form is
// dirty and refreshes its line items + dirty snapshot in onChanged().
import { useState } from "react";
import { validateZoneRows } from "@/lib/offloadZones";
import type { OrderLineItem } from "@/components/orders/OrderEntryForm";
import ZoneEditorModal from "./ZoneEditorModal";

interface OffloadZonesSectionProps {
  jobId: string;
  enabled: boolean;
  /** The edit modal's current local items — only for the quick valid-or-not check + summary. */
  lineItems: OrderLineItem[];
  canEdit: boolean;
  /** True while the edit modal has unsaved changes. */
  disabled: boolean;
  onChanged: () => void;
}

const ghostBtn =
  "min-h-[44px] px-4 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 disabled:cursor-not-allowed";

export default function OffloadZonesSection({
  jobId, enabled, lineItems, canEdit, disabled, onChanged,
}: OffloadZonesSectionProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  // True while the editor was opened by switching zones ON — the switch shows checked until the
  // editor saves (parent refetch flips `enabled`) or is cancelled (reverts to off).
  const [pendingEnable, setPendingEnable] = useState(false);

  const checked = enabled || pendingEnable;
  const controlsDisabled = disabled || busy;

  async function handleToggle(next: boolean) {
    setError(null);
    if (next) {
      const invalid = validateZoneRows(lineItems.map((li) => ({ zone_label: li.zone_label, offload_seq: li.offload_seq })));
      if (invalid) {
        setPendingEnable(true);
        setEditorOpen(true);
        return;
      }
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/zones`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next, items: [] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setError(data?.error || "Couldn't update offload zones.");
        return;
      }
      onChanged();
    } catch {
      setError("Network error — couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  function handleEditorClose(saved: boolean) {
    setEditorOpen(false);
    setPendingEnable(false);
    if (saved) onChanged();
  }

  // Compact summary from the local items: "1 · Dock A (3 lines)", in delivery order.
  const zones = new Map<string, { order: number | null; count: number }>();
  for (const li of lineItems) {
    const label = (li.zone_label || "").trim();
    if (!label) continue;
    const z = zones.get(label);
    if (z) z.count += 1;
    else zones.set(label, { order: li.offload_seq ?? null, count: 1 });
  }
  const summary = Array.from(zones.entries())
    .sort((a, b) => (a[1].order ?? Infinity) - (b[1].order ?? Infinity))
    .map(([label, z]) => `${z.order ?? "?"} · ${label} (${z.count} line${z.count === 1 ? "" : "s"})`);

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-text">Offload zones</h2>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className={`inline-flex items-center gap-2 min-h-[44px] pr-2 ${controlsDisabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => handleToggle(e.target.checked)}
              disabled={controlsDisabled}
              className="w-5 h-5 accent-[var(--brand)]"
            />
            <span className="text-sm font-semibold text-text">Offload Zones</span>
          </label>
          {enabled && (
            <button
              type="button"
              onClick={() => { setError(null); setEditorOpen(true); }}
              disabled={controlsDisabled}
              className={ghostBtn}
            >
              Edit zones
            </button>
          )}
        </div>
      ) : (
        <p className="text-sm text-text">{enabled ? "Offload zones on" : "Offload zones off"}</p>
      )}

      <p className="text-xs text-muted">Group line items into delivery zones with an unloading order.</p>
      {canEdit && disabled && <p className="text-xs text-muted">Save your other changes first.</p>}

      {enabled && summary.length > 0 && (
        <ul className="text-sm text-text space-y-0.5">
          {summary.map((s) => <li key={s}>{s}</li>)}
        </ul>
      )}

      {error && <p className="text-sm text-[var(--warn-text)]">{error}</p>}

      {canEdit && (
        <ZoneEditorModal isOpen={editorOpen} jobId={jobId} onClose={handleEditorClose} />
      )}
    </section>
  );
}
