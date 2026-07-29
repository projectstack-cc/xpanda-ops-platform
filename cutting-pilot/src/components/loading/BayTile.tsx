// src/components/loading/BayTile.tsx
// One bay: tile background tints to the dominant active load's status color (prefers
// "loading" if any load is in that status, else the lowest load_number); an empty bay renders
// as a neutral surface. Body stacks every active load in the bay.
import type { LoadingBoardBay, LoadingBoardLoad } from "./LoadingBoard";
import LoadCard from "./LoadCard";
import { statusVariant } from "./status";

interface BayTileProps {
  bay: LoadingBoardBay;
}

function dominantLoad(loads: LoadingBoardLoad[]): LoadingBoardLoad | null {
  if (loads.length === 0) return null;
  const loadingOne = loads.find((l) => l.loading_status === "loading");
  if (loadingOne) return loadingOne;
  return [...loads].sort((a, b) => a.load_number - b.load_number)[0];
}

export default function BayTile({ bay }: BayTileProps) {
  const dominant = dominantLoad(bay.loads);
  const variant = dominant ? statusVariant(dominant.loading_status) : null;
  const defaultLabel = `Bay ${bay.bay_number}`;

  return (
    <div
      className="min-h-0 flex flex-col rounded-lg border overflow-hidden"
      style={{
        background: variant ? `${variant.bg}` : "var(--surface)",
        borderColor: variant ? variant.border : "var(--line)",
      }}
    >
      <div
        className="shrink-0 flex items-center justify-between gap-1 px-2 py-1 border-b"
        style={{ borderColor: variant ? variant.border : "var(--line)" }}
      >
        <span
          className="font-bold text-[clamp(0.95rem,2vh,1.3rem)]"
          style={{ color: variant ? variant.text : "var(--text)" }}
        >
          {defaultLabel}
        </span>
        {bay.label && bay.label !== defaultLabel && (
          <span
            className="text-[clamp(0.6rem,1vh,0.8rem)] font-medium truncate"
            style={{ color: variant ? variant.text : "var(--text-faint)" }}
          >
            {bay.label}
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-1 p-1.5 overflow-hidden">
        {bay.loads.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-[clamp(0.7rem,1.2vh,0.9rem)] italic text-text-faint">
            Empty
          </div>
        ) : (
          bay.loads.map((load, i) => (
            <LoadCard key={`${load.invoice_number ?? "load"}-${load.load_number}-${i}`} load={load} />
          ))
        )}
      </div>
    </div>
  );
}
