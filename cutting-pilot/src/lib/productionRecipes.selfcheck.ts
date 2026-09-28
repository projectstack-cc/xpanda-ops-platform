// src/lib/productionRecipes.selfcheck.ts
// Guarded dev self-check for productionRecipes.ts pure helpers. Mirrors
// productionNumbering.selfcheck.ts's shape: a check()/results table, one exported
// run*SelfCheck() function. Not part of the production build path.
import { normDensity, pcfFromBucket, targetGramsFromPcf } from "./productionRecipes";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export function runProductionRecipesSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });

  check("pcfFromBucket(16.0185, 1) === 1", pcfFromBucket(16.0185, 1) === 1, String(pcfFromBucket(16.0185, 1)));
  check("targetGramsFromPcf(1.25, 1) === 20.0", targetGramsFromPcf(1.25, 1) === 20.0, String(targetGramsFromPcf(1.25, 1)));

  check('normDensity("1.255") === 1.26', normDensity("1.255") === 1.26, String(normDensity("1.255")));
  check("normDensity(0) === null", normDensity(0) === null);
  check("normDensity(-1) === null", normDensity(-1) === null);
  check('normDensity("") === null', normDensity("") === null);
  check("normDensity(NaN) === null", normDensity(NaN) === null);
  check("normDensity(1e-7) === null (no NaN leak)", normDensity(1e-7) === null);
  check("normDensity(0.001) === null (rounds to 0)", normDensity(0.001) === null);

  // Null propagation: either input null / non-positive -> null.
  check("pcfFromBucket(null, 1) === null", pcfFromBucket(null, 1) === null);
  check("pcfFromBucket(16, null) === null", pcfFromBucket(16, null) === null);
  check("pcfFromBucket(0, 1) === null", pcfFromBucket(0, 1) === null);
  check("pcfFromBucket(16, 0) === null", pcfFromBucket(16, 0) === null);
  check("targetGramsFromPcf(null, 1) === null", targetGramsFromPcf(null, 1) === null);
  check("targetGramsFromPcf(1, null) === null", targetGramsFromPcf(1, null) === null);
  check("targetGramsFromPcf(-1, 1) === null", targetGramsFromPcf(-1, 1) === null);

  return { pass: results.every((r) => r.pass), results };
}
