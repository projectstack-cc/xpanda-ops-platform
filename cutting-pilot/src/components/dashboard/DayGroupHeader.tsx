// src/components/dashboard/DayGroupHeader.tsx
// board-ui-01: per-day section header (title, Today chip, row count, optional extra summary) shared
// by the v2 Shipment Dashboard and Job Board (JSX + classes moved verbatim from ShipmentDashboard.tsx).
import type { ReactNode } from "react";
import { formatDayHeader } from "@/lib/week";

interface DayGroupHeaderProps {
  dateKey: string;
  count: number;
  noun: [string, string];
  extra?: ReactNode;
}

export default function DayGroupHeader({ dateKey, count, noun, extra }: DayGroupHeaderProps) {
  const { title, isToday } = formatDayHeader(dateKey);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold text-text flex items-center gap-2">
          {title}
          {isToday && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-[var(--brand)] text-white">
              Today
            </span>
          )}
        </h2>
      </div>
      <div className="flex items-center gap-3 text-xs text-muted">
        <span>
          <strong className="text-text tabular-nums">{count}</strong>{" "}
          {count === 1 ? noun[0] : noun[1]}
        </span>
        {extra}
      </div>
    </div>
  );
}
