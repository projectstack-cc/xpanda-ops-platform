// src/lib/productionHistory.selfcheck.ts
// Guarded dev self-check for productionHistory.ts. Mirrors productionNumbering.selfcheck.ts's
// shape: a check()/results table, one exported run*SelfCheck() function. Not part of the
// production build path.
import { agingHours, filtersToQuery, parseUtcTs } from "./productionHistory";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export function runProductionHistorySelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });

  const a = agingHours("2026-09-28 12:00:00", "2026-09-27 12:00:00");
  check("agingHours 24h", a === 24, String(a));
  const b = agingHours("2026-09-28 12:30:00", "2026-09-28 12:00:00");
  check("agingHours 0.5h", b === 0.5, String(b));
  check("agingHours negative -> null", agingHours("2026-09-27 12:00:00", "2026-09-28 12:00:00") === null);
  check("agingHours null created -> null", agingHours(null, "2026-09-28 12:00:00") === null);
  check("agingHours null full_at -> null", agingHours("2026-09-28 12:00:00", null) === null);
  check("agingHours garbage -> null", agingHours("not a date", "2026-09-28 12:00:00") === null);

  // D1 stamp and ISO parse to the same UTC instant.
  check(
    "parseUtcTs stamp == ISO Z",
    parseUtcTs("2026-09-28 12:00:00") === Date.UTC(2026, 8, 28, 12, 0, 0) &&
      parseUtcTs("2026-09-28T12:00:00Z") === Date.UTC(2026, 8, 28, 12, 0, 0)
  );

  const q = filtersToQuery({ from: "2026-09-01", to: "2026-09-28", supplier: "", bead_type: "  ", lot: "L1" });
  check("filtersToQuery omits blanks", q === "from=2026-09-01&to=2026-09-28&lot=L1", q);

  return { pass: results.every((r) => r.pass), results };
}
