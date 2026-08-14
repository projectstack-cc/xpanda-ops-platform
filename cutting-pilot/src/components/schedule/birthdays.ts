// src/components/schedule/birthdays.ts
// Per-column birthday matching for the schedule board. All date math is UTC to match the
// Monday-anchored ship-week tab (M-D-YY) from schedule-ingest.ts and avoid TZ drift.
import type { Birthday } from "@/types/schedule";

// Monday of the week from the "M-D-YY" tab (same shape as parseTabName in schedule-ingest.ts).
export function parseWeekMonday(tab: string | undefined | null): Date | null {
  const m = tab?.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (!m) return null;
  const [, mo, da, yr] = m;
  return new Date(Date.UTC(2000 + Number(yr), Number(mo) - 1, Number(da)));
}

// dayIndex: MON=0 .. FRI=4. The board never renders weekend columns and the plant doesn't ship
// weekends, so FRIDAY additionally absorbs that week's Saturday (+5) and Sunday (+6).
export function birthdaysForColumn(
  all: Birthday[],
  weekMonday: Date | null,
  dayIndex: number
): Birthday[] {
  if (!weekMonday) return [];
  const offsets = dayIndex === 4 ? [4, 5, 6] : [dayIndex];
  const wanted = new Set<string>();
  for (const off of offsets) {
    const d = new Date(weekMonday);
    d.setUTCDate(d.getUTCDate() + off);
    wanted.add(`${d.getUTCMonth() + 1}-${d.getUTCDate()}`);
  }
  return all.filter((b) => wanted.has(`${b.month}-${b.day}`));
}
