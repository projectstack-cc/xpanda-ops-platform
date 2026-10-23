// src/lib/reports/range.ts — rpt-01
// Pure calendar-date (YYYY-MM-DD) helpers for v2 Reports ranges. All arithmetic is on Y-M-D parts in
// UTC, so a DST change (Nov 1 2026) can never shift a day. "Today" comes from the caller (ET, via
// etNowWallClock) — nothing here reads the clock.

export type RangePreset = "this_week" | "last_7" | "last_30" | "custom";
export const MAX_RANGE_DAYS = 92;

function parts(ymd: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ""));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return [y, mo, d];
}

export function isYmd(ymd: string): boolean {
  return parts(ymd) !== null;
}

export function addDaysYmd(ymd: string, days: number): string {
  const p = parts(ymd);
  if (!p) return ymd;
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + days)).toISOString().slice(0, 10);
}

// Inclusive count of calendar days from → to (same day = 1).
export function spanDays(from: string, to: string): number {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return NaN;
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000) + 1;
}

// Every date from → to inclusive (empty when invalid or reversed).
export function eachDay(from: string, to: string): string[] {
  const n = spanDays(from, to);
  if (!Number.isFinite(n) || n < 1) return [];
  return Array.from({ length: n }, (_, i) => addDaysYmd(from, i));
}

// Both valid YMD, from ≤ to, span ≤ maxDays (inclusive count: 92 days ok, 93 rejected by default).
// rpt-03: optional maxDays (Incidents allows 731 — two years); existing callers unchanged.
export function validRange(from: string, to: string, maxDays: number = MAX_RANGE_DAYS): { ok: true } | { ok: false; error: string } {
  if (!isYmd(from) || !isYmd(to)) return { ok: false, error: "from and to must be dates (YYYY-MM-DD)." };
  if (from > to) return { ok: false, error: "The start date is after the end date." };
  if (spanDays(from, to) > maxDays) return { ok: false, error: `Pick a range of ${maxDays} days or fewer.` };
  return { ok: true };
}

// 0 = Monday … 6 = Sunday, from calendar parts.
function mondayIndex(ymd: string): number {
  const p = parts(ymd);
  if (!p) return 0;
  return (new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay() + 6) % 7;
}

// Preset → { from, to } for an ET `today`. This week = Monday → today; Last N days = today − (N − 1) → today
// (N dates, today included — "Sat Oct 17 – Fri Oct 23" for Last 7 days on Fri Oct 23; rpt-03).
export function presetRange(preset: Exclude<RangePreset, "custom">, today: string): { from: string; to: string } {
  if (preset === "this_week") return { from: addDaysYmd(today, -mondayIndex(today)), to: today };
  if (preset === "last_30") return { from: addDaysYmd(today, -29), to: today };
  return { from: addDaysYmd(today, -6), to: today };
}

// "Fri Oct 16" from a calendar date (UTC formatting, so the date never shifts).
export function dayLabel(ymd: string): string {
  const p = parts(ymd);
  if (!p) return ymd;
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(p[0], p[1] - 1, p[2])))
    .replace(",", "");
}

export function rangeLabel(from: string, to: string): string {
  return from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`;
}
