// src/components/logistics/BolActions.tsx
// Build Load + Generate/View BOL — the two per-shipment actions.
// Generate/View toggles on `bol_count > 0` (or `bol_number`).
// If no BOL is generated, shows "Generate BOL" (primary brand action).
// Once generated, alternates to "View BOL" (secondary/view action, also visible on delivered).
import { FileText, Eye, Truck } from "lucide-react";
import type { ShipmentListItem } from "./types";

interface BolActionsProps {
  shipment: ShipmentListItem;
  onViewBol: (jobId: string) => void;
  onGenerateBol: (jobId: string) => void;
}

export default function BolActions({ shipment, onViewBol, onGenerateBol }: BolActionsProps) {
  const hasBol = Number(shipment.bol_count || 0) > 0 || Boolean(shipment.bol_number);
  const jobId = shipment.job_id;
  const isCancelled = shipment.status === "cancelled";
  const isDelivered = shipment.status === "delivered";

  // If cancelled and no BOL, nothing to do
  if (isCancelled && !hasBol) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {jobId && !isDelivered && !isCancelled && (
        <a
          href={`/logistics/load-builder.html?job_id=${jobId}`}
          className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-text no-underline hover:bg-[var(--ghost-bg)] transition-colors cursor-pointer whitespace-nowrap"
          title="Open Load Builder"
        >
          <Truck size={14} aria-hidden="true" />
          Build Load
        </a>
      )}

      {hasBol ? (
        <button
          type="button"
          onClick={() => jobId && onViewBol(jobId)}
          disabled={!jobId}
          className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          title="View Bill of Lading"
        >
          <Eye size={14} aria-hidden="true" className="text-muted" />
          View BOL
        </button>
      ) : (
        <button
          type="button"
          onClick={() => jobId && onGenerateBol(jobId)}
          disabled={!jobId || isCancelled}
          className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg bg-[var(--brand)] text-white text-xs font-semibold shadow-sm hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          title={jobId ? "Generate Bill of Lading" : "No linked job"}
        >
          <FileText size={14} aria-hidden="true" />
          Generate BOL
        </button>
      )}
    </div>
  );
}
