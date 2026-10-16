"use client";
// src/components/loading/BayDetail.tsx
// dock-07: one bay's full-density detail (heading, trailer chip, Not Started / Loading / Loaded
// groups), extracted from TeamView.tsx's drill-in screen so the Bay Pair tablet view (dock-08)
// renders the same body. "← All bays" renders only when the caller passes onBack.
import DockAssignmentCard from "./DockAssignmentCard";
import { sortAssignments, type LdSortOrder } from "./sortAssignments";
import { BAY_ACTIVE_STATUSES, type CardActionHandlers, type DockAssignment, type DockBay } from "./dockTypes";

interface BayDetailProps {
  bay: DockBay;
  assignments: DockAssignment[];
  sortOrder: LdSortOrder;
  cardHandlers: CardActionHandlers;
  highlightedId?: string | null;
  onBack?: () => void;
}

const GROUPS: { status: string; label: string }[] = [
  { status: "not_started", label: "Not Started" },
  { status: "loading", label: "Loading" },
  { status: "loaded", label: "Loaded" },
];

export default function BayDetail({
  bay,
  assignments,
  sortOrder,
  cardHandlers,
  highlightedId = null,
  onBack,
}: BayDetailProps) {
  const bayAssignments = assignments.filter(
    (a) => a.bay_id === bay.id && BAY_ACTIVE_STATUSES.includes(a.loading_status)
  );
  const activeJob = bayAssignments.find((a) => a.loading_status === "loading") ?? bayAssignments[0] ?? null;

  return (
    <div className="space-y-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="cursor-pointer"
          style={{ color: "var(--link)", fontSize: 14, fontWeight: 600 }}
        >
          ← All bays
        </button>
      )}
      <div className="flex items-center gap-4 flex-wrap">
        <h2 className="font-bold text-text" style={{ fontSize: 26, margin: 0 }}>
          Bay {bay.bay_number}
        </h2>
        {activeJob?.trailer_number && (
          <span
            className="font-bold text-text rounded"
            style={{ fontSize: 16, padding: "4px 12px", background: "var(--ghost-bg)" }}
          >
            🚛 {activeJob.trailer_number}
          </span>
        )}
      </div>
      {GROUPS.map((g) => {
        const members = sortAssignments(bayAssignments.filter((a) => a.loading_status === g.status), sortOrder);
        return (
          <section key={g.status} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted px-1">
              {g.label} ({members.length})
            </h3>
            {members.length === 0 ? (
              <p className="text-sm text-text-faint px-1">No jobs {g.label.toLowerCase()}.</p>
            ) : (
              <div className="space-y-2">
                {members.map((a) => (
                  <DockAssignmentCard
                    key={a.id}
                    a={a}
                    {...cardHandlers}
                    draggable={false}
                    highlighted={highlightedId === a.id}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
