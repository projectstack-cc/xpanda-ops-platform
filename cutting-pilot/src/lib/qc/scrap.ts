// src/lib/qc/scrap.ts — qc-04
// Pure helpers for the native scrap database (scrap_events) — the /v2/qc Scrap log popup and
// POST /v2/api/qc/scrap. No DB, no React — exercised by scrap.selfcheck.ts
// (`npx tsx src/lib/qc/scrap.selfcheck.ts`). Amount = pieces × T × W × L (in³); board feet = in³ ÷ 144
// (legacy's formula). Both are computed on the server; the popup shows the same numbers live.
import { SHIFTS, type ShiftKey } from "../cutting/shiftRisk";
import { etNowWallClock } from "../etDateTime";

export const SCRAP_REASONS = [
  "Incorrect Cut",
  "Hole Pass Issue",
  "Dirty / Wet Foam",
  "Equipment Issue",
  "Setup Error",
  "Other",
] as const;
export type ScrapReason = (typeof SCRAP_REASONS)[number];

export const SCRAP_LINES = ["Main Line", "Blue Line", "Cross Cutter", "Hole Cutter", "Laminate"] as const;
export type ScrapLine = (typeof SCRAP_LINES)[number];

export const SHIFT_VALUES = ["1", "2", "3"] as const;
export type ShiftValue = (typeof SHIFT_VALUES)[number];

export const SHIFT_LABELS: Record<ShiftValue, string> = {
  "1": `1st (${SHIFTS["1st"].label})`,
  "2": `2nd (${SHIFTS["2nd"].label})`,
  "3": `3rd (${SHIFTS["3rd"].label})`,
};

export const NOTES_MAX = 500;
export const VOID_REASON_MAX = 200;
export const MAX_ENTRIES = 20;

export type ScrapSource = "qc" | "cutting" | "legacy";

// One scrap_events row as the API returns it.
export interface ScrapRow {
  id: string;
  event_date: string;
  week_number: number;
  month_name: string;
  shift: ShiftValue;
  source: ScrapSource;
  job_id: string | null;
  line_item_id: string | null;
  cutting_line_id: string | null;
  inv_number: string;
  customer: string | null;
  line_machine: ScrapLine;
  operator_id: string | null;
  operator_name: string;
  part_product: string;
  material_density: string | null;
  pieces: number | null;
  thickness_in: number | null;
  width_in: number | null;
  length_in: number | null;
  scrap_cubic_in: number;
  scrap_board_ft: number;
  scrap_reason: ScrapReason;
  notes: string | null;
  created_by_id: string | null;
  created_by_name: string | null;
  created_at: string;
  voided_at: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
}

function ymdParts(ymd: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return [y, mo, d];
}

export function isValidYmd(ymd: string): boolean {
  return ymdParts(ymd) !== null;
}

// Byte-faithful port of legacy getWeekNumberMondayStart (_worker.js/routes/qc.js, retired in qc-04).
// Legacy parsed `${date}T00:00:00` as a local Date and read getFullYear/getMonth/getDate back out —
// i.e. exactly the Y-M-D parts — so this takes them straight from the string.
export function weekNumberMondayStart(ymd: string): number {
  const p = ymdParts(ymd);
  if (!p) return NaN;
  const d = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const dayOffset = (yearStart.getUTCDay() + 6) % 7;
  const diff = Math.floor((d.getTime() - yearStart.getTime()) / 86400000);
  return Math.floor((diff + dayOffset) / 7) + 1;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "October" for "2026-10-16" — from the Y-M-D parts, no Date timezone drift. */
export function monthName(ymd: string): string {
  const p = ymdParts(ymd);
  return p ? MONTHS[p[1] - 1] : "";
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** pieces × T × W × L. Pieces a positive integer, dimensions finite and > 0, else null. Rounded to 3 dp. */
export function scrapVolume(pieces: number, t: number, w: number, l: number): { cubicIn: number; boardFt: number } | null {
  if (typeof pieces !== "number" || !Number.isInteger(pieces) || pieces < 1) return null;
  for (const v of [t, w, l]) {
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  }
  const cubicIn = pieces * t * w * l;
  return { cubicIn: round3(cubicIn), boardFt: round3(cubicIn / 144) };
}

const SHIFT_KEY_TO_VALUE: Record<ShiftKey, ShiftValue> = { "1st": "1", "2nd": "2", "3rd": "3" };

/** Shift for an ET wall-clock minute (0..1439). In an overlap the shift that started most recently wins. */
export function defaultShiftForEtMinutes(min: number): ShiftValue {
  let best: ShiftValue = "1";
  let bestElapsed = Infinity;
  for (const key of Object.keys(SHIFTS) as ShiftKey[]) {
    const { start, end } = SHIFTS[key];
    const elapsed = (((min - start) % 1440) + 1440) % 1440;
    if (elapsed < end - start && elapsed < bestElapsed) {
      bestElapsed = elapsed;
      best = SHIFT_KEY_TO_VALUE[key];
    }
  }
  return best;
}

export interface ScrapEntryInput {
  event_date?: unknown;
  shift?: unknown;
  inv_number?: unknown;
  job_id?: unknown;
  line_item_id?: unknown;
  line_machine?: unknown;
  operator_name?: unknown;
  part_product?: unknown;
  material_density?: unknown;
  pieces?: unknown;
  thickness_in?: unknown;
  width_in?: unknown;
  length_in?: unknown;
  scrap_reason?: unknown;
  notes?: unknown;
}

export interface ScrapEntryValue {
  event_date: string;
  shift: ShiftValue;
  inv_number: string;
  job_id: string | null;
  line_item_id: string | null;
  line_machine: ScrapLine;
  operator_name: string;
  part_product: string;
  material_density: string | null;
  pieces: number;
  thickness_in: number;
  width_in: number;
  length_in: number;
  scrap_reason: ScrapReason;
  notes: string | null;
  scrap_cubic_in: number;
  scrap_board_ft: number;
}

function text(v: unknown, max = 200): string {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function numIn(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v.trim());
  return NaN;
}

/** Validate + normalize one entry. `todayEt` (YYYY-MM-DD) defaults to today in ET. */
export function validateScrapEntry(
  e: ScrapEntryInput,
  todayEt: string = etNowWallClock().date
): { ok: true; value: ScrapEntryValue } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const event_date = text(e.event_date, 10);
  const shift = text(e.shift, 1);
  const inv_number = text(e.inv_number, 50);
  const line_machine = text(e.line_machine, 50);
  const operator_name = text(e.operator_name, 100);
  const part_product = text(e.part_product, 200);
  const material_density = text(e.material_density, 100);
  const scrap_reason = text(e.scrap_reason, 50);
  const rawNotes = typeof e.notes === "string" ? e.notes.trim().slice(0, NOTES_MAX) : "";
  const job_id = text(e.job_id, 100) || null;
  const line_item_id = text(e.line_item_id, 100) || null;

  if (!event_date) errors.push("Date is required.");
  else if (!isValidYmd(event_date)) errors.push("Date must be YYYY-MM-DD.");
  else if (event_date > todayEt) errors.push("Date can't be in the future.");
  if (!(SHIFT_VALUES as readonly string[]).includes(shift)) errors.push("Shift is required.");
  if (!inv_number) errors.push("INV # is required.");
  if (!(SCRAP_LINES as readonly string[]).includes(line_machine)) errors.push("Line / machine is required.");
  if (!operator_name) errors.push("Operator is required.");
  if (!part_product) errors.push("Part is required.");
  if (!(SCRAP_REASONS as readonly string[]).includes(scrap_reason)) errors.push("Reason is required.");
  else if (scrap_reason === "Other" && !rawNotes) errors.push("Notes are required when the reason is Other.");

  const pieces = numIn(e.pieces);
  const t = numIn(e.thickness_in);
  const w = numIn(e.width_in);
  const l = numIn(e.length_in);
  const vol = scrapVolume(pieces, t, w, l);
  if (!vol) {
    if (!Number.isInteger(pieces) || pieces < 1) errors.push("Pieces must be a whole number of at least 1.");
    if (![t, w, l].every((v) => Number.isFinite(v) && v > 0)) errors.push("Thickness, width and length must be greater than 0.");
  }

  if (errors.length || !vol) return { ok: false, errors };
  return {
    ok: true,
    value: {
      event_date,
      shift: shift as ShiftValue,
      inv_number,
      job_id,
      line_item_id,
      line_machine: line_machine as ScrapLine,
      operator_name,
      part_product,
      material_density: material_density || null,
      pieces,
      thickness_in: t,
      width_in: w,
      length_in: l,
      scrap_reason: scrap_reason as ScrapReason,
      notes: rawNotes || null,
      scrap_cubic_in: vol.cubicIn,
      scrap_board_ft: vol.boardFt,
    },
  };
}

/** YYYY-MM-DD plus `days`, on calendar parts (no TZ). */
export function addDaysYmd(ymd: string, days: number): string {
  const p = ymdParts(ymd);
  if (!p) return ymd;
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + days)).toISOString().slice(0, 10);
}
