// src/lib/thicknessPalette.selfcheck.ts
// Guarded dev self-check for thicknessPalette.ts (lbr-05). Mirrors savedLoad.selfcheck.ts's shape.
// Pure — no network.
import { THICKNESS_TABLE, thicknessColor, thicknessLabel } from "./thicknessPalette";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

// WCAG 2.x relative luminance + contrast ratio.
function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function runThicknessPaletteSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  const check = (name: string, pass: boolean, detail?: string) => results.push({ name, pass, detail });

  for (let i = 1; i <= 16; i++) {
    const { bg, fg } = THICKNESS_TABLE[i];
    const ratio = contrast(fg, bg);
    check(`${i}″: fg/bg contrast >= 4.5`, ratio >= 4.5, ratio.toFixed(2));
  }
  for (let i = 1; i < 16; i++) {
    check(`${i}″ and ${i + 1}″ never share a bg`, THICKNESS_TABLE[i].bg !== THICKNESS_TABLE[i + 1].bg);
  }
  const f = thicknessColor(5.25);
  check("5.25 -> hatched with the 5″ colors", f.hatched && f.bg === THICKNESS_TABLE[5].bg && f.fg === THICKNESS_TABLE[5].fg, JSON.stringify(f));
  check("5 -> not hatched", thicknessColor(5).hatched === false);
  check("20 -> hatched (cycles the table)", thicknessColor(20).hatched === true && thicknessColor(20).bg === THICKNESS_TABLE[4].bg, JSON.stringify(thicknessColor(20)));
  check("labels: 13 -> 13″, 5.25 -> 5.25″", thicknessLabel(13) === "13″" && thicknessLabel(5.25) === "5.25″");

  return { pass: results.every((r) => r.pass), results };
}
