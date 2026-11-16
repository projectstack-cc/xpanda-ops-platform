// src/lib/blockCalc/diagram.ts — blk-02
// Pure geometry for the Block Calculator's three cut diagrams. Port of legacy
// manufacturing/block-calculator.html buildDiagParams (~1495) and the geometry half of
// drawBlockView (~1384): same view order and axis pairing, same padding, scale, rounding and label
// rules. No DOM — BlockDiagrams.tsx turns a ViewLayout into SVG.
//
// One deliberate difference from the canvas code: legacy's primary span gW = n·(part+kerf)·scale
// runs a kerf past the block when the remnant is under one kerf; canvas silently draws a negative-
// width strip there. SVG can't, so strip widths/heights are clamped to ≥ 0 and the primary rect is
// clipped to the block. Labels and separators use the unclamped legacy conditions.
import type { BlockCalcResult } from "@/lib/blockEngine";

export type DiagAxis = "Length" | "Width" | "Height";

export interface DiagParams {
  blockD1: number;
  blockD2: number;
  n1: number;
  n2: number;
  eff1: number;
  eff2: number;
  rem1: number;
  rem2: number;
  partD1: number;
  partD2: number;
  axis1: DiagAxis;
  axis2: DiagAxis;
  /** A secondary part sits in the strip past the primary span on axis 1 / axis 2. */
  secInRem1: boolean;
  secInRem2: boolean;
}

/** Legacy buildDiagParams: [Front (W × H), Top (L × W), Side (L × H)]. */
export function buildDiagParams(calc: BlockCalcResult): [DiagParams, DiagParams, DiagParams] {
  const p = calc.primary;
  const secInZone1 = calc.secondaries.some((s) => s.zone1.total > 0);
  const secInZone2 = calc.secondaries.some((s) => s.zone2.total > 0);
  const secInZone3 = calc.secondaries.some((s) => s.zone3.total > 0);
  return [
    {
      blockD1: p.bW, blockD2: p.bH, n1: p.nW, n2: p.nH, eff1: p.effW, eff2: p.effH,
      rem1: p.remW, rem2: p.remH, partD1: p.partDimW, partD2: p.partDimH,
      axis1: "Width", axis2: "Height", secInRem1: secInZone2, secInRem2: secInZone3,
    },
    {
      blockD1: p.bL, blockD2: p.bW, n1: p.nL, n2: p.nW, eff1: p.effL, eff2: p.effW,
      rem1: p.remL, rem2: p.remW, partD1: p.partDimL, partD2: p.partDimW,
      axis1: "Length", axis2: "Width", secInRem1: secInZone1, secInRem2: secInZone2,
    },
    {
      blockD1: p.bL, blockD2: p.bH, n1: p.nL, n2: p.nH, eff1: p.effL, eff2: p.effH,
      rem1: p.remL, rem2: p.remH, partD1: p.partDimL, partD2: p.partDimH,
      axis1: "Length", axis2: "Height", secInRem1: secInZone1, secInRem2: secInZone3,
    },
  ];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Line {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface Label {
  x: number;
  y: number;
  text: string;
  anchor: "middle" | "start";
  size: number;
  /** Degrees; -90 for the left block-dimension label. */
  rotate?: number;
}

export interface ViewLayout {
  width: number;
  height: number;
  scale: number;
  /** Legacy's unclamped primary span (px). */
  gW: number;
  gH: number;
  block: Rect;
  /** Null when there is no primary span on both axes (legacy draws nothing). */
  primary: Rect | null;
  /** Right strip (past axis 1's primary span) and bottom strip (below axis 2's). */
  rem1Strip: Rect & { secondary: boolean };
  rem2Strip: Rect & { secondary: boolean };
  gridLines: Line[];
  /** Internal cut lines across axis 1 (vertical) / axis 2 (horizontal). */
  gridLines1: number;
  gridLines2: number;
  separator1: Line | null;
  separator2: Line | null;
  labels: {
    dim1: Label;
    dim2: Label;
    part: Label | null;
    rem1: Label | null;
    rem2: Label | null;
  };
}

export const PAD = { L: 52, T: 28, R: 52, B: 38 } as const;

/**
 * Legacy drawBlockView geometry. `axisLabel1/2` arrive translated (legacy passes axisLabel(...)).
 */
export function layoutView(
  params: DiagParams,
  maxW: number,
  maxH: number,
  axisLabel1: string,
  axisLabel2: string
): ViewLayout {
  const { blockD1, blockD2, n1, n2, eff1, eff2, rem1, rem2, partD1, secInRem1, secInRem2 } = params;
  const availW = maxW - PAD.L - PAD.R;
  const availH = maxH - PAD.T - PAD.B;
  const scale = Math.min(availW / blockD1, availH / blockD2);
  const rW = Math.round(blockD1 * scale);
  const rH = Math.round(blockD2 * scale);
  const width = rW + PAD.L + PAD.R;
  const height = rH + PAD.T + PAD.B;

  const ox = PAD.L;
  const oy = PAD.T;
  const gW = n1 * eff1 * scale;
  const gH = n2 * eff2 * scale;
  const gWc = Math.min(Math.max(gW, 0), rW);
  const gHc = Math.min(Math.max(gH, 0), rH);

  const gridLines: Line[] = [];
  for (let i = 1; i < n1; i++) {
    const x = ox + i * eff1 * scale;
    gridLines.push({ x1: x, y1: oy, x2: x, y2: oy + gH });
  }
  for (let j = 1; j < n2; j++) {
    const y = oy + j * eff2 * scale;
    gridLines.push({ x1: ox, y1: y, x2: ox + gW, y2: y });
  }

  const fs = Math.max(9, Math.min(11, rW * 0.028));
  const smallFs = Math.max(8, Math.min(10, rW * 0.022));
  const bottomY = oy + rH + PAD.B / 2 - 2;

  return {
    width,
    height,
    scale,
    gW,
    gH,
    block: { x: ox, y: oy, w: rW, h: rH },
    primary: gW > 0 && gH > 0 ? { x: ox, y: oy, w: gWc, h: gHc } : null,
    rem1Strip: { x: ox + gWc, y: oy, w: Math.max(0, rW - gW), h: rH, secondary: secInRem1 },
    rem2Strip: { x: ox, y: oy + gHc, w: gWc, h: Math.max(0, rH - gH), secondary: secInRem2 },
    gridLines,
    gridLines1: Math.max(0, n1 - 1),
    gridLines2: Math.max(0, n2 - 1),
    separator1: rem1 > 0.001 && gW > 0 ? { x1: ox + gW, y1: oy, x2: ox + gW, y2: oy + rH } : null,
    separator2: rem2 > 0.001 && gH > 0 ? { x1: ox, y1: oy + gH, x2: ox + gW, y2: oy + gH } : null,
    labels: {
      dim1: { x: ox + rW / 2, y: oy - PAD.T / 2 + 2, text: `${blockD1}" ${axisLabel1}`, anchor: "middle", size: fs },
      dim2: {
        x: ox - PAD.L / 2 + 4, y: oy + rH / 2, text: `${blockD2}" ${axisLabel2}`, anchor: "middle", size: fs, rotate: -90,
      },
      part: n1 > 0 && gW > 0 ? { x: ox + (partD1 * scale) / 2, y: bottomY, text: `${partD1}"`, anchor: "middle", size: smallFs } : null,
      rem1:
        rem1 > 0.001 && rW - gW > 2
          ? { x: ox + gW + (rW - gW) / 2, y: bottomY, text: `${rem1.toFixed(2)}"`, anchor: "middle", size: smallFs }
          : null,
      rem2:
        rem2 > 0.001 && rH - gH > 2
          ? { x: ox + rW + 4, y: oy + gH + (rH - gH) / 2, text: `${rem2.toFixed(2)}"`, anchor: "start", size: smallFs }
          : null,
    },
  };
}
