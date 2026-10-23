// src/lib/marina/pieces.selfcheck.ts — marina-03
// Self-check for the pure piece logic (pieces.ts). No DB, no network.
// Run with: npx tsx src/lib/marina/pieces.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import { MARINA_DEFAULT_TOL } from "../inches";
import { evaluateMeasurements, nextStatus, type DimNominal, type NextStatusResult } from "./pieces";
import type { MarinaPieceStatus } from "./types";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}

const T = MARINA_DEFAULT_TOL;
const dims: DimNominal[] = [
  { id: "L", nominal_in: 41.375 },
  { id: "W", nominal_in: 22.5 },
  { id: "H", nominal_in: 6 },
];

// ── evaluateMeasurements ─────────────────────────────────────────────────────────────────────
{
  const r = evaluateMeasurements(dims, [
    { dim_id: "H", value: "6" }, { dim_id: "L", value: " 41⅜ " }, { dim_id: "W", value: "22.5" },
  ], T);
  check("eval all in → ok", r.ok && r.allIn);
  if (r.ok) {
    eq("eval rows in dim order", r.rows.map((x) => x.dim_id), ["L", "W", "H"]);
    eq("eval measured_text trimmed", r.rows[0].measured_text, "41⅜");
    eq("eval measured_in parsed", r.rows[0].measured_in, 41.375);
    eq("eval nominal snapshot", r.rows[1].nominal_in, 22.5);
  }
}
{
  // Boundary: exactly 3/16 off is IN; 3/16 + 1/64 is OUT.
  const r = evaluateMeasurements(dims, [
    { dim_id: "L", value: "41 9/16" }, { dim_id: "W", value: "22 5/16" }, { dim_id: "H", value: "6" },
  ], T);
  check("eval exactly 3/16 off (both ways) → all in", r.ok && r.allIn);
  const o = evaluateMeasurements(dims, [
    { dim_id: "L", value: "41 37/64" }, { dim_id: "W", value: "22.5" }, { dim_id: "H", value: "6" },
  ], T);
  check("eval 3/16 + 1/64 → out", o.ok && !o.allIn && !o.rows[0].in_tol && o.rows[1].in_tol);
}
eq("eval missing_dim", evaluateMeasurements(dims, [{ dim_id: "L", value: "41" }, { dim_id: "W", value: "22" }], T),
  { ok: false, code: "missing_dim", dim_id: "H", error: "Every dimension needs a measurement." });
{
  const r = evaluateMeasurements(dims, [{ dim_id: "X", value: "1" }], T);
  check("eval unknown_dim", !r.ok && r.code === "unknown_dim" && r.dim_id === "X");
}
{
  const r = evaluateMeasurements(dims, [{ dim_id: "L", value: "41" }, { dim_id: "L", value: "41" }], T);
  check("eval duplicate_dim", !r.ok && r.code === "duplicate_dim" && r.dim_id === "L");
}
for (const bad of ["abc", "", "   ", "4/0", "-3"]) {
  const r = evaluateMeasurements(dims, [
    { dim_id: "L", value: bad }, { dim_id: "W", value: "22.5" }, { dim_id: "H", value: "6" },
  ], T);
  check(`eval bad_value ${JSON.stringify(bad)}`, !r.ok && r.code === "bad_value" && r.dim_id === "L");
}
{
  const r = evaluateMeasurements(dims, [
    { dim_id: "L", value: 41 as unknown as string }, { dim_id: "W", value: "22.5" }, { dim_id: "H", value: "6" },
  ], T);
  check("eval non-string value → bad_value", !r.ok && r.code === "bad_value");
}
check("eval empty input → missing_dim", (() => { const r = evaluateMeasurements(dims, [], T); return !r.ok && r.code === "missing_dim"; })());

// ── nextStatus: the state-machine table ──────────────────────────────────────────────────────
const ok = (status: string, used: string | null): NextStatusResult =>
  ({ ok: true, status, dispositionUsed: used } as NextStatusResult);
const code = (r: NextStatusResult) => (r.ok ? `ok:${r.status}` : r.code);

eq("attempt 1 all in → pass", nextStatus({ current: null, allIn: true }), ok("pass", null));
eq("attempt 1 out + rework → rework_pending", nextStatus({ current: null, allIn: false, disposition: "rework" }), ok("rework_pending", "rework"));
eq("attempt 1 out + scrap → scrapped", nextStatus({ current: null, allIn: false, disposition: "scrap" }), ok("scrapped", "scrap"));
eq("attempt 1 out, no disposition", code(nextStatus({ current: null, allIn: false })), "disposition_required");
eq("attempt 1 out, null disposition", code(nextStatus({ current: null, allIn: false, disposition: null })), "disposition_required");
eq("re-measure all in → accepted", nextStatus({ current: "rework_pending", allIn: true }), ok("accepted", null));
eq("re-measure out, no disposition", code(nextStatus({ current: "rework_pending", allIn: false })), "disposition_required");
eq("disposition ignored when all in (attempt 1)", nextStatus({ current: null, allIn: true, disposition: "scrap" }), ok("pass", null));
eq("disposition ignored when all in (re-measure)", nextStatus({ current: "rework_pending", allIn: true, disposition: "rework" }), ok("accepted", null));
for (const s of ["pass", "accepted", "scrapped"] as MarinaPieceStatus[]) {
  eq(`re-measure on ${s} → not_rework_pending`, code(nextStatus({ current: s, allIn: true })), "not_rework_pending");
  eq(`re-measure on ${s} (out) → not_rework_pending`, code(nextStatus({ current: s, allIn: false, disposition: "rework" })), "not_rework_pending");
}

// Sequences.
function run(steps: { allIn: boolean; disposition?: "rework" | "scrap" }[]): string[] {
  let current: MarinaPieceStatus | null = null;
  const out: string[] = [];
  for (const s of steps) {
    const r = nextStatus({ current, ...s });
    out.push(code(r));
    if (r.ok) current = r.status;
  }
  return out;
}
eq("rework → rework again → accepted",
  run([{ allIn: false, disposition: "rework" }, { allIn: false, disposition: "rework" }, { allIn: true }]),
  ["ok:rework_pending", "ok:rework_pending", "ok:accepted"]);
eq("rework → scrap",
  run([{ allIn: false, disposition: "rework" }, { allIn: false, disposition: "scrap" }]),
  ["ok:rework_pending", "ok:scrapped"]);
eq("accepted is final",
  run([{ allIn: false, disposition: "rework" }, { allIn: true }, { allIn: true }]),
  ["ok:rework_pending", "ok:accepted", "not_rework_pending"]);
eq("scrapped is final",
  run([{ allIn: false, disposition: "scrap" }, { allIn: true }]),
  ["ok:scrapped", "not_rework_pending"]);

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  (${r.detail})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
