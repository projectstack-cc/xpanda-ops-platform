"use client";
// src/app/logistics/loading/BayPairView.tsx
// dock-08: the dock-tablet "Bay Pair" view (`?view=pair&bays=20,21`) -- one or two bays side by
// side, each the same BayDetail body Team View drills into, with the same card handlers and
// modals (via DockBoard's useDockActions/DockModalHost). Bays only: no Awaiting/Yard/Transit/
// Delivered and no drag; moving a load between bays goes through the card's "Assign bay" action.
import BayDetail from "@/components/loading/BayDetail";
import type { LdSortOrder } from "@/components/loading/sortAssignments";
import type { CardActionHandlers, DockAssignment, DockBay } from "@/components/loading/dockTypes";

interface BayPairViewProps {
  bays: DockBay[];
  assignments: DockAssignment[];
  sortOrder: LdSortOrder;
  cardHandlers: CardActionHandlers;
  highlightedId: string | null;
  pairBayNumbers: number[];
  onChangeBays: () => void;
}

export default function BayPairView({
  bays,
  assignments,
  sortOrder,
  cardHandlers,
  highlightedId,
  pairBayNumbers,
  onChangeBays,
}: BayPairViewProps) {
  const pairBays = pairBayNumbers
    .map((n) => bays.find((b) => b.bay_number === n))
    .filter((b): b is DockBay => !!b);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-bold text-text" style={{ fontSize: 28, margin: 0 }}>
          {pairBays.length === 0 ? "No bays selected" : pairBays.map((b) => `Bay ${b.bay_number}`).join(" · ")}
        </h2>
        <button
          type="button"
          onClick={onChangeBays}
          className="min-h-[44px] px-4 rounded border border-[var(--input-border)] bg-[var(--card-bg)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--surface-2)] transition-colors"
        >
          Change bays
        </button>
      </div>
      <div className={pairBays.length === 2 ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "grid grid-cols-1 gap-4"}>
        {pairBays.map((bay) => (
          <div
            key={bay.id}
            className="rounded border border-[var(--line)] bg-[var(--surface-2)] p-3 overflow-y-auto max-h-[calc(100vh-12rem)] min-w-0"
          >
            <BayDetail
              bay={bay}
              assignments={assignments}
              sortOrder={sortOrder}
              cardHandlers={cardHandlers}
              highlightedId={highlightedId}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
