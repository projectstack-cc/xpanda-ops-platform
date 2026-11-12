// src/lib/trailerStops.selfcheck.ts
// Guarded dev self-check for trailerStops.ts (stops-01). Not part of the production build path.
// Run: npx tsx -e "import('./src/lib/trailerStops.selfcheck').then(m => { const r = m.runTrailerStopsSelfCheck(); console.log(r); process.exit(r.pass ? 0 : 1); })"
import { stopLabel, validateStops, type TrailerStopMember } from "./trailerStops";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const m = (id: string, stop: number | null = null, status = "in_production", archived_at: string | null = null): TrailerStopMember =>
  ({ id, status, archived_at, trailer_stop: stop });

export function runTrailerStopsSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const eq = (name: string, got: unknown, want: unknown) =>
    check(name, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));

  // Ordinals.
  eq("ordinals 1-4", [1, 2, 3, 4].map(stopLabel), ["1st Stop", "2nd Stop", "3rd Stop", "4th Stop"]);
  eq("ordinals 11-13", [11, 12, 13].map(stopLabel), ["11th Stop", "12th Stop", "13th Stop"]);
  eq("ordinals 21-23", [21, 22, 23].map(stopLabel), ["21st Stop", "22nd Stop", "23rd Stop"]);

  const group = [m("a"), m("b"), m("c")];

  eq("valid full set", validateStops(group, { a: 1, b: 2, c: 3 }), { ok: true });
  eq("valid partial set", validateStops(group, { a: 2, b: null, c: null }), { ok: true });
  eq("swap 1<->2 in one map", validateStops([m("a", 1), m("b", 2), m("c")], { a: 2, b: 1 }), { ok: true });

  const dup = validateStops(group, { a: 1, b: 1, c: null });
  eq("duplicate", dup, { ok: false, status: 400, error: "Two orders can't be the same stop." });
  const dupSaved = validateStops([m("a"), m("b", 2), m("c")], { a: 2 });
  eq("duplicate against an omitted saved stop", dupSaved.ok ? "ok" : (dupSaved as any).status, 400);

  for (const bad of [0, 5, 4, 1.5, "1", -1]) {
    const r = validateStops(group, { a: bad });
    eq(`out of range ${JSON.stringify(bad)}`, r.ok ? "ok" : (r as any).status, 400);
  }

  eq("saved stop above group size, unchanged", validateStops([m("a", 3), m("b", 1)], { a: 3, b: 2 }), { ok: true });
  const raised = validateStops([m("a", 1), m("b")], { b: 3 });
  eq("new stop above group size", raised.ok ? "ok" : (raised as any).status, 400);

  const outsider =validateStops(group, { a: 1, z: 2 });
  eq("job not in group", outsider.ok ? "ok" : (outsider as any).status, 400);

  const shipped = validateStops([m("a", 1, "shipped"), m("b"), m("c")], { a: 2 });
  eq("shipped member change", shipped, { ok: false, status: 409, error: "A shipped or archived order's stop can't change." });
  const archived = validateStops([m("a", null, "done", "2026-11-01"), m("b"), m("c")], { a: 1 });
  eq("archived member change", archived.ok ? "ok" : (archived as any).status, 409);
  eq("shipped member unchanged is fine", validateStops([m("a", 1, "shipped"), m("b"), m("c")], { a: 1, b: 2 }), { ok: true });
  eq("loading member can change", validateStops([m("a", null, "loading"), m("b"), m("c")], { a: 3 }), { ok: true });
  eq("string 'null' archived_at is not archived", validateStops([m("a", null, "done", "null"), m("b")], { a: 1 }), { ok: true });

  eq("non-object stops", validateStops(group, [] as any).ok, false);

  return { pass: results.every((x) => x.pass), results };
}
