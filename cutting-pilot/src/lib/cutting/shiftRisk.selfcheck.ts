// src/lib/cutting/shiftRisk.selfcheck.ts
// Guarded dev self-check for shiftRisk.ts (shift-alert-01). Mirrors toLoadSheet.selfcheck.ts's shape: a
// check()/results table, one exported run*SelfCheck() function. Not part of the production build path.
// Real UTC instants so the ET conversion runs under both offsets: 2026-10-05 is a Monday (EDT, UTC−4);
// 2026-12-07 is a Monday (EST, UTC−5).
import { dueCheckpoints, lastShift } from "./shiftRisk";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export function runShiftRiskSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, got: unknown, want: unknown) =>
    check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
  const due = (iso: string) => dueCheckpoints(new Date(iso));

  eq("Mon 12:29 EDT none", due("2026-10-05T16:29Z"), []);
  eq("Mon 12:30 1st T-2h", due("2026-10-05T16:30Z"), [{ shift: "1st", shiftDate: "2026-10-05", kind: "t_minus_2h" }]);
  eq("Mon 14:29 1st T-2h only", due("2026-10-05T18:29Z"), [{ shift: "1st", shiftDate: "2026-10-05", kind: "t_minus_2h" }]);
  eq("Mon 14:30 1st end", due("2026-10-05T18:30Z"), [{ shift: "1st", shiftDate: "2026-10-05", kind: "end_of_shift" }]);
  eq("Mon 15:30 none", due("2026-10-05T19:30Z"), []);
  eq("Mon 20:30 2nd T-2h", due("2026-10-06T00:30Z"), [{ shift: "2nd", shiftDate: "2026-10-05", kind: "t_minus_2h" }]);
  eq("Mon 22:30 2nd end", due("2026-10-06T02:30Z"), [{ shift: "2nd", shiftDate: "2026-10-05", kind: "end_of_shift" }]);
  eq("Tue 04:00 3rd T-2h (Mon night)", due("2026-10-06T08:00Z"), [{ shift: "3rd", shiftDate: "2026-10-05", kind: "t_minus_2h" }]);
  eq("Tue 06:00 3rd end (Mon night)", due("2026-10-06T10:00Z"), [{ shift: "3rd", shiftDate: "2026-10-05", kind: "end_of_shift" }]);
  eq("Sat 04:00 3rd T-2h (Fri night counts)", due("2026-10-10T08:00Z"), [{ shift: "3rd", shiftDate: "2026-10-09", kind: "t_minus_2h" }]);
  eq("Sat 12:30 none", due("2026-10-10T16:30Z"), []);
  eq("Mon 04:00 none (Sun night)", due("2026-10-12T08:00Z"), []);
  eq("Mon 12:30 EST 1st T-2h", due("2026-12-07T17:30Z"), [{ shift: "1st", shiftDate: "2026-12-07", kind: "t_minus_2h" }]);

  eq("lastShift 1st+2nd", lastShift(["1st", "2nd"]), "2nd");
  eq("lastShift 3rd+1st", lastShift(["3rd", "1st"]), "3rd");
  eq("lastShift empty", lastShift([]), null);
  eq("lastShift bogus", lastShift(["bogus"]), null);

  return { pass: results.every((r) => r.pass), results };
}
