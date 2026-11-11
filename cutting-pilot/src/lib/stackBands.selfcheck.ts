// src/lib/stackBands.selfcheck.ts
// Guarded dev self-check for stackBands.ts (lb-diag-03). Mirrors dissolve.selfcheck.ts's shape:
// hand-built fixtures, a check()/results table, one exported run*SelfCheck() function. Not part of
// the production build path.
//
// Cases 2 and 3 pin the one-top-off result to the exact pre-lb-diag-03 formulas the screen and PDF
// renderers used, so 1–2-layer stacks draw byte-for-byte as before.
import type { PackColumn, PackLayer } from "./packEngine";
import { stackBands } from "./stackBands";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

function layer(unitHeight: number, count: number): PackLayer {
  return {
    skuId: `S${unitHeight}`,
    skuName: `${unitHeight}in`,
    skuCode: `S${unitHeight}`,
    color: "#333333",
    unitHeight,
    count,
    orientation: { length: 96, width: 48, height: unitHeight, label: "flat" },
  };
}

function col(layers: PackLayer[]): Pick<PackColumn, "layers" | "totalHeight"> {
  return { layers, totalHeight: layers.reduce((s, l) => s + l.unitHeight * l.count, 0) };
}

const SCREEN_MIN = 24;
const EPS = 1e-9;

export async function runStackBandsSelfCheck(): Promise<{ pass: boolean; results: CheckResult[] }> {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  // 1. Pure stack.
  {
    const r = stackBands(col([layer(2, 10)]), 120, SCREEN_MIN);
    check("pure stack -> no bands, baseHeight === height", r.bands.length === 0 && r.baseHeight === 120, JSON.stringify(r));
  }

  // 2. One top-off, screen minimum — equals Math.min(H*0.6, Math.max(24, H*frac)).
  {
    const combos: [number, PackLayer[], string][] = [
      [120, [layer(2, 10), layer(1, 5)], "proportional"],
      [40, [layer(2, 10), layer(0.5, 1)], "min-clamp"],
      [30, [layer(2, 10), layer(1, 5)], "cap-clamp (min 24 > 0.6*30)"],
      [100, [layer(1, 2), layer(4, 10)], "cap-clamp (share > 0.6)"],
      [87.3, [layer(3, 7), layer(1.5, 4)], "fractional H"],
    ];
    for (const [H, layers, label] of combos) {
      const c = col(layers);
      const top = layers[1];
      const frac = c.totalHeight > 0 ? (top.unitHeight * top.count) / c.totalHeight : 0;
      const expected = Math.min(H * 0.6, Math.max(SCREEN_MIN, H * frac));
      const r = stackBands(c, H, SCREEN_MIN);
      check(
        `one top-off, screen min, ${label}: band === old formula, base === H - band`,
        r.bands.length === 1 && r.bands[0].layerIndex === 1 && r.bands[0].height === expected && r.baseHeight === H - expected,
        `got ${JSON.stringify(r)} expected ${expected}`
      );
    }
  }

  // 3. One top-off, PDF minimum — equals Math.min(h*0.6, Math.max(h*frac, Math.min(12, h*0.45))).
  {
    const combos: [number, PackLayer[], string][] = [
      [60, [layer(2, 10), layer(1, 5)], "proportional"],
      [40, [layer(2, 10), layer(0.5, 1)], "min-clamp (12)"],
      [20, [layer(2, 10), layer(0.5, 1)], "min-clamp (0.45*h)"],
      [50, [layer(1, 2), layer(4, 10)], "cap-clamp"],
    ];
    for (const [h, layers, label] of combos) {
      const c = col(layers);
      const top = layers[1];
      const frac = (top.unitHeight * top.count) / c.totalHeight;
      const minBand = Math.min(12, h * 0.45);
      const expected = Math.min(h * 0.6, Math.max(h * frac, minBand));
      const r = stackBands(c, h, minBand);
      check(
        `one top-off, PDF min, ${label}: band === old formula, base === h - band`,
        r.bands.length === 1 && r.bands[0].height === expected && r.baseHeight === h - expected,
        `got ${JSON.stringify(r)} expected ${expected}`
      );
    }
  }

  // 4. Three layers (2"×10, 1"×5, ½"×4): two bands, top layer first.
  {
    const H = 200;
    const c = col([layer(2, 10), layer(1, 5), layer(0.5, 4)]); // total 27
    const r = stackBands(c, H, SCREEN_MIN);
    const sum = r.bands.reduce((s, b) => s + b.height, 0);
    const shareOk = r.bands.every((b) => {
      const l = c.layers[b.layerIndex];
      return b.height >= Math.max(SCREEN_MIN, (H * l.unitHeight * l.count) / c.totalHeight) - EPS;
    });
    check("three layers: two bands", r.bands.length === 2, JSON.stringify(r));
    check("three layers: bands[0] is layer 2 (top edge), bands[1] is layer 1", r.bands[0]?.layerIndex === 2 && r.bands[1]?.layerIndex === 1, JSON.stringify(r.bands));
    check("three layers: each band >= its share or the minimum (no cap hit)", shareOk, JSON.stringify(r.bands));
    check("three layers: sum <= 0.7*H, baseHeight > 0, sum + base === H", sum <= 0.7 * H + EPS && r.baseHeight > 0 && Math.abs(sum + r.baseHeight - H) < EPS, `sum=${sum} base=${r.baseHeight}`);
  }

  // 5. Three layers where the minimums exceed the cap (small H): scaled to exactly 0.7*H.
  {
    const H = 50; // 2 × 24 = 48 > 35
    const r = stackBands(col([layer(2, 10), layer(1, 5), layer(0.5, 4)]), H, SCREEN_MIN);
    const sum = r.bands.reduce((s, b) => s + b.height, 0);
    check("three layers, small H: sum scaled to 0.7*H", r.bands.length === 2 && Math.abs(sum - 0.7 * H) < EPS, `sum=${sum}`);
    check("three layers, small H: both bands > 0, base === H - sum", r.bands.every((b) => b.height > 0) && Math.abs(r.baseHeight - (H - sum)) < EPS, JSON.stringify(r));
  }

  // 6. Four layers (defensive): three bands, ordered 3, 2, 1.
  {
    const H = 300;
    const r = stackBands(col([layer(4, 6), layer(2, 3), layer(1, 2), layer(0.5, 2)]), H, SCREEN_MIN);
    const sum = r.bands.reduce((s, b) => s + b.height, 0);
    check("four layers: three bands ordered 3, 2, 1", r.bands.map((b) => b.layerIndex).join(",") === "3,2,1", JSON.stringify(r.bands));
    check("four layers: sum <= 0.7*H, base > 0", sum <= 0.7 * H + EPS && r.baseHeight > 0, `sum=${sum} base=${r.baseHeight}`);
  }

  return { pass: results.every((r) => r.pass), results };
}
