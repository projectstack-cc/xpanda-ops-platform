// src/lib/blockCalc/cutList.selfcheck.ts — blk-01
// Self-check for the block-calculator cut list / stats / validation (cutList.ts) on top of the real
// engine (blockEngine.runFullCalc). Golden cases A–G from the blk-01 prompt, worked with the engine
// at 4cdbaaa. No DB, no network.
// Run with: npx tsx src/lib/blockCalc/cutList.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import { runFullCalc, type BlockCalcInput } from "../blockEngine";
import { buildCutListRows, machineFor, orientNote, stats, validate, type RawInput } from "./cutList";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}

const ALL_ON = { crossCutter: true, blueLine: true };
const remFmt = (r: number) => (r < 0.005 ? "0" : r.toFixed(2));

function caseA(over: Partial<BlockCalcInput> = {}): BlockCalcInput {
  return {
    bL: 199, bW: 50, bH: 50, pL: 37.5, pW: 37.5, pH: 2.25, kerf: 0.079, primaryQty: 200, mode: "auto",
    secondaryParts: [{ id: "s1", label: "PALLET FOAM", L: 36, W: 36, H: 1, qty: 100 }],
    ...over,
  };
}

// ── machineFor ───────────────────────────────────────────────────────────────
eq("machineFor Length on", machineFor("Length", ALL_ON), { name: "Cross Cutter", rerouted: false });
eq("machineFor Width", machineFor("Width", { crossCutter: false, blueLine: false }), { name: "Main Line", rerouted: false });
eq("machineFor Height off", machineFor("Height", { crossCutter: true, blueLine: false }), { name: "Main Line", rerouted: true, from: "Blue Line" });

// ── A: HT4040-4 + PALLET FOAM, auto, all machines ────────────────────────────
const A = runFullCalc(caseA());
eq("A primary total/nL/nW/nH", [A.primary.total, A.primary.nL, A.primary.nW, A.primary.nH], [105, 5, 1, 21]);
eq("A blocksNeeded/produced/surplus", [A.blocksNeeded, A.totalProduced, A.surplus], [2, 210, 10]);
const secA = A.secondaries[0];
eq("A secondary totalPieces", secA.totalPieces, 70);
eq("A zone totals L/W/H-end", [secA.zone1.total, secA.zone2.total, secA.zone3.total], [10, 55, 5]);
eq("A L-end nA/nB/nC", [secA.zone1.nA, secA.zone1.nB, secA.zone1.nC], [10, 1, 1]);
eq("A W-end nA/nB/nC", [secA.zone2.nA, secA.zone2.nB, secA.zone2.nC], [5, 11, 1]);
eq("A H-end nA/nB/nC", [secA.zone3.nA, secA.zone3.nB, secA.zone3.nC], [5, 1, 1]);

const sA = stats(A);
eq("A combined util 1dp", sA.utilPct.toFixed(1), "85.0");
eq("A util tone", sA.utilTone, "good");
eq("A waste in³", sA.waste, 74553);
eq("A waste toLocaleString", sA.waste.toLocaleString("en-US"), "74,553");
eq("A parts per block", sA.partsPerBlock, 105);
eq("A primary produced", sA.primaryProduced, { produced: 210, surplus: 10, needed: 200 });
eq("A secondary ordered", sA.secondaryOrdered, [{ label: "PALLET FOAM", qty: 100, produced: 140, surplus: 40 }]);
eq("A secondary total", sA.secondaryTotal, { total: 70, breakdown: [{ pieces: 70, label: "PALLET FOAM" }] });
eq("A orientNote identity", orientNote(A), "identity");

const rowsA = buildCutListRows(A, ALL_ON, { part_number: "HT4040-4", customer: "Hot Tub Co" }, { s1: { part_number: "PF-36", customer: "" } });
eq("A row count (3 primary + 9 secondary)", rowsA.length, 12);
eq("A steps 1..12", rowsA.map((r) => r.step), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
eq("A primary machines", rowsA.slice(0, 3).map((r) => r.machine), ["Cross Cutter", "Main Line", "Blue Line"]);
eq("A primary spacing", rowsA.slice(0, 3).map((r) => r.spacing.toFixed(3)), ["37.579", "37.579", "2.329"]);
eq("A primary remnant", rowsA.slice(0, 3).map((r) => remFmt(r.remnant)), ["11.18", "12.50", "1.17"]);
eq("A primary pieces", rowsA.slice(0, 3).map((r) => r.pieces), [5, 1, 21]);
eq("A primary part_label / lib", [rowsA[0].part_label, rowsA[0].part_number, rowsA[0].customer], ["Primary", "HT4040-4", "Hot Tub Co"]);
check("A no primary remapFrom (identity)", rowsA.every((r) => r.remapFrom === null));
eq(
  "A secondary part labels",
  rowsA.slice(3).map((r) => r.part_label),
  [
    ...Array(3).fill("PALLET FOAM (L remnant)"),
    ...Array(3).fill("PALLET FOAM (W remnant)"),
    ...Array(3).fill("PALLET FOAM (H remnant)"),
  ]
);
eq("A secondary pieces (n = 1 axes still get a row)", rowsA.slice(3).map((r) => r.pieces), [10, 1, 1, 5, 11, 1, 5, 1, 1]);
eq("A secondary directions", rowsA.slice(3, 6).map((r) => r.direction), ["Length", "Width", "Height"]);
eq("A secondary lib part #", rowsA[3].part_number, "PF-36");
check("A nothing rerouted", rowsA.every((r) => !r.machine_rerouted && r.machine_rerouted_from === ""));

// ── B: Cross Cutter off ──────────────────────────────────────────────────────
const rowsB = buildCutListRows(A, { crossCutter: false, blueLine: true }, null, {});
const lenB = rowsB.filter((r) => r.direction === "Length");
check(
  "B every Length row → Main Line, rerouted from Cross Cutter",
  lenB.length === 4 && lenB.every((r) => r.machine === "Main Line" && r.machine_rerouted && r.machine_rerouted_from === "Cross Cutter")
);
check("B Width rows unchanged", rowsB.filter((r) => r.direction === "Width").every((r) => r.machine === "Main Line" && !r.machine_rerouted));
check("B Height rows still Blue Line", rowsB.filter((r) => r.direction === "Height").every((r) => r.machine === "Blue Line" && !r.machine_rerouted));

// ── C: Blue Line off ─────────────────────────────────────────────────────────
const rowsC = buildCutListRows(A, { crossCutter: true, blueLine: false }, null, {});
const hC = rowsC.filter((r) => r.direction === "Height");
check(
  "C every Height row → Main Line, rerouted from Blue Line",
  hC.length === 4 && hC.every((r) => r.machine === "Main Line" && r.machine_rerouted && r.machine_rerouted_from === "Blue Line")
);
check("C Length rows still Cross Cutter", rowsC.filter((r) => r.direction === "Length").every((r) => r.machine === "Cross Cutter"));

// ── D: fixed mode ────────────────────────────────────────────────────────────
const D = runFullCalc(caseA({ mode: "fixed" }));
eq("D orientNote null", orientNote(D), null);
check("D no remapFrom", buildCutListRows(D, ALL_ON, null, {}).every((r) => r.remapFrom === null));

// ── E: auto, part entered rotated ────────────────────────────────────────────
const E = runFullCalc(caseA({ pL: 2.25, pW: 37.5, pH: 37.5 }));
eq("E total", E.primary.total, 105);
eq("E partNameL/W/H", [E.primary.partNameL, E.primary.partNameW, E.primary.partNameH], ["Width", "Length", "Height"]);
const rowsE = buildCutListRows(E, ALL_ON, null, {});
eq("E primary remapFrom", rowsE.slice(0, 3).map((r) => r.remapFrom), ["Width", "Length", null]);
check("E secondary rows never remapped", rowsE.slice(3).every((r) => r.remapFrom === null));
eq("E orientNote mapping", orientNote(E), {
  L: { name: "Width", dim: 37.5 },
  W: { name: "Length", dim: 2.25 },
  H: { name: "Height", dim: 37.5 },
});

// ── F: validate ──────────────────────────────────────────────────────────────
function raw(over: Partial<RawInput> = {}): RawInput {
  return {
    bL: "199", bW: "50", bH: "50", pL: "37.5", pW: "37.5", pH: "2 1/4", kerf: "0.079", primaryQty: "200", mode: "auto",
    secondaries: [{ id: "s1", label: "PALLET FOAM", L: "36", W: "36", H: "1", qty: "100" }],
    ...over,
  };
}
const keyOf = (r: ReturnType<typeof validate>) => (r.ok ? "ok" : r.key);

const okF = validate(raw());
check("F valid input ok", okF.ok);
if (okF.ok) {
  eq("F '2 1/4' → 2.25", okF.input.pH, 2.25);
  eq("F primaryQty 200", okF.input.primaryQty, 200);
  eq("F secondary parsed", okF.input.secondaryParts, [{ id: "s1", label: "PALLET FOAM", L: 36, W: 36, H: 1, qty: 100 }]);
  eq("F validated input → same calc as A", runFullCalc(okF.input).primary.total, 105);
}

// Every legacy error, in legacy order (each case breaks only one field; earlier fields valid).
const legacyOrder: [Partial<RawInput>, string][] = [
  [{ bL: "" }, "blockCalc.blockLengthPositive"],
  [{ bW: "0" }, "blockCalc.blockWidthPositive"],
  [{ bH: "abc" }, "blockCalc.blockHeightPositive"],
  [{ pL: "" }, "blockCalc.primaryLengthPositive"],
  [{ pW: "-2" }, "blockCalc.primaryWidthPositive"],
  [{ pH: "0" }, "blockCalc.primaryHeightPositive"],
  [{ kerf: "x" }, "blockCalc.kerfNonNegative"],
  [{ primaryQty: "0" }, "blockCalc.primaryQtyPositive"],
];
for (const [over, key] of legacyOrder) eq(`F ${key}`, keyOf(validate(raw(over))), key);
// Order: with everything broken, the block length error wins; then each fix exposes the next.
eq("F order: all broken → block length first", keyOf(validate(raw({ bL: "", bW: "", pL: "", kerf: "x" }))), "blockCalc.blockLengthPositive");
eq("F order: block fine → primary before kerf", keyOf(validate(raw({ pL: "", kerf: "x", primaryQty: "1.5" }))), "blockCalc.primaryLengthPositive");
eq("F order: kerf before qty", keyOf(validate(raw({ kerf: "x", primaryQty: "1.5" }))), "blockCalc.kerfNonNegative");

eq("F qty '1.5' rejected", keyOf(validate(raw({ primaryQty: "1.5" }))), "blockCalc.primaryQtyPositive");
eq("F qty garbage rejected", keyOf(validate(raw({ primaryQty: "abc" }))), "blockCalc.primaryQtyPositive");
const blankQty = validate(raw({ primaryQty: "  " }));
check("F blank qty → null", blankQty.ok && blankQty.input.primaryQty === null);
const blankKerf = validate(raw({ kerf: "" }));
check("F blank kerf → 0 (legacy Number(''))", blankKerf.ok && blankKerf.input.kerf === 0);
eq("F kerf 0 ok", keyOf(validate(raw({ kerf: "0" }))), "ok");
const fracBlock = validate(raw({ bH: "49 1/2" }));
check("F fraction on block dims", fracBlock.ok && fracBlock.input.bH === 49.5);

const sec = (o: Partial<RawInput["secondaries"][number]>) => ({ id: "s1", label: "PALLET FOAM", L: "36", W: "36", H: "1", qty: "", ...o });
const allBlank = validate(raw({ secondaries: [sec({ L: "", W: " ", H: "", qty: "5" })] }));
check("F secondary with all dims blank is ignored", allBlank.ok && allBlank.input.secondaryParts.length === 0);
const secErrs: [Partial<RawInput["secondaries"][number]>, string][] = [
  [{ L: "" }, "blockCalc.secLengthPositive"],
  [{ W: "" }, "blockCalc.secWidthPositive"],
  [{ H: "0" }, "blockCalc.secHeightPositive"],
  [{ qty: "2.5" }, "blockCalc.secQtyPositive"],
  [{ qty: "0" }, "blockCalc.secQtyPositive"],
];
for (const [over, key] of secErrs) {
  const r = validate(raw({ secondaries: [sec(over)] }));
  eq(`F ${key} ${JSON.stringify(over)}`, [keyOf(r), r.ok ? null : r.vars], [key, { label: "PALLET FOAM" }]);
}
eq("F secondary errors after primary errors", keyOf(validate(raw({ primaryQty: "x", secondaries: [sec({ L: "" })] }))), "blockCalc.primaryQtyPositive");
const blankSecQty = validate(raw({ secondaries: [sec({ qty: "" })] }));
check("F secondary blank qty → null", blankSecQty.ok && blankSecQty.input.secondaryParts[0].qty === null);

// ── G: part bigger than the block ────────────────────────────────────────────
const G = runFullCalc(caseA({ pL: 250, pW: 60, pH: 60, mode: "auto" }));
eq("G primary.total === 0 (UI shows noPartsFitError)", G.primary.total, 0);

// ── report ───────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  — ${r.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
