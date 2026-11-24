// src/lib/hbChunkPlan.selfcheck.ts
// hbplan-01: dev self-check for hbChunkPlan.ts's pure logic. Run: npx tsx src/lib/hbChunkPlan.selfcheck.ts
// Not part of the production build path.
import { HB_CHUNK_HEIGHT, HB_KERF } from "./holeyNester";
import {
  hbNeededByThickness,
  hbAllowedThicknesses,
  groupFill,
  validatePlanGroups,
  planVsNeeded,
  planMatches,
  planTotal,
  parsePlan,
  type HbPlanGroup,
} from "./hbChunkPlan";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: unknown) {
  results.push({ name, pass, detail: pass ? undefined : JSON.stringify(detail) });
}
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// --- hbNeededByThickness ---
const lines = [
  { part_id: "p4a", part_number: "HB-4A", thickness: 4, qty: 40 },
  { part_id: "p2", part_number: "HB-2", thickness: 2, qty: 10 },
  { part_id: "p4b", part_number: "HB-4B", thickness: 4, qty: 32 },
  { part_id: "p1", part_number: "HB-1", thickness: 1, qty: 6 },
];
const bdNoNet = JSON.stringify({ chunks_required: 9, lines });
check("needed: no net -> order qty summed by thickness, thickest first", JSON.stringify(hbNeededByThickness(bdNoNet)) === JSON.stringify([{ thickness: 4, qty: 72 }, { thickness: 2, qty: 10 }, { thickness: 1, qty: 6 }]), hbNeededByThickness(bdNoNet));
const bdNet = JSON.stringify({
  chunks_required: 9,
  lines,
  net: { pcs: [{ part_id: "p4b", thickness: 4, order_qty: 32, on_hand: 12, to_cut: 20 }, { part_id: "p1", thickness: 1, order_qty: 6, on_hand: 6, to_cut: 0 }] },
});
check("needed: net.pcs to_cut replaces the line qty; zero rows dropped", JSON.stringify(hbNeededByThickness(bdNet)) === JSON.stringify([{ thickness: 4, qty: 60 }, { thickness: 2, qty: 10 }]), hbNeededByThickness(bdNet));
check("needed: null / garbage / no lines -> []", hbNeededByThickness(null).length === 0 && hbNeededByThickness("{nope").length === 0 && hbNeededByThickness("{}").length === 0 && hbNeededByThickness("42").length === 0);
check("allowed thicknesses come from the lines", JSON.stringify(hbAllowedThicknesses(bdNet)) === "[4,2,1]", hbAllowedThicknesses(bdNet));

// --- groupFill ---
check("fill: single board has no kerf", close(groupFill({ pieces: [{ thickness: 4, qty: 1 }] }), 4));
check("fill: kerf between boards only", close(groupFill({ pieces: [{ thickness: 4, qty: 10 }, { thickness: 2, qty: 2 }] }), 44 + 11 * HB_KERF));
const exactQty = 5;
const exactT = (HB_CHUNK_HEIGHT - (exactQty - 1) * HB_KERF) / exactQty; // 5 boards filling 50.5" exactly
check("fill: exact 50.5\" fit", close(groupFill({ pieces: [{ thickness: exactT, qty: exactQty }] }), HB_CHUNK_HEIGHT));
check("fill: empty group is 0", groupFill({ pieces: [] }) === 0);

// --- validatePlanGroups ---
const allowed = [4, 2, 1];
const err = (g: unknown, a = allowed) => {
  const r = validatePlanGroups(g, a);
  return r.ok ? null : r.error;
};
check("validate: empty list rejected", err([]) === "A chunk list needs at least 1 group.", err([]));
check("validate: non-array rejected", err(null) !== null && err({}) !== null);
check("validate: count 0 rejected", /Group 1: chunk count/.test(err([{ count: 0, pieces: [{ thickness: 4, qty: 1 }] }]) ?? ""));
check("validate: fractional count rejected", /Group 1: chunk count/.test(err([{ count: 1.5, pieces: [{ thickness: 4, qty: 1 }] }]) ?? ""));
check("validate: no pieces rejected", /Group 2 needs at least one piece/.test(err([{ count: 1, pieces: [{ thickness: 4, qty: 1 }] }, { count: 1, pieces: [] }]) ?? ""));
check("validate: qty 0 rejected", /piece quantity/.test(err([{ count: 1, pieces: [{ thickness: 4, qty: 0 }] }]) ?? ""));
check("validate: fractional qty rejected", /piece quantity/.test(err([{ count: 1, pieces: [{ thickness: 4, qty: 2.5 }] }]) ?? ""));
check("validate: thickness not on the order rejected", /3" isn't a Holey Board thickness/.test(err([{ count: 1, pieces: [{ thickness: 3, qty: 1 }] }]) ?? ""), err([{ count: 1, pieces: [{ thickness: 3, qty: 1 }] }]));
const overG = [{ count: 1, pieces: [{ thickness: 4, qty: 1 }] }, { count: 2, pieces: [{ thickness: 4, qty: 12 }, { thickness: 2, qty: 1 }] }];
check("validate: over-fill message", err(overG) === `Group 2 is ${groupFill(overG[1]).toFixed(1)}" — over the 50.5" chunk`, err(overG));
check("validate: over-fill message text (12x4 + 1x2 = 50.9\")", err([{ count: 1, pieces: [{ thickness: 4, qty: 1 }] }, { count: 1, pieces: [{ thickness: 4, qty: 12 }, { thickness: 2, qty: 1 }] }]) === 'Group 2 is 50.9" — over the 50.5" chunk', err([{ count: 1, pieces: [{ thickness: 4, qty: 1 }] }, { count: 1, pieces: [{ thickness: 4, qty: 12 }, { thickness: 2, qty: 1 }] }]));
check("validate: exact fit accepted", validatePlanGroups([{ count: 1, pieces: [{ thickness: exactT, qty: exactQty }] }], [exactT]).ok);
check("validate: thickness tolerance 1e-9", validatePlanGroups([{ count: 1, pieces: [{ thickness: 4 + 1e-12, qty: 1 }] }], allowed).ok);
const merged = validatePlanGroups([{ count: 3, pieces: [{ thickness: 2, qty: 2 }, { thickness: 4, qty: 5 }, { thickness: 2, qty: 3 }] }], allowed);
check("validate: duplicate thicknesses merged, thickest first", merged.ok && JSON.stringify(merged.groups) === JSON.stringify([{ count: 3, pieces: [{ thickness: 4, qty: 5 }, { thickness: 2, qty: 5 }] }]), merged);

// --- planVsNeeded / planMatches / planTotal ---
const needed = [{ thickness: 4, qty: 72 }, { thickness: 2, qty: 10 }];
const exactPlan: HbPlanGroup[] = [{ count: 6, pieces: [{ thickness: 4, qty: 12 }] }, { count: 1, pieces: [{ thickness: 2, qty: 10 }] }];
check("match: exact plan matches", planMatches(exactPlan, needed) && planTotal(exactPlan) === 7);
const shortPlan: HbPlanGroup[] = [{ count: 5, pieces: [{ thickness: 4, qty: 12 }] }, { count: 1, pieces: [{ thickness: 2, qty: 10 }, { thickness: 1, qty: 2 }] }];
const sv = planVsNeeded(shortPlan, needed);
check("mismatch: short 12 x 4\", over 2 x 1\" (thickness only on the plan side)", !planMatches(shortPlan, needed) && JSON.stringify(sv) === JSON.stringify([{ thickness: 4, needed: 72, planned: 60, diff: -12 }, { thickness: 2, needed: 10, planned: 10, diff: 0 }, { thickness: 1, needed: 0, planned: 2, diff: 2 }]), sv);
const missing = planVsNeeded([{ count: 6, pieces: [{ thickness: 4, qty: 12 }] }], needed);
check("mismatch: a needed thickness absent from the plan is listed short", missing.some((r) => r.thickness === 2 && r.diff === -10), missing);

// --- parsePlan ---
const good = JSON.stringify({ v: 1, groups: exactPlan, total: 7, updated_by: "Steve", updated_at: "2026-11-24 10:00:00" });
const p = parsePlan(good);
check("parse: valid plan round-trips", !!p && p.total === 7 && p.updated_by === "Steve" && p.groups.length === 2, p);
const garbage: unknown[] = [null, undefined, "", "{", "null", "[]", "42", '"x"', "{}", '{"v":2,"groups":[{"count":1,"pieces":[{"thickness":4,"qty":1}]}]}', '{"v":1,"groups":[]}', '{"v":1,"groups":[{"count":0,"pieces":[{"thickness":4,"qty":1}]}]}', '{"v":1,"groups":[{"count":1,"pieces":[]}]}', '{"v":1,"groups":[{"count":1,"pieces":[{"thickness":"x","qty":1}]}]}', '{"v":1,"groups":[null]}'];
let threw = false;
let allNull = true;
for (const g of garbage) {
  try {
    if (parsePlan(g as any) !== null) allNull = false;
  } catch {
    threw = true;
  }
}
check("parse: garbage -> null, never throws", allNull && !threw);

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  (${r.detail})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
