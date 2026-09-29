// src/lib/deliveryTime.selfcheck.ts
// Guarded dev self-check for deliveryTime.ts (carrier-03). Mirrors productionSchedule.selfcheck.ts's
// shape: a check()/results table, one exported run*SelfCheck() function. Not part of the
// production build path. Covers every real jobs.delivery_time value seen in D1, plus the
// parseDeliveryTime header examples as a regression guard for the schedule board.
import { parseAppointment, parseDeliveryTime, suggestedPickup } from "./deliveryTime";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export function runDeliveryTimeSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, got: unknown, want: unknown) =>
    check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

  // parseDeliveryTime — schedule board, must stay byte-identical in behavior.
  eq("pdt 10a w/ driver note", parseDeliveryTime("INV 4329 - Delivery @ 10:00 am  **DRIVER TO PULL ... NO EARLIER THAN 9:45 AM**"), "10a");
  eq("pdt 8a range", parseDeliveryTime("INV 4325-001 (8am - 5pm}"), "8a");
  eq("pdt 6:15a", parseDeliveryTime("INV 4330 - Delivery @ 6:15 am"), "6:15a");
  eq("pdt 1p", parseDeliveryTime("INV 4311 ^^^ 1pm"), "1p");
  eq("pdt no time", parseDeliveryTime("INV 4331-001 - Tyler pull for BRAD WRIEDT"), null);
  eq("pdt null", parseDeliveryTime(null), null);

  // parseAppointment — shipDay 2026-09-29 is a Tuesday.
  const ship = "2026-09-29";
  eq("appt plain", parseAppointment("7:00 AM", ship), { date: ship, minutes: 420 });
  eq("appt Thurs rolls fwd", parseAppointment("Thurs 7:00 AM", ship), { date: "2026-10-01", minutes: 420 });
  eq("appt Wed. no space", parseAppointment("Wed. 7:00AM", ship), { date: "2026-09-30", minutes: 420 });
  eq("appt TUES = ship day", parseAppointment("TUES 10:00AM", ship), { date: ship, minutes: 600 });
  eq("appt Thurs 7AM", parseAppointment("Thurs 7AM", ship), { date: "2026-10-01", minutes: 420 });
  eq("appt & HRLY ignored", parseAppointment("8:00 AM & HRLY", ship), { date: ship, minutes: 480 });
  eq("appt Wed 6:00AM", parseAppointment("Wed 6:00AM", ship), { date: "2026-09-30", minutes: 360 });
  eq("appt Mon wraps week", parseAppointment("Mon 9am", ship), { date: "2026-10-05", minutes: 540 });
  eq("appt 12pm noon", parseAppointment("12:30 PM", ship), { date: ship, minutes: 750 });
  eq("appt 12am midnight", parseAppointment("12 AM", ship), { date: ship, minutes: 0 });
  eq("appt empty", parseAppointment("", ship), null);
  eq("appt null", parseAppointment(null, ship), null);
  eq("appt no time", parseAppointment("Thurs", ship), null);
  eq("appt invoice guard", parseAppointment("INV 4307", ship), null);

  // suggestedPickup — appt − drive − 60 min, floored to 15.
  eq("pickup 2h45m drive", suggestedPickup({ date: "2026-10-01", minutes: 420 }, 9900), { date: "2026-10-01", minutes: 195 });
  eq("pickup floors to 15", suggestedPickup({ date: ship, minutes: 600 }, 3000), { date: ship, minutes: 480 });
  eq("pickup lands on midnight", suggestedPickup({ date: "2026-09-30", minutes: 360 }, 5 * 3600), { date: "2026-09-30", minutes: 0 });
  eq("pickup rolls to prev day", suggestedPickup({ date: "2026-09-30", minutes: 360 }, 6 * 3600), { date: ship, minutes: 1380 });
  eq("pickup no duration", suggestedPickup({ date: ship, minutes: 420 }, null), null);
  eq("pickup no appt", suggestedPickup(null, 3600), null);

  return { pass: results.every((r) => r.pass), results };
}
