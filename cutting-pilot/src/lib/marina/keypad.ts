// src/lib/marina/keypad.ts — marina-06
// Pure entry state machine for the Marina fraction keypad (FractionKeypad.tsx has no parsing logic).
// whole = digits only (≤ 4, leading zeros collapsed, never past the 2000" parseInches cap); frac = a
// reduced "n/d" sixteenths fraction or null. keypadText is always parseInches-able (or "").
import { formatInches, inTolerance, parseInches } from "../inches";

export interface KeypadState { whole: string; frac: string | null; }   // whole: digits only, ≤ 4; frac: "1/16".."15/16" reduced, or null
export type KeypadKey =
  | { kind: "digit"; d: string }
  | { kind: "frac"; f: string }
  | { kind: "back" }
  | { kind: "clear" }
  | { kind: "nudge"; sixteenths: 1 | -1 };

export const KEYPAD_MAX_IN = 2000;
export const EMPTY_KEYPAD: KeypadState = { whole: "", frac: null };

const FRAC_RE = /^(\d+)\/(\d+)$/;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

// "6/16" → "3/8"; null for anything that isn't a proper sixteenths fraction (1/16 … 15/16).
function reduceFrac(f: string): string | null {
  const m = f.trim().match(FRAC_RE);
  if (!m) return null;
  const num = Number(m[1]);
  const den = Number(m[2]);
  if (!den || 16 % den !== 0 || num <= 0 || num >= den) return null;
  const g = gcd(num, den);
  return `${num / g}/${den / g}`;
}

function value(s: KeypadState): number | null {
  const t = keypadText(s);
  return t ? parseInches(t) : null;
}

export function applyKey(s: KeypadState, k: KeypadKey): KeypadState {
  switch (k.kind) {
    case "digit": {
      if (!/^\d$/.test(k.d) || s.whole.length >= 4) return s;
      const whole = String(Number(s.whole + k.d)); // collapses leading zeros ("0" + "5" → "5")
      const next = { ...s, whole };
      const v = value(next);
      return v === null || v > KEYPAD_MAX_IN ? s : next;
    }
    case "frac": {
      const f = reduceFrac(k.f);
      if (!f) return s;
      if (s.frac === f) return { ...s, frac: null };
      const next = { ...s, frac: f };
      const v = value(next);
      return v === null || v > KEYPAD_MAX_IN ? s : next;
    }
    case "back":
      if (s.frac) return { ...s, frac: null };
      return { ...s, whole: s.whole.slice(0, -1) };
    case "clear":
      return { ...EMPTY_KEYPAD };
    case "nudge": {
      const cur = value(s) ?? 0;
      const n = Math.min(KEYPAD_MAX_IN, Math.max(0, Math.round(cur * 16) + k.sixteenths) / 16);
      return keypadFromValue(n);
    }
  }
}

// "41 3/8", "3/8", "41", "" — "0" with a fraction renders as the bare fraction.
export function keypadText(s: KeypadState): string {
  const whole = s.whole && Number(s.whole) === 0 && s.frac ? "" : s.whole;
  if (whole && s.frac) return `${whole} ${s.frac}`;
  return whole || s.frac || "";
}

// Prefill / nudge: normalised through formatInches (nearest 1/16, reduced).
export function keypadFromValue(n: number | null): KeypadState {
  if (n === null || !Number.isFinite(n) || n < 0) return { ...EMPTY_KEYPAD };
  const text = formatInches(Math.min(n, KEYPAD_MAX_IN));
  const m = text.match(/^(?:(\d+) )?(\d+\/\d+)$/);
  if (m) return { whole: m[1] ?? "", frac: m[2] };
  return { whole: text, frac: null };
}

// Live row feedback (UX only — the server's in_tol is what's saved). null until the text parses.
// Deviation = measured − nominal, nearest 1/16 via formatInches(|Δ|), signed "+" / "−" (U+2212):
// in → { inTol: true, text: "+1/16" | "0" }; out → { inTol: false, text: "+1/4 OVER" | "−3/8 UNDER" }.
export interface MeasureFeedback { inTol: boolean; text: string; }
export function measureFeedback(raw: string, nominal: number, tol: number): MeasureFeedback | null {
  const t = raw.trim();
  const v = t ? parseInches(t) : null;
  if (v === null) return null;
  const delta = v - nominal;
  const inTol = inTolerance(v, nominal, tol);
  const mag = formatInches(Math.abs(delta));
  const signed = mag === "0" ? "0" : `${delta > 0 ? "+" : "−"}${mag}`;
  if (inTol) return { inTol, text: signed };
  return { inTol, text: `${signed} ${delta > 0 ? "OVER" : "UNDER"}` };
}
