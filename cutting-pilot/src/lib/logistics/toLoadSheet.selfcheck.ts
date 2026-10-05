// src/lib/logistics/toLoadSheet.selfcheck.ts
// Guarded dev self-check for toLoadSheet.ts (tls-01). Mirrors deliveryTime.selfcheck.ts's shape: a
// check()/results table, one exported run*SelfCheck() function. Not part of the production build path.
// Fixture dates: 2026-10-02 is a Friday; 10/5..10/9 are Mon..Fri.
import {
  buildToLoadSheet, compareRows, isLoaded, isSisterCompanyDelivery, nextShipDay, toLoadWindow, type ToLoadRow,
} from "./toLoadSheet";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

let seq = 0;
function row(over: Partial<ToLoadRow>): ToLoadRow {
  seq += 1;
  return {
    job_id: `job-${seq}`,
    assignment_id: `la-${seq}`,
    ship_day: "2026-10-05",
    bay_number: null,
    location: null,
    invoice_number: String(4000 + seq),
    customer: `Customer ${seq}`,
    load_number: 1,
    load_count: 1,
    loading_status: "not_started",
    city_label: "",
    delivery_label: "—",
    pickup_label: null,
    pickup_early: false,
    ...over,
  };
}

export function runToLoadSheetSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, got: unknown, want: unknown) =>
    check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  const D = "2026-10-02";

  // nextShipDay — Mon–Fri only.
  eq("nextShipDay Fri → Mon", nextShipDay("2026-10-02"), "2026-10-05");
  eq("nextShipDay Sat → Mon", nextShipDay("2026-10-03"), "2026-10-05");
  eq("nextShipDay Mon → Tue", nextShipDay("2026-10-05"), "2026-10-06");
  eq("toLoadWindow Fri", toLoadWindow(D), ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12"]);

  // isLoaded.
  eq("loading = not loaded", isLoaded("loading"), false);
  eq("in_transit = loaded", isLoaded("in_transit"), true);
  eq("null = not loaded", isLoaded(null), false);

  // Shift 1: section 1 = all S1 rows incl. loaded; section 2 starts at S2.
  const mon1 = row({ ship_day: "2026-10-05", loading_status: "loaded", bay_number: 22, location: "bay" });
  const mon2 = row({ ship_day: "2026-10-05", loading_status: "not_started", bay_number: 25, location: "bay" });
  const tue1 = row({ ship_day: "2026-10-06" });
  const tue2 = row({ ship_day: "2026-10-06", loading_status: "awaiting" });
  const tueLoaded = row({ ship_day: "2026-10-06", loading_status: "delivered" });
  const s1 = buildToLoadSheet([mon1, mon2, tue1, tue2, tueLoaded], 1, D);
  eq("shift1 two sections", s1.sections.map((s) => s.kind), ["pickups", "to_load"]);
  eq("shift1 pickups title", s1.sections[0].title, "Load Verification — Mon 10/5");
  eq("shift1 pickups includes loaded", s1.sections[0].days[0]?.rows.map((r) => r.job_id), [mon2.job_id, mon1.job_id]);
  eq("shift1 to_load starts 10/6", s1.sections[1].days.map((d) => d.shipDay), ["2026-10-06"]);
  eq("shift1 to_load excludes loaded", s1.sections[1].days[0]?.rows.length, 2);
  eq("shift1 to_load no note", s1.sections[1].note, null);

  // Shift 2: one to-load section starting at S1.
  const s2 = buildToLoadSheet([mon1, mon2, tue1, tue2], 2, D);
  eq("shift2 one section", s2.sections.map((s) => s.kind), ["to_load"]);
  eq("shift2 starts 10/5 (loaded dropped)", s2.sections[0].days[0]?.shipDay, "2026-10-05");
  eq("shift2 10/5 then 10/6", s2.sections[0].days.map((d) => d.shipDay), ["2026-10-05", "2026-10-06"]);

  // Fallback: 10/5 has 1 not-loaded → 10/6 appended.
  const f1 = buildToLoadSheet([row({ ship_day: "2026-10-05" }), row({ ship_day: "2026-10-06" }), row({ ship_day: "2026-10-07" })], 2, D);
  eq("fallback 1 row → append next day", f1.sections[0].days.map((d) => d.shipDay), ["2026-10-05", "2026-10-06"]);
  // 10/5 has 0 not-loaded, 10/6 has 3 → no 10/5 header, 10/6 included, stop.
  const f2 = buildToLoadSheet(
    [
      row({ ship_day: "2026-10-05", loading_status: "loaded" }),
      row({ ship_day: "2026-10-06" }),
      row({ ship_day: "2026-10-06" }),
      row({ ship_day: "2026-10-06" }),
      row({ ship_day: "2026-10-07" }),
    ],
    2,
    D
  );
  eq("fallback empty day skipped", f2.sections[0].days.map((d) => d.shipDay), ["2026-10-06"]);
  eq("fallback 10/6 all 3 rows", f2.sections[0].days[0]?.rows.length, 3);
  // All days empty → stops at 5 days, note set.
  const f3 = buildToLoadSheet([row({ ship_day: "2026-10-12" })], 2, D);
  eq("fallback all empty → no days", f3.sections[0].days.length, 0);
  eq("fallback cap note", f3.sections[0].note, "Nothing else scheduled to load through Fri 10/9.");
  // 1st shift section 2 cap runs S2..S6.
  const f4 = buildToLoadSheet([row({ ship_day: "2026-10-12" })], 1, D);
  eq("shift1 cap reaches 10/12", f4.sections[1].days.map((d) => d.shipDay), ["2026-10-12"]);
  eq("shift1 cap note", f4.sections[1].note, "Nothing else scheduled to load through Mon 10/12.");
  eq("shift1 empty pickups", f4.sections[0].days.length, 0);

  // Ordering: bays 30, 25, 20, then yard, then unassigned; same bay → invoice numeric asc.
  const b20 = row({ bay_number: 20, location: "bay" });
  const b30 = row({ bay_number: 30, location: "bay" });
  const b25b = row({ bay_number: 25, location: "bay", invoice_number: "1002" });
  const b25a = row({ bay_number: 25, location: "bay", invoice_number: "998" });
  const yard = row({ location: "yard" });
  const un = row({});
  const sorted = [un, yard, b20, b25b, b30, b25a].sort(compareRows).map((r) => r.job_id);
  eq("ordering bays desc, yard, unassigned", sorted, [b30, b25a, b25b, b20, yard, un].map((r) => r.job_id));
  const l2 = row({ invoice_number: "4321", load_number: 2 });
  const l1 = row({ invoice_number: "4321", load_number: 1 });
  eq("ordering load_number tiebreak", [l2, l1].sort(compareRows).map((r) => r.load_number), [1, 2]);

  // Sister-company filter (tls-02).
  eq("sister: Marina Foam customer", isSisterCompanyDelivery("Marina Foam", null), true);
  eq("sister: ship-to normalized", isSisterCompanyDelivery("Acme Boats", "MARINA  FOAM, LLC"), true);
  eq("sister: Marina Bay Docks no match", isSisterCompanyDelivery("Marina Bay Docks", "Marina Bay Docks"), false);
  eq("sister: null/null no match", isSisterCompanyDelivery(null, null), false);

  return { pass: results.every((r) => r.pass), results };
}
