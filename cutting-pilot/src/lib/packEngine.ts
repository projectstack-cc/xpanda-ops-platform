// src/lib/packEngine.ts
// v2 Load Builder packing engine — typed contracts + invariant harness (lb-engine-01). Pure,
// dependency-free: no React, no Cloudflare bindings, no fetch. Importable from a Node script and
// from a client component alike.
//
// Output shape is rows[] -> columns[] -> layers[], matching legacy exactly, so the diagram,
// customize editor, dissolve, saved loads and bolShared.ts can all consume it unchanged once
// lb-engine-02 (joint orientation + width pairing + row assembly) and lb-engine-03 (column fill,
// top-off, ordering, running balance) land the real algorithm.
//
// posFromFront = 0 is the REAR of the trailer (locked decision, do not re-litigate).
// Support policy is strict-only for now: every piece sits on a single matching footprint (no
// bridging) — supportPolicy is reserved on PackOptions but only "strict" is implemented.
// Mode A (holey board) and Mode B (blocks) are one engine, differing by allowRotation; holey
// board never rotates (see HOLEY_BOARD_CATEGORY / holey-no-rotation below).
// Weight is a hard guard, never an objective. Every column carries a human-readable `rationale` —
// a required trust feature, not decoration.

// --- Dimensions & trailer presets ---

export interface Dimensions {
  length: number;
  width: number;
  height: number;
  maxWeight: number;
}

// Named trailer presets, keyed by display name (matches legacy's TRAILER_TYPES keys exactly).
export type TrailerType = Record<string, Dimensions>;

// Transcribed from logistics/load-builder.html's TRAILER_TYPES (verified against the live file
// 2026-09-14 — do NOT modify that file; this is a reproduction for the v2 engine only).
export const TRAILER_TYPES: TrailerType = {
  "53ft Standard": { length: 636, width: 98, height: 109, maxWeight: 44000 },
  "48ft Flatbed": { length: 576, width: 98, height: 108, maxWeight: 44000 },
  "40ft Container": { length: 480, width: 90, height: 102, maxWeight: 55000 },
  "20ft Container": { length: 240, width: 90, height: 86, maxWeight: 44000 },
  "26ft Box Truck": { length: 312, width: 72, height: 108, maxWeight: 28000 },
};

// Matches legacy's `sku.category === 'Holey Board'` string exactly (verified against
// logistics/load-builder.html 2026-09-14). Holey board never rotates: length stays along the
// trailer, width stays across, height stacks up.
export const HOLEY_BOARD_CATEGORY = "Holey Board";

// --- SKU / cart ---

export interface PackSku {
  id: string;
  name: string;
  sku: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  category?: string;
  allowRotation: boolean;
  bundleQty?: number;
}

export interface CartLine {
  skuId: string;
  qty: number;
}

export interface Orientation {
  length: number;
  width: number;
  height: number;
  label: string;
}

// --- Plan output shape (rows -> columns -> layers), matching legacy ---

export interface PackLayer {
  skuId: string;
  skuName: string;
  skuCode: string;
  color: string;
  unitHeight: number;
  count: number;
}

export interface PackColumn {
  posY: number;
  colWidth: number;
  totalHeight: number;
  totalWeight: number;
  stackCount: number;
  layers: PackLayer[];
  mixed: boolean;
  rationale: string;
}

export interface PackRow {
  posFromFront: number;
  rowLength: number;
  rowWidthUsed: number;
  columns: PackColumn[];
  totalUnits: number;
  totalWeight: number;
}

export interface PackTrailer {
  type?: string;
  dims: Dimensions;
  rows: PackRow[];
  usedLength: number;
  usedFloorArea: number;
  usedWeight: number;
  totalStacks: number;
  totalUnits: number;
  mixedStacks: number;
  widthUtilization: number;
  heightUtilization: number;
}

// Remaining unplaced demand.
export type PackBalance = Array<{ skuId: string; remaining: number }>;

export interface PackPlan {
  trailers: PackTrailer[];
  balance: PackBalance;
  warnings: string[];
  totalWeight: number;
  totalUnits: number;
  totalStacks: number;
  mixedStacks: number;
}

export interface PackOptions {
  allowRotation: boolean;
  topOffMinInchesPerPiece: number;
  maxSkusPerColumn: number;
  supportPolicy: "strict";
  trailerLimit?: number;
  isFlatbed?: boolean;
  runnerHeight?: number;
}

export const DEFAULT_PACK_OPTIONS: PackOptions = {
  allowRotation: true,
  topOffMinInchesPerPiece: 3,
  maxSkusPerColumn: 2,
  supportPolicy: "strict",
  trailerLimit: 20,
};

// --- pack() — stub until lb-engine-02 ---

/**
 * Packs `cart` demand (against the `skus` catalog) into trailers of `dims`. **Stub**: the joint
 * orientation/width-pairing/row-assembly algorithm lands in lb-engine-02, column fill + top-off +
 * ordering + running balance in lb-engine-03. An unimplemented function that throws is honest; a
 * half-algorithm is not.
 */
export function pack(
  cart: CartLine[],
  skus: PackSku[],
  dims: Dimensions,
  options?: Partial<PackOptions>
): PackPlan {
  throw new Error("packEngine: pack() not implemented until lb-engine-02");
}

// --- validatePlan() — the real deliverable of this prompt ---

export interface PackViolation {
  rule: string;
  detail: string;
  trailerIndex?: number;
  rowIndex?: number;
  columnIndex?: number;
}

const EPS = 1e-6;

function approxLte(a: number, b: number, eps = EPS): boolean {
  return a <= b + eps;
}

function approxGte(a: number, b: number, eps = EPS): boolean {
  return a >= b - eps;
}

function approxEq(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

// Legal orientations for a SKU given rotation policy: holey board never rotates (always its
// declared L/W/H); anything else may present length/width swapped if both the engine-wide and
// per-SKU rotation flags allow it. Height never swaps in either case — these are stacked items.
function skuOrientations(sku: PackSku, options: PackOptions): Orientation[] {
  const identity: Orientation = { length: sku.length, width: sku.width, height: sku.height, label: "flat" };
  const isHoley = sku.category === HOLEY_BOARD_CATEGORY;
  const rotationAllowed = !isHoley && options.allowRotation && sku.allowRotation;
  if (!rotationAllowed) return [identity];
  const rotated: Orientation = { length: sku.width, width: sku.length, height: sku.height, label: "rotated" };
  return [identity, rotated];
}

/**
 * Checks a PackPlan against all 13 invariants. Fully implemented — this is the real deliverable
 * of lb-engine-01. Returns one PackViolation per failure found; an empty array means the plan is
 * structurally sound (does not mean the algorithm that produced it was optimal).
 */
export function validatePlan(
  plan: PackPlan,
  dims: Dimensions,
  cart: CartLine[],
  skus: PackSku[],
  options: PackOptions
): PackViolation[] {
  const violations: PackViolation[] = [];
  const skuById = new Map(skus.map((s) => [s.id, s]));

  function violate(rule: string, detail: string, trailerIndex?: number, rowIndex?: number, columnIndex?: number) {
    violations.push({ rule, detail, trailerIndex, rowIndex, columnIndex });
  }

  // strict-support (part 1/2): only the "strict" policy is implemented. The type only allows
  // "strict", but a value crossing an API/JSON boundary isn't checked by the compiler — this
  // becomes load-bearing the day supportPolicy is ever relaxed.
  if (options.supportPolicy !== "strict") {
    violate(
      "strict-support",
      `unsupported supportPolicy "${String(options.supportPolicy)}" — only "strict" is implemented`
    );
  }

  plan.trailers.forEach((trailer, ti) => {
    let runningLength = 0;

    const summedRowLength = trailer.rows.reduce((sum, r) => sum + r.rowLength, 0);
    // trailer-length: catches rows that overflow the trailer bed lengthwise.
    if (!approxLte(summedRowLength, dims.length)) {
      violate("trailer-length", `sum of row lengths ${summedRowLength} exceeds trailer length ${dims.length}`, ti);
    }

    // weight: catches a plan that would overload the trailer's rated capacity.
    if (!approxLte(trailer.usedWeight, dims.maxWeight)) {
      violate("weight", `trailer usedWeight ${trailer.usedWeight} exceeds maxWeight ${dims.maxWeight}`, ti);
    }

    trailer.rows.forEach((row, ri) => {
      // row-geometry (length axis): catches a row placed at the wrong depth — e.g. a gap or
      // overlap left behind by a dissolve/repack.
      if (!approxEq(row.posFromFront, runningLength)) {
        violate("row-geometry", `row.posFromFront ${row.posFromFront} != running length ${runningLength}`, ti, ri);
      }
      runningLength += row.rowLength;

      let runningWidth = 0;
      const summedColWidth = row.columns.reduce((sum, c) => sum + c.colWidth, 0);
      // row-width: catches columns overflowing the trailer's usable width.
      if (!approxLte(summedColWidth, dims.width)) {
        violate("row-width", `sum of column widths ${summedColWidth} exceeds trailer width ${dims.width}`, ti, ri);
      }

      row.columns.forEach((column, ci) => {
        // row-geometry (width axis): same invariant as above, across the row.
        if (!approxEq(column.posY, runningWidth)) {
          violate("row-geometry", `column.posY ${column.posY} != running width ${runningWidth}`, ti, ri, ci);
        }
        runningWidth += column.colWidth;

        // column-height: catches a stack taller than the trailer's clearance.
        if (!approxLte(column.totalHeight, dims.height)) {
          violate(
            "column-height",
            `column totalHeight ${column.totalHeight} exceeds trailer height ${dims.height}`,
            ti,
            ri,
            ci
          );
        }

        // rationale-present: the trust feature — every column must explain itself.
        if (!column.rationale || column.rationale.trim().length === 0) {
          violate("rationale-present", "column has no rationale string", ti, ri, ci);
        }

        // strict-support (part 2/2): with this data shape a column is inherently one footprint
        // (single colWidth/rowLength pair for however many layers stack on it) — this asserts
        // that footprint actually has positive area, i.e. something is really sitting on it.
        if (column.layers.length > 0 && (column.colWidth <= 0 || row.rowLength <= 0)) {
          violate(
            "strict-support",
            `column footprint has non-positive area (colWidth=${column.colWidth}, rowLength=${row.rowLength})`,
            ti,
            ri,
            ci
          );
        }

        const distinctSkuIds = new Set(column.layers.map((l) => l.skuId));

        // max-skus-per-column: catches a column mixing more SKUs than the top-off policy allows.
        if (distinctSkuIds.size > options.maxSkusPerColumn) {
          violate(
            "max-skus-per-column",
            `column has ${distinctSkuIds.size} distinct SKUs, exceeds maxSkusPerColumn ${options.maxSkusPerColumn}`,
            ti,
            ri,
            ci
          );
        }

        // topoff-threshold: catches a top-off layer too thin to be worth the extra handling —
        // every non-base layer in a mixed column must gain at least topOffMinInchesPerPiece.
        if (distinctSkuIds.size > 1) {
          column.layers.slice(1).forEach((layer) => {
            if (!approxGte(layer.unitHeight, options.topOffMinInchesPerPiece)) {
              violate(
                "topoff-threshold",
                `topoff layer (sku ${layer.skuId}) unitHeight ${layer.unitHeight} < topOffMinInchesPerPiece ${options.topOffMinInchesPerPiece}`,
                ti,
                ri,
                ci
              );
            }
          });
        }

        column.layers.forEach((layer) => {
          const sku = skuById.get(layer.skuId);
          if (!sku) {
            violate("piece-fits-trailer", `sku ${layer.skuId} not found in skus[]`, ti, ri, ci);
            return;
          }

          // piece-fits-trailer: catches a SKU that physically cannot fit inside the trailer's
          // envelope in any orientation legal for it, independent of where it was placed.
          const fits = skuOrientations(sku, options).some(
            (o) => approxLte(o.length, dims.length) && approxLte(o.width, dims.width) && approxLte(o.height, dims.height)
          );
          if (!fits) {
            violate(
              "piece-fits-trailer",
              `sku ${layer.skuId} (${sku.length}x${sku.width}x${sku.height}) does not fit trailer ${dims.length}x${dims.width}x${dims.height} in any legal orientation`,
              ti,
              ri,
              ci
            );
          }

          // holey-no-rotation: catches a holey-board piece placed off its declared orientation.
          if (sku.category === HOLEY_BOARD_CATEGORY) {
            if (
              !approxEq(row.rowLength, sku.length) ||
              !approxEq(column.colWidth, sku.width) ||
              !approxEq(layer.unitHeight, sku.height)
            ) {
              violate(
                "holey-no-rotation",
                `holey board sku ${layer.skuId} placed at ${row.rowLength}x${column.colWidth}x${layer.unitHeight}, declared ${sku.length}x${sku.width}x${sku.height}`,
                ti,
                ri,
                ci
              );
            }
          }
        });
      });
    });

    // totals-consistent (trailer level): catches aggregate fields drifting from their rows.
    const sumUnits = trailer.rows.reduce((s, r) => s + r.totalUnits, 0);
    if (!approxEq(trailer.totalUnits, sumUnits)) {
      violate("totals-consistent", `trailer.totalUnits ${trailer.totalUnits} != sum of row totalUnits ${sumUnits}`, ti);
    }
    const sumWeight = trailer.rows.reduce((s, r) => s + r.totalWeight, 0);
    if (!approxEq(trailer.usedWeight, sumWeight)) {
      violate("totals-consistent", `trailer.usedWeight ${trailer.usedWeight} != sum of row totalWeight ${sumWeight}`, ti);
    }
    const sumStacks = trailer.rows.reduce((s, r) => s + r.columns.length, 0);
    if (trailer.totalStacks !== sumStacks) {
      violate("totals-consistent", `trailer.totalStacks ${trailer.totalStacks} != sum of row column counts ${sumStacks}`, ti);
    }
    const sumMixed = trailer.rows.reduce((s, r) => s + r.columns.filter((c) => c.mixed).length, 0);
    if (trailer.mixedStacks !== sumMixed) {
      violate("totals-consistent", `trailer.mixedStacks ${trailer.mixedStacks} != sum of mixed columns ${sumMixed}`, ti);
    }
    if (!approxEq(trailer.usedLength, summedRowLength)) {
      violate("totals-consistent", `trailer.usedLength ${trailer.usedLength} != sum of row lengths ${summedRowLength}`, ti);
    }
    const sumFloorArea = trailer.rows.reduce(
      (s, r) => s + r.columns.reduce((s2, c) => s2 + c.colWidth * r.rowLength, 0),
      0
    );
    if (!approxEq(trailer.usedFloorArea, sumFloorArea)) {
      violate(
        "totals-consistent",
        `trailer.usedFloorArea ${trailer.usedFloorArea} != sum of column footprints ${sumFloorArea}`,
        ti
      );
    }
  });

  // totals-consistent (plan level): catches the plan-wide rollup drifting from its trailers.
  const planUnits = plan.trailers.reduce((s, t) => s + t.totalUnits, 0);
  if (!approxEq(plan.totalUnits, planUnits)) {
    violate("totals-consistent", `plan.totalUnits ${plan.totalUnits} != sum of trailer totalUnits ${planUnits}`);
  }
  const planWeight = plan.trailers.reduce((s, t) => s + t.usedWeight, 0);
  if (!approxEq(plan.totalWeight, planWeight)) {
    violate("totals-consistent", `plan.totalWeight ${plan.totalWeight} != sum of trailer usedWeight ${planWeight}`);
  }
  const planStacks = plan.trailers.reduce((s, t) => s + t.totalStacks, 0);
  if (plan.totalStacks !== planStacks) {
    violate("totals-consistent", `plan.totalStacks ${plan.totalStacks} != sum of trailer totalStacks ${planStacks}`);
  }
  const planMixed = plan.trailers.reduce((s, t) => s + t.mixedStacks, 0);
  if (plan.mixedStacks !== planMixed) {
    violate("totals-consistent", `plan.mixedStacks ${plan.mixedStacks} != sum of trailer mixedStacks ${planMixed}`);
  }

  // conservation: catches pieces that vanished or were double-counted between placement and the
  // remaining-demand balance — exact integer equality against the requested cart quantities.
  const placedBySku = new Map<string, number>();
  for (const trailer of plan.trailers) {
    for (const row of trailer.rows) {
      for (const column of row.columns) {
        for (const layer of column.layers) {
          placedBySku.set(layer.skuId, (placedBySku.get(layer.skuId) ?? 0) + layer.count);
        }
      }
    }
  }
  const remainingBySku = new Map(plan.balance.map((b) => [b.skuId, b.remaining]));
  const allSkuIds = Array.from(
    new Set<string>([...cart.map((c) => c.skuId), ...Array.from(remainingBySku.keys()), ...Array.from(placedBySku.keys())])
  );
  for (const skuId of allSkuIds) {
    const cartQty = cart.find((c) => c.skuId === skuId)?.qty ?? 0;
    const placed = placedBySku.get(skuId) ?? 0;
    const remaining = remainingBySku.get(skuId) ?? 0;
    if (placed + remaining !== cartQty) {
      violate("conservation", `sku ${skuId}: placed ${placed} + remaining ${remaining} != cart qty ${cartQty}`);
    }
  }

  return violations;
}
