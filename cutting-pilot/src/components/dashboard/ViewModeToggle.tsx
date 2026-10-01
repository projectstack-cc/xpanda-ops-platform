"use client";
// src/components/dashboard/ViewModeToggle.tsx
// board-ui-01: pill-style List / Calendar switch shared by the v2 Shipment Dashboard and Job Board
// (JSX + classes moved verbatim from ShipmentDashboard.tsx).
import { Calendar as CalendarIcon, List as ListIcon } from "lucide-react";

export type ViewMode = "list" | "calendar";

interface ViewModeToggleProps {
  value: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export default function ViewModeToggle({ value, onChange }: ViewModeToggleProps) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5 bg-[var(--ghost-bg)]">
      <button
        type="button"
        onClick={() => onChange("list")}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
          value === "list"
            ? "bg-surface text-text shadow-xs"
            : "text-muted hover:text-text"
        }`}
      >
        <ListIcon size={14} />
        List
      </button>
      <button
        type="button"
        onClick={() => onChange("calendar")}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
          value === "calendar"
            ? "bg-surface text-text shadow-xs"
            : "text-muted hover:text-text"
        }`}
      >
        <CalendarIcon size={14} />
        Calendar
      </button>
    </div>
  );
}
