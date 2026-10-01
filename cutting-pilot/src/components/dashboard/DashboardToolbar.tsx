// src/components/dashboard/DashboardToolbar.tsx
// board-ui-01: toolbar card (left: view/week controls, right: search/filter) shared by the v2
// Shipment Dashboard and Job Board (wrapper markup + classes moved verbatim from ShipmentDashboard.tsx).
import type { ReactNode } from "react";

interface DashboardToolbarProps {
  left: ReactNode;
  right: ReactNode;
}

export default function DashboardToolbar({ left, right }: DashboardToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 bg-surface border border-[var(--card-border)] rounded-xl p-3 shadow-sm">
      {/* Left: View Mode Toggle + Week Controls */}
      <div className="flex flex-wrap items-center gap-2">{left}</div>

      {/* Right: Search Box & Filter */}
      <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">{right}</div>
    </div>
  );
}
