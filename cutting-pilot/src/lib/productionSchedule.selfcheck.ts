// src/lib/productionSchedule.selfcheck.ts
// Guarded dev self-check for productionSchedule.ts pure helpers. Mirrors
// productionRecipes.selfcheck.ts's shape: a check()/results table, one exported run*SelfCheck()
// function. Not part of the production build path.
import { addDays, etDayBoundsUtc, expansionKey, validateLineInput, validatePlanDate } from "./productionSchedule";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export function runProductionScheduleSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, got: unknown, want: unknown) =>
    check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

  // EST (UTC-5) and EDT (UTC-4) days.
  eq("bounds EST 2026-01-15", etDayBoundsUtc("2026-01-15"), ["2026-01-15 05:00:00", "2026-01-16 05:00:00"]);
  eq("bounds EDT 2026-07-15", etDayBoundsUtc("2026-07-15"), ["2026-07-15 04:00:00", "2026-07-16 04:00:00"]);
  // DST transition days: spring forward = 23 h, fall back = 25 h.
  eq("bounds 2026-03-08 (23 h)", etDayBoundsUtc("2026-03-08"), ["2026-03-08 05:00:00", "2026-03-09 04:00:00"]);
  eq("bounds 2026-11-01 (25 h)", etDayBoundsUtc("2026-11-01"), ["2026-11-01 04:00:00", "2026-11-02 05:00:00"]);

  eq("addDays month end", addDays("2026-09-30", 1), "2026-10-01");
  eq("addDays year end", addDays("2026-12-31", 1), "2027-01-01");
  eq("addDays negative", addDays("2026-03-01", -1), "2026-02-28");

  const today = "2026-09-28";
  eq("plan date ok today", validatePlanDate("2026-09-28", today), null);
  eq("plan date ok +14", validatePlanDate("2026-10-12", today), null);
  eq("plan date bad format", validatePlanDate("09/28/2026", today), "invalid_plan_date");
  eq("plan date impossible", validatePlanDate("2026-02-30", today), "invalid_plan_date");
  eq("plan date past", validatePlanDate("2026-09-27", today), "date_out_of_range");
  eq("plan date +15", validatePlanDate("2026-10-13", today), "date_out_of_range");

  eq("line invalid_kind", validateLineInput("cutting", { qty: 1 }), { ok: false, error: "invalid_kind" });
  eq("line qty 0", validateLineInput("molding", { block_type: "A", qty: 0 }), { ok: false, error: "qty_invalid" });
  eq("line qty 1000", validateLineInput("molding", { block_type: "A", qty: 1000 }), { ok: false, error: "qty_invalid" });
  eq("line qty 1.5", validateLineInput("molding", { block_type: "A", qty: 1.5 }), { ok: false, error: "qty_invalid" });
  eq("line density_required", validateLineInput("expansion", { bead_supplier: "S", bead_type: "T", qty: 2 }), {
    ok: false,
    error: "density_required",
  });
  const ok = validateLineInput("expansion", { bead_supplier: " S ", bead_type: "T", density: "1.255", qty: "3" });
  eq("line expansion normalized", ok, {
    ok: true,
    value: { kind: "expansion", block_type: null, bead_supplier: "S", bead_type: "T", density: 1.26, qty: 3, note: null },
  });
  eq("expansionKey 2 dp", expansionKey("S", "T", 1.2500001), "S|T|1.25");

  return { pass: results.every((r) => r.pass), results };
}
