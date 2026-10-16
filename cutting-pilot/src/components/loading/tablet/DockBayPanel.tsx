"use client";
// src/components/loading/tablet/DockBayPanel.tsx
// dock-10: one bay tile on the Dock Tablet page. Tinted by the dominant load's status (the TV
// BayTile rule: any "loading" load, else the lowest load_number); an empty bay gets the neutral
// "Nothing in Bay N" state. Long bays scroll inside their own tile.
import { Truck } from "lucide-react";
import DockTabletCard from "./DockTabletCard";
import { sortAssignments } from "../sortAssignments";
import { statusVariant } from "../status";
import { BAY_ACTIVE_STATUSES, type CardActionHandlers, type DockAssignment, type DockBay } from "../dockTypes";
import { DOCK_TABLET as P } from "./palette";

interface DockBayPanelProps {
  bay: DockBay;
  /** All rows -- the panel picks its own bay's active loads (and cross-bay siblings). */
  assignments: DockAssignment[];
  cardHandlers: CardActionHandlers;
  canManage: boolean;
  onMore: (a: DockAssignment, anchor: HTMLElement) => void;
}

function dominantLoad(loads: DockAssignment[]): DockAssignment | null {
  if (loads.length === 0) return null;
  const loadingOne = loads.find((l) => l.loading_status === "loading");
  if (loadingOne) return loadingOne;
  return [...loads].sort((x, y) => (x.load_number ?? 0) - (y.load_number ?? 0))[0];
}

// 64px at >=1280px wide (the spec size); scales down so two bays still fit a portrait tablet
// without the title colliding with the trailer number.
const TITLE_SIZE = "clamp(40px, 5vw, 64px)";

function BayTitle({ number, color }: { number: number; color: string }) {
  return (
    <div className="flex items-baseline justify-center whitespace-nowrap" style={{ gap: 16, color }}>
      <span className="font-bold" style={{ fontSize: TITLE_SIZE, lineHeight: 1, letterSpacing: ".02em" }}>
        BAY
      </span>
      <span className="font-mono font-bold" style={{ fontSize: TITLE_SIZE, lineHeight: 1 }}>
        {number}
      </span>
    </div>
  );
}

export default function DockBayPanel({ bay, assignments, cardHandlers, canManage, onMore }: DockBayPanelProps) {
  const isActive = (a: DockAssignment) => BAY_ACTIVE_STATUSES.includes(a.loading_status);
  const loads = sortAssignments(
    assignments.filter((a) => a.bay_id === bay.id && isActive(a)),
    "inv_asc"
  );
  const dominant = dominantLoad(loads);

  const bandGrid = {
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)",
    alignItems: "center",
    padding: "14px 20px",
  } as const;

  if (!dominant) {
    return (
      <div
        className="flex flex-col h-full min-h-0"
        style={{ background: P.emptyTileBg, border: `2px solid ${P.emptyTileBorder}`, borderRadius: 16, overflow: "hidden" }}
      >
        <div style={{ ...bandGrid, background: P.emptyBandBg, borderBottom: `2px solid ${P.emptyTileBorder}` }}>
          <span aria-hidden="true" />
          <BayTitle number={bay.bay_number} color={P.emptyInk} />
          <span className="font-semibold" style={{ justifySelf: "end", fontSize: 18, color: P.emptyInk }}>
            Open
          </span>
        </div>
        <div className="flex-1 min-h-0 flex" style={{ padding: 16 }}>
          <div
            className="flex-1 flex flex-col items-center justify-center text-center"
            style={{ border: `2px dashed ${P.emptyDash}`, borderRadius: 14, gap: 10, padding: 24 }}
          >
            <Truck size={56} strokeWidth={1.5} aria-hidden="true" style={{ color: P.faint }} />
            <div className="font-bold" style={{ fontSize: 26, color: P.ink }}>
              Nothing in Bay {bay.bay_number}
            </div>
            <div style={{ fontSize: 17, color: P.muted }}>Loads assigned to this bay will appear here automatically.</div>
          </div>
        </div>
      </div>
    );
  }

  const variant = statusVariant(dominant.loading_status);
  const trailer = (dominant.trailer_number ?? "").trim();
  const sharedCount = trailer ? loads.filter((l) => (l.trailer_number ?? "").trim() === trailer).length : 0;
  const layout = loads.length === 1 ? "full" : "compact";

  return (
    <div
      className="flex flex-col h-full min-h-0"
      style={{ background: P.surface, border: `2px solid ${variant.border}`, borderRadius: 16, overflow: "hidden" }}
    >
      <div style={{ ...bandGrid, background: variant.bg, borderBottom: `2px solid ${variant.border}` }}>
        <span aria-hidden="true" />
        <BayTitle number={bay.bay_number} color={variant.text} />
        <div className="flex flex-col items-end text-right min-w-0" style={{ justifySelf: "end" }}>
          <span
            className="font-semibold uppercase"
            style={{ fontSize: 12, letterSpacing: ".08em", color: variant.text }}
          >
            {sharedCount >= 2 ? `Trailer · ${sharedCount} orders` : "Trailer"}
          </span>
          {trailer ? (
            <span className="font-mono font-bold truncate max-w-full" style={{ fontSize: "clamp(20px, 2.4vw, 30px)", lineHeight: 1.1, color: P.ink }}>
              {trailer}
            </span>
          ) : (
            <span className="font-semibold" style={{ fontSize: 18, color: P.ink }}>
              No trailer
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto" style={{ padding: 16, gap: 12 }}>
        {loads.map((a) => (
          <DockTabletCard
            key={a.id}
            a={a}
            siblings={assignments.filter((s) => s.job_id === a.job_id && s.id !== a.id && isActive(s))}
            layout={layout}
            cardHandlers={cardHandlers}
            canManage={canManage}
            onMore={onMore}
          />
        ))}
      </div>
    </div>
  );
}
