// src/lib/productionStats.ts
// Pure statistics for the Production report (prod-c-04). No DOM, no React.
// Control limits are Shewhart individuals (I-MR): σ̂ = MR̄ / 1.128 (d2 for n = 2), where MR̄ is the
// mean moving range of consecutive points in time order; UCL / LCL = mean ± 3σ̂. These are
// STATISTICAL control limits, not spec limits — recipes carry no target weight or tolerance.
// Non-finite values are dropped before any statistic.

const D2 = 1.128;
export const MIN_MEANINGFUL_N = 20;

const finite = (xs: number[]) => xs.filter((x) => typeof x === "number" && Number.isFinite(x));

export function mean(xs: number[]): number | null {
  const f = finite(xs);
  if (!f.length) return null;
  return f.reduce((s, x) => s + x, 0) / f.length;
}

export function minMax(xs: number[]): { min: number; max: number } | null {
  const f = finite(xs);
  if (!f.length) return null;
  return { min: Math.min(...f), max: Math.max(...f) };
}

export interface ImrLimits {
  n: number;
  mean: number;
  mrBar: number | null;
  sigma: number | null;
  ucl: number | null;
  lcl: number | null;
  meaningful: boolean; // n >= 20
}

// null when n === 0; mrBar / sigma / ucl / lcl null when n < 2.
export function imrLimits(xsInTimeOrder: number[]): ImrLimits | null {
  const f = finite(xsInTimeOrder);
  const n = f.length;
  if (n === 0) return null;
  const m = f.reduce((s, x) => s + x, 0) / n;
  if (n < 2) return { n, mean: m, mrBar: null, sigma: null, ucl: null, lcl: null, meaningful: false };
  let mrSum = 0;
  for (let i = 1; i < n; i++) mrSum += Math.abs(f[i] - f[i - 1]);
  const mrBar = mrSum / (n - 1);
  const sigma = mrBar / D2;
  return { n, mean: m, mrBar, sigma, ucl: m + 3 * sigma, lcl: m - 3 * sigma, meaningful: n >= MIN_MEANINGFUL_N };
}

// One flag per input value (same indexes); non-finite values and missing limits → false.
export function outOfLimits(xs: number[], lim: ImrLimits | null): boolean[] {
  return xs.map((x) => {
    if (!lim || lim.ucl === null || lim.lcl === null || !Number.isFinite(x)) return false;
    return x > lim.ucl || x < lim.lcl;
  });
}

// Pearson r over pairs where both values are finite; null if n < 2 or either has zero variance.
export function pearson(xs: number[], ys: number[]): number | null {
  const pairs: [number, number][] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pairs.push([xs[i], ys[i]]);
  }
  const n = pairs.length;
  if (n < 2) return null;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// Insertion-ordered grouping.
export function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}
