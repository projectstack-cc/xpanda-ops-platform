"use client";
// src/components/board/StatusCards.tsx
// Three clickable status tiles (Open / Cutting / Loading) at the top of the Job Board.
// board-ui-01: rendered with the shared dashboard StatTile (logistics KPI-tile parity) — global
// counts, not week-filtered; clicking a tile opens the existing StatusModal via onSelect(bucket).
import type { KeyboardEvent, ReactNode } from "react";
import { Clock, Scissors, Truck } from "lucide-react";
import StatTile from "@/components/dashboard/StatTile";

export type StatusBucket = "open" | "cutting" | "loading";

interface StatusCardsProps {
  counts: { open: number; cutting: number; loading: number };
  onSelect: (bucket: StatusBucket) => void;
}

const CARDS: Array<{ bucket: StatusBucket; label: string; caption: string; iconWrapClassName: string; icon: ReactNode }> = [
  {
    bucket: "open",
    label: "Open jobs",
    caption: "not started / in production",
    iconWrapClassName:
      "w-10 h-10 rounded-lg bg-[var(--warn-bg)]/30 border border-[var(--warn-border)] flex items-center justify-center text-[var(--warn-text)]",
    icon: <Clock size={20} />,
  },
  {
    bucket: "cutting",
    label: "Cutting",
    caption: "line in progress",
    iconWrapClassName:
      "w-10 h-10 rounded-lg bg-[var(--info-bg)]/20 border border-[var(--info-border)] flex items-center justify-center text-[var(--brand)]",
    icon: <Scissors size={20} />,
  },
  {
    bucket: "loading",
    label: "Loading",
    caption: "on the dock",
    iconWrapClassName:
      "w-10 h-10 rounded-lg bg-[var(--ghost-bg)] border border-[var(--border)] flex items-center justify-center text-muted",
    icon: <Truck size={20} />,
  },
];

export default function StatusCards({ counts, onSelect }: StatusCardsProps) {
  // Same click + keyboard-activation pattern as ShipmentDashboard's statTileProps.
  function tileProps(bucket: StatusBucket) {
    return {
      role: "button" as const,
      tabIndex: 0,
      onClick: () => onSelect(bucket),
      onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(bucket);
        }
      },
    };
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
      {CARDS.map((c) => (
        <StatTile
          key={c.bucket}
          tileProps={tileProps(c.bucket)}
          label={c.label}
          orders={counts[c.bucket]}
          loads={undefined}
          hideLoads
          unit={["job", "jobs"]}
          caption={c.caption}
          iconWrapClassName={c.iconWrapClassName}
          icon={c.icon}
        />
      ))}
    </div>
  );
}
