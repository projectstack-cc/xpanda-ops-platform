// src/components/schedule/density.ts
// Shrink-to-fit tiering: the tallest day column (row count) in the currently-fetched two weeks
// decides how much per-row detail survives. Font size itself shrinks continuously via CSS
// clamp() in each component (floored at a TV-readable size); this only controls which FIELDS
// render — trimming secondary fields is preferred over shrinking text below the floor.
export type Density = "full" | "compact" | "minimal";

export interface DensityPlan {
  density: Density;
  rowCap: number;
}

export function computeDensity(maxColumnRows: number): DensityPlan {
  if (maxColumnRows <= 5) return { density: "full", rowCap: Infinity };
  if (maxColumnRows <= 9) return { density: "compact", rowCap: 9 };
  return { density: "minimal", rowCap: 14 };
}
