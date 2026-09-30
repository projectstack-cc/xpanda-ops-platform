// src/lib/logistics/fuelSurcharge.selfcheck.ts
// lgx-fuel-02 self-check for the pure fuel surcharge formula + wording (fuelSurcharge.ts).
// Run with: node src/lib/logistics/fuelSurcharge.selfcheck.ts   (from cutting-pilot/; Node 22.6+/23.6+
// strips the TypeScript syntax natively — same note as scripts/bol-parity.mjs). Exits 1 on any failure.
// @ts-expect-error TS5097 -- Node's native type stripping needs the explicit .ts extension (see run note above).
import { buildFuelLine, dollarsToMills, formatRate, roundTripMiles, surchargeCents } from "./fuelSurcharge.ts";

const results: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
}
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `got ${a}, expected ${e}`);
}

// Worked example from Steve: $0.10/mi, 20 mi one-way -> 40 mi round trip -> $4.00.
eq("100 mills + 20 mi: round trip", roundTripMiles(20), 40);
eq("100 mills + 20 mi: cents", surchargeCents(100, 40), 400);
eq("100 mills + 20 mi: line", buildFuelLine(100, 20), { main: "Fuel Surcharge - $4.00", detail: null });

// 125 mills + 57.59 mi -> rt 115 -> 1437.5 -> 1438¢ -> $14.38.
eq("125 mills + 57.59 mi: round trip", roundTripMiles(57.59), 115);
eq("125 mills + 57.59 mi: cents", surchargeCents(125, 115), 1438);
eq("125 mills + 57.59 mi: line", buildFuelLine(125, 57.59), { main: "Fuel Surcharge - $14.38", detail: null });

eq('dollarsToMills("0.1")', dollarsToMills("0.1"), 100);
eq('dollarsToMills("$0.125")', dollarsToMills("$0.125"), 125);
eq('dollarsToMills(".10")', dollarsToMills(".10"), 100);
eq('dollarsToMills("0.1234")', dollarsToMills("0.1234"), null);
eq('dollarsToMills("")', dollarsToMills(""), null);
eq('dollarsToMills("abc")', dollarsToMills("abc"), null);

eq("formatRate(100)", formatRate(100), "$0.10");
eq("formatRate(125)", formatRate(125), "$0.125");
eq("formatRate(1500)", formatRate(1500), "$1.50");

eq("null mills -> no line", buildFuelLine(null, 20), null);
eq("null miles -> rate wording", buildFuelLine(100, null), { main: "Fuel Surcharge - $0.10/mi", detail: null });
eq("null miles, 3-decimal rate", buildFuelLine(125, null), { main: "Fuel Surcharge - $0.125/mi", detail: null });
eq("zero rate still prints", buildFuelLine(0, 20), { main: "Fuel Surcharge - $0.00", detail: null });

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  (${r.detail})`}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
