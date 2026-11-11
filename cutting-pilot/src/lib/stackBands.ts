// src/lib/stackBands.ts
// lb-diag-03: a column's layers[] is base-first, then each top-off upward. Both diagram renderers
// (TrailerDiagram.tsx on screen, loadingDiagramPdf.ts in the PDF) used to draw only layers[0] and
// layers[last], so a three-size stack silently lost its middle layer. Every layer above the base
// now gets its own band, stacked from the column's top edge downward (topmost layer at the very
// top), and the base fills what's left. This is the one sizing rule both renderers share — kept in
// its own pure module so the client diagram never imports pdf-lib.
//
// One top-off reproduces the pre-lb-diag-03 single-band sizes exactly:
//   band = min(0.6·H, max(minBand, H·share)).
// Two or more: each raw band = max(minBand, H·share); if their sum exceeds 0.7·H, every band is
// scaled by cap / Σraw.
import type { PackColumn } from "./packEngine";

export interface StackBand {
  layerIndex: number;
  height: number;
}

export interface StackBandLayout {
  bands: StackBand[];
  baseHeight: number;
}

/** Top-off bands for one column, ordered top edge → down (layers[last] first, layers[1] last).
 *  height = the column's drawn height (px or pt). minBand = the renderer's readable minimum. */
export function stackBands(column: Pick<PackColumn, "layers" | "totalHeight">, height: number, minBand: number): StackBandLayout {
  const layers = column.layers;
  if (layers.length <= 1) return { bands: [], baseHeight: height };

  const total = column.totalHeight > 0 ? column.totalHeight : layers.reduce((s, l) => s + l.unitHeight * l.count, 0);
  const raw: StackBand[] = [];
  for (let i = layers.length - 1; i >= 1; i--) {
    const share = total > 0 ? (layers[i].unitHeight * layers[i].count) / total : 0;
    raw.push({ layerIndex: i, height: Math.max(minBand, height * share) });
  }

  let bands: StackBand[];
  if (raw.length === 1) {
    bands = [{ layerIndex: raw[0].layerIndex, height: Math.min(height * 0.6, raw[0].height) }];
  } else {
    const cap = height * 0.7;
    const sum = raw.reduce((s, b) => s + b.height, 0);
    bands = sum > cap && sum > 0 ? raw.map((b) => ({ layerIndex: b.layerIndex, height: b.height * (cap / sum) })) : raw;
  }

  const used = bands.reduce((s, b) => s + b.height, 0);
  return { bands, baseHeight: height - used };
}
