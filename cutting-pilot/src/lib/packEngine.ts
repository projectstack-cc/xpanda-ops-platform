// src/lib/packEngine.ts
// v2 Load Builder packing engine — typed contracts + invariant harness (lb-engine-01), joint
// orientation selection + width pairing + row assembly (lb-engine-02). Pure, dependency-free: no
// React, no Cloudflare bindings, no fetch. Importable from a Node script and from a client
// component alike.
//
// Output shape is rows[] -> columns[] -> layers[], matching legacy exactly, so the diagram,
// customize editor, dissolve, saved loads and bolShared.ts can all consume it unchanged.
// lb-engine-03 (column fill/top-off across multiple SKUs, rear->front ordering, running balance)
// still lands on top of this: lb-engine-02's pack() fills each column with a single SKU, stacked
// to the trailer height by simple division — real height optimisation is lb-engine-03's job.
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

// layers[0] is always the base of the stack; subsequent entries stack upward on top of it
// (top-off — lb-engine-03 is the first to actually populate more than one layer per column;
// lb-engine-02's pack() always emits a single-layer column). topoff-threshold below and
// lb-engine-03's fill logic both depend on this ordering.
export interface PackLayer {
  skuId: string;
  skuName: string;
  skuCode: string;
  color: string;
  unitHeight: number;
  count: number;
  // The orientation this layer is actually placed in. Must be one of the SKU's legal
  // orientations (skuOrientations) and must agree with the column's footprint — see
  // piece-fits-trailer below.
  orientation: Orientation;
}

export interface PackColumn {
  posY: number;
  colWidth: number;
  // Depth of this column along the trailer's length axis. Rows may hold columns of differing
  // depth (a 90.75"-deep column beside a 42.75"-deep one); PackRow.rowLength is the deepest
  // column in the row, and the shortfall behind shallower columns is PackRow.wastedFloorArea.
  colLength: number;
  totalHeight: number;
  totalWeight: number;
  stackCount: number;
  // layers[0] is the base of the stack; subsequent entries stack upward. See the PackLayer note.
  layers: PackLayer[];
  mixed: boolean;
  rationale: string;
}

export interface PackRow {
  posFromFront: number;
  rowLength: number;
  rowWidthUsed: number;
  // sum((rowLength - column.colLength) * column.colWidth) across this row's columns — floor area
  // behind shallower columns that a deeper column forces the row to carry but that isn't used.
  wastedFloorArea: number;
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
  // Advisory only — never rejects a placement. When a layer's unitHeight exceeds
  // stabilityWarnRatio * min(colLength, colWidth), pack() appends a note to that column's
  // rationale and a line to plan.warnings (a tall narrow stack is a loader-rearrange candidate,
  // not a structural violation). Infinity disables the check entirely.
  stabilityWarnRatio: number;
}

export const DEFAULT_PACK_OPTIONS: PackOptions = {
  allowRotation: true,
  topOffMinInchesPerPiece: 3,
  maxSkusPerColumn: 2,
  supportPolicy: "strict",
  trailerLimit: 20,
  stabilityWarnRatio: 3,
};

// --- shared numeric helpers ---

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

// --- orientation ---

// All six axis-aligned permutations of a SKU's (length, width, height). Not deduplicated —
// callers use skuOrientations(), which dedupes and applies rotation policy.
function allPermutations(sku: PackSku): Orientation[] {
  const { length: L, width: W, height: H } = sku;
  return [
    { length: L, width: W, height: H, label: "flat" },
    { length: W, width: L, height: H, label: "flat-rotated" },
    { length: L, width: H, height: W, label: "on-edge" },
    { length: H, width: L, height: W, label: "on-edge-rotated" },
    { length: W, width: H, height: L, label: "on-end" },
    { length: H, width: W, height: L, label: "on-end-rotated" },
  ];
}

function dedupeOrientations(orientations: Orientation[]): Orientation[] {
  const kept: Orientation[] = [];
  for (const o of orientations) {
    const isDup = kept.some(
      (k) => approxEq(k.length, o.length) && approxEq(k.width, o.width) && approxEq(k.height, o.height)
    );
    if (!isDup) kept.push(o);
  }
  return kept;
}

/**
 * Legal orientations for a SKU. Holey board (or `!allowRotation`, engine-wide or per-SKU) is
 * locked to exactly one: its declared L/W/H, identity. Decision (locked): blocks may be tipped
 * or stood on end — otherwise all six axis-aligned permutations are legal, deduplicated so a SKU
 * with two equal dimensions (or a cube) isn't scored as the same shape twice.
 */
export function skuOrientations(sku: PackSku, options: PackOptions): Orientation[] {
  const identity: Orientation = { length: sku.length, width: sku.width, height: sku.height, label: "flat" };
  const isHoley = sku.category === HOLEY_BOARD_CATEGORY;
  const rotationAllowed = !isHoley && options.allowRotation && sku.allowRotation;
  if (!rotationAllowed) return [identity];
  return dedupeOrientations(allPermutations(sku));
}

// --- pack() internals ---

interface Demand {
  sku: PackSku;
  qty: number;
}

// A family is a set of SKUs sharing the same native (length, width) footprint — different
// thicknesses/labels included (B1). Grouping is on the SKU's own declared L/W, before any
// rotation choice.
interface Family {
  length: number;
  width: number;
  members: Demand[];
}

// A family-level orientation choice: only "flat" (native) and "flat-rotated" (length/width
// swapped) are offered, never on-edge/on-end. This isn't a shortcut: a family with more than one
// distinct member height cannot use an orientation that swaps height into the footprint without
// giving each member a different footprint, which dissolves the family the search is trying to
// place as one unit. A family of exactly one member could legally use all six orientations
// (skuOrientations returns them), but the joint search here only ever needs the two that keep
// height untouched — no observed order needs a block stood on end, and doing so would only ever
// look worse under this scorer (a much taller, narrower column). Holey board collapses to one
// option because skuOrientations already locks it to identity.
interface FamilyOrientation {
  length: number;
  width: number;
  label: string;
}

interface ColumnBlueprint {
  colLength: number;
  colWidth: number;
  orientationLabel: string;
  sku: PackSku;
  unitHeight: number;
  perColumnCount: number;
  columnsNeeded: number;
  totalQty: number;
}

interface ColumnInstance {
  blueprint: ColumnBlueprint;
  count: number;
}

interface SimResult {
  trailers: PackTrailer[];
  leftover: Map<string, number>;
  warnings: string[];
}

const COLOR_PALETTE = [
  "#D97706", "#0F766E", "#2563EB", "#7C3AED", "#DC2626", "#059669", "#9333EA", "#0891B2",
  "#CA8A04", "#4F46E5", "#EA580C", "#16A34A", "#0284C7", "#BE123C", "#A21CAF", "#4338CA",
];

function colorForSku(skuId: string): string {
  let hash = 0;
  for (let i = 0; i < skuId.length; i++) hash = (hash * 31 + skuId.charCodeAt(i)) % COLOR_PALETTE.length;
  return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
}

function groupIntoFamilies(demand: Demand[]): Family[] {
  const families: Family[] = [];
  for (const d of demand) {
    const existing = families.find((f) => approxEq(f.length, d.sku.length) && approxEq(f.width, d.sku.width));
    if (existing) existing.members.push(d);
    else families.push({ length: d.sku.length, width: d.sku.width, members: [d] });
  }
  return families;
}

function familyOrientationOptions(fam: Family, opts: PackOptions): FamilyOrientation[] {
  const rep = fam.members[0].sku;
  const isHoley = rep.category === HOLEY_BOARD_CATEGORY;
  const rotationAllowed = !isHoley && opts.allowRotation && fam.members.every((m) => m.sku.allowRotation);
  const flat: FamilyOrientation = { length: fam.length, width: fam.width, label: "flat" };
  if (!rotationAllowed || approxEq(fam.length, fam.width)) return [flat];
  const rotated: FamilyOrientation = { length: fam.width, width: fam.length, label: "flat-rotated" };
  return [flat, rotated];
}

// Builds one column-type per (family, member SKU) under the family's chosen orientation. A
// member that can never stack even once (height alone exceeds the trailer, or weight alone
// exceeds maxWeight) is reported to `leftover`/`warnings` and produces no blueprint.
function buildBlueprints(
  families: Family[],
  chosen: FamilyOrientation[],
  dims: Dimensions,
  warnings: string[],
  leftover: Map<string, number>
): ColumnBlueprint[] {
  const blueprints: ColumnBlueprint[] = [];
  families.forEach((fam, i) => {
    const orient = chosen[i];
    if (!approxLte(orient.length, dims.length) || !approxLte(orient.width, dims.width)) {
      for (const member of fam.members) {
        warnings.push(
          `sku ${member.sku.id}: chosen footprint ${orient.length}x${orient.width} exceeds trailer ${dims.length}x${dims.width} — ${member.qty} unplaced`
        );
        leftover.set(member.sku.id, (leftover.get(member.sku.id) ?? 0) + member.qty);
      }
      return;
    }
    for (const member of fam.members) {
      const unitHeight = member.sku.height;
      const heightCount = Math.floor(dims.height / unitHeight);
      const weightCount = member.sku.weight > 0 ? Math.floor(dims.maxWeight / member.sku.weight) : Infinity;
      const perColumnCount = Math.min(heightCount, weightCount);
      if (perColumnCount < 1) {
        warnings.push(
          `sku ${member.sku.id}: cannot stack even one unit (height ${unitHeight} vs trailer height ${dims.height}, weight ${member.sku.weight} vs maxWeight ${dims.maxWeight}) — ${member.qty} unplaced`
        );
        leftover.set(member.sku.id, (leftover.get(member.sku.id) ?? 0) + member.qty);
        continue;
      }
      blueprints.push({
        colLength: orient.length,
        colWidth: orient.width,
        orientationLabel: orient.label,
        sku: member.sku,
        unitHeight,
        perColumnCount,
        columnsNeeded: Math.ceil(member.qty / perColumnCount),
        totalQty: member.qty,
      });
    }
  });
  return blueprints;
}

function expandInstances(blueprints: ColumnBlueprint[]): ColumnInstance[] {
  const instances: ColumnInstance[] = [];
  for (const bp of blueprints) {
    let remaining = bp.totalQty;
    for (let i = 0; i < bp.columnsNeeded && remaining > 0; i++) {
      const count = Math.min(bp.perColumnCount, remaining);
      instances.push({ blueprint: bp, count });
      remaining -= count;
    }
  }
  return instances;
}

function buildColumn(inst: ColumnInstance, posY: number): PackColumn {
  const bp = inst.blueprint;
  const orientation: Orientation = {
    length: bp.colLength,
    width: bp.colWidth,
    height: bp.unitHeight,
    label: bp.orientationLabel,
  };
  const layer: PackLayer = {
    skuId: bp.sku.id,
    skuName: bp.sku.name,
    skuCode: bp.sku.sku,
    color: colorForSku(bp.sku.id),
    unitHeight: bp.unitHeight,
    count: inst.count,
    orientation,
  };
  return {
    posY,
    colWidth: bp.colWidth,
    colLength: bp.colLength,
    totalHeight: bp.unitHeight * inst.count,
    totalWeight: inst.count * bp.sku.weight,
    stackCount: inst.count,
    layers: [layer],
    mixed: false,
    rationale: "lb-engine-02: provisional single-SKU fill, height optimisation pending lb-engine-03",
  };
}

// Greedy width bin-pack for one row: sort remaining column instances by width descending and take
// each that still fits the row's remaining width AND the trailer's remaining weight budget AND
// whose own depth fits the trailer's remaining length. This reproduces both reference shapes:
// holey board tiles 4 identical 24"-wide columns into a 98"-wide row; INV_4202's 42.75"+54.75"
// pairing falls out because both are the largest widths left and together they're the closest
// sum to 98" without exceeding it.
function buildOneRow(
  instances: ColumnInstance[],
  dims: Dimensions,
  weightBudget: number,
  lengthBudget: number
): { row: PackRow | null; chosen: ColumnInstance[] } {
  const sorted = [...instances].sort((a, b) => b.blueprint.colWidth - a.blueprint.colWidth);
  const chosen: ColumnInstance[] = [];
  let widthLeft = dims.width;
  let weightLeft = weightBudget;
  for (const inst of sorted) {
    if (inst.blueprint.colLength > lengthBudget + EPS) continue;
    const w = inst.blueprint.colWidth;
    const wt = inst.count * inst.blueprint.sku.weight;
    if (w <= widthLeft + EPS && wt <= weightLeft + EPS) {
      chosen.push(inst);
      widthLeft -= w;
      weightLeft -= wt;
    }
  }
  if (chosen.length === 0) return { row: null, chosen: [] };

  let posY = 0;
  const columns = chosen.map((inst) => {
    const col = buildColumn(inst, posY);
    posY += col.colWidth;
    return col;
  });
  const rowLength = Math.max(...columns.map((c) => c.colLength));
  const wastedFloorArea = columns.reduce((s, c) => s + (rowLength - c.colLength) * c.colWidth, 0);
  const row: PackRow = {
    posFromFront: 0, // filled in by buildTrailer once the row's position in the trailer is known
    rowLength,
    rowWidthUsed: posY,
    wastedFloorArea,
    columns,
    totalUnits: columns.reduce((s, c) => s + c.stackCount, 0),
    totalWeight: columns.reduce((s, c) => s + c.totalWeight, 0),
  };
  return { row, chosen };
}

function buildTrailer(rows: PackRow[], dims: Dimensions): PackTrailer {
  let runningLength = 0;
  for (const row of rows) {
    row.posFromFront = runningLength;
    runningLength += row.rowLength;
  }
  const usedWeight = rows.reduce((s, r) => s + r.totalWeight, 0);
  const totalUnits = rows.reduce((s, r) => s + r.totalUnits, 0);
  const totalStacks = rows.reduce((s, r) => s + r.columns.length, 0);
  const mixedStacks = rows.reduce((s, r) => s + r.columns.filter((c) => c.mixed).length, 0);
  const usedFloorArea = rows.reduce((s, r) => s + r.columns.reduce((s2, c) => s2 + c.colWidth * r.rowLength, 0), 0);
  const widthUtilization = rows.length > 0 ? rows.reduce((s, r) => s + r.rowWidthUsed / dims.width, 0) / rows.length : 0;
  const allHeights = rows.flatMap((r) => r.columns.map((c) => c.totalHeight));
  const heightUtilization =
    allHeights.length > 0 ? allHeights.reduce((s, h) => s + h, 0) / allHeights.length / dims.height : 0;
  return {
    dims,
    rows,
    usedLength: runningLength,
    usedFloorArea,
    usedWeight,
    totalStacks,
    totalUnits,
    mixedStacks,
    widthUtilization,
    heightUtilization,
  };
}

// Assembles rows into trailers for one chosen family-orientation combination. Pure: does not
// touch any accumulator outside its own return value, so it's safe to call once per candidate
// combination during the search and simply discard all but the winner's result.
function simulate(families: Family[], chosen: FamilyOrientation[], dims: Dimensions, opts: PackOptions): SimResult {
  const warnings: string[] = [];
  const leftover = new Map<string, number>();
  const blueprints = buildBlueprints(families, chosen, dims, warnings, leftover);
  let instances = expandInstances(blueprints);
  const trailers: PackTrailer[] = [];
  const trailerLimit = opts.trailerLimit ?? Infinity;

  while (instances.length > 0 && trailers.length < trailerLimit) {
    const rows: PackRow[] = [];
    let lengthLeft = dims.length;
    let weightLeft = dims.maxWeight;
    let progressed = false;

    while (instances.length > 0 && lengthLeft > EPS) {
      const { row, chosen: used } = buildOneRow(instances, dims, weightLeft, lengthLeft);
      if (!row) break;
      rows.push(row);
      lengthLeft -= row.rowLength;
      weightLeft -= row.totalWeight;
      instances = instances.filter((inst) => !used.includes(inst));
      progressed = true;
    }

    if (!progressed) {
      for (const inst of instances) {
        leftover.set(inst.blueprint.sku.id, (leftover.get(inst.blueprint.sku.id) ?? 0) + inst.count);
      }
      warnings.push(`unable to place remaining ${instances.length} column(s) on any trailer — moved to balance`);
      instances = [];
      break;
    }

    trailers.push(buildTrailer(rows, dims));
  }

  if (instances.length > 0) {
    for (const inst of instances) {
      leftover.set(inst.blueprint.sku.id, (leftover.get(inst.blueprint.sku.id) ?? 0) + inst.count);
    }
    warnings.push(`trailerLimit (${trailerLimit}) reached with ${instances.length} column(s) unplaced`);
  }

  return { trailers, leftover, warnings };
}

// Score, lower-is-better lexicographically: fewest trailers; then highest average row width
// utilization (negated so "lower" still means "better"); then least wasted depth; then fewest
// distinct orientation labels in play (operator predictability).
function scoreResult(result: SimResult, labels: string[]): [number, number, number, number] {
  const trailerCount = result.trailers.length;
  let widthUtilSum = 0;
  let rowCount = 0;
  let wasteSum = 0;
  for (const t of result.trailers) {
    for (const r of t.rows) {
      widthUtilSum += r.rowWidthUsed / t.dims.width;
      rowCount += 1;
      wasteSum += r.wastedFloorArea;
    }
  }
  const avgWidthUtil = rowCount > 0 ? widthUtilSum / rowCount : 0;
  const distinctOrientations = new Set(labels).size;
  return [trailerCount, -avgWidthUtil, wasteSum, distinctOrientations];
}

function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// Mixed-radix enumeration of every combination of one choice per family — safe to materialize in
// full because callers only invoke it under the 20,000-combination guard.
function enumerateCombos<T>(optionsPerFamily: T[][]): T[][] {
  const total = optionsPerFamily.reduce((p, o) => p * o.length, 1);
  const combos: T[][] = [];
  const indices = new Array(optionsPerFamily.length).fill(0);
  for (let n = 0; n < total; n++) {
    combos.push(indices.map((idx, i) => optionsPerFamily[i][idx]));
    for (let i = 0; i < indices.length; i++) {
      indices[i]++;
      if (indices[i] < optionsPerFamily[i].length) break;
      indices[i] = 0;
    }
  }
  return combos;
}

function bestCombo(
  families: Family[],
  familyOptions: FamilyOrientation[][],
  dims: Dimensions,
  opts: PackOptions
): { chosen: FamilyOrientation[]; result: SimResult } {
  const combos = enumerateCombos(familyOptions);
  let best: { chosen: FamilyOrientation[]; result: SimResult; score: number[] } | null = null;
  for (const combo of combos) {
    const result = simulate(families, combo, dims, opts);
    const score = scoreResult(
      result,
      combo.map((c) => c.label)
    );
    if (!best || compareScores(score, best.score) < 0) {
      best = { chosen: combo, result, score };
    }
  }
  // combos is non-empty whenever families is non-empty (every family has >= 1 option), so best
  // is always assigned when this is called.
  return best as { chosen: FamilyOrientation[]; result: SimResult };
}

// Largest-family-first greedy, used only when the exhaustive search space exceeds the guard.
// Processes families by descending total qty; each subsequent family prefers whichever of its
// own orientation options matches the length already established by an earlier, larger family,
// so pairing opportunities aren't lost just because the search itself was truncated.
function greedyCombo(families: Family[], familyOptions: FamilyOrientation[][]): FamilyOrientation[] {
  const order = families
    .map((f, i) => ({ i, qty: f.members.reduce((s, m) => s + m.qty, 0) }))
    .sort((a, b) => b.qty - a.qty);
  const chosen: FamilyOrientation[] = new Array(families.length);
  let preferredLength: number | null = null;
  for (const { i } of order) {
    const options = familyOptions[i];
    const match: FamilyOrientation | undefined =
      preferredLength !== null ? options.find((o) => approxEq(o.length, preferredLength as number)) : undefined;
    const pick: FamilyOrientation = match ?? options[0];
    chosen[i] = pick;
    if (preferredLength === null) preferredLength = pick.length;
  }
  return chosen;
}

function applyStabilityWarnings(trailers: PackTrailer[], opts: PackOptions, warnings: string[]): void {
  if (!Number.isFinite(opts.stabilityWarnRatio)) return;
  trailers.forEach((trailer, ti) => {
    trailer.rows.forEach((row, ri) => {
      row.columns.forEach((column, ci) => {
        const footprint = Math.min(column.colLength, column.colWidth);
        if (footprint <= 0) return;
        for (const layer of column.layers) {
          if (layer.unitHeight > opts.stabilityWarnRatio * footprint + EPS) {
            const note = `stability: sku ${layer.skuId} unitHeight ${layer.unitHeight} exceeds ${opts.stabilityWarnRatio}x its footprint (${footprint}) — loader may want to rearrange`;
            column.rationale = `${column.rationale} [${note}]`;
            warnings.push(`trailer ${ti} row ${ri} column ${ci}: ${note}`);
          }
        }
      });
    });
  });
}

const COMBO_GUARD = 20000;

/**
 * Packs `cart` demand (against the `skus` catalog) into trailers of `dims`. Implements joint
 * orientation selection, width pairing and row assembly (lb-engine-02). Column height fill is a
 * simple single-SKU division for now; real top-off, rear->front ordering and running balance land
 * in lb-engine-03.
 */
export function pack(cart: CartLine[], skus: PackSku[], dims: Dimensions, options?: Partial<PackOptions>): PackPlan {
  const opts: PackOptions = { ...DEFAULT_PACK_OPTIONS, ...options };
  const warnings: string[] = [];
  const skuById = new Map(skus.map((s) => [s.id, s]));
  const balanceMap = new Map<string, number>();

  const demand: Demand[] = [];
  for (const line of cart) {
    if (line.qty <= 0) continue;
    const sku = skuById.get(line.skuId);
    if (!sku) {
      warnings.push(`sku ${line.skuId} not found in catalog — ${line.qty} unplaced`);
      balanceMap.set(line.skuId, (balanceMap.get(line.skuId) ?? 0) + line.qty);
      continue;
    }
    demand.push({ sku, qty: line.qty });
  }

  const placeable: Demand[] = [];
  for (const d of demand) {
    const canFit = skuOrientations(d.sku, opts).some(
      (o) => approxLte(o.length, dims.length) && approxLte(o.width, dims.width) && approxLte(o.height, dims.height)
    );
    if (!canFit) {
      warnings.push(
        `sku ${d.sku.id} (${d.sku.length}x${d.sku.width}x${d.sku.height}) does not fit trailer ${dims.length}x${dims.width}x${dims.height} in any legal orientation — ${d.qty} unplaced`
      );
      balanceMap.set(d.sku.id, (balanceMap.get(d.sku.id) ?? 0) + d.qty);
      continue;
    }
    placeable.push(d);
  }

  const families = groupIntoFamilies(placeable);
  const familyOptions = families.map((f) => familyOrientationOptions(f, opts));

  let simResult: SimResult;
  if (families.length === 0) {
    simResult = { trailers: [], leftover: new Map(), warnings: [] };
  } else {
    const comboCount = familyOptions.reduce((p, o) => p * o.length, 1);
    if (comboCount <= COMBO_GUARD) {
      simResult = bestCombo(families, familyOptions, dims, opts).result;
    } else {
      warnings.push(
        `orientation search space (${comboCount}) exceeds guard (${COMBO_GUARD}) — using greedy largest-family-first fallback`
      );
      simResult = simulate(families, greedyCombo(families, familyOptions), dims, opts);
    }
  }

  applyStabilityWarnings(simResult.trailers, opts, simResult.warnings);

  for (const [skuId, qty] of Array.from(simResult.leftover.entries())) {
    balanceMap.set(skuId, (balanceMap.get(skuId) ?? 0) + qty);
  }
  warnings.push(...simResult.warnings);

  const trailers = simResult.trailers;
  const balance: PackBalance = Array.from(balanceMap.entries())
    .filter(([, qty]) => qty > 0)
    .map(([skuId, remaining]) => ({ skuId, remaining }));

  return {
    trailers,
    balance,
    warnings,
    totalWeight: trailers.reduce((s, t) => s + t.usedWeight, 0),
    totalUnits: trailers.reduce((s, t) => s + t.totalUnits, 0),
    totalStacks: trailers.reduce((s, t) => s + t.totalStacks, 0),
    mixedStacks: trailers.reduce((s, t) => s + t.mixedStacks, 0),
  };
}

// --- validatePlan() ---

export interface PackViolation {
  rule: string;
  detail: string;
  trailerIndex?: number;
  rowIndex?: number;
  columnIndex?: number;
}

/**
 * Checks a PackPlan against all invariants. Fully implemented. Returns one PackViolation per
 * failure found; an empty array means the plan is structurally sound (does not mean the algorithm
 * that produced it was optimal).
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

        // trailer-length (companion, A1): a column can never be deeper than the row it sits in —
        // rowLength is defined as the deepest column, so this is a shape invariant, not just a
        // capacity one. Catches a row whose rowLength wasn't actually set to max(colLength).
        if (!approxLte(column.colLength, row.rowLength)) {
          violate(
            "trailer-length",
            `column colLength ${column.colLength} exceeds row rowLength ${row.rowLength}`,
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
        // (single colWidth/colLength pair for however many layers stack on it) — this asserts
        // that footprint actually has positive area, i.e. something is really sitting on it.
        if (column.layers.length > 0 && (column.colWidth <= 0 || column.colLength <= 0)) {
          violate(
            "strict-support",
            `column footprint has non-positive area (colWidth=${column.colWidth}, colLength=${column.colLength})`,
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
        // every non-base layer (layers[0] is the base — see the PackLayer note) in a mixed column
        // must gain at least topOffMinInchesPerPiece.
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
            violate("sku-unplaceable", `sku ${layer.skuId} not found in skus[]`, ti, ri, ci);
            return;
          }

          const legalOrientations = skuOrientations(sku, options);

          // sku-unplaceable: catches a SKU that can never ship — no legal orientation fits the
          // trailer envelope at all, independent of where (or how) it was actually placed.
          const canEverFit = legalOrientations.some(
            (o) => approxLte(o.length, dims.length) && approxLte(o.width, dims.width) && approxLte(o.height, dims.height)
          );
          if (!canEverFit) {
            violate(
              "sku-unplaceable",
              `sku ${layer.skuId} (${sku.length}x${sku.width}x${sku.height}) does not fit trailer ${dims.length}x${dims.width}x${dims.height} in any legal orientation`,
              ti,
              ri,
              ci
            );
          }

          // piece-fits-trailer: catches a layer whose declared orientation isn't actually legal
          // for this SKU, OR disagrees with where it's placed (column footprint / unitHeight), OR
          // — even though legal and self-consistent — doesn't fit within this specific trailer.
          // This is the real per-placement check; sku-unplaceable above only asks "could some
          // orientation have worked," which a piece placed illegally could pass vacuously.
          const isLegalOrientation = legalOrientations.some(
            (o) =>
              approxEq(o.length, layer.orientation.length) &&
              approxEq(o.width, layer.orientation.width) &&
              approxEq(o.height, layer.orientation.height)
          );
          const matchesPlacement =
            approxEq(layer.orientation.length, column.colLength) &&
            approxEq(layer.orientation.width, column.colWidth) &&
            approxEq(layer.orientation.height, layer.unitHeight);
          const withinTrailer =
            approxLte(layer.orientation.length, dims.length) &&
            approxLte(layer.orientation.width, dims.width) &&
            approxLte(layer.orientation.height, dims.height);
          if (!isLegalOrientation || !matchesPlacement || !withinTrailer) {
            violate(
              "piece-fits-trailer",
              `sku ${layer.skuId} orientation ${JSON.stringify(layer.orientation)} vs column ${column.colLength}x${column.colWidth} unitHeight ${layer.unitHeight} (legal=${isLegalOrientation}, matchesPlacement=${matchesPlacement}, withinTrailer=${withinTrailer})`,
              ti,
              ri,
              ci
            );
          }

          // holey-no-rotation: catches a holey-board piece placed off its declared orientation.
          // Compares against column.colLength, NOT row.rowLength — rows may now be mixed-depth
          // (A1), so rowLength can legitimately exceed this column's own depth even when the
          // holey column itself is placed correctly.
          if (sku.category === HOLEY_BOARD_CATEGORY) {
            if (
              !approxEq(column.colLength, sku.length) ||
              !approxEq(column.colWidth, sku.width) ||
              !approxEq(layer.unitHeight, sku.height)
            ) {
              violate(
                "holey-no-rotation",
                `holey board sku ${layer.skuId} placed at ${column.colLength}x${column.colWidth}x${layer.unitHeight}, declared ${sku.length}x${sku.width}x${sku.height}`,
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
