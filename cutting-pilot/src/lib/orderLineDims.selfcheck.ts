// src/lib/orderLineDims.selfcheck.ts — ord-dims-01
// Self-check for the blank-dimensions order-line rule (orderLineDims.ts). No DB, no network.
// Run with: npx tsx src/lib/orderLineDims.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import { linesMissingDims, missingDimsMessage, type DimCheckLine } from "./orderLineDims";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}

const line = (part_number: unknown, description: unknown, dimensions: unknown): DimCheckLine =>
  ({ part_number, description, dimensions });

// Blank / whitespace-only dims fail.
eq("blank dims fail", linesMissingDims([line("P1", "Block", "")]), [1]);
eq("whitespace dims fail", linesMissingDims([line("P1", "Block", "   \t ")]), [1]);
eq("part-only line, blank dims fail", linesMissingDims([line("P1", "", "")]), [1]);
eq("description-only line, blank dims fail", linesMissingDims([line("", "PACKAGING —", "")]), [1]);

// Any typed text passes (tapers, TBD).
eq('taper 0-2" x 48" x 48" passes', linesMissingDims([line("P1", "Taper", '0-2" x 48" x 48"')]), []);
eq("TBD passes", linesMissingDims([line("P1", "Block", "TBD")]), []);
eq("normal dims pass", linesMissingDims([line("P1", "Block", '2" x 48" x 96"')]), []);

// Fully empty rows are skipped but still counted in numbering.
eq("fully empty row skipped", linesMissingDims([line("", "", "")]), []);
eq("whitespace-only row skipped", linesMissingDims([line("  ", " ", " ")]), []);
eq("empty row counts toward numbering",
  linesMissingDims([line("P1", "A", "1x2x3"), line("", "", ""), line("P3", "C", "")]), [3]);
eq("dims-only row (no part/desc) skipped", linesMissingDims([line("", "", "1x2x3")]), []);

// Messages.
eq("no message when all good", missingDimsMessage([line("P1", "A", "1x2x3"), line("", "", "")]), null);
eq("no message for empty list", missingDimsMessage([]), null);
eq("singular message",
  missingDimsMessage([line("P1", "A", "1x2x3"), line("", "", ""), line("P3", "C", "")]),
  "Line 3 has no dimensions. Add dimensions or remove the line before saving.");
eq("plural message",
  missingDimsMessage([line("P1", "A", "1x2x3"), line("P2", "B", ""), line("", "", ""), line("P4", "D", "1x1x1"), line("", "E", " ")]),
  "Lines 2, 5 have no dimensions. Add dimensions or remove the lines before saving.");

// undefined / null fields (and null rows) don't throw.
let threw = false;
let got: unknown;
try {
  got = linesMissingDims([
    {}, line(undefined, undefined, undefined), line(null, null, null),
    line("P4", null, null), line(null, "Desc", undefined), null as unknown as DimCheckLine,
    { part_number: 12345, dimensions: 0 } as DimCheckLine,
  ]);
} catch { threw = true; }
check("undefined/null fields don't throw", !threw);
eq("undefined/null fields → expected positions", got, [4, 5]);

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  (${r.detail})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
