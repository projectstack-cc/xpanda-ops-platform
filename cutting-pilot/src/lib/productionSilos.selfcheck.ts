// src/lib/productionSilos.selfcheck.ts
// Guarded dev self-check for productionSilos.ts's pure predicates. Mirrors
// productionNumbering.selfcheck.ts's shape: a check()/results table, one exported
// run*SelfCheck() function. Not part of the production build path.
import { canExpandInto, canMoldFrom, type SiloState } from "./productionSilos";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export function runProductionSilosSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const silo = (state: SiloState, lot_id: string | null = null, active = 1) => ({ state, lot_id, active });
  const err = (r: { ok: boolean; error?: string }) => (r.ok ? "ok" : r.error ?? "?");

  // Expansion
  check("expand into empty -> ok", err(canExpandInto(silo("empty"), "L1")) === "ok");
  check("expand into filling, same lot -> ok", err(canExpandInto(silo("filling", "L1"), "L1")) === "ok");
  const other = err(canExpandInto(silo("filling", "L1"), "L2"));
  check("expand into filling, other lot -> silo_lot_mismatch", other === "silo_lot_mismatch", other);
  const full = err(canExpandInto(silo("full", "L1"), "L1"));
  check("expand into full -> silo_not_fillable", full === "silo_not_fillable", full);
  const inUse = err(canExpandInto(silo("in_use", "L1"), "L1"));
  check("expand into in_use -> silo_not_fillable", inUse === "silo_not_fillable", inUse);
  const inactiveExp = err(canExpandInto(silo("empty", null, 0), "L1"));
  check("expand into inactive -> silo_inactive", inactiveExp === "silo_inactive", inactiveExp);

  // Molding
  const moldEmpty = err(canMoldFrom(silo("empty")));
  check("mold from empty -> silo_not_moldable", moldEmpty === "silo_not_moldable", moldEmpty);
  const moldFilling = err(canMoldFrom(silo("filling", "L1")));
  check("mold from filling -> silo_not_moldable", moldFilling === "silo_not_moldable", moldFilling);
  check("mold from full -> ok", err(canMoldFrom(silo("full", "L1"))) === "ok");
  check("mold from in_use -> ok", err(canMoldFrom(silo("in_use", "L1"))) === "ok");
  const inactiveMold = err(canMoldFrom(silo("full", "L1", 0)));
  check("mold from inactive -> silo_inactive", inactiveMold === "silo_inactive", inactiveMold);

  return { pass: results.every((r) => r.pass), results };
}
