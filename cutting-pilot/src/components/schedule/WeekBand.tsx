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
  // tasks-03 (TV only): how many weekday columns to render, from Monday. Default 5.
  dayCount?: 2 | 5;
  // tasks-03 (TV only): a panel rendered beside the shown days, spanning the rest of the 5-col
  // grid (NEXT WEEK → Today's Assignments). Never combined with `interactive` — the desk board
  // passes neither prop, so its render is unchanged.
  aside?: React.ReactNode;
}

const shortDay = (d: string) => d.charAt(0) + d.slice(1, 3).toLowerCase();

export default function WeekBand({ weekLabel, weekTab, days, birthdays, interactive, onSelectOrder, dayCount = 5, aside }: WeekBandProps) {
  const byDay = new Map(days.map((d) => [d.day_of_week, d]));
  const weekMonday = parseWeekMonday(weekTab);
  const shownDays = DAY_ORDER.slice(0, dayCount);
  // Totals cover only the shown days (same job-id chunk dedupe). All five shown → the full list,
  // exactly as before.
  const { bdft, chunks } = weekTotals(
    dayCount === DAY_ORDER.length ? days : days.filter((d) => (shownDays as readonly string[]).includes(d.day_of_week))
  );

  const dayColumns = shownDays.map((day, dayIndex) => {
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
  });

  if (aside) {
    // TV layout: [label strip + shown days] col-span-2 | aside col-span-3. Birthdays for the dropped
    // days (incl. Friday's weekend absorption) are not rendered here (BACKLOG).
    const range = `${shortDay(shownDays[0])}–${shortDay(shownDays[shownDays.length - 1])}`;
    return (
      <section className="flex-1 min-h-0 grid grid-cols-5 grid-rows-1 gap-px bg-[var(--line)]">
        <div className="col-span-2 min-h-0 min-w-0 flex flex-col">
          <h2 className="shrink-0 flex items-center justify-between gap-2 px-2 py-0.5 border-b border-[var(--line)] bg-[var(--surface-2)] text-[clamp(0.625rem,0.85vh,0.75rem)] font-semibold uppercase tracking-wide text-muted">
            <span>{weekLabel}</span>
            <span className="flex items-center gap-2 font-mono tabular-nums normal-case">
              <span>{range}</span>
              <span aria-hidden="true">·</span>
              <span title={`Total board feet, ${range}`}>{Math.round(bdft).toLocaleString()} bdft</span>
              <span aria-hidden="true">·</span>
              <span title={`Total holey-board chunks required, ${range}`}>{chunks.toLocaleString()} chunks</span>
            </span>
          </h2>
          <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-1 gap-px bg-[var(--line)]">{dayColumns}</div>
        </div>
        <div className="col-span-3 min-h-0 min-w-0 flex flex-col">{aside}</div>
      </section>
    );
  }

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
        {dayColumns}
      </div>
    </section>
  );
}
