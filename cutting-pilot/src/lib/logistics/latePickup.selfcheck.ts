// src/lib/logistics/latePickup.selfcheck.ts
// Guarded dev self-check for latePickup.ts + etNowWallClock (late-pickup-01). Mirrors
// deliveryTime.selfcheck.ts's shape: a check()/results table, one exported run*SelfCheck()
// function. Not part of the production build path.
import { evaluatePickup, wallClockOrdinal } from "./latePickup";
import { etNowWallClock } from "@/lib/etDateTime";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export function runLatePickupSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, got: unknown, want: unknown) =>
    check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

  // 2026-09-29 is a Tuesday. "10:00 AM" with a 50-min drive → 10:00 − 50 − 60 = 8:10 → floored 8:00 (480).
  const ship = "2026-09-29";
  const at = (minutes: number, date = ship) => ({ date, minutes });

  eq("on time (before pickup)", evaluatePickup("10:00 AM", ship, 3000, at(450)), {
    date: ship, minutes: 480, label: "8:00 AM", late: false,
  });
  eq("exactly +30 not late", evaluatePickup("10:00 AM", ship, 3000, at(510))?.late, false);
  eq("+31 late", evaluatePickup("10:00 AM", ship, 3000, at(511))?.late, true);
  eq("durationSec null → null", evaluatePickup("10:00 AM", ship, null, at(450)), null);
  eq("unparseable delivery_time → null", evaluatePickup("Tyler pull", ship, 3000, at(450)), null);
  eq("null delivery_time → null", evaluatePickup(null, ship, 3000, at(450)), null);
  eq("null ship_day → null", evaluatePickup("10:00 AM", null, 3000, at(450)), null);

  // "Thurs 7:00 AM" from a Tuesday ship day → appt Thu 10/01; viewed on Tue → weekday prefix.
  eq("different day → weekday prefix", evaluatePickup("Thurs 7:00 AM", ship, 9900, at(600)), {
    date: "2026-10-01", minutes: 195, label: "Thu 3:15 AM", late: false,
  });

  // "Wed 6:00AM" with a 6h drive → pickup Tue 23:00 (rolls back across midnight).
  const rolled = evaluatePickup("Wed 6:00AM", ship, 6 * 3600, at(1380));
  eq("midnight rollback date/minutes", rolled && [rolled.date, rolled.minutes], [ship, 1380]);
  eq("midnight rollback same-day label", rolled?.label, "11:00 PM");
  eq("midnight rollback exactly +30 not late", evaluatePickup("Wed 6:00AM", ship, 6 * 3600, at(1410))?.late, false);
  const nextDay = evaluatePickup("Wed 6:00AM", ship, 6 * 3600, at(0, "2026-09-30"));
  eq("midnight rollback late across day", nextDay?.late, true);
  eq("midnight rollback viewed next day → prefix", nextDay?.label, "Tue 11:00 PM");
  eq("ordinal spans days", wallClockOrdinal(at(0, "2026-09-30")) - wallClockOrdinal(at(1380)), 60);

  // etNowWallClock — EDT (UTC−4) and EST (UTC−5).
  eq("etNow EDT", etNowWallClock(Date.UTC(2026, 6, 15, 14, 30)), { date: "2026-07-15", minutes: 630 });
  eq("etNow EST", etNowWallClock(Date.UTC(2026, 0, 15, 14, 30)), { date: "2026-01-15", minutes: 570 });
  eq("etNow EDT previous ET day", etNowWallClock(Date.UTC(2026, 6, 16, 2, 5)), { date: "2026-07-15", minutes: 1325 });
  eq("etNow EST midnight hour", etNowWallClock(Date.UTC(2026, 0, 15, 5, 0)), { date: "2026-01-15", minutes: 0 });

  return { pass: results.every((r) => r.pass), results };
}
