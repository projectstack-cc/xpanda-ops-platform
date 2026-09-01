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
