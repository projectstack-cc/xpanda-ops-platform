// src/components/schedule/WeekBand.tsx
// One horizontal band for a single ship week: a label strip + MONDAY..FRIDAY as columns
// across. Always renders all five day slots (even with zero rows) so the two bands line up.
import type { ScheduleDayGroup } from "@/types/schedule";
import DayColumn from "./DayColumn";
import type { Density } from "./density";

const DAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;

interface WeekBandProps {
  weekLabel: string;
  days: ScheduleDayGroup[];
  density: Density;
  rowCap: number;
}

export default function WeekBand({ weekLabel, days, density, rowCap }: WeekBandProps) {
  const byDay = new Map(days.map((d) => [d.day_of_week, d]));

  return (
    <section className="flex-1 min-h-0 flex flex-col">
      <h2 className="shrink-0 px-2 py-0.5 border-b border-[var(--line)] bg-[var(--surface-2)] text-[10px] font-semibold uppercase tracking-wide text-muted">
        {weekLabel}
      </h2>
      <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-5 gap-px bg-[var(--line)]">
        {DAY_ORDER.map((day) => {
          const group = byDay.get(day);
          return (
            <DayColumn
              key={day}
              dayOfWeek={day}
              shipDate={group?.ship_date ?? null}
              rows={group?.rows ?? []}
              density={density}
              rowCap={rowCap}
            />
          );
        })}
      </div>
    </section>
  );
}
