// src/lib/blockCalc/diagram.selfcheck.ts — blk-02
// Self-check for the cut-diagram geometry (diagram.ts) on top of the real engine. Expected values
// are worked by hand from legacy drawBlockView's formulas (PL/PT/PR/PB = 52/28/52/38,
// scale = min(availW/D1, availH/D2), rW/rH rounded) at maxW 400 × maxH 180 (availW 296, availH 114).
// Run with: npx tsx src/lib/blockCalc/diagram.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import { runFullCalc, type BlockCalcInput } from "../blockEngine";
import { buildDiagParams, layoutView, type ViewLayout } from "./diagram";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}
function near(name: string, actual: number, expected: number, tol = 1e-6) {
  check(name, Math.abs(actual - expected) <= tol, `got ${actual}, expected ${expected}`);
}

const AX = { Length: "Length", Width: "Width", Height: "Height" } as const;
function views(inp: BlockCalcInput): ViewLayout[] {
  const calc = runFullCalc(inp);
  return buildDiagParams(calc).map((p) => layoutView(p, 400, 180, AX[p.axis1], AX[p.axis2]));
}
function caseA(over: Partial<BlockCalcInput> = {}): BlockCalcInput {
  return {
    bL: 199, bW: 50, bH: 50, pL: 37.5, pW: 37.5, pH: 2.25, kerf: 0.079, primaryQty: 200, mode: "auto",
    secondaryParts: [{ id: "s1", label: "PALLET FOAM", L: 36, W: 36, H: 1, qty: 100 }],
    ...over,
  };
}
const flags = (v: ViewLayout) => [v.rem1Strip.secondary, v.rem2Strip.secondary];
const labelText = (v: ViewLayout) => [v.labels.rem1?.text ?? null, v.labels.rem2?.text ?? null];
const grid = (v: ViewLayout) => [v.gridLines1, v.gridLines2, v.gridLines.length];
const seps = (v: ViewLayout) => [v.separator1 !== null, v.separator2 !== null];

// ── A: 199×50×50, 37.5×37.5×2.25, kerf 0.079 → nL 5, nW 1, nH 21; remL 11.184, remW 12.5, remH 1.17 ──
const [aF, aT, aS] = views(caseA());
// Front (W × H): scale = min(296/50, 114/50) = 2.28; rW = rH = round(114) = 114.
near("A front scale", aF.scale, 2.28);
eq("A front size", [aF.width, aF.height, aF.block.w, aF.block.h], [218, 180, 114, 114]);
near("A front gW = 1 × 37.579 × 2.28", aF.gW, 37.579 * 2.28);
near("A front gH = 21 × 2.329 × 2.28", aF.gH, 21 * 2.329 * 2.28);
eq("A front grid lines (0 across W, 20 across H)", grid(aF), [0, 20, 20]);
eq("A front separators", seps(aF), [true, true]);
eq("A front remnant labels", labelText(aF), ['12.50"', '1.17"']);
eq("A front dim labels", [aF.labels.dim1.text, aF.labels.dim2.text, aF.labels.part?.text], ['50" Width', '50" Height', '37.5"']);
eq("A front rem2 label left-anchored at ox + rW + 4", [aF.labels.rem2?.anchor, aF.labels.rem2?.x], ["start", 52 + 114 + 4]);
eq("A front font sizes (fs 9..11 = 114×0.028 → 9; small 8..10 → 8)", [aF.labels.dim1.size, aF.labels.rem1?.size], [9, 8]);
// Top (L × W): scale = min(296/199, 2.28) = 296/199; rW = 296, rH = round(50 × 296/199) = 74.
near("A top scale", aT.scale, 296 / 199);
eq("A top size", [aT.width, aT.height, aT.block.w, aT.block.h], [400, 140, 296, 74]);
eq("A top grid lines (4 across L, 0 across W)", grid(aT), [4, 0, 4]);
eq("A top separators", seps(aT), [true, true]);
eq("A top remnant labels", labelText(aT), ['11.18"', '12.50"']);
eq("A top dim/part labels", [aT.labels.dim1.text, aT.labels.dim2.text, aT.labels.part?.text], ['199" Length', '50" Width', '37.5"']);
eq("A top fs (296×0.028 = 8.288 → 9; 296×0.022 = 6.5 → 8)", [aT.labels.dim1.size, aT.labels.part?.size], [9, 8]);
// Side (L × H): rH − gH = 74 − 21 × 2.329 × 296/199 = 1.25 → under 2 px, no rem2 label; separator still drawn.
eq("A side grid lines (4 across L, 20 across H)", grid(aS), [4, 20, 24]);
eq("A side separators", seps(aS), [true, true]);
eq("A side remnant labels (rem2 too thin to label)", labelText(aS), ['11.18"', null]);
near("A side rem2 strip h = 74 − gH", aS.rem2Strip.h, 74 - 21 * 2.329 * (296 / 199));
// Secondary flags: Pallet Foam fills all three zones (L-end 10, W-end 55, H-end 5).
eq("A secondary flags Front(z2,z3) Top(z1,z2) Side(z1,z3)", [flags(aF), flags(aT), flags(aS)], [[true, true], [true, true], [true, true]]);
eq("A grid line y positions (front, first/last)", [aF.gridLines[0].y1, aF.gridLines[19].y1].map((y) => +y.toFixed(4)), [28 + 2.329 * 2.28, 28 + 20 * 2.329 * 2.28].map((y) => +y.toFixed(4)));

// ── B: Cross Cutter off — routing never reaches the diagrams ───────────────────
eq("B diagrams identical to A (routing is cut-list only)", views(caseA()), [aF, aT, aS]);

// ── E: part entered rotated 2.25 × 37.5 × 37.5 → nL 5, nW 21, nH 1 ────────────
const [eF, eT, eS] = views(caseA({ pL: 2.25, pW: 37.5, pH: 37.5 }));
eq("E front grid (20 across W, 0 across H)", grid(eF), [20, 0, 20]);
eq("E front part dim = W-axis part dim", eF.labels.part?.text, '2.25"');
eq("E front remnant labels", labelText(eF), ['1.17"', '12.50"']);
eq("E top grid (4 across L, 20 across W)", grid(eT), [4, 20, 24]);
eq("E top remnant labels (W remnant 74 − 72.75 < 2 px)", labelText(eT), ['11.18"', null]);
eq("E side grid (4 across L, 0 across H)", grid(eS), [4, 0, 4]);
eq("E side remnant labels", labelText(eS), ['11.18"', '12.50"']);

// ── S: secondary 12 × 12 × 12 fits only the W-end zone (zone2) ────────────────
const [sF, sT, sS] = views(caseA({ secondaryParts: [{ id: "s1", label: "CUBE", L: 12, W: 12, H: 12, qty: null }] }));
eq("S zone2 only: Front (z2,z3)", flags(sF), [true, false]);
eq("S zone2 only: Top (z1,z2)", flags(sT), [false, true]);
eq("S zone2 only: Side (z1,z3)", flags(sS), [false, false]);
eq("S no-secondary: all flags false", views(caseA({ secondaryParts: [] })).map(flags), [[false, false], [false, false], [false, false]]);

// ── N: no remnant — 100×50×50 block, 25×25×10 part, kerf 0, fixed → nL 4, nW 2, nH 5 ──
const [nF, nT] = views({ bL: 100, bW: 50, bH: 50, pL: 25, pW: 25, pH: 10, kerf: 0, primaryQty: null, mode: "fixed", secondaryParts: [] });
eq("N front grid (1 across W, 4 across H)", grid(nF), [1, 4, 5]);
eq("N front separators hidden", seps(nF), [false, false]);
eq("N front remnant labels hidden", labelText(nF), [null, null]);
check("N front strips empty (≤ float noise)", nF.rem1Strip.w < 1e-9 && nF.rem2Strip.h < 1e-9, `${nF.rem1Strip.w}, ${nF.rem2Strip.h}`);
near("N front primary fills the block (w)", nF.primary?.w ?? 0, 114, 1e-9);
near("N front primary fills the block (h)", nF.primary?.h ?? 0, 114, 1e-9);
near("N top scale = 2.28 (height-limited)", nT.scale, 2.28);
eq("N top grid (3 across L, 1 across W)", grid(nT), [3, 1, 4]);
eq("N top separators hidden", seps(nT), [false, false]);

// ── O: remnant under one kerf — legacy gW overshoots the block; strips clamp to 0 ──
// W: 2 × 24.9605 + 0.079 = 50 → remW ≈ 0, gW = 2 × 25.0395 × 2.28 = 114.18 > rW 114.
const [oF] = views({ bL: 100, bW: 50, bH: 50, pL: 25, pW: 24.9605, pH: 10, kerf: 0.079, primaryQty: null, mode: "fixed", secondaryParts: [] });
check("O legacy gW overshoots rW", oF.gW > oF.block.w, `gW ${oF.gW}, rW ${oF.block.w}`);
eq("O rem1 strip clamped to 0, primary clipped to rW", [oF.rem1Strip.w, oF.primary?.w], [0, 114]);
check("O every strip dimension ≥ 0", [oF.rem1Strip.w, oF.rem1Strip.h, oF.rem2Strip.w, oF.rem2Strip.h].every((n) => n >= 0));
eq("O no rem1 separator/label", [oF.separator1, oF.labels.rem1], [null, null]);

// ── report ───────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  — ${r.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
