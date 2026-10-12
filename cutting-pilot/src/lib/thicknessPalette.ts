// src/lib/thicknessPalette.ts
// lbr-05: the ONE place Load Builder diagram data colors are defined — one fixed color per board
// thickness, identical on every load, on screen (TrailerDiagram.tsx) and in print
// (loadingDiagramPdf.ts). Documented exception to the platform's "tokens, never hex" rule: these
// are DATA colors (a thickness's identity), not UI chrome, and must not shift with the theme.
// Adjacent sizes differ strongly in hue and/or lightness; every fg/bg pair is >= 4.5:1
// (re-verified in thicknessPalette.selfcheck.ts). Entries 8–13 match the approved
// "Load Builder v2 Mockup". Color is never the only signal — every cell also prints its size label.

export interface ThicknessColor {
  bg: string;
  fg: string;
  /** Fractional (e.g. 5.25") or > 16" sizes reuse a table color — drawn with a diagonal hatch so
   * they never look identical to the integer size. */
  hatched: boolean;
}

/** Keyed by integer inches, 1–16. */
export const THICKNESS_TABLE: Readonly<Record<number, { bg: string; fg: string }>> = {
  1: { bg: "#fde68a", fg: "#111827" },
  2: { bg: "#7c2d12", fg: "#ffffff" },
  3: { bg: "#a5f3fc", fg: "#111827" },
  4: { bg: "#4d7c0f", fg: "#ffffff" },
  5: { bg: "#fbcfe8", fg: "#111827" },
  6: { bg: "#92400e", fg: "#ffffff" },
  7: { bg: "#d9f99d", fg: "#111827" },
  8: { bg: "#be123c", fg: "#ffffff" },
  9: { bg: "#7c3aed", fg: "#ffffff" },
  10: { bg: "#bae6fd", fg: "#0c4a6e" },
  11: { bg: "#fbbf24", fg: "#111827" },
  12: { bg: "#0f766e", fg: "#ffffff" },
  13: { bg: "#1e3a8a", fg: "#ffffff" },
  14: { bg: "#fca5a5", fg: "#111827" },
  15: { bg: "#4338ca", fg: "#ffffff" },
  16: { bg: "#86efac", fg: "#111827" },
};

const TABLE_SIZE = 16;
const EPS = 1e-6;

export function thicknessColor(unitHeight: number): ThicknessColor {
  const floor = Math.floor(unitHeight + EPS);
  const fractional = Math.abs(unitHeight - floor) > EPS;
  const key = floor < 1 ? 1 : ((floor - 1) % TABLE_SIZE) + 1;
  const { bg, fg } = THICKNESS_TABLE[key];
  return { bg, fg, hatched: fractional || floor > TABLE_SIZE || floor < 1 };
}

/** "13″" for whole sizes, "5.25″" for fractional ones. */
export function thicknessLabel(unitHeight: number): string {
  const n = Number.isInteger(unitHeight) ? String(unitHeight) : unitHeight.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${n}″`;
}
