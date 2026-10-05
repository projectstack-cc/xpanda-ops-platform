// src/lib/cutting/shiftRisk.ts
// shift-alert-01: pure shift/checkpoint math for the cutting shift-risk notifications
// (shiftRiskCron.ts). No I/O. All times are America/New_York wall clock; `shift_date` is the ET
// calendar date the shift STARTED, so a 3rd shift starting Mon 22:00 is shift_date Monday and its
// checkpoints land Tue 04:00 / 06:00. Shift start/end are minutes from shift_date 00:00 ET (3rd
// shift's end runs past 1440). Day arithmetic is on YYYY-MM-DD strings via Date.UTC; wall-clock
// minutes make DST nights come out right with no offset math.

export type ShiftKey = "1st" | "2nd" | "3rd";
export type AlertKind = "t_minus_2h" | "end_of_shift";

export interface ShiftDef {
  start: number;
  end: number;
  label: string;
  endLabel: string;
}

export const SHIFTS: Record<ShiftKey, ShiftDef> = {
  "1st": { start: 360, end: 870, label: "6:00 AM–2:30 PM", endLabel: "2:30 PM" },
  "2nd": { start: 840, end: 1350, label: "2:00 PM–10:30 PM", endLabel: "10:30 PM" },
  "3rd": { start: 1320, end: 1800, label: "10:00 PM–6:00 AM", endLabel: "6:00 AM" },
};

const SHIFT_ORDER: ShiftKey[] = ["1st", "2nd", "3rd"];

/** Minutes before shift end that the "at risk" alert fires. */
export const T_MINUS_MIN = 120;
/** End-of-shift alert window: fires from shift end until this many minutes after (outage cap). */
export const END_WINDOW_MIN = 60;

/**
 * Work days, keyed on shift_date weekday (0 = Sun … 6 = Sat): Mon–Fri. Friday-night 3rd shift
 * (checkpoints Sat 04:00/06:00) counts; Sunday-night 3rd shift doesn't. This is the ONE line to
 * change if 3rd shift actually runs Sun–Thu nights.
 */
export const WORK_DAYS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]);

/** The latest of a job's assigned shifts (1st < 2nd < 3rd); unknown values ignored. */
export function lastShift(shifts: string[]): ShiftKey | null {
  let best = -1;
  for (const s of shifts) best = Math.max(best, SHIFT_ORDER.indexOf(s as ShiftKey));
  return best >= 0 ? SHIFT_ORDER[best] : null;
}

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** ET calendar date, minutes after ET midnight, and weekday (0 = Sun) for an instant. */
export function etParts(d: Date): { ymd: string; minutes: number; weekday: number } {
  const p: Record<string, string> = {};
  for (const part of ET_FMT.formatToParts(d)) p[part.type] = part.value;
  const ymd = `${p.year}-${p.month}-${p.day}`;
  return { ymd, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: weekdayOf(ymd) };
}

/** Checkpoints whose firing window contains `now`. */
export function dueCheckpoints(now: Date): Array<{ shift: ShiftKey; shiftDate: string; kind: AlertKind }> {
  const { ymd: today, minutes } = etParts(now);
  const out: Array<{ shift: ShiftKey; shiftDate: string; kind: AlertKind }> = [];
  for (const shift of SHIFT_ORDER) {
    const { end } = SHIFTS[shift];
    for (const [shiftDate, dayDiff] of [[today, 0], [addDays(today, -1), 1]] as const) {
      if (!WORK_DAYS.has(weekdayOf(shiftDate))) continue;
      const t = dayDiff * 1440 + minutes;
      if (end - T_MINUS_MIN <= t && t < end) out.push({ shift, shiftDate, kind: "t_minus_2h" });
      else if (end <= t && t < end + END_WINDOW_MIN) out.push({ shift, shiftDate, kind: "end_of_shift" });
    }
  }
  return out;
}
