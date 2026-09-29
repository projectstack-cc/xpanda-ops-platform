// src/lib/deliveryTime.ts
// The sheet's `delivery_time` cell is free-text and messy: it leads with "INV <4-digit#>", often
// trails a driver note that contains a SECOND time, and sometimes has no time at all. Examples:
//   "INV 4329 - Delivery @ 10:00 am  **DRIVER TO PULL ... NO EARLIER THAN 9:45 AM**"  -> "10a"
//   "INV 4325-001 (8am - 5pm}"                                                        -> "8a"
//   "INV 4330 - Delivery @ 6:15 am"                                                   -> "6:15a"
//   "INV 4311 ^^^ 1pm"                                                                -> "1p"
//   "INV 4331-001 - Tyler pull for BRAD WRIEDT"                                       -> null
//
// Returns the FIRST clock time as a compact label for the schedule board's leading time column.
// The delivery time is always stated before any driver-note time, so first-match is correct.
// Invoice-number guard: the hour is 1-2 digits AND must be immediately followed (whitespace only)
// by am/pm, so a 4-digit INV number like "4307" can never match as a time.
const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m/i;

export function parseDeliveryTime(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(TIME_RE);
  if (!m) return null;
  const hour = Number(m[1]);
  if (hour < 1 || hour > 12) return null;
  const min = m[2] && m[2] !== "00" ? `:${m[2]}` : ""; // drop ":00", keep real minutes
  return `${hour}${min}${m[3].toLowerCase()}`; // "7a", "6:15a", "12p"
}

// ── Carrier View appointment parsing (carrier-03) ────────────────────────────────────────────
// `jobs.delivery_time` is also free text, entered on the order: "7:00 AM", "Thurs 7:00 AM",
// "Wed. 7:00AM", "TUES 10:00AM", "Thurs 7AM", "8:00 AM & HRLY", "Wed 6:00AM", "". These siblings
// reuse TIME_RE (same invoice-number guard); parseDeliveryTime above stays untouched for the
// schedule board. All values are ET wall-clock — plain date strings + minutes, no Date/TZ math.

export interface WallClock {
  /** YYYY-MM-DD */
  date: string;
  /** Minutes after midnight, 0..1439 */
  minutes: number;
}

// Longest alternatives first so "thurs" never stops at "thu". Must be followed by whitespace,
// a digit, or end — so a customer word that merely starts with "sat…" can't read as a weekday.
const WEEKDAY_RE = /^\s*(thurs|thur|thu|tues|tue|mon|wed|fri|sat|sun)\.?(?=\s|\d|$)/i;
const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};

function addDaysStr(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Parse a free-text appointment ("Thurs 7:00 AM") relative to the load's ship day. An optional
 * leading weekday resolves to its next occurrence ON OR AFTER `shipDay`; no weekday → `shipDay`.
 * Time is the first TIME_RE match; trailing text ("& HRLY") is ignored. Unparseable → null.
 */
export function parseAppointment(text: string | null | undefined, shipDay: string): WallClock | null {
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(shipDay)) return null;
  const m = text.match(TIME_RE);
  if (!m) return null;
  const hour = Number(m[1]);
  if (hour < 1 || hour > 12) return null;
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  const pm = m[3].toLowerCase() === "p";
  const minutes = ((hour % 12) + (pm ? 12 : 0)) * 60 + min;

  let date = shipDay;
  const wd = text.match(WEEKDAY_RE);
  if (wd) {
    const target = WEEKDAY_INDEX[wd[1].toLowerCase()];
    const delta = (target - weekdayOf(shipDay) + 7) % 7;
    date = addDaysStr(shipDay, delta);
  }
  return { date, minutes };
}

/**
 * Suggested pickup = appointment − drive time − 60 min traffic buffer, floored to 15 min
 * (rolls back across midnight). Null when either input is missing — never a guessed time.
 */
export function suggestedPickup(
  appt: WallClock | null | undefined,
  durationSec: number | null | undefined
): WallClock | null {
  if (!appt || durationSec == null || !Number.isFinite(durationSec) || durationSec < 0) return null;
  let total = appt.minutes - Math.ceil(durationSec / 60) - 60;
  total = Math.floor(total / 15) * 15;
  let date = appt.date;
  while (total < 0) {
    total += 1440;
    date = addDaysStr(date, -1);
  }
  return { date, minutes: total };
}
