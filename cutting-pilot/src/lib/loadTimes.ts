// src/lib/loadTimes.ts
// dlv-01: per-load delivery times. Pure functions only — no D1, no Date/TZ math beyond plain
// YYYY-MM-DD weekday arithmetic. Every value is ET wall clock, same convention as deliveryTime.ts.
// Source of truth for the stored rows is the `job_load_times` table (one row per job + load).
//
// Live schedule_rows.delivery_time cells this has to read (col F of the schedule sheet):
//   "INV 4434-005-008 - Delivery @ 8am & HRLY"               4 loads -> 8, 9, 10, 11 AM
//   "INV 4179 - Deliver @ 7:30 am & every 45-min"            5 loads -> 7:30 … 10:30 AM
//   "INV 4336 - delivery @ 8am & 9am"                        2 loads -> 8, 9 AM
//   "INV 4463 - Delivery @ 6:30 & 7:30 am"                   2 loads -> 6:30, 7:30 AM (shared meridiem)
//   "INV 4329 - Delivery @ 10:00 am  **… NO EARLIER THAN 9:45 AM**"  driver-note time is never read
//   "INV 4356 ^^^"                                           ditto — previous row in the same day section
//   "INV 4331-001 - Tyler pull for BRAD WRIEDT"              no time -> null
import { TIME_RE } from "./deliveryTime";

/** Day labels by JS weekday index. This exact casing and these abbreviations are what BOLs print. */
export const DAY_ABBR = ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"] as const;

export interface LoadTime {
  /** 1-based */
  load_number: number;
  /** YYYY-MM-DD, or null = unknown day */
  date: string | null;
  /** Minutes after midnight 0..1439, or null = no time */
  minutes: number | null;
  /** Canonical "Thurs 9:00AM"; "" when minutes is null */
  display: string;
}

/** One `schedule_rows` row for an invoice, as assignSheetLoads reads it. */
export interface SheetRowInput {
  ship_date: string | null;
  day_of_week?: string | null;
  sort_order: number;
  load_count: number | null;
  delivery_time: string | null;
  /**
   * Ditto convention (pre-resolved by the caller): when this row's cell is a pure `^^^` ditto, the
   * caller sets this to the cell of the nearest earlier NON-ditto row in the same
   * (ship_week, ship_date) section, whatever its invoice. When absent, assignSheetLoads falls back
   * to the previous row in `rows` itself if it is on the same ship_date.
   */
  ditto_source?: string | null;
}

export interface SheetLoadTime extends LoadTime {
  /** The raw sheet cell that produced this load (the row's own cell, even for a ditto). */
  sheet_raw: string;
}

export interface SheetAssignment {
  times: SheetLoadTime[];
  /** Set when the sheet describes a different number of loads than the job has. */
  warning: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Same alternatives as WEEKDAY_RE in deliveryTime.ts (kept private there; deliveryTime.ts may only
// gain the TIME_RE export). Longest first so "thurs" never stops at "thu".
const WEEKDAY_RE = /^\s*(thurs|thur|thu|tues|tue|mon|wed|fri|sat|sun)\.?(?=\s|\d|$)/i;
const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};
const TIME_RE_G = new RegExp(TIME_RE.source, "gi");
// Separator that makes the next time part of an explicit list ("8am & 9am", "8am, 9am, 10am").
// Anything else between two times (a range "8am - 5pm", prose) ends the list.
const LIST_SEP_RE = /^\s*(?:&|,|\+|and)\s*$/i;
// "6:30 & 7:30 am": a bare h:mm directly followed by a list separator and a time that HAS a
// meridiem borrows that meridiem. Colon form only, so suffixes like "001-004" can never match.
const SHARED_MERIDIEM_RE = /(\b\d{1,2}:\d{2})(?!\s*[ap]\.?m)(?=\s*(?:&|,|\+|and)\s*\d{1,2}(?::\d{2})?\s*([ap])\.?m)/gi;
// "2-3:00 pm": a bare start hour directly before "-"/"–" and a time with a meridiem borrows it, so
// the START of the window is read (not the end). Only when start ≤ end on the same meridiem; never
// preceded by a digit, "-" or ":" so invoice suffixes ("001-004") can't match.
const RANGE_START_RE = /(^|[^\d:-])(\d{1,2})(?::(\d{2}))?(\s*[-–]\s*)(\d{1,2})((?::\d{2})?\s*([ap])\.?m)/gi;
const DITTO_RE =/^\s*INV\s*\d+(?:[\s-]*\d+)*\s*-?\s*\^+\s*$/i;

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDaysStr(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const mm = String(minutes % 60).padStart(2, "0");
  return `${h % 12 || 12}:${mm}${h < 12 ? "AM" : "PM"}`;
}

function dayLabel(date: string | null): string {
  return date && DATE_RE.test(date) ? DAY_ABBR[weekdayOf(date)] : "";
}

/** "Thurs 9:00AM"; time only ("9:00AM") with no date; "" with no minutes. 12:00PM = noon, 12:00AM = midnight. */
export function formatLoadTime(date: string | null, minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0 || minutes > 1439) return "";
  const day = dayLabel(date);
  const time = clockLabel(Math.floor(minutes));
  return day ? `${day} ${time}` : time;
}

/** True when a sheet cell is a pure ditto: the INV# followed only by carets ("INV 4356 ^^^"). */
export function isDittoCell(cell: string | null | undefined): boolean {
  return !!cell && DITTO_RE.test(cell);
}

function toMinutes(m: RegExpMatchArray | RegExpExecArray): number | null {
  const hour = Number(m[1]);
  if (hour < 1 || hour > 12) return null;
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  const pm = m[3].toLowerCase() === "p";
  return ((hour % 12) + (pm ? 12 : 0)) * 60 + min;
}

function intervalOf(text: string): number | null {
  if (/\b(?:hrly|hourly)\b/i.test(text) || /\bevery\s+hour\b/i.test(text)) return 60;
  const m = text.match(/\bevery\s*(\d+)\s*-?\s*(minutes?|mins?|hours?|hrs?)\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!(n > 0)) return null;
  return /^h/i.test(m[2]) ? n * 60 : n;
}

/**
 * Expand one free-text cell/input into exactly `loadCount` entries.
 * - Day: an optional LEADING weekday resolves to its next occurrence on or after `defaultDate`;
 *   otherwise `defaultDate`.
 * - Start time: the first TIME_RE match (or "noon"). Anything after a `**` driver note is ignored.
 * - Loads 2..N: explicit extra times joined by & / , first, then HRLY / every N min / every N hr.
 *   Fewer times than loads with no interval → the rest stay null. Never invents a time; a running
 *   time that would pass 11:59 PM stops there.
 * - No time at all → null ("no data, change nothing").
 */
export function parseLoadTimePattern(
  text: string | null | undefined,
  loadCount: number,
  defaultDate: string | null
): LoadTime[] | null {
  if (!text) return null;
  const count = Math.max(1, Math.floor(Number(loadCount) || 1));

  let date: string | null = defaultDate && DATE_RE.test(defaultDate) ? defaultDate : null;
  const wd = text.match(WEEKDAY_RE);
  if (wd && date) {
    const target = WEEKDAY_INDEX[wd[1].toLowerCase()];
    date = addDaysStr(date, (target - weekdayOf(date) + 7) % 7);
  }

  let body = text.split("**")[0];
  body = body.replace(/\bnoon\b/gi, "12:00pm");
  body = body.replace(SHARED_MERIDIEM_RE, (_all, t: string, mer: string) => `${t}${mer}m`);
  body = body.replace(
    RANGE_START_RE,
    (all, pre: string, sh: string, sm: string | undefined, sep: string, eh: string, endRest: string, mer: string) => {
      const s = Number(sh) % 12;
      const e = Number(eh) % 12;
      if (Number(sh) < 1 || Number(sh) > 12 || s > e) return all;
      return `${pre}${sh}${sm ? ":" + sm : ""}${mer}m${sep}${eh}${endRest}`;
    }
  );

  const explicit: number[] = [];
  let lastEnd = -1;
  TIME_RE_G.lastIndex = 0;
  for (let m = TIME_RE_G.exec(body); m; m = TIME_RE_G.exec(body)) {
    if (lastEnd >= 0 && !LIST_SEP_RE.test(body.slice(lastEnd, m.index))) break;
    const mins = toMinutes(m);
    if (mins == null) {
      if (lastEnd < 0) continue; // an invalid first hit (e.g. "13am") isn't a start time
      break;
    }
    explicit.push(mins);
    lastEnd = m.index + m[0].length;
  }
  if (!explicit.length) return null;

  const interval = intervalOf(body);
  const out: LoadTime[] = [];
  let prev: number | null = null;
  for (let i = 0; i < count; i++) {
    let minutes: number | null = null;
    if (i < explicit.length) minutes = explicit[i];
    else if (interval != null && prev != null && prev + interval <= 1439) minutes = prev + interval;
    out.push({ load_number: i + 1, date, minutes, display: formatLoadTime(date, minutes) });
    prev = minutes;
  }
  return out;
}

/**
 * Assign per-load times from every `schedule_rows` row of one invoice. Load numbers run
 * sequentially across rows ordered by ship_date, sort_order, each row taking its own load_count
 * (col C; NULL/0 = 1) — NOT the cell's suffix ranges ("001-004", "-002"), which live data uses
 * inconsistently. Each row's day is its ship_date (the sheet's day section). Rows that parse to no
 * time still occupy their load numbers with null entries. Never truncated to `jobLoadCount`; a
 * mismatch is only reported in `warning`.
 */
export function assignSheetLoads(rows: SheetRowInput[], jobLoadCount: number): SheetAssignment {
  const sorted = rows.slice().sort((a, b) => {
    const da = a.ship_date || "";
    const db = b.ship_date || "";
    if (da !== db) return da < db ? -1 : 1;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });

  const times: SheetLoadTime[] = [];
  let next = 1;
  let prevResolved: { ship_date: string | null; cell: string | null } | null = null;
  for (const row of sorted) {
    const rowLoads = row.load_count && row.load_count > 0 ? Math.floor(row.load_count) : 1;
    let cell = row.delivery_time;
    if (isDittoCell(cell)) {
      if (row.ditto_source !== undefined) cell = row.ditto_source;
      else cell = prevResolved && prevResolved.ship_date === row.ship_date ? prevResolved.cell : null;
    }
    const parsed = parseLoadTimePattern(cell, rowLoads, row.ship_date);
    for (let i = 0; i < rowLoads; i++) {
      const p = parsed?.[i];
      times.push({
        load_number: next + i,
        date: row.ship_date,
        minutes: p?.minutes ?? null,
        display: p?.display ?? "",
        sheet_raw: row.delivery_time || "",
      });
    }
    next += rowLoads;
    prevResolved = { ship_date: row.ship_date, cell };
  }

  const described = times.length;
  const warning =
    jobLoadCount > 0 && described !== jobLoadCount
      ? `Sheet describes ${described} load${described === 1 ? "" : "s"}; job has ${jobLoadCount}`
      : null;
  return { times, warning };
}

/**
 * Compact label for single-field surfaces (jobs.delivery_time, shipments.delivery_time):
 *   one load                                  → "Thurs 9:00AM"
 *   2+ loads, same day, every load timed, even interval → "Thurs 9:00AM–12:00PM (4 loads)"
 *   otherwise                                 → "Thurs 9:00AM, 10:00AM | Fri 8:00AM"
 * The leading weekday + first time stay parseable by parseAppointment (Carrier View, late pickup).
 */
export function summarizeLoadTimes(times: LoadTime[]): string {
  const sorted = times.slice().sort((a, b) => a.load_number - b.load_number);
  const timed = sorted.filter((t) => t.minutes != null);
  if (!timed.length) return "";
  if (sorted.length === 1) return formatLoadTime(timed[0].date, timed[0].minutes);

  const sameDay = timed.every((t) => t.date === timed[0].date);
  if (sameDay && timed.length === sorted.length && timed.length >= 2) {
    const step = (timed[1].minutes as number) - (timed[0].minutes as number);
    const even = step > 0 && timed.every((t, i) => i === 0 || (t.minutes as number) - (timed[i - 1].minutes as number) === step);
    if (even) {
      const day = dayLabel(timed[0].date);
      const range = `${clockLabel(timed[0].minutes as number)}–${clockLabel(timed[timed.length - 1].minutes as number)}`;
      return `${day ? day + " " : ""}${range} (${timed.length} loads)`;
    }
  }

  const groups: string[] = [];
  let curDate: string | null | undefined = undefined;
  let cur: string[] = [];
  const flush = () => {
    if (!cur.length) return;
    const day = dayLabel(curDate ?? null);
    groups.push(`${day ? day + " " : ""}${cur.join(", ")}`);
    cur = [];
  };
  for (const t of timed) {
    if (t.date !== curDate) {
      flush();
      curDate = t.date;
    }
    cur.push(clockLabel(t.minutes as number));
  }
  flush();
  return groups.join(" | ");
}
