// src/lib/blockCalc/xlsx.selfcheck.ts — blk-02
// Self-check for the Block Calculator XLSX sheets (xlsx.ts) on top of the real engine. Every cell
// of all three sheets is asserted except the date (passed in as "D"). Goldens are the engine's
// output, spot-checked by hand against legacy buildAndDownloadXlsx: primary-only utilization
// (332,226.5625 / 497,500 = 66.78 → "66.8%"), waste Math.round(165,273.4375), spacing/remnant
// rounded to 3 dp as numbers, "<m> (from <x>)" on rerouted rows, "N/A" with no qty, a 0-yield
// secondary left out of Parts and Yields while the Yields header stays. The parity run against the
// legacy page (Playwright) diffs these same cells file-to-file.
// Run with: npx tsx src/lib/blockCalc/xlsx.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import { runFullCalc, type BlockCalcInput } from "../blockEngine";
import { buildCutListRows, type LibPartRef, type Routing } from "./cutList";
import { buildBlockCalcSheets, buildPartsMeta, buildXlsxMeta, COLS, type BlockCalcSheets, type LibMeta } from "./xlsx";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  results.push({ name, pass: a === e, detail: `got ${a}, expected ${e}` });
}

function sheets(inp: BlockCalcInput, routing: Routing, pl: LibMeta | null, sl: Record<string, LibMeta | null>): BlockCalcSheets {
  const calc = runFullCalc(inp);
  const rows = buildCutListRows(calc, routing, pl as LibPartRef | null, sl);
  return buildBlockCalcSheets(rows, buildPartsMeta(calc, inp, pl, sl), buildXlsxMeta(calc, inp, routing, "D"));
}
function assertSheets(tag: string, got: BlockCalcSheets, exp: BlockCalcSheets) {
  for (const k of ["cutList", "summary", "parts"] as const) {
    eq(`${tag} ${k} row count`, got[k].length, exp[k].length);
    exp[k].forEach((row, i) => eq(`${tag} ${k} row ${i}`, got[k][i], row));
  }
}
const HEAD = ["#", "Machine", "Cut Direction", "Part", "Part Number", "Customer", "Pieces", "Cut Spacing (in)", "Remnant (in)"];
const PHEAD = ["Part Number", "Customer", "Density / Material", "Length (in)", "Width (in)", "Height (in)", "Role"];

// ── A: HT4040-4 + PALLET FOAM, auto, all machines, both from the library ─────
const A: BlockCalcInput = {
  bL: 199, bW: 50, bH: 50, pL: 37.5, pW: 37.5, pH: 2.25, kerf: 0.079, primaryQty: 200, mode: "auto",
  secondaryParts: [{ id: "s1", label: "PALLET FOAM", L: 36, W: 36, H: 1, qty: 100 }],
};
const PF = "PALLET FOAM";
assertSheets(
  "A",
  sheets(A, { crossCutter: true, blueLine: true }, { part_number: "HT4040-4", customer: "Hot Tub Co", density_material: "1.0# RC" }, { s1: { part_number: "PF-36", customer: "", density_material: "" } }),
  {
    cutList: [
      ["xPanda Foam — Block Calculator"], ["Date: D"], ['Block Size: 199" × 50" × 50"'], ["Orientation: Auto (Best Fit)"],
      ["Active Machines: Cross Cutter, Main Line, Blue Line"], [], HEAD,
      [1, "Cross Cutter", "Length", "Primary", "HT4040-4", "Hot Tub Co", 5, 37.579, 11.184],
      [2, "Main Line", "Width", "Primary", "HT4040-4", "Hot Tub Co", 1, 37.579, 12.5],
      [3, "Blue Line", "Height", "Primary", "HT4040-4", "Hot Tub Co", 21, 2.329, 1.17],
      [4, "Cross Cutter", "Length", `${PF} (L remnant)`, "PF-36", "", 10, 1.079, 0.473],
      [5, "Main Line", "Width", `${PF} (L remnant)`, "PF-36", "", 1, 36.079, 1.579],
      [6, "Blue Line", "Height", `${PF} (L remnant)`, "PF-36", "", 1, 36.079, 12.909],
      [7, "Cross Cutter", "Length", `${PF} (W remnant)`, "PF-36", "", 5, 36.079, 18.684],
      [8, "Main Line", "Width", `${PF} (W remnant)`, "PF-36", "", 11, 1.079, 0.71],
      [9, "Blue Line", "Height", `${PF} (W remnant)`, "PF-36", "", 1, 36.079, 14],
      [10, "Cross Cutter", "Length", `${PF} (H remnant)`, "PF-36", "", 5, 36.079, 18.684],
      [11, "Main Line", "Width", `${PF} (H remnant)`, "PF-36", "", 1, 36.079, 1.579],
      [12, "Blue Line", "Height", `${PF} (H remnant)`, "PF-36", "", 1, 1.079, 0.17],
    ],
    summary: [
      ["Summary"], [], ["Parts per Block", 105], ["Utilization", "66.8%"], ["Waste per Block (in³)", 165273],
      ["Blocks Needed", 2], ["Total Produced", 210], ["Surplus", 10], [], ["Secondary Part Yields"], [PF, 70],
    ],
    parts: [PHEAD, ["HT4040-4", "Hot Tub Co", "1.0# RC", 37.5, 37.5, 2.25, "Primary"], ["PF-36", "", "", 36, 36, 1, `Secondary (${PF})`]],
  }
);

// ── E: auto, entered rotated — legacy writes the part-axis hint into Cut Direction ──
const E = sheets({ ...A, pL: 2.25, pW: 37.5, pH: 37.5 }, { crossCutter: true, blueLine: true }, null, {});
eq("E cut directions", E.cutList.slice(7, 10).map((r) => r[2]), ["Length (← Part Width)", "Width (← Part Length)", "Height"]);
eq("E primary manual entry", E.parts[1].slice(0, 3), ["Manual Entry", "", ""]);

// ── S: fixed, Blue Line off, no qty; two secondaries, one yields nothing ─────
assertSheets(
  "S",
  sheets(
    {
      bL: 199, bW: 50, bH: 58, pL: 40, pW: 24, pH: 3, kerf: 0.079, primaryQty: null, mode: "fixed",
      secondaryParts: [{ id: "a", label: "STRIP", L: 6, W: 6, H: 2, qty: null }, { id: "b", label: "HUGE", L: 60, W: 60, H: 60, qty: 5 }],
    },
    { crossCutter: true, blueLine: false },
    null,
    { a: { part_number: "ST-6", customer: "Acme", density_material: "2.0#" } }
  ),
  {
    cutList: [
      ["xPanda Foam — Block Calculator"], ["Date: D"], ['Block Size: 199" × 50" × 58"'], ["Orientation: Fixed (As Entered)"],
      ["Active Machines: Cross Cutter, Main Line"], [], HEAD,
      [1, "Cross Cutter", "Length", "Primary", "", "", 4, 40.079, 38.763],
      [2, "Main Line", "Width", "Primary", "", "", 2, 24.079, 1.921],
      [3, "Main Line (from Blue Line)", "Height", "Primary", "", "", 18, 3.079, 2.657],
      [4, "Cross Cutter", "Length", "STRIP (L remnant)", "ST-6", "Acme", 6, 6.079, 2.368],
      [5, "Main Line", "Width", "STRIP (L remnant)", "ST-6", "Acme", 7, 6.079, 5.684],
      [6, "Main Line (from Blue Line)", "Height", "STRIP (L remnant)", "ST-6", "Acme", 26, 2.079, 1.447],
      [7, "Cross Cutter", "Length", "STRIP (H remnant)", "ST-6", "Acme", 32, 6.079, 4.551],
      [8, "Main Line", "Width", "STRIP (H remnant)", "ST-6", "Acme", 7, 6.079, 5.684],
      [9, "Main Line (from Blue Line)", "Height", "STRIP (H remnant)", "ST-6", "Acme", 1, 2.079, 0.657],
    ],
    summary: [
      ["Summary"], [], ["Parts per Block", 144], ["Utilization", "71.9%"], ["Waste per Block (in³)", 162380],
      ["Blocks Needed", "N/A"], ["Total Produced", "N/A"], ["Surplus", "N/A"], [], ["Secondary Part Yields"], ["STRIP", 1316],
    ],
    parts: [PHEAD, ["Manual Entry", "", "", 40, 24, 3, "Primary"], ["ST-6", "Acme", "2.0#", 6, 6, 2, "Secondary (STRIP)"]],
  }
);

// ── no secondaries: no Yields block at all ───────────────────────────────────
const N = sheets({ ...A, secondaryParts: [] }, { crossCutter: true, blueLine: true }, null, {});
eq("N summary ends at Surplus", N.summary.length, 8);
eq("N parts = primary only", N.parts.length, 2);

eq("column widths", COLS, { cutList: [4, 20, 22, 28, 14, 18, 8, 16, 12], summary: [26, 16], parts: [14, 18, 20, 12, 12, 12, 22] });

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  — ${r.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
