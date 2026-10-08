"use client";
// src/app/logistics/loading/TeamView.tsx
// Port of legacy logistics/loading.html's Loading Team View (renderBayList + drillIntoBay/
// backToBayList/renderBayView) -- a distinct two-screen stack, not the reduced single-board
// view unit 3b originally shipped (see DockBoard.tsx's header note). Reads `selectedBayId`
// from DockBoard rather than owning it locally: PXXX-a's own bay <select> in the toolbar and
// PXXX-b's notification deep-link both need to drive the same drill-in state from outside this
// component.
import BayListItem from "@/components/loading/BayListItem";
import DockAssignmentCard from "@/components/loading/DockAssignmentCard";
import { sortAssignments, type LdSortOrder } from "@/components/loading/sortAssignments";
import type { CardActionHandlers, DockAssignment, DockBay } from "@/components/loading/dockTypes";

const BAY_ACTIVE_STATUSES = ["not_started", "loading", "loaded"];

interface TeamViewProps {
  bays: DockBay[];
  assignments: DockAssignment[];
  sortOrder: LdSortOrder;
  selectedBayId: string | null;
  onSelectBay: (bayId: string | null) => void;
  cardHandlers: CardActionHandlers;
  highlightedId?: string | null;
}

export default function TeamView({
  bays,
  assignments,
  sortOrder,
  selectedBayId,
  onSelectBay,
  cardHandlers,
  highlightedId = null,
}: TeamViewProps) {
  const yard = sortAssignments(
    assignments.filter(
      (a) => a.location === "yard" && a.loading_status !== "in_transit" && a.loading_status !== "delivered"
    ),
    sortOrder
  );

  if (selectedBayId === null) {
    return (
      <div>
        <div>
          {bays.length === 0 ? (
            <p className="text-sm text-text-faint px-1">No bays configured.</p>
          ) : (
            bays.map((bay) => (
              <BayListItem key={bay.id} bay={bay} assignments={assignments} onSelect={onSelectBay} />
            ))
          )}
        </div>
        <section className="space-y-2" style={{ marginTop: 16 }}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted px-1">Yard</h2>
          {yard.length === 0 ? (
            <p className="text-sm text-text-faint px-1">No trailers in the yard.</p>
          ) : (
            <div className="space-y-2">
              {yard.map((a) => (
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
      </div>
    );
  }

  const bay = bays.find((b) => b.id === selectedBayId);
  if (!bay) return null;

  const bayAssignments = assignments.filter(
    (a) => a.bay_id === selectedBayId && BAY_ACTIVE_STATUSES.includes(a.loading_status)
  );
  const activeJob = bayAssignments.find((a) => a.loading_status === "loading") ?? bayAssignments[0] ?? null;

  const groups: { status: string; label: string }[] = [
    { status: "not_started", label: "Not Started" },
    { status: "loading", label: "Loading" },
    { status: "loaded", label: "Loaded" },
  ];

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => onSelectBay(null)}
        className="cursor-pointer"
        style={{ color: "#3b82f6", fontSize: 14, fontWeight: 600 }}
      >
        ← All bays
      </button>
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
      {groups.map((g) => {
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
