// src/lib/productionStats.selfcheck.ts
// Guarded dev self-check for productionStats.ts. Mirrors productionNumbering.selfcheck.ts's shape:
// a check()/results table, one exported run*SelfCheck() function. Not part of the production
// build path.
import { imrLimits, outOfLimits, pearson } from "./productionStats";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

export function runProductionStatsSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });
  const near = (a: number | null | undefined, b: number, tol: number) => a !== null && a !== undefined && Math.abs(a - b) <= tol;

  const l = imrLimits([10, 12, 11, 13, 12]);
  check("imr mean 11.6", near(l?.mean, 11.6, 1e-6), String(l?.mean));
  check("imr mrBar 1.5", near(l?.mrBar, 1.5, 1e-6), String(l?.mrBar));
  check("imr sigma ≈ 1.329787", near(l?.sigma, 1.329787, 1e-6), String(l?.sigma));
  check("imr ucl ≈ 15.589362", near(l?.ucl, 15.589362, 1e-6), String(l?.ucl));
  check("imr lcl ≈ 7.610638", near(l?.lcl, 7.610638, 1e-6), String(l?.lcl));
  check("imr meaningful false (n < 20)", l?.meaningful === false);

  check("imrLimits([5]) sigma null", imrLimits([5])?.sigma === null);
  check("imrLimits([]) null", imrLimits([]) === null);
  check("imrLimits drops non-finite", imrLimits([10, NaN, 12, Infinity])?.n === 2);

  const out = outOfLimits([10, 100, 12], imrLimits([10, 12, 11, 13, 12]));
  check("outOfLimits flags only the outlier", out.join() === "false,true,false", out.join());

  check("pearson +1", near(pearson([1, 2, 3], [2, 4, 6]), 1, 1e-9));
  check("pearson -1", near(pearson([1, 2, 3], [6, 4, 2]), -1, 1e-9));
  check("pearson zero variance null", pearson([1, 1, 1], [1, 2, 3]) === null);

  return { pass: results.every((r) => r.pass), results };
}
