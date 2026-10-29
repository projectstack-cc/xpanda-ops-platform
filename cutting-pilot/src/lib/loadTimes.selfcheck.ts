// src/lib/loadTimes.selfcheck.ts
// Guarded dev self-check for loadTimes.ts (dlv-01). Mirrors deliveryTime.selfcheck.ts's shape: a
// check()/results table, one exported run*SelfCheck() function. Not part of the production build
// path. Every parse case is a real schedule_rows.delivery_time cell from D1 with its load count.
import {
  assignSheetLoads,
  capLoadTimesLabel,
  formatLoadTime,
  hasLeadingWeekday,
  isDittoCell,
  loadSuffix,
  parseLoadTimePattern,
  summarizeLoadTimes,
  type LoadTime,
} from "./loadTimes";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export function runLoadTimesSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, got: unknown, want: unknown) =>
    check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  const mins = (r: LoadTime[] | null) => (r ? r.map((t) => t.minutes) : null);
  const disp = (r: { display: string }[] | null) => (r ? r.map((t) => t.display) : null);
  const h = (hh: number, mm = 0) => hh * 60 + mm;

  const WED = "2026-10-14"; // a Wednesday
  const THU = "2026-10-01";
  const FRI = "2026-10-02";

  // ── parseLoadTimePattern: live cells ──────────────────────────────────────────────────────
  eq("4336 8am & 9am ×2", mins(parseLoadTimePattern("INV 4336 - delivery @ 8am & 9am", 2, WED)), [h(8), h(9)]);
  eq("4434 8am & HRLY ×4", mins(parseLoadTimePattern("INV 4434-005-008 - Delivery @ 8am & HRLY", 4, FRI)), [h(8), h(9), h(10), h(11)]);
  eq("4403 9:30am & HRLY ×3", mins(parseLoadTimePattern("INV 4403 - Delivery @ 9:30am & HRLY", 3, WED)), [h(9, 30), h(10, 30), h(11, 30)]);
  eq("4252 8:00 am & HRLY ×2", mins(parseLoadTimePattern("INV 4252 - Delivery @ 8:00 am & HRLY", 2, WED)), [h(8), h(9)]);
  eq("4354 every 30-min ×3", mins(parseLoadTimePattern("INV 4354 - Delivery @ 10:30 am & every 30-min", 3, WED)), [h(10, 30), h(11), h(11, 30)]);
  eq("4179 every 45-min ×5", mins(parseLoadTimePattern("INV 4179 - Deliver @ 7:30 am & every 45-min", 5, WED)), [h(7, 30), h(8, 15), h(9), h(9, 45), h(10, 30)]);
  const r4235 = parseLoadTimePattern("INV 4235 - 006-0010 - Delivery 8am & HRLY", 5, WED);
  eq("4235 006-0010 ×5 → 8..12", mins(r4235), [h(8), h(9), h(10), h(11), h(12)]);
  eq("4235 last load is noon", r4235?.[4].display, "Wed 12:00PM");
  // The prompt's table expected 10:00AM, 11:00AM for this cell — but the live cell has no HRLY /
  // interval, so the "never invent a time" rule wins: load 2 stays empty. Driver-note 9:45 ignored.
  const r4329 = parseLoadTimePattern("INV 4329 - Delivery @ 10:00 am  **DRIVER TO PULL INTO YARD NO EARLIER THAN 9:45 AM**", 2, WED);
  eq("4329 driver note ignored, no invented load 2", mins(r4329), [h(10), null]);
  eq("4329 display", disp(r4329), ["Wed 10:00AM", ""]);
  eq("4331 no time", parseLoadTimePattern("INV 4331-001 - Tyler pull for BRAD WRIEDT", 1, WED), null);
  eq("4331 live cell w/ newlines", parseLoadTimePattern("INV 4331\n- \nTyler pull for BRAD WRIEDT", 1, WED), null);
  eq("8:00AM & HRLY on Wed ×3", disp(parseLoadTimePattern("8:00AM & HRLY", 3, WED)), ["Wed 8:00AM", "Wed 9:00AM", "Wed 10:00AM"]);
  eq("Thurs 7AM rolls fwd from Wed", disp(parseLoadTimePattern("Thurs 7AM", 1, WED)), ["Thurs 7:00AM"]);

  // Extra live shapes.
  eq("4463 shared meridiem 6:30 & 7:30 am", mins(parseLoadTimePattern("INV 4463 - Delivery @ 6:30 & 7:30 am", 2, WED)), [h(6, 30), h(7, 30)]);
  eq("4122 9 AM & 10 AM", mins(parseLoadTimePattern("INV 4122 - Delivery @ 9 AM & 10 AM", 2, WED)), [h(9), h(10)]);
  eq("4172 one time ×5 → rest null", mins(parseLoadTimePattern("INV 4172 - Delivery @  8:00 am", 5, WED)), [h(8), null, null, null, null]);
  eq("8am, 9am, 10am list", mins(parseLoadTimePattern("8am, 9am, 10am", 3, WED)), [h(8), h(9), h(10)]);
  eq("explicit then interval continues", mins(parseLoadTimePattern("7am & 8am & HRLY", 4, WED)), [h(7), h(8), h(9), h(10)]);
  eq("range is not a list", mins(parseLoadTimePattern("INV 4325-001 (8am - 5pm}", 2, WED)), [h(8), null]);
  eq("4200 range start 2-3:00 pm", disp(parseLoadTimePattern("INV 4200 - CPU @ 2-3:00 pm EST", 1, WED)), ["Wed 2:00PM"]);
  eq("receiving window 7:30 am – 4:00 pm", disp(parseLoadTimePattern("INV 4208 - Deliveries accepted 7:30 am – 4:00 pm", 1, WED)), ["Wed 7:30AM"]);
  eq("4474 bare 8:30 → 8:30 AM (dlv-06; was null)", mins(parseLoadTimePattern("INV 4474 - Delivery @ 8:30", 1, WED)), [h(8, 30)]);
  eq("suffix range never a time", mins(parseLoadTimePattern("INV 4434 - 001-004- Delivery @ 9am & HRLY", 2, THU)), [h(9), h(10)]);
  eq("every 2 hr", mins(parseLoadTimePattern("6am every 2 hr", 3, WED)), [h(6), h(8), h(10)]);
  eq("every 1 hour", mins(parseLoadTimePattern("6am every 1 hour", 2, WED)), [h(6), h(7)]);
  eq("NOON", disp(parseLoadTimePattern("INV 4301 - Delivery @ NOON **DRIVER P/U CHECK**", 1, WED)), ["Wed 12:00PM"]);
  eq("rollover past 11:59 PM stops", mins(parseLoadTimePattern("10pm & HRLY", 4, WED)), [h(22), h(23), null, null]);
  eq("^^^ with own time is not a ditto", mins(parseLoadTimePattern("INV 4308 ^^^ 11am", 1, WED)), [h(11)]);
  eq("no date → time only", disp(parseLoadTimePattern("9am", 1, null)), ["9:00AM"]);
  eq("empty → null", parseLoadTimePattern("", 2, WED), null);
  eq("invoice guard", parseLoadTimePattern("INV 4307", 1, WED), null);

  // ── isDittoCell ──────────────────────────────────────────────────────────────────────────
  eq("ditto INV 4356 ^^^", isDittoCell("INV 4356 ^^^"), true);
  eq("ditto with suffix", isDittoCell("INV 4356-002 ^^^^"), true);
  eq("not ditto with time", isDittoCell("INV 4308 ^^^ 11am"), false);

  // ── assignSheetLoads ─────────────────────────────────────────────────────────────────────
  const a4434 = assignSheetLoads(
    [
      { ship_date: FRI, sort_order: 1, load_count: 4, delivery_time: "INV 4434-005-008 - Delivery @ 8am & HRLY" },
      { ship_date: THU, sort_order: 5, load_count: 4, delivery_time: "INV 4434 - 001-004- Delivery @ 9am & HRLY" },
    ],
    8
  );
  eq("4434 multi-day loads 1..8", a4434.times.map((t) => t.load_number), [1, 2, 3, 4, 5, 6, 7, 8]);
  eq("4434 multi-day displays", disp(a4434.times), [
    "Thurs 9:00AM", "Thurs 10:00AM", "Thurs 11:00AM", "Thurs 12:00PM",
    "Fri 8:00AM", "Fri 9:00AM", "Fri 10:00AM", "Fri 11:00AM",
  ]);
  eq("4434 no warning", a4434.warning, null);
  eq("4434 sheet_raw kept", a4434.times[4].sheet_raw, "INV 4434-005-008 - Delivery @ 8am & HRLY");
  eq("count mismatch warns", assignSheetLoads([{ ship_date: THU, sort_order: 0, load_count: 2, delivery_time: "8am & HRLY" }], 3).warning, "Sheet describes 2 loads; job has 3");
  eq("NULL load_count = 1", assignSheetLoads([{ ship_date: THU, sort_order: 0, load_count: null, delivery_time: "8am & HRLY" }], 1).times.length, 1);

  // Ditto: pre-resolved by the caller (the sync passes the previous section row's cell).
  const ditto = assignSheetLoads(
    [{ ship_date: "2026-09-14", sort_order: 5, load_count: 3, delivery_time: "INV 4356 ^^^", ditto_source: "INV 4355 - Delivery @ 7am & HRLY" }],
    3
  );
  eq("ditto 4356 takes previous row's pattern", disp(ditto.times), ["Mon 7:00AM", "Mon 8:00AM", "Mon 9:00AM"]);
  eq("ditto keeps its own raw cell", ditto.times[0].sheet_raw, "INV 4356 ^^^");
  // Ditto fallback: previous row in the same list on the same ship_date.
  const dittoInList = assignSheetLoads(
    [
      { ship_date: "2026-09-14", sort_order: 1, load_count: 1, delivery_time: "INV 4356 - Delivery @ 7am & HRLY" },
      { ship_date: "2026-09-14", sort_order: 2, load_count: 2, delivery_time: "INV 4356 ^^^" },
    ],
    3
  );
  eq("ditto falls back to previous in-list row", disp(dittoInList.times), ["Mon 7:00AM", "Mon 7:00AM", "Mon 8:00AM"]);
  eq("ditto with no source → null loads", disp(assignSheetLoads([{ ship_date: THU, sort_order: 0, load_count: 1, delivery_time: "INV 4356 ^^^", ditto_source: null }], 1).times), [""]);

  // ── formatLoadTime ───────────────────────────────────────────────────────────────────────
  eq("fmt noon", formatLoadTime(WED, 720), "Wed 12:00PM");
  eq("fmt midnight", formatLoadTime(WED, 0), "Wed 12:00AM");
  eq("fmt Tues", formatLoadTime("2026-10-13", 545), "Tues 9:05AM");
  eq("fmt Thurs", formatLoadTime(THU, 1439), "Thurs 11:59PM");
  eq("fmt no date", formatLoadTime(null, 540), "9:00AM");
  eq("fmt no minutes", formatLoadTime(WED, null), "");

  // ── summarizeLoadTimes ───────────────────────────────────────────────────────────────────
  const lt = (n: number, date: string | null, m: number | null): LoadTime => ({ load_number: n, date, minutes: m, display: formatLoadTime(date, m) });
  eq("summary one load", summarizeLoadTimes([lt(1, THU, h(9))]), "Thurs 9:00AM");
  eq("summary same-day range", summarizeLoadTimes([lt(1, THU, h(9)), lt(2, THU, h(10)), lt(3, THU, h(11)), lt(4, THU, h(12))]), "Thurs 9:00AM–12:00PM (4 loads)");
  eq("summary multi-day", summarizeLoadTimes([lt(1, THU, h(9)), lt(2, THU, h(10)), lt(3, FRI, h(8))]), "Thurs 9:00AM, 10:00AM | Fri 8:00AM");
  eq("summary groups by day, load 1's day first", summarizeLoadTimes([lt(1, THU, h(8)), lt(2, FRI, h(9)), lt(3, THU, h(10))]), "Thurs 8:00AM, 10:00AM | Fri 9:00AM");
  eq("hasLeadingWeekday", [hasLeadingWeekday("Thurs 7AM"), hasLeadingWeekday("8am & HRLY"), hasLeadingWeekday("INV 4434 ^^^"), hasLeadingWeekday(null)], [true, false, false, false]);
  eq("summary uneven same day", summarizeLoadTimes([lt(1, THU, h(8)), lt(2, THU, h(9)), lt(3, THU, h(11))]), "Thurs 8:00AM, 9:00AM, 11:00AM");
  eq("summary untimed load → list", summarizeLoadTimes([lt(1, THU, h(10)), lt(2, THU, null)]), "Thurs 10:00AM");
  eq("summary none", summarizeLoadTimes([lt(1, THU, null)]), "");
  eq("summary unordered input", summarizeLoadTimes([lt(2, THU, h(10)), lt(1, THU, h(9))]), "Thurs 9:00AM–10:00AM (2 loads)");

  // ── loadSuffix (dlv-04) ───────────────────────────────────────────────────────────────────
  eq("suffix 1 load → bare", loadSuffix("4440", 1, 1), "4440");
  eq("suffix 2 loads", [loadSuffix("4472", 1, 2), loadSuffix("4472", 2, 2)], ["4472-01", "4472-02"]);
  eq("suffix load 10 of 12", loadSuffix("4440", 10, 12), "4440-10");
  eq("suffix empty invoice", loadSuffix("", 3, 5), "");

  // ── capLoadTimesLabel (dlv-05) ────────────────────────────────────────────────────────────
  eq("cap 6 times over 2 days", capLoadTimesLabel("Mon 8:00AM, 9:00AM, 10:00AM, 11:00AM, 12:00PM | Tues 11:00AM"), "Mon 8:00AM, 9:00AM…");
  eq("cap 3 times one day", capLoadTimesLabel("Thurs 8:00AM, 9:00AM, 11:00AM"), "Thurs 8:00AM, 9:00AM…");
  eq("cap spans day groups", capLoadTimesLabel("Mon 8:00AM | Tues 11:00AM, 12:00PM"), "Mon 8:00AM | Tues 11:00AM…");
  eq("cap drops whole later group", capLoadTimesLabel("Thurs 9:00AM, 10:00AM | Fri 8:00AM"), "Thurs 9:00AM, 10:00AM…");
  eq("cap 2 times unchanged", capLoadTimesLabel("Thurs 9:00AM, 10:00AM"), "Thurs 9:00AM, 10:00AM");
  eq("cap 2 groups of 1 unchanged", capLoadTimesLabel("Mon 8:00AM | Tues 11:00AM"), "Mon 8:00AM | Tues 11:00AM");
  eq("cap range form unchanged", capLoadTimesLabel("Thurs 9:00AM–12:00PM (4 loads)"), "Thurs 9:00AM–12:00PM (4 loads)");
  eq("cap legacy free text unchanged", capLoadTimesLabel("8:00 AM & HRLY"), "8:00 AM & HRLY");
  eq("cap empty", capLoadTimesLabel(""), "");

  // ── bare "@ h:mm" with no am/pm (dlv-06): 5–11 → AM, 12–4 → PM ───────────────────────────
  eq("4542 @ 8:30 bare ×1", mins(parseLoadTimePattern("INV 4542 - Delivery @ 8:30", 1, WED)), [h(8, 30)]);
  eq("4542 @ 1:30 bare → PM", mins(parseLoadTimePattern("INV 4542 - Delivery @ 1:30", 1, WED)), [h(13, 30)]);
  eq("@ 12 bare → noon", mins(parseLoadTimePattern("Delivery @ 12", 1, WED)), [h(12)]);
  eq("@ 7 bare → AM", mins(parseLoadTimePattern("Delivery @ 7", 1, WED)), [h(7)]);
  eq("4531 @ 8:30 & HRLY ×3", mins(parseLoadTimePattern("INV 4531 - Delivery @ 8:30 & HRLY", 3, WED)), [h(8, 30), h(9, 30), h(10, 30)]);
  eq("@ 8:30 driver note ignored", mins(parseLoadTimePattern("Delivery @ 8:30 **NO EARLIER THAN 8:15**", 1, WED)), [h(8, 30)]);
  eq("@ 13:00 bare → null", parseLoadTimePattern("Delivery @ 13:00", 1, WED), null);
  eq("4434 suffix unchanged", mins(parseLoadTimePattern("INV 4434-005-008 - Delivery @ 8am & HRLY", 4, WED)), [h(8), h(9), h(10), h(11)]);
  eq("4463 shared meridiem unchanged", mins(parseLoadTimePattern("INV 4463 - Delivery @ 6:30 & 7:30 am", 2, WED)), [h(6, 30), h(7, 30)]);
  eq("4536 no time still null", parseLoadTimePattern("INV 4536 - Tyler pull for PIPER", 1, WED), null);

  return { pass: results.every((r) => r.pass), results };
}
