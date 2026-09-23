// src/lib/productionNumbering.selfcheck.ts
// Guarded dev self-check for productionNumbering.ts. Mirrors dissolve.selfcheck.ts's shape:
// a check()/results table, one exported run*SelfCheck() function. Not part of the production
// build path.
import { blockSuffix, nextBlockNo } from "./productionNumbering";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export function runProductionNumberingSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });

  const day1 = new Date("2026-09-22T15:00:00Z"); // 09/22 11:00 AM ET

  // Empty sheet -> -01
  check(
    "empty sheet -> -01",
    nextBlockNo([], day1) === "09/22-01",
    nextBlockNo([], day1)
  );

  // Gaps/deleted rows use max, not count.
  check(
    "gaps use max not count",
    nextBlockNo(["09/22-01", "09/22-03"], day1) === "09/22-04",
    nextBlockNo(["09/22-01", "09/22-03"], day1)
  );

  // Non-matching manual values are ignored, not crash-causing.
  check(
    "non-matching manual values ignored",
    nextBlockNo(["scratch", "09/22-02", "weird-99x"], day1) === "09/22-03",
    nextBlockNo(["scratch", "09/22-02", "weird-99x"], day1)
  );

  // blockSuffix returns null for anything that doesn't match MM/DD-NN.
  check("blockSuffix null on garbage", blockSuffix("not-a-block") === null);
  check("blockSuffix null on empty", blockSuffix("") === null);
  check("blockSuffix parses trailing int", blockSuffix("09/22-14") === 14);

  // Midnight rollover: sheet keeps counting across ET dates — MM/DD comes from the block's own
  // ET date (d), the counter (max) comes from ALL existing suffixes regardless of date prefix.
  const rolled = nextBlockNo(["09/22-14"], new Date("2026-09-23T05:00:00Z")); // 09/23 01:00 ET
  check(
    "midnight rollover keeps counting",
    rolled === "09/23-15",
    rolled
  );

  // Pads to 2 digits minimum but not beyond (100 stays 3 digits).
  check("pads under 100", nextBlockNo(["09/22-08"], day1) === "09/22-09");
  const past99 = nextBlockNo(["09/22-99"], day1);
  check("past 99 unpadded to 3 digits", past99 === "09/22-100", past99);

  return { pass: results.every((r) => r.pass), results };
}
