// src/lib/inches.selfcheck.ts — marina-02
// Self-check for the pure inch helpers (inches.ts). No DB, no network.
// Run with: npx tsx src/lib/inches.selfcheck.ts   (from cutting-pilot/). Exits 1 on any failure.
import { MARINA_DEFAULT_TOL, formatInches, inTolerance, parseInches, roundToSixteenth } from "./inches";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}

// Accepted forms.
const parses: [string, number][] = [
  ["41 3/8", 41.375], ["41-3/8", 41.375], ["41 - 3/8", 41.375], ["41.375", 41.375], ["3/8", 0.375],
  ["41", 41], [".5", 0.5], ["41.", 41], ["0", 0],
  ['41 3/8"', 41.375], ["41 3/8 in", 41.375], ["41 3/8in", 41.375], ["41 3/8″", 41.375], ["41IN", 41],
  ["  41 3/8  ", 41.375], ["\t56\n", 56],
  ["41⅜", 41.375], ["41 ⅜", 41.375], ["⅜", 0.375], ["⅛", 0.125], ["¼", 0.25], ["½", 0.5],
  ["⅝", 0.625], ["¾", 0.75], ["⅞", 0.875], ['41⅜"', 41.375],
  // Scope samples.
  ["147 1/2", 147.5], ["66 1/8", 66.125], ["22 1/2", 22.5], ["36 1/2", 36.5], ["2000", 2000],
];
for (const [raw, want] of parses) eq(`parseInches(${JSON.stringify(raw)})`, parseInches(raw), want);
check("parseInches ⅓", Math.abs((parseInches("⅓") ?? 0) - 1 / 3) < 1e-12);
check("parseInches 1 ⅔", Math.abs((parseInches("1 ⅔") ?? 0) - 5 / 3) < 1e-12);

// Null cases.
const nulls = ["", "   ", '"', "abc", "41 3/0", "3/0", "-3", "-3/8", "41 -3/8x", "2000.01", "2001", "41..5",
  "1/2/3", "41 3/8 5", "4 1 3/8", "⅜⅜", "3/8 41", "1e3", "NaN", "Infinity"];
for (const raw of nulls) eq(`parseInches(${JSON.stringify(raw)}) → null`, parseInches(raw), null);
eq("parseInches(undefined) → null", parseInches(undefined as unknown as string), null);

// formatInches.
const formats: [number, string][] = [
  [41.375, "41 3/8"], [0.5, "1/2"], [56, "56"], [41.97, "42"], [0.03, "0"], [0, "0"],
  [147.5, "147 1/2"], [66.125, "66 1/8"], [0.0625, "1/16"], [1.9375, "1 15/16"], [12.25, "12 1/4"],
  [41.4, "41 3/8"], [-0.5, "-1/2"],
];
for (const [n, want] of formats) eq(`formatInches(${n})`, formatInches(n), want);

// Round-trip every 1/16 from 0 to 2.
for (let k = 0; k <= 32; k++) {
  const n = k / 16;
  const s = formatInches(n);
  eq(`round-trip ${k}/16 (${s})`, parseInches(s), n);
}
eq("roundToSixteenth(41.37)", roundToSixteenth(41.37), 41.375);
eq("roundToSixteenth(0.03)", roundToSixteenth(0.03), 0);

// Tolerance boundaries (±3/16 inclusive; 3/16 + 1/64 out).
eq("MARINA_DEFAULT_TOL", MARINA_DEFAULT_TOL, 0.1875);
const T = MARINA_DEFAULT_TOL;
eq("in: exact", inTolerance(41.375, 41.375, T), true);
eq("in: +3/16", inTolerance(41.375 + 3 / 16, 41.375, T), true);
eq("in: -3/16", inTolerance(41.375 - 3 / 16, 41.375, T), true);
eq("in: +3/16 via parsed text", inTolerance(parseInches("41 9/16")!, parseInches("41 3/8")!, T), true);
eq("in: 0.1 decimal drift", inTolerance(56.1875, 56, T), true);
eq("out: +3/16 + 1/64", inTolerance(41.375 + 3 / 16 + 1 / 64, 41.375, T), false);
eq("out: -3/16 - 1/64", inTolerance(41.375 - 3 / 16 - 1 / 64, 41.375, T), false);
eq("out: +1/4", inTolerance(147.75, 147.5, T), false);

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  (${r.detail})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
