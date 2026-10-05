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

// Week totals derived straight from the rows already on the board — no separate endpoint or
// sheet cell read, so this stays in lockstep with whatever the board itself is showing.
// total_bdft IS per sheet row (column H; a continuation row like "^^^" comes through null via
// numOrNull, contributing 0), so summing every row is correct. chunks_required is NOT per row —
// schedule-board/route.ts's fetchChunksByJob keys it by job_id and every row matching that job
// gets the same number back. A job routinely splits its invoice across multiple delivery days
// within one week (documented live in schedule-ingest.ts's matchAndUpsert comment), so summing
// every row would double/triple-count that job's chunks; dedupe by job_id instead.
function weekTotals(days: ScheduleDayGroup[]): { bdft: number; chunks: number } {
  let bdft = 0;
  let chunks = 0;
  const chunkedJobIds = new Set<string>();
  for (const day of days) {
    for (const row of day.rows) {
      if (row.total_bdft != null) bdft += row.total_bdft;
      if (row.chunks_required != null && row.job_id && !chunkedJobIds.has(row.job_id)) {
        chunkedJobIds.add(row.job_id);
        chunks += row.chunks_required;
      }
    }
  }
  return { bdft, chunks };
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
  const { bdft, chunks } = weekTotals(days);

  return (
    <section className={interactive ? "flex flex-col sm:flex-1 sm:min-h-0" : "flex-1 min-h-0 flex flex-col"}>
      <h2
        className={
          interactive
            ? "shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 sm:px-2 sm:py-0.5 border-b border-[var(--line)] bg-[var(--surface-2)] text-xs sm:text-[clamp(0.625rem,0.85vh,0.75rem)] font-semibold uppercase tracking-wide text-muted"
            : "shrink-0 flex items-center justify-between gap-2 px-2 py-0.5 border-b border-[var(--line)] bg-[var(--surface-2)] text-[clamp(0.625rem,0.85vh,0.75rem)] font-semibold uppercase tracking-wide text-muted"
        }
      >
        <span>{weekLabel}</span>
        <span className="flex items-center gap-2 font-mono tabular-nums normal-case">
          <span title="Total board feet this week">{Math.round(bdft).toLocaleString()} bdft</span>
          <span title="Total holey-board chunks required this week">{chunks.toLocaleString()} chunks</span>
        </span>
      </h2>
      <div
        className={
          interactive
            ? "grid grid-cols-1 sm:grid-cols-5 gap-px bg-[var(--line)] sm:flex-1 sm:min-h-0"
            : "flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-5 gap-px bg-[var(--line)]"
        }
      >
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
