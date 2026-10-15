// src/lib/qc/board.ts — qc-01
// Pure helpers for the v2 QC Final Inspection board (/v2/qc) and its Density Calculator popup.
// No DB, no React — exercised by board.selfcheck.ts (`npx tsx src/lib/qc/board.selfcheck.ts`).

export interface QcLine {
  id: string;
  description: string;
  dimensions: string;
  quantity: number;
  sort_order: number;
  // qc-02: becomes the line's latest inspection record ({ result: "pass" | "fail", ... }). Always null in qc-01.
  inspection: null;
}

export interface QcOrder {
  job_id: string;
  invoice_number: string;
  customer: string;
  ship_date: string;
  status: string;
  lines: QcLine[];
}

export type QcOrderState = "open" | "partial" | "passed" | "failed";

// Written against qc-02's future `inspection.result`; null (no inspection yet) counts as open.
function lineResult(line: QcLine): "pass" | "fail" | null {
  const insp = line.inspection as { result?: "pass" | "fail" } | null;
  return insp?.result ?? null;
}

export function isLineInspected(line: QcLine): boolean {
  return lineResult(line) !== null;
}

export function isLineFailed(line: QcLine): boolean {
  return lineResult(line) === "fail";
}

export function orderState(order: QcOrder): QcOrderState {
  const results = order.lines.map(lineResult);
  if (results.some((r) => r === "fail")) return "failed";
  if (results.every((r) => r === null)) return "open";
  if (results.some((r) => r === null)) return "partial";
  return "passed";
}

// Ascending by ship date; blank/null ship_date groups under "No Date" (formatDayHeader's key), last.
export function groupByShipDay(orders: QcOrder[]): { dateKey: string; orders: QcOrder[] }[] {
  const map = new Map<string, QcOrder[]>();
  for (const o of orders) {
    const key = (o.ship_date ?? "").trim() || "No Date";
    const list = map.get(key) ?? [];
    list.push(o);
    map.set(key, list);
  }
  const keys = Array.from(map.keys()).sort((a, b) => {
    if (a === "No Date") return 1;
    if (b === "No Date") return -1;
    return a.localeCompare(b);
  });
  return keys.map((dateKey) => ({ dateKey, orders: map.get(dateKey) ?? [] }));
}

// Port of legacy calcSampleSizeRequired (qc/final-inspection.html). Used by qc-02's Inspect modal.
export function sampleSizeFor(lot: number): number | null {
  if (!Number.isFinite(lot) || lot <= 0) return null;
  if (lot <= 2) return lot;
  if (lot <= 50) return 3;
  if (lot <= 150) return 5;
  if (lot <= 500) return 8;
  return 10;
}

// Legacy shared-utils round(n, 3): Math.round-based, so 1.0125 → 1.013. Plain toFixed(3) gives
// 1.012 for 8.1/8 (binary float), so display and comparison both go through this.
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function fmt3(n: number): string {
  return round3(n).toFixed(3);
}

export interface DensityResult {
  cubicInches: number;
  cubicFeet: number;
  density: number;
}

// Same formula as legacy utils.calculateDensity: lb / (in³ / 1728). Unrounded — format with fmt3.
export function calcDensity(weightLb: number, lIn: number, wIn: number, hIn: number): DensityResult | null {
  const vals = [weightLb, lIn, wIn, hIn];
  if (vals.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  const cubicInches = lIn * wIn * hIn;
  const cubicFeet = cubicInches / 1728;
  return { cubicInches, cubicFeet, density: weightLb / cubicFeet };
}

export interface DensityVsTarget {
  variance: number;
  variancePct: number;
  verdict: "above" | "below" | "on";
}

// Legacy qc/density-calculator.html: density arrives Math.round'd (utils.round), the target is
// rounded with Number(toFixed(3)); variance = density − target (positive = above target), verdict
// by comparing the rounded values. Legacy shows no percent; variancePct here is
// variance / rounded target × 100 (percent of target).
export function densityVsTarget(density: number, target: number): DensityVsTarget {
  const d = round3(density);
  const t = Number(target.toFixed(3));
  const variance = round3(d - t);
  const verdict = d === t ? "on" : d > t ? "above" : "below";
  return { variance, variancePct: t > 0 ? (variance / t) * 100 : 0, verdict };
}
