// src/components/schedule/WeekBand.tsx
// One horizontal band for a single ship week: a label strip + MONDAY..FRIDAY as columns
// across. Always renders all five day slots (even with zero rows) so the two bands line up.
import type { ScheduleDayGroup } from "@/types/schedule";
import DayColumn from "./DayColumn";
import type { Birthday } from "@/types/schedule";
import { parseWeekMonday, birthdaysForColumn } from "./birthdays";

const DAY_ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;

// The header date must not depend on a day having loads. `weekMonday` (already parsed for the
// P375 birthday feature) + dayIndex yields the column's calendar date whether or not it has
// rows, as `YYYY-MM-DD` — the same shape `formatDayHeader` parses and the same UTC arithmetic
// ingest uses to derive `ship_date` (shipDateFor). So populated days are byte-identical; only
// empty days change (from bare day name to day + date). Null tab → null → bare day name (the
// pre-P376 fallback), preserved.
function columnDate(weekMonday: Date | null, dayIndex: number): string | null {
  if (!weekMonday) return null;
  const d = new Date(weekMonday);
  d.setUTCDate(d.getUTCDate() + dayIndex);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

interface WeekBandProps {
  weekLabel: string;
  weekTab: string | undefined;
  days: ScheduleDayGroup[];
  birthdays: Birthday[];
  interactive?: boolean;
  onSelectOrder?: (jobId: string) => void;
}

export default function WeekBand({ weekLabel, weekTab, days, birthdays, interactive, onSelectOrder }: WeekBandProps) {
  const byDay = new Map(days.map((d) => [d.day_of_week, d]));
  const weekMonday = parseWeekMonday(weekTab);

  return (
    <section className="flex-1 min-h-0 flex flex-col">
      <h2 className="shrink-0 px-2 py-0.5 border-b border-[var(--line)] bg-[var(--surface-2)] text-[10px] font-semibold uppercase tracking-wide text-muted">
        {weekLabel}
      </h2>
      <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-5 gap-px bg-[var(--line)]">
        {DAY_ORDER.map((day, dayIndex) => {
          const group = byDay.get(day);
          return (
            <DayColumn
              key={day}
              dayOfWeek={day}
              shipDate={group?.ship_date ?? columnDate(weekMonday, dayIndex)}
              rows={group?.rows ?? []}
              birthdays={birthdaysForColumn(birthdays, weekMonday, dayIndex)}
              interactive={interactive}
              onSelectOrder={onSelectOrder}
            />
          );
        })}
      </div>
    </section>
  );
}
