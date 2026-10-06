// src/lib/logistics/splitDays.selfcheck.ts
// Guarded dev self-check for splitDays.ts (split-days-01). Mirrors toLoadSheet.selfcheck.ts's shape: a
// check()/results table, one exported run*SelfCheck() function. Not part of the production build path.
// Fixture dates: 2026-10-05 is a Monday; 10/12 is the following Monday.
import { expandShipmentDays, inWeek, sortEntries, weekTileCounts, type LoadDayRow } from "./splitDays";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

interface Row { id: string; ship_date: string | null; load_count: number | null; trailer_group_id?: string | null }

const la = (load_number: number | null, ship_date: string | null): LoadDayRow => ({ job_id: "j", load_number, ship_date });

export function runSplitDaysSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, got: unknown, want: unknown) =>
    check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  const pick = (es: Array<{ day_date: string | null; day_loads: number[] | null; entry_key: string }>) =>
    es.map((e) => [e.day_date, e.day_loads, e.entry_key]);

  // Unsplit, no la rows.
  const a: Row = { id: "s1", ship_date: "2026-10-06", load_count: 2 };
  eq("unsplit no la rows", pick(expandShipmentDays(a, [])), [["2026-10-06", null, "s1"]]);

  // All loads override to the same non-order date -> unsplit, stays on the ORDER date.
  eq("all same override -> order date", pick(expandShipmentDays(a, [la(1, "2026-10-08"), la(2, "2026-10-08")])),
    [["2026-10-06", null, "s1"]]);

  // Stale single-load override (INV 4386).
  const inv4386: Row = { id: "s4386", ship_date: "2026-09-30", load_count: 1 };
  eq("stale single-load override (INV 4386)", pick(expandShipmentDays(inv4386, [la(1, "2026-09-24")])),
    [["2026-09-30", null, "s4386"]]);

  // 3-load split 1 | 2,3.
  const b: Row = { id: "s2", ship_date: "2026-10-06", load_count: 3 };
  eq("3-load split 1 | 2,3", pick(expandShipmentDays(b, [la(1, "2026-10-06"), la(2, "2026-10-09"), la(3, "2026-10-09")])),
    [["2026-10-06", [1], "s2@2026-10-06"], ["2026-10-09", [2, 3], "s2@2026-10-09"]]);

  // Partial la rows: load 2 has no row -> falls back to the order date.
  eq("partial la rows", pick(expandShipmentDays(b, [la(1, "2026-10-07"), la(3, "2026-10-07")])),
    [["2026-10-06", [2], "s2@2026-10-06"], ["2026-10-07", [1, 3], "s2@2026-10-07"]]);

  // Datetime-shaped override is clipped to 10 chars.
  eq("override clipped to date", pick(expandShipmentDays(b, [la(3, "2026-10-08T00:00:00Z")])),
    [["2026-10-06", [1, 2], "s2@2026-10-06"], ["2026-10-08", [3], "s2@2026-10-08"]]);

  // Split straddling two weeks + inWeek windowing.
  const straddle = expandShipmentDays(b, [la(2, "2026-10-13"), la(3, "2026-10-13")]);
  eq("straddle: 2 entries", straddle.length, 2);
  eq("straddle: this week keeps load 1", pick(straddle.filter((e) => inWeek(e.day_date, "2026-10-05"))),
    [["2026-10-06", [1], "s2@2026-10-06"]]);
  eq("straddle: next week keeps loads 2,3", pick(straddle.filter((e) => inWeek(e.day_date, "2026-10-12"))),
    [["2026-10-13", [2, 3], "s2@2026-10-13"]]);

  // Blank-string ship_date is null.
  eq("blank override = null", pick(expandShipmentDays(b, [la(1, ""), la(2, "   "), la(3, null)])),
    [["2026-10-06", null, "s2"]]);
  const noDate: Row = { id: "s3", ship_date: "", load_count: 2 };
  eq("blank order date + one override splits to none", pick(expandShipmentDays(noDate, [la(2, "2026-10-07")])),
    [["2026-10-07", [2], "s3@2026-10-07"], [null, [1], "s3@none"]]);

  // Extra load_number beyond load_count is enumerated.
  eq("extra la load_number enumerated", pick(expandShipmentDays(a, [la(3, "2026-10-09")])),
    [["2026-10-06", [1, 2], "s1@2026-10-06"], ["2026-10-09", [3], "s1@2026-10-09"]]);

  // inWeek edges (incl. month rollover).
  eq("inWeek Monday", inWeek("2026-10-05", "2026-10-05"), true);
  eq("inWeek Sunday", inWeek("2026-10-11", "2026-10-05"), true);
  eq("inWeek next Monday", inWeek("2026-10-12", "2026-10-05"), false);
  eq("inWeek prior Sunday", inWeek("2026-10-04", "2026-10-05"), false);
  eq("inWeek month rollover", inWeek("2026-11-01", "2026-10-26"), true);
  eq("inWeek null", inWeek(null, "2026-10-05"), false);

  // sortEntries: asc, null last, stable.
  const sorted = sortEntries([
    { k: "n", day_date: null }, { k: "b1", day_date: "2026-10-07" }, { k: "a", day_date: "2026-10-06" }, { k: "b2", day_date: "2026-10-07" },
  ]).map((e) => e.k);
  eq("sortEntries asc/null last/stable", sorted, ["a", "b1", "b2", "n"]);

  // weekTileCounts: trailer group collapse per day.
  const g1 = expandShipmentDays({ id: "g1", ship_date: "2026-10-06", load_count: 2, trailer_group_id: "T" }, []);
  const g2 = expandShipmentDays({ id: "g2", ship_date: "2026-10-06", load_count: 1, trailer_group_id: "T" }, []);
  eq("tile: trailer group collapses to MAX", weekTileCounts([...g1, ...g2]), { orders: 2, loads: 2 });

  // weekTileCounts: same order split across two in-week days.
  const sp = expandShipmentDays(b, [la(2, "2026-10-09"), la(3, "2026-10-09")]).filter((e) => inWeek(e.day_date, "2026-10-05"));
  eq("tile: split order in-week = 1 order, sum of day loads", weekTileCounts(sp), { orders: 1, loads: 3 });
  eq("tile: split + unsplit", weekTileCounts([...sp, ...expandShipmentDays(a, [])]), { orders: 2, loads: 5 });

  return { pass: results.every((r) => r.pass), results };
}
