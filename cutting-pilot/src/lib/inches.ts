// src/lib/inches.ts — marina-02
// Pure inch parsing / formatting / tolerance helpers. No imports: shared by the Marina routes
// (authoritative tolerance check) and the Marina UI (live red/green, fraction keypad).

export const MARINA_DEFAULT_TOL = 0.1875; // ±3/16"

const MAX_INCHES = 2000;

const VULGAR: Record<string, number> = {
  "⅛": 1 / 8, "¼": 1 / 4, "⅜": 3 / 8, "½": 1 / 2, "⅝": 5 / 8, "¾": 3 / 4, "⅞": 7 / 8,
  "⅓": 1 / 3, "⅔": 2 / 3,
};

function ok(n: number): number | null {
  return Number.isFinite(n) && n >= 0 && n <= MAX_INCHES ? n : null;
}

// "41 3/8" | "41-3/8" | "41.375" | "3/8" | "41" | ".5" | "41⅜" | "41 ⅜" | "⅜", with an optional
// trailing `"`, `in` or `″`. Null for empty, garbage, a zero denominator, negative, or > 2000 in.
export function parseInches(raw: string): number | null {
  let s = String(raw ?? "").trim();
  s = s.replace(/\s*(?:"|″|in)$/i, "").trim();
  if (!s) return null;

  let m = s.match(/^(\d+)?\s*([⅛¼⅜½⅝¾⅞⅓⅔])$/);
  if (m) return ok((m[1] ? Number(m[1]) : 0) + VULGAR[m[2]]);

  m = s.match(/^(\d+(?:\.\d*)?|\.\d+)$/);
  if (m) return ok(Number(m[1]));

  m = s.match(/^(?:(\d+)(?:\s*-\s*|\s+))?(\d+)\/(\d+)$/);
  if (m) {
    const den = Number(m[3]);
    if (den === 0) return null;
    return ok((m[1] ? Number(m[1]) : 0) + Number(m[2]) / den);
  }
  return null;
}

export function roundToSixteenth(n: number): number {
  return Math.round(n * 16) / 16;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

// Nearest 1/16, fraction reduced: 41.375 → "41 3/8", 0.5 → "1/2", 56 → "56", 41.97 → "42", 0.03 → "0".
export function formatInches(n: number): string {
  if (!Number.isFinite(n)) return "";
  const sign = n < 0 ? "-" : "";
  const sixteenths = Math.round(Math.abs(n) * 16);
  const whole = Math.floor(sixteenths / 16);
  const rem = sixteenths % 16;
  if (rem === 0) return sixteenths === 0 ? "0" : `${sign}${whole}`;
  const g = gcd(rem, 16);
  const frac = `${rem / g}/${16 / g}`;
  return whole === 0 ? `${sign}${frac}` : `${sign}${whole} ${frac}`;
}

// Inclusive: exactly 3/16 off at a 3/16 tolerance is IN (epsilon absorbs float error).
export function inTolerance(measured: number, nominal: number, tol: number): boolean {
  return Math.abs(measured - nominal) <= tol + 1e-9;
}
