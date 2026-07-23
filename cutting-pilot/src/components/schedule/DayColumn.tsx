// src/components/schedule/DayColumn.tsx
// One weekday column within a WeekBand: header (day + date) + its order rows. Clips to
// `rowCap` and shows a "+N more" chip rather than shrinking text past the legibility floor.
import type { ScheduleBoardRow } from "@/types/schedule";
import OrderRow from "./OrderRow";
import type { Density } from "./density";

function formatDayHeader(dayOfWeek: string, shipDate: string | null): string {
  const short = dayOfWeek.slice(0, 3);
  if (!shipDate) return short;
  const parts = shipDate.split("-");
  if (parts.length !== 3) return short;
  const [, month, day] = parts;
  return `${short} ${Number(month)}/${Number(day)}`;
}

interface DayColumnProps {
  dayOfWeek: string;
  shipDate: string | null;
  rows: ScheduleBoardRow[];
  density: Density;
  rowCap: number;
}

export default function DayColumn({ dayOfWeek, shipDate, rows, density, rowCap }: DayColumnProps) {
  const visible = rows.slice(0, rowCap);
  const overflow = rows.length - visible.length;

  return (
    <div className="min-h-0 min-w-0 flex flex-col bg-[var(--surface)]">
      <div className="shrink-0 flex items-baseline justify-between gap-1 px-1.5 py-0.5 border-b border-[var(--line)]">
        <span className="font-mono tabular-nums text-[clamp(0.6875rem,1vh,0.8rem)] font-semibold text-text">
          {formatDayHeader(dayOfWeek, shipDate)}
        </span>
        <span className="font-mono tabular-nums text-[10px] text-text-faint">{rows.length}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {visible.length === 0 ? (
          <div className="px-1.5 py-2 text-[10px] italic text-text-faint">No loads</div>
        ) : (
          visible.map((row, i) => (
            <OrderRow key={`${row.invoice_number}-${row.job_id ?? i}`} row={row} density={density} />
          ))
        )}
        {overflow > 0 && (
          <div className="px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand)]">
            +{overflow} more
          </div>
        )}
      </div>
    </div>
  );
}
