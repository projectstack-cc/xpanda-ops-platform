"use client";
// src/components/dashboard/WeekSelector.tsx
// board-ui-01: This Week / Next Week / Show All + prev/next week stepping, shared by the v2 Shipment
// Dashboard and Job Board (JSX + classes moved verbatim from ShipmentDashboard.tsx).
// weekOffset: 0 = This Week, 1 = Next Week, null = Show All.
import { ChevronLeft, ChevronRight } from "lucide-react";

interface WeekSelectorProps {
  weekOffset: number | null;
  onChange: (offset: number | null) => void;
  label?: string;
}

export default function WeekSelector({ weekOffset, onChange, label }: WeekSelectorProps) {
  return (
    <div className="flex items-center gap-1 ml-1">
      <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5 bg-[var(--ghost-bg)]">
        <button
          type="button"
          onClick={() => onChange(0)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
            weekOffset === 0
              ? "bg-[var(--brand)] text-white shadow-xs"
              : "text-muted hover:text-text"
          }`}
        >
          This Week
        </button>
        <button
          type="button"
          onClick={() => onChange(1)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
            weekOffset === 1
              ? "bg-[var(--brand)] text-white shadow-xs"
              : "text-muted hover:text-text"
          }`}
        >
          Next Week
        </button>
        <button
          type="button"
          onClick={() => onChange(null)}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
            weekOffset === null
              ? "bg-surface text-text shadow-xs"
              : "text-muted hover:text-text"
          }`}
        >
          Show All
        </button>
      </div>

      {weekOffset !== null && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChange(weekOffset - 1)}
            className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-muted hover:text-text hover:bg-[var(--ghost-bg)] cursor-pointer"
            title="Previous week"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs font-medium text-text px-1">
            {label}
          </span>
          <button
            type="button"
            onClick={() => onChange(weekOffset + 1)}
            className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-muted hover:text-text hover:bg-[var(--ghost-bg)] cursor-pointer"
            title="Next week"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
