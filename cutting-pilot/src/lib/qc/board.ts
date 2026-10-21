// src/lib/qc/board.ts — qc-01
// Pure helpers for the v2 QC Final Inspection board (/v2/qc) and its Density Calculator popup.
// No DB, no React — exercised by board.selfcheck.ts (`npx tsx src/lib/qc/board.selfcheck.ts`).

export interface QcLine {
  id: string;
  description: string;
  dimensions: string;
  quantity: number;
  sort_order: number;
  inspection: QcLineInspection | null;
}

// qc-02: the line's latest (non-superseded) inspection, as the board shows it.
export interface QcLineInspection {
  id: string;
  result: "pass" | "fail";
  inspector_name: string;
  inspected_at: string;          // "YYYY-MM-DD HH:MM:SS" UTC, as stored
  drive_status: "pending" | "synced" | "failed";
  drive_file_id: string | null;
  drive_error: string | null;
  drive_attempted_at: string | null;
  stale: boolean;                // line qty/dimensions changed since this inspection
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

// null (no inspection yet) counts as open.
function lineResult(line: QcLine): "pass" | "fail" | null {
  return line.inspection?.result ?? null;
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

// ── qc-02: Inspect modal + POST /v2/api/qc/inspections ──────────────────────────────────────────

export const TOLERANCES: { label: string; value: number }[] = [
  { label: "1/16 (.0625) in", value: 0.0625 },
  { label: "1/8 (.125) in", value: 0.125 },
  { label: "3/16 (.1875) in", value: 0.1875 },
  { label: "1/4 (.25) in", value: 0.25 },
];
export const DEFAULT_TOLERANCE = 0.125;

export interface Nominal {
  length: number | null;
  width: number | null;
  height: number | null;
  taper: string | null;
}

const EMPTY_NOMINAL: Nominal = { length: null, width: null, height: null, taper: null };

// Curly/prime inch marks and doubled single quotes → ", every x/X/× separator → x.
function normalizeDims(raw: string): string {
  return raw
    .replace(/[“”„‟″]/g, '"')
    .replace(/''|[‘’′]{2}/g, '"')
    .replace(/[×X]/g, "x");
}

const NUM = String.raw`\d+(?:\.\d+)?|\.\d+`;

// One segment → its number (taper: the thick end) plus the taper text when it is one.
function parseSegment(seg: string): { value: number; taper: string | null } | null {
  const s = seg.replace(/["'\s]/g, "");
  if (!s) return null;
  const mixed = s.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (mixed) {
    const den = parseInt(mixed[3], 10);
    return den ? { value: parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / den, taper: null } : null;
  }
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const den = parseInt(frac[2], 10);
    return den ? { value: parseInt(frac[1], 10) / den, taper: null } : null;
  }
  // Taper a-b / a>b / a–b — b is never a fraction (that's a mixed number, handled above), b > a.
  const taper = s.match(new RegExp(`^(${NUM})[-–>](${NUM})$`));
  if (taper) {
    const a = parseFloat(taper[1]);
    const b = parseFloat(taper[2]);
    return b > a ? { value: b, taper: `${taper[1]}–${taper[2]}` } : null;
  }
  if (new RegExp(`^(?:${NUM})$`).test(s)) return { value: parseFloat(s), taper: null };
  return null;
}

function parseDims(raw: string): { values: number[]; taper: string | null } {
  const parts = normalizeDims(raw).split(/\s*x\s*/i);
  const values: number[] = [];
  let taper: string | null = null;
  if (parts.length < 2) return { values, taper };
  for (const p of parts) {
    const seg = parseSegment(p);
    if (!seg) return { values: [], taper: null };
    values.push(seg.value);
    if (seg.taper && !taper) taper = seg.taper;
  }
  return { values, taper };
}

// Leading dimension-like token of a description ("FOAM-HT1840-4 ~ 15.5X37.5X3-9/16" → "15.5X37.5X3-9/16").
function dimsTokenFromDescription(description: string): string | null {
  const seg = String.raw`(?:\d+(?:\.\d+)?|\.\d+)(?:[-–>](?:\d+(?:\.\d+)?)(?:\/\d+)?|\/\d+)?["”″']*`;
  // Prefix group, not a lookbehind — lookbehind needs Safari 16.4+, and older floor iPads would throw.
  const m = normalizeDims(description).match(new RegExp(String.raw`(?:^|[^\w.])(${seg}(?:\s*x\s*${seg})+)`, "i"));
  return m ? m[1] : null;
}

// Pre-fill for the Inspect modal's nominal row. Order varies by customer, so the values are sorted:
// height = smallest, length = largest, width = middle. Two numbers → height null. Nothing → all null.
export function nominalFromLine(dimensions: string, description: string): Nominal {
  let parsed = parseDims(dimensions || "");
  if (parsed.values.length < 2) {
    const token = dimsTokenFromDescription(description || "");
    parsed = token ? parseDims(token) : { values: [], taper: null };
  }
  if (parsed.values.length < 2) return { ...EMPTY_NOMINAL };
  const v = [...parsed.values].sort((a, b) => a - b);
  if (v.length === 2) return { length: v[1], width: v[0], height: null, taper: parsed.taper };
  return { length: v[v.length - 1], width: v[v.length - 2], height: v[0], taper: parsed.taper };
}

export function outOfTolerance(measured: number | null | undefined, nominal: number | null | undefined, tol: number): boolean {
  if (typeof measured !== "number" || typeof nominal !== "number") return false;
  if (!Number.isFinite(measured) || !Number.isFinite(nominal)) return false;
  return Math.abs(measured - nominal) > tol + 1e-9;
}

export interface QcSampleInput {
  length: number | null;
  width: number | null;
  height: number | null;
  taper: string;
  visual_pass: boolean;
  result: "pass" | "fail" | null;
  notes: string;
}

function finiteNum(v: unknown): boolean {
  return typeof v === "number" && Number.isFinite(v);
}

// Mirrors legacy isSampleComplete (qc/final-inspection.html): L, W, H and Pass/Fail required.
export function isSampleComplete(s: { length?: unknown; width?: unknown; height?: unknown; result?: unknown }): boolean {
  return finiteNum(s.length) && finiteNum(s.width) && finiteNum(s.height) && (s.result === "pass" || s.result === "fail");
}

export function inspectionResult(samples: { result?: unknown }[]): "pass" | "fail" {
  return samples.some((s) => s.result === "fail") ? "fail" : "pass";
}

function normDimsText(s: string | null | undefined): string {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

// qc-03: one qc_inspections row → the board's QcLineInspection (board route + Retry Drive route).
export interface QcInspectionRow {
  id: string;
  result: "pass" | "fail";
  inspector_name: string | null;
  inspected_at: string;
  drive_status: "pending" | "synced" | "failed";
  drive_file_id: string | null;
  drive_error: string | null;
  drive_attempted_at: string | null;
  line_quantity: number | null;
  dimensions_text: string | null;
}

export function toLineInspection(
  r: QcInspectionRow,
  lineQty: number | null | undefined,
  lineDims: string | null | undefined
): QcLineInspection {
  return {
    id: r.id,
    result: r.result,
    inspector_name: r.inspector_name ?? "",
    inspected_at: r.inspected_at,
    drive_status: r.drive_status,
    drive_file_id: r.drive_file_id ?? null,
    drive_error: r.drive_error ?? null,
    drive_attempted_at: r.drive_attempted_at ?? null,
    stale: isStale(r.line_quantity, r.dimensions_text, lineQty, lineDims),
  };
}

// Line changed since inspection: quantity compared numerically, dimensions whitespace-insensitively.
export function isStale(
  snapshotQty: number | null | undefined,
  snapshotDims: string | null | undefined,
  lineQty: number | null | undefined,
  lineDims: string | null | undefined
): boolean {
  return Number(snapshotQty ?? 0) !== Number(lineQty ?? 0) || normDimsText(snapshotDims) !== normDimsText(lineDims);
}

// ── qc-06: admin bulk inspect (POST /v2/api/qc/inspections/bulk + BulkInspectModal) ─────────────

export type BulkSkipReason = "already_inspected" | "no_quantity" | "no_dimensions";

export interface BulkLinePlan {
  line_item_id: string;
  description: string;
  action: "record" | "skip";
  reason?: BulkSkipReason;
  lot?: number;
  sampleSize?: number;
  nominal?: Nominal;
}

export const BULK_SKIP_LABELS: Record<BulkSkipReason, string> = {
  already_inspected: "Already inspected",
  no_quantity: "No quantity on the line",
  no_dimensions: "Couldn't read dimensions — inspect manually",
};

// A line is auto-filled only when every sample can be written complete: a whole quantity ≥ 1 and
// nominal L, W and H. nominalFromLine gives H for every 3-dimension line (a taper's thick end); a
// 2-dimension taper ("2.5-4 x 39") has no H, so it's left for a manual inspection.
export function planBulkInspection(order: QcOrder): BulkLinePlan[] {
  return order.lines.map((l): BulkLinePlan => {
    const base = { line_item_id: l.id, description: l.description };
    if (l.inspection) return { ...base, action: "skip", reason: "already_inspected" };
    const qty = Number(l.quantity);
    if (!Number.isInteger(qty) || qty < 1) return { ...base, action: "skip", reason: "no_quantity" };
    const nominal = nominalFromLine(l.dimensions, l.description);
    if (nominal.length === null || nominal.width === null || nominal.height === null) {
      return { ...base, action: "skip", reason: "no_dimensions" };
    }
    return { ...base, action: "record", lot: qty, sampleSize: sampleSizeFor(qty) as number, nominal };
  });
}

// N identical passing samples at nominal (visual pass, taper = the nominal taper text or null).
export function bulkSamples(nominal: Nominal, sampleSize: number) {
  return Array.from({ length: sampleSize }, () => ({
    length: nominal.length,
    width: nominal.width,
    height: nominal.height,
    taper: nominal.taper,
    visual_pass: true,
    result: "pass" as const,
    notes: null,
  }));
}
