"use client";
// src/app/logistics/loading/TeamView.tsx
// Port of legacy logistics/loading.html's Loading Team View (renderBayList + drillIntoBay/
// backToBayList/renderBayView) -- a distinct two-screen stack, not the reduced single-board
// view unit 3b originally shipped (see DockBoard.tsx's header note). Reads `selectedBayId`
// from DockBoard rather than owning it locally: PXXX-a's own bay <select> in the toolbar and
// PXXX-b's notification deep-link both need to drive the same drill-in state from outside this
// component.
import BayListItem from "@/components/loading/BayListItem";
import BayDetail from "@/components/loading/BayDetail";
import DockAssignmentCard from "@/components/loading/DockAssignmentCard";
import { sortAssignments, type LdSortOrder } from "@/components/loading/sortAssignments";
import type { CardActionHandlers, DockAssignment, DockBay } from "@/components/loading/dockTypes";

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

  return (
    <BayDetail
      bay={bay}
      assignments={assignments}
      sortOrder={sortOrder}
      cardHandlers={cardHandlers}
      highlightedId={highlightedId}
      onBack={() => onSelectBay(null)}
    />
  );
}
