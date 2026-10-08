"use client";
// src/components/loading/BayListItem.tsx
// Port of legacy logistics/loading.html's renderBayList row (the Loading Team View bay-list
// entry point) -- byte-for-byte visual parity per PXXX-a, including the 🚛 emoji legacy uses
// there (a deliberate, prompt-mandated exception to the platform's no-emoji-icons doctrine --
// this component's entire purpose is exact legacy parity, not new design).
import { statusVariant } from "./status";
import type { DockAssignment, DockBay } from "./dockTypes";

const BAY_ACTIVE_STATUSES = ["not_started", "loading", "loaded"];

interface BayListItemProps {
  bay: DockBay;
  assignments: DockAssignment[]; // full board assignment set -- filtered internally by bay
  onSelect: (bayId: string) => void;
}

export default function BayListItem({ bay, assignments, onSelect }: BayListItemProps) {
  const bayAssignments = assignments.filter(
    (a) => a.bay_id === bay.id && BAY_ACTIVE_STATUSES.includes(a.loading_status)
  );
  const jobCount = bayAssignments.length;
  const activeJob = bayAssignments.find((a) => a.loading_status === "loading") ?? bayAssignments[0] ?? null;
  const variant = activeJob ? statusVariant(activeJob.loading_status) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(bay.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(bay.id);
        }
      }}
      className="flex items-center justify-between rounded border cursor-pointer transition-colors hover:bg-[var(--ghost-bg)]/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
      style={{
        padding: 16,
        marginBottom: 8,
        borderColor: "var(--line)",
        borderLeftWidth: 5,
        borderLeftColor: variant ? variant.border : "var(--line)",
        background: variant
          ? `linear-gradient(0deg, ${variant.border}14, ${variant.border}14), var(--card-bg)`
          : "var(--card-bg)",
      }}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-3.5 flex-wrap">
          <span className="font-bold text-text" style={{ fontSize: 22 }}>
            Bay {bay.bay_number}
          </span>
          {activeJob?.trailer_number && (
            <span
              className="font-bold text-text rounded"
              style={{ fontSize: 15, padding: "3px 10px", background: "var(--ghost-bg)" }}
            >
              🚛 {activeJob.trailer_number}
            </span>
          )}
          {variant && (
            <span className="text-xs font-bold" style={{ color: variant.border }}>
              {variant.label}
            </span>
          )}
        </div>
        {activeJob ? (
          <div className="text-[13px] text-muted mt-1.5 truncate">
            {activeJob.customer || "Unknown customer"}
            {activeJob.invoice_number ? ` — INV# ${activeJob.invoice_number}` : ""}
          </div>
        ) : (
          <div className="text-[13px] mt-1.5" style={{ color: "#9ca3af" }}>
            No active jobs
          </div>
        )}
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        {jobCount > 0 && (
          <span
            className="text-text font-bold rounded"
            style={{ fontSize: 12, padding: "4px 10px", background: "var(--ghost-bg)" }}
          >
            {jobCount} job{jobCount === 1 ? "" : "s"}
          </span>
        )}
        <span style={{ color: "#9ca3af", fontSize: 18 }}>›</span>
      </div>
    </div>
  );
}
