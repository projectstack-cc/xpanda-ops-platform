// src/lib/packEngine.ts
// v2 Load Builder packing engine — typed contracts + invariant harness (lb-engine-01), joint
// orientation selection + width pairing + row assembly (lb-engine-02), multi-SKU column fill with
// K top-off, rear->front ordering and running balance (lb-engine-03, completes pack()). Pure,
// dependency-free: no React, no Cloudflare bindings, no fetch. Importable from a Node script and
// from a client component alike.
//
// Output shape is rows[] -> columns[] -> layers[], matching legacy exactly, so the diagram,
// customize editor, dissolve, saved loads and bolShared.ts can all consume it unchanged.
//
// posFromFront = 0 is the REAR of the trailer (locked decision, do not re-litigate). Rows are
// ordered thinnest-base first at the rear, thickest toward the nose (lb-engine-03 B3's open
// question, resolved by Steve 2026-09-16, row-order-nose-first: the floor crew loads nose-first,
// biggest sizes go in first — so the thickest freight sits at the nose, loaded first/unloaded
// last, and the thinnest sits at the rear where the doors are, loaded last/unloaded first). Was
// thickest-at-the-rear until this fix — see CHANGELOG.md for the prior (wrong) assumption.
// Support policy is strict-only for now: every piece sits on a single matching footprint (no
// bridging) — supportPolicy is reserved on PackOptions but only "strict" is implemented.
// Mode A (holey board) and Mode B (blocks) are one engine, differing by allowRotation; holey
// board never rotates (see HOLEY_BOARD_CATEGORY / holey-no-rotation below).
// Weight is a hard guard, never an objective. Every column carries a human-readable `rationale` —
// a required trust feature, not decoration.

import { planStacks, planStacksWithin, type PlannedStack, type PlannerBudget, type PlannerSku } from "./stackPlanner";

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

// lbr-rot-01: the largest envelope any trailer offers — max length, max width and max height across
// TRAILER_TYPES, taken independently. A piece whose identity exceeds it can't ship as entered on any
// trailer, so skuOrientations treats it as rotatable regardless of its allowRotation flag.
export const MAX_TRAILER_ENVELOPE: Pick<Dimensions, "length" | "width" | "height"> = {
  length: Math.max(...Object.values(TRAILER_TYPES).map((t) => t.length)),
  width: Math.max(...Object.values(TRAILER_TYPES).map((t) => t.width)),
  height: Math.max(...Object.values(TRAILER_TYPES).map((t) => t.height)),
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
// (top-off — lb-engine-03's buildFamilyColumns is what actually populates more than one layer per
// column now). topoff-threshold below and buildFamilyColumns both depend on this ordering.
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
  // lbr-03: the planner's stack kind — "full" (a full-height pure stack, possibly topped off) or
  // "partial" (a size's leftover, or a full stack shortened to save a trailer). Set on every column
  // pack() builds; optional so saved loads and editor-built columns stay valid without it.
  stackKind?: "full" | "partial";
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
  // lbr-10: set (true) only by forcedPack.ts's packForced on a trailer from the planner's Force sizes
  // queue — a display flag for the "Forced · {type}" badge. Type-only; nothing in this file reads it.
  forced?: true;
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
  // lbr-03: what consolidation (mixing to save a trailer) did. Always set by pack(); optional on the
  // type so hand-built plans (saved loads, the customize editor, fixtures) stay valid.
  consolidation?: PackConsolidation;
}

export interface PackConsolidation {
  applied: boolean;
  pureTrailers: number; // trailers the all-pure plan needs
  trailers: number;
  topOffStacks: number;
  shortenedStacks: number;
  // e.g. "Mixed 30 stacks to fit on 1 truck instead of 2 (1 stack shortened)"; null when not applied.
  note: string | null;
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
  // lb-ui-12: when true, pack() checks whether the LAST trailer's already-placed demand would
  // also fit a "26ft Box Truck" and, if so, repacks just that trailer against box-truck dims — see
  // pack()'s own comment at the call site for the full acceptance contract. Defaults to false
  // (below) rather than legacy's `true`: flipping this on changes trailer.dims for real plans,
  // including every saved load that regenerates via pack() with editedPlan: null on reload — the
  // caller (LoadPlanView's own toggle state) opts in explicitly instead of the engine changing
  // behavior for every existing consumer the moment this field was added.
  autoDownsize?: boolean;
  // lb-ui-12: a display label stamped onto every trailer this pack() call produces (PackTrailer.type)
  // — NOT read by the engine itself for any geometry/placement decision, purely a UI convenience so
  // "what type is trailer N" never needs a `trailer.type ?? primaryTrailerTypeKey` fallback (the
  // field is either populated on every trailer from a given call, or the caller omitted it and it's
  // absent on all of them — never populated on some and not others). The auto-downsize repack above
  // passes "26ft Box Truck" here on its own recursive pack() call so the one repacked trailer is
  // labeled correctly.
  trailerTypeLabel?: string;
  // lbr-03: mix (top off) only to save a trailer — Steve's 2026-10-12 rules. false gives the
  // all-pure plan (lbr-05's "pure plan" toggle). maxSkusPerColumn < 2 also disables it.
  consolidate?: boolean;
}

export const DEFAULT_PACK_OPTIONS: PackOptions = {
  allowRotation: true,
  topOffMinInchesPerPiece: 3,
  maxSkusPerColumn: 2,
  supportPolicy: "strict",
  trailerLimit: 20,
  stabilityWarnRatio: 3,
  autoDownsize: false,
  consolidate: true,
};

// --- shared numeric helpers ---

const EPS = 1e-6;

function approxLte(a: number, b: number, eps = EPS): boolean {
  return a <= b + eps;
}

function fitsEnvelope(o: { length: number; width: number; height: number }, env: { length: number; width: number; height: number }): boolean {
  return approxLte(o.length, env.length) && approxLte(o.width, env.width) && approxLte(o.height, env.height);
}

function approxGte(a: number, b: number, eps = EPS): boolean {
  return a >= b - eps;
}

function approxEq(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

// --- runner height / effective column budget ---

// A runner is a raised strip (wood or steel) the trailer floor rides on; freight stacks on top of
// the runners, not the bare floor, so the vertical space a column can actually use is the
// trailer's nominal height minus the runner height, not the nominal height itself. A runnerHeight
// that is negative, non-finite, or >= the trailer height can't produce a usable budget, so it is
// clamped to 0 (no runner) and reported via `warnings` rather than silently producing a zero or
// negative vertical budget.
function resolveEffectiveHeight(
  dims: Dimensions,
  options: PackOptions,
  warnings: string[]
): { effectiveHeight: number; runnerHeight: number } {
  let runnerHeight = options.runnerHeight ?? 0;
  if (!Number.isFinite(runnerHeight) || runnerHeight < 0 || runnerHeight >= dims.height) {
    warnings.push(
      `runnerHeight ${runnerHeight} is invalid (must be finite, >= 0, and less than trailer height ${dims.height}) — clamped to 0`
    );
    runnerHeight = 0;
  }
  return { effectiveHeight: dims.height - runnerHeight, runnerHeight };
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
 * Exception (lbr-rot-01): a non-Holey SKU whose identity exceeds MAX_TRAILER_ENVELOPE gets all
 * permutations even when the flag (SKU or engine-wide) says no. Identity always stays first.
 */
export function skuOrientations(sku: PackSku, options: PackOptions): Orientation[] {
  const identity: Orientation = { length: sku.length, width: sku.width, height: sku.height, label: "flat" };
  const isHoley = sku.category === HOLEY_BOARD_CATEGORY;
  if (isHoley) return [identity];
  // lbr-rot-01: a part that can't fit any trailer as entered is rotatable regardless of its flag
  // (legacy rotates every non-Holey part; Steve 2026-10-15). Parts that fit as entered keep the flag.
  const fitsAsEntered = fitsEnvelope(identity, MAX_TRAILER_ENVELOPE);
  const rotationAllowed = !fitsAsEntered || (options.allowRotation && sku.allowRotation);
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

// A family-level orientation choice. A family of 2+ members offers only "flat" (native) and
// "flat-rotated" (length/width swapped), never on-edge/on-end: a family with more than one
// distinct member height cannot use an orientation that swaps height into the footprint without
// giving each member a different footprint, which dissolves the family the search is trying to
// place as one unit. A family of exactly one member has no such constraint — it may legally use
// all six orientations (lb-engine-03 A1; skuOrientations already computes exactly this set, so
// familyOrientationOptions defers to it for the single-member case), which is precisely how odd
// one-off pieces tip to squeeze into leftover floor. `height` carries the orientation's own height
// contribution — for a tipped single-member family this is NOT the same as the member SKU's
// declared height, so buildFamilyColumns must read unitHeight from here rather than from
// member.sku.height directly. For a 2+ member family, "flat"/"flat-rotated" never tip height, so
// `height` here is only representative (the first member's); each member keeps its own height.
// Holey board collapses to one option because skuOrientations already locks it to identity.
interface FamilyOrientation {
  length: number;
  width: number;
  height: number;
  label: string;
}

// One fully-resolved physical column, produced by buildFamilyColumns (lb-engine-03 B1). Unlike
// lb-engine-02's ColumnBlueprint (one SKU, replicated into uniform ColumnInstances), a ColumnPlan
// already carries its final layer composition — base first, optional single top-off second — so
// no separate "instance" wrapper/count is needed; each ColumnPlan IS one column.
interface ColumnPlan {
  colLength: number;
  colWidth: number;
  orientationLabel: string;
  layers: { sku: PackSku; unitHeight: number; count: number }[];
  totalHeight: number;
  totalWeight: number;
  rationale: string;
  // lbr-03: which family (index into simulate()'s families) built this column — consolidation counts
  // each family's columns on the last trailer by it — and the planner's stack kind.
  familyIndex: number;
  stackKind: "full" | "partial";
}

interface SimResult {
  trailers: PackTrailer[];
  leftover: Map<string, number>;
  warnings: string[];
  consolidation: PackConsolidation;
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

/**
 * Legal family-level orientation choices (lb-engine-03 A1). A single-member family defers
 * entirely to skuOrientations — up to all six axis-aligned permutations, already deduplicated and
 * already gated on holey/allowRotation — since with only one member there's no risk of a tipped
 * orientation giving different members different footprints. A 2+ member family keeps the
 * lb-engine-02 restriction: only "flat" and "flat-rotated", gated on every member allowing
 * rotation (and holey, which never rotates regardless).
 */
export function familyOrientationOptions(fam: Family, opts: PackOptions): FamilyOrientation[] {
  const rep = fam.members[0].sku;
  if (fam.members.length === 1) {
    return skuOrientations(rep, opts).map((o) => ({ length: o.length, width: o.width, height: o.height, label: o.label }));
  }
  const isHoley = rep.category === HOLEY_BOARD_CATEGORY;
  // lbr-rot-01: a member counts as rotatable if its flag allows it or it can't fit any trailer as entered.
  const rotationAllowed =
    !isHoley &&
    fam.members.every((m) => !fitsEnvelope(m.sku, MAX_TRAILER_ENVELOPE) || (opts.allowRotation && m.sku.allowRotation));
  const flat: FamilyOrientation = { length: fam.length, width: fam.width, height: rep.height, label: "flat" };
  if (!rotationAllowed || approxEq(fam.length, fam.width)) return [flat];
  const rotated: FamilyOrientation = { length: fam.width, width: fam.length, height: rep.height, label: "flat-rotated" };
  return [flat, rotated];
}

function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

// Builds one family's columns with the stack planner (stackPlanner.ts, lbr-03). A member that can
// never stack even once (height alone exceeds the trailer, or weight alone exceeds maxWeight) is
// reported to `leftover`/`warnings` up front and excluded from the pool, as before.
//
// Steve's final loading rules (2026-10-12) replace both earlier fill strategies here:
//   - holey-sequential-fill (2026-09-16): Holey Board chained descending thicknesses into EVERY
//     column ("top off every column") — retired.
//   - lb-engine-03 B1's exact-fill block search (2026-09): Blocks tried every (base, top-off) pair
//     per column, shortening the base to hunt an exact 109" — retired.
// Now every family, Holey Board and Blocks alike, starts from the PURE plan: full-height pure
// stacks of each size plus at most one leftover stack, thickest first (planStacks with
// consolidate:false). Mixing happens only in simulate()'s consolidation pass, and only when it
// saves a trailer; the returned toColumns() converts that pass's re-planned stacks the same way.
// K (topOffMinInchesPerPiece) is passed through as the planner's minTopOffHeight, so a sub-K SKU is
// never a top-off.
interface FamilyBuild {
  columns: ColumnPlan[];
  // The family's planner input (remaining demand per member, weight cap as maxPerStack) — what
  // consolidation re-plans with planStacksWithin. Empty when nothing in the family can stack.
  skus: PlannerSku[];
  toColumns: (stacks: PlannedStack[]) => ColumnPlan[];
}

function buildFamilyColumns(
  fam: Family,
  familyIndex: number,
  orient: FamilyOrientation,
  dims: Dimensions,
  effectiveHeight: number,
  opts: PackOptions,
  warnings: string[],
  leftover: Map<string, number>
): FamilyBuild {
  const runnerHeight = dims.height - effectiveHeight;
  const empty: FamilyBuild = { columns: [], skus: [], toColumns: () => [] };
  if (!approxLte(orient.length, dims.length) || !approxLte(orient.width, dims.width)) {
    for (const member of fam.members) {
      warnings.push(
        `sku ${member.sku.id}: chosen footprint ${orient.length}x${orient.width} exceeds trailer ${dims.length}x${dims.width} — ${member.qty} unplaced`
      );
      leftover.set(member.sku.id, (leftover.get(member.sku.id) ?? 0) + member.qty);
    }
    return empty;
  }

  interface PoolMember {
    sku: PackSku;
    unitHeight: number;
    remaining: number;
    weightCap: number;
  }
  const pool: PoolMember[] = [];
  for (const member of fam.members) {
    const unitHeight = fam.members.length === 1 ? orient.height : member.sku.height;
    const heightCount = Math.floor(effectiveHeight / unitHeight);
    const weightCap = member.sku.weight > 0 ? Math.floor(dims.maxWeight / member.sku.weight) : Infinity;
    if (heightCount < 1 || weightCap < 1) {
      warnings.push(
        `sku ${member.sku.id}: cannot stack even one unit (height ${unitHeight} vs effective height ${effectiveHeight}${runnerHeight > EPS ? ` [trailer ${dims.height} − runner ${runnerHeight}]` : ""}, weight ${member.sku.weight} vs maxWeight ${dims.maxWeight}) — ${member.qty} unplaced`
      );
      leftover.set(member.sku.id, (leftover.get(member.sku.id) ?? 0) + member.qty);
      continue;
    }
    pool.push({ sku: member.sku, unitHeight, remaining: member.qty, weightCap });
  }
  if (pool.length === 0) return empty;

  const K = opts.topOffMinInchesPerPiece;
  const byId = new Map(pool.map((m) => [m.sku.id, m]));
  const skus: PlannerSku[] = pool.map((m) => ({
    skuId: m.sku.id,
    unitHeight: m.unitHeight,
    qty: m.remaining,
    maxPerStack: Number.isFinite(m.weightCap) ? m.weightCap : undefined,
  }));

  const toColumns = (stacks: PlannedStack[]): ColumnPlan[] =>
    stacks.map((st) => {
      const base = byId.get(st.base.skuId) as PoolMember;
      const layers: ColumnPlan["layers"] = [{ sku: base.sku, unitHeight: base.unitHeight, count: st.base.count }];
      const baseH = st.base.count * base.unitHeight;
      let totalHeight = baseH;
      let rationale: string;
      if (st.top) {
        const top = byId.get(st.top.skuId) as PoolMember;
        layers.push({ sku: top.sku, unitHeight: top.unitHeight, count: st.top.count });
        totalHeight += st.top.count * top.unitHeight;
        rationale = `${st.base.count} × ${fmt(base.unitHeight)}" + ${st.top.count} × ${fmt(top.unitHeight)}" = ${fmt(totalHeight)}" — topped off to save a truck`;
      } else if (st.kind === "partial") {
        rationale = `leftover: ${st.base.count} × ${fmt(base.unitHeight)}" = ${fmt(baseH)}"`;
      } else {
        const gap = effectiveHeight - baseH;
        rationale = gap <= EPS ? `${st.base.count} × ${fmt(base.unitHeight)}" = ${fmt(baseH)}" exact` : `${st.base.count} × ${fmt(base.unitHeight)}" = ${fmt(baseH)}", ${fmt(gap)}" left`;
      }
      // With a runner in play, "exact"/"left" only means something against the effective height —
      // surface the usable height and the runner deduction (unchanged from lb-engine-04 A3).
      if (runnerHeight > EPS) {
        rationale += ` — ${fmt(effectiveHeight)}" usable (${fmt(dims.height)}" trailer − ${fmt(runnerHeight)}" runner)`;
      }
      return {
        colLength: orient.length,
        colWidth: orient.width,
        orientationLabel: orient.label,
        layers,
        totalHeight,
        totalWeight: layers.reduce((s, l) => s + l.count * l.sku.weight, 0),
        rationale,
        familyIndex,
        stackKind: st.kind,
      };
    });

  // Pure plan: consolidation off, so stacksPerTruck is irrelevant (1).
  const pure = planStacks(skus, effectiveHeight, 1, { consolidate: false, minTopOffHeight: K });
  for (const skuId of pure.skippedSkuIds) {
    const m = byId.get(skuId) as PoolMember;
    warnings.push(`sku ${skuId}: cannot stack even one unit — ${m.remaining} unplaced`);
    leftover.set(skuId, (leftover.get(skuId) ?? 0) + m.remaining);
  }
  return { columns: toColumns(pure.stacks), skus: skus.filter((x) => !pure.skippedSkuIds.includes(x.skuId)), toColumns };
}

function buildColumn(plan: ColumnPlan, posY: number): PackColumn {
  const layers: PackLayer[] = plan.layers.map((l) => ({
    skuId: l.sku.id,
    skuName: l.sku.name,
    skuCode: l.sku.sku,
    color: colorForSku(l.sku.id),
    unitHeight: l.unitHeight,
    count: l.count,
    orientation: { length: plan.colLength, width: plan.colWidth, height: l.unitHeight, label: plan.orientationLabel },
  }));
  const distinctSkuIds = new Set(layers.map((l) => l.skuId));
  return {
    posY,
    colWidth: plan.colWidth,
    colLength: plan.colLength,
    totalHeight: plan.totalHeight,
    totalWeight: plan.totalWeight,
    stackCount: layers.reduce((s, l) => s + l.count, 0),
    layers,
    mixed: distinctSkuIds.size > 1,
    rationale: plan.rationale,
    stackKind: plan.stackKind,
  };
}

// Row-fill scorer for comparing different candidate fillings of the SAME row slot (lb-engine-03
// A2): width utilisation first (higher is better), then wastedFloorArea (lower is better) — the
// same priority order the prompt specifies. Returns negative when `a` is better than `b`.
function compareRowFill(a: PackRow, b: PackRow): number {
  if (!approxEq(a.rowWidthUsed, b.rowWidthUsed)) return b.rowWidthUsed - a.rowWidthUsed;
  return a.wastedFloorArea - b.wastedFloorArea;
}

function assembleRowFrom(chosen: ColumnPlan[]): PackRow {
  let posY = 0;
  const columns = chosen.map((plan) => {
    const col = buildColumn(plan, posY);
    posY += col.colWidth;
    return col;
  });
  const rowLength = Math.max(...columns.map((c) => c.colLength));
  const wastedFloorArea = columns.reduce((s, c) => s + (rowLength - c.colLength) * c.colWidth, 0);
  return {
    posFromFront: 0, // filled in by buildTrailer once the row's position in the trailer is known
    rowLength,
    rowWidthUsed: posY,
    wastedFloorArea,
    columns,
    totalUnits: columns.reduce((s, c) => s + c.stackCount, 0),
    totalWeight: columns.reduce((s, c) => s + c.totalWeight, 0),
  };
}

// Depth-aware width bin-pack for one row (lb-engine-03 A2). Candidates are grouped by colLength
// (epsilon-tolerant); for each group in turn as the "seed", greedily fill the row's width from
// that group first (widest-fit), then fall through to the other groups (deepest-first) only for
// whatever width the seed group couldn't fill — this is what keeps a 90.75"-deep column from
// automatically absorbing trailer depth it doesn't need just because a 66.75"-deep column happened
// to fit beside it. A last candidate ignores grouping entirely (the lb-engine-02 behaviour: widest
// column first regardless of depth) so a genuine cross-depth pairing (e.g. INV_4347's
// 54.75"+42.75"=97.5", each from a different depth group) is never lost to same-depth bias — width
// utilisation is scored first, so a real cross-depth win still surfaces. Bounded: one greedy pass
// per depth group plus one ungrouped pass, never exponential.
function buildOneRow(
  instances: ColumnPlan[],
  dims: Dimensions,
  weightBudget: number,
  lengthBudget: number
): { row: PackRow | null; chosen: ColumnPlan[] } {
  const eligible = instances.filter((inst) => approxLte(inst.colLength, lengthBudget));
  if (eligible.length === 0) return { row: null, chosen: [] };

  const groups: { colLength: number; items: ColumnPlan[] }[] = [];
  for (const inst of eligible) {
    let g = groups.find((x) => approxEq(x.colLength, inst.colLength));
    if (!g) {
      g = { colLength: inst.colLength, items: [] };
      groups.push(g);
    }
    g.items.push(inst);
  }
  groups.sort((a, b) => b.colLength - a.colLength);

  function greedyFill(pools: ColumnPlan[][]): ColumnPlan[] {
    const chosen: ColumnPlan[] = [];
    const used = new Set<ColumnPlan>();
    let widthLeft = dims.width;
    let weightLeft = weightBudget;

    const takeBest = (pool: ColumnPlan[]): boolean => {
      let best: ColumnPlan | null = null;
      for (const p of pool) {
        if (used.has(p)) continue;
        if (p.colWidth > widthLeft + EPS || p.totalWeight > weightLeft + EPS) continue;
        if (!best || p.colWidth > best.colWidth) best = p;
      }
      if (!best) return false;
      chosen.push(best);
      used.add(best);
      widthLeft -= best.colWidth;
      weightLeft -= best.totalWeight;
      return true;
    };

    for (const pool of pools) {
      while (takeBest(pool)) {
        // keep draining this pool before moving to the next
      }
    }
    return chosen;
  }

  let best: { chosen: ColumnPlan[]; row: PackRow } | null = null;
  const consider = (chosen: ColumnPlan[]) => {
    if (chosen.length === 0) return;
    const row = assembleRowFrom(chosen);
    if (!best || compareRowFill(row, best.row) < 0) best = { chosen, row };
  };

  // One candidate per seed group: same-depth first, other groups (deepest-first) fill whatever
  // width the seed group left over.
  for (const seed of groups) {
    const pools = [seed.items, ...groups.filter((g) => g !== seed).map((g) => g.items)];
    consider(greedyFill(pools));
  }
  // Ungrouped candidate: widest-fit across all depths, matching lb-engine-02 — catches a
  // cross-depth pairing that a same-depth-first seed would otherwise miss or under-fill.
  consider(greedyFill([eligible]));

  if (!best) return { row: null, chosen: [] };
  const winner = best as { chosen: ColumnPlan[]; row: PackRow };
  return { row: winner.row, chosen: winner.chosen };
}

// A row's sort key for rear->front ordering (lb-engine-03 B3, row-order-nose-first): the thickest
// BASE layer (layers[0], never a top-off layer) among the row's columns. Rows are sorted ascending
// by this before posFromFront is assigned, so the thinnest freight sits at the rear (posFromFront
// 0, where the trailer doors are, loaded last) and the thickest sits at the nose (loaded first).
function rowBaseThickness(row: PackRow): number {
  return row.columns.reduce((max, c) => Math.max(max, c.layers[0]?.unitHeight ?? 0), 0);
}

function buildTrailer(rows: PackRow[], dims: Dimensions, effectiveHeight: number): PackTrailer {
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
    allHeights.length > 0 ? allHeights.reduce((s, h) => s + h, 0) / allHeights.length / effectiveHeight : 0;
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
// Decomposes any unplaced ColumnPlans back into per-SKU leftover quantities. A plan may carry a
// mixed base+top-off pair (lb-engine-03 B1), so this must walk `layers`, not assume one SKU per
// plan — the old single-SKU-per-instance shortcut would silently drop top-off pieces from the
// balance and break the `conservation` invariant the moment any mixed column went unplaced.
function spillToLeftover(plans: ColumnPlan[], leftover: Map<string, number>): void {
  for (const plan of plans) {
    for (const layer of plan.layers) {
      leftover.set(layer.sku.id, (leftover.get(layer.sku.id) ?? 0) + layer.count);
    }
  }
}

// lbr-03: one trailer-assembly pass over a fixed set of columns — the old simulate() loop, moved
// verbatim except for the row sort (rule 5, below). Columns not placed within trailerLimit come
// back in `unplaced` (the caller spills them to the balance); `trailerPlans` records which
// ColumnPlans landed on each trailer so consolidation can count each family's columns on the last.
function assembleTrailers(
  instancesIn: ColumnPlan[],
  dims: Dimensions,
  effectiveHeight: number,
  opts: PackOptions
): { trailers: PackTrailer[]; trailerPlans: ColumnPlan[][]; unplaced: ColumnPlan[]; warnings: string[] } {
  let instances = instancesIn;
  const warnings: string[] = [];
  const trailers: PackTrailer[] = [];
  const trailerPlans: ColumnPlan[][] = [];
  const trailerLimit = opts.trailerLimit ?? Infinity;

  while (instances.length > 0 && trailers.length < trailerLimit) {
    const rows: PackRow[] = [];
    const plansOnTrailer: ColumnPlan[] = [];
    let lengthLeft = dims.length;
    let weightLeft = dims.maxWeight;
    let progressed = false;

    while (instances.length > 0 && lengthLeft > EPS) {
      const { row, chosen: used } = buildOneRow(instances, dims, weightLeft, lengthLeft);
      if (!row) break;
      rows.push(row);
      plansOnTrailer.push(...used);
      lengthLeft -= row.rowLength;
      weightLeft -= row.totalWeight;
      const usedSet = new Set(used);
      instances = instances.filter((inst) => !usedSet.has(inst));
      progressed = true;
    }

    if (!progressed) {
      warnings.push(`unable to place remaining ${instances.length} column(s) on any trailer — moved to balance`);
      return { trailers, trailerPlans, unplaced: instances, warnings };
    }

    // Rear->front ordering (lb-engine-03 B3, row-order-nose-first, 2026-09-16): thinnest base
    // layer at posFromFront 0 (the rear, where the doors are — loaded last), thickest toward the
    // nose (loaded first — "biggest sizes go in first," confirmed with Steve). Must sort before
    // buildTrailer assigns posFromFront, since that assignment walks rows in array order.
    //
    // Secondary key, same day (row-order-tail-placement): buildOneRow's greedy width-pack can't
    // always fill every row to dims.width — when a thickness's own column supply runs out mid-tier,
    // one row is left with fewer columns than its same-thickness neighbors (e.g. 1 of 4 width-lanes
    // used). Without a tiebreak, JS's stable sort leaves that partial row wherever it was greedily
    // assembled, which can land it sandwiched between two FULL same-thickness rows — reads as a
    // random gap in the middle of the diagram, not an intentional "ran out" tail. Breaking same-
    // thickness ties by rowWidthUsed ascending (sparsest first, i.e. lowest posFromFront/most-rear
    // within the tie group) puts the partial row at the tier's rear-adjacent edge instead — the
    // position a real loader would leave it, having run through the full rows first and hit this
    // size's remainder right before moving on to the next, thinner size.
    //
    // Rule 5 (lbr-03, Steve 2026-10-12): within one thickness, pure stacks first (nose-ward) and
    // topped/partial stacks LAST. So a row holding any non-pure column (mixed, or stackKind
    // "partial") sorts BEFORE the all-pure rows of its thickness — i.e. rear-ward — ahead of the
    // rowWidthUsed tie-break. Rows are assembled nose-first, in the planner's loading order, but
    // this array is rear-first, so it is reversed BEFORE the stable sort: otherwise every tie group
    // would come out flipped (on the golden load, the 11" row holding the partial 11x6+10x4 would
    // sit right behind the 12s instead of last among the 11s).
    const isNonPure = (row: PackRow) => row.columns.some((c) => c.mixed || c.stackKind === "partial");
    rows.reverse();
    rows.sort((a, b) => {
      const dt = rowBaseThickness(a) - rowBaseThickness(b);
      if (!approxEq(dt, 0)) return dt;
      const dp = (isNonPure(a) ? 0 : 1) - (isNonPure(b) ? 0 : 1);
      if (dp !== 0) return dp;
      return a.rowWidthUsed - b.rowWidthUsed;
    });

    trailers.push(buildTrailer(rows, dims, effectiveHeight));
    trailerPlans.push(plansOnTrailer);
  }

  if (instances.length > 0) {
    warnings.push(`trailerLimit (${trailerLimit}) reached with ${instances.length} column(s) unplaced`);
  }
  return { trailers, trailerPlans, unplaced: instances, warnings };
}

function consolidationNote(pureTrailers: number, trailers: number, topOffStacks: number, shortenedStacks: number): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const shortened = shortenedStacks > 0 ? ` (${plural(shortenedStacks, "stack", "stacks")} shortened)` : "";
  return `Mixed ${plural(topOffStacks, "stack", "stacks")} to fit on ${plural(trailers, "truck", "trucks")} instead of ${pureTrailers}${shortened}`;
}

const CONSOLIDATION_BUDGET_WARNING = "consolidation stopped early (work budget) — plan may use more trucks than necessary";

function simulate(
  families: Family[],
  chosen: FamilyOrientation[],
  dims: Dimensions,
  effectiveHeight: number,
  opts: PackOptions,
  budget: PlannerBudget
): SimResult {
  const warnings: string[] = [];
  const leftover = new Map<string, number>();
  const builds: FamilyBuild[] = families.map((fam, i) =>
    buildFamilyColumns(fam, i, chosen[i], dims, effectiveHeight, opts, warnings, leftover)
  );
  const instances: ColumnPlan[] = builds.flatMap((b) => b.columns);

  // Pure pass.
  const pureResult = assembleTrailers(instances, dims, effectiveHeight, opts);
  let result = pureResult;
  let current: ColumnPlan[][] = builds.map((b) => b.columns);
  const breaksByFamily = new Map<number, number>();
  let applied = false;

  // Consolidation pass (lbr-03): mix only when it saves a trailer. Skipped when the pure pass hit
  // trailerLimit (pieces unplaced) — that also keeps huge over-cap carts fast.
  if (opts.consolidate !== false && opts.maxSkusPerColumn >= 2 && pureResult.trailers.length > 1 && pureResult.unplaced.length === 0) {
    const K = opts.topOffMinInchesPerPiece;
    const familyStackLowerBound = builds.map((b) => Math.ceil(b.skus.reduce((s, x) => s + x.unitHeight * x.qty, 0) / effectiveHeight - EPS));
    let T = pureResult.trailers.length;
    let budgetHit = false;

    const attempt = (familyIdxs: number[], onLast: number[]): boolean => {
      const next = current.slice();
      const breaks = new Map<number, number>();
      for (const f of familyIdxs) {
        const target = current[f].length - onLast[f];
        // Exact prune: a family can never fit in fewer stacks than its volume needs, so skip the
        // planner search (which would only burn the work budget failing) when target is below it.
        if (target < 1 || target < familyStackLowerBound[f]) return false;
        const plan = planStacksWithin(builds[f].skus, effectiveHeight, target, { minTopOffHeight: K, budget });
        if (!plan) {
          if (budget.remaining <= 0) budgetHit = true;
          return false;
        }
        next[f] = builds[f].toColumns(plan.stacks);
        breaks.set(f, plan.shortenedStacks);
      }
      const r = assembleTrailers(next.flat(), dims, effectiveHeight, opts);
      if (r.trailers.length < T && r.unplaced.length === 0) {
        current = next;
        result = r;
        T = r.trailers.length;
        Array.from(breaks.entries()).forEach(([f, b]) => breaksByFamily.set(f, b));
        applied = true;
        return true;
      }
      return false;
    };

    while (T > 1 && !budgetHit) {
      const onLast = families.map(() => 0);
      for (const plan of result.trailerPlans[T - 1]) onLast[plan.familyIndex] += 1;
      const candidates = families
        .map((_, i) => i)
        .filter((i) => onLast[i] > 0)
        .sort((a, b) => onLast[b] - onLast[a] || a - b);
      let accepted = false;
      for (const f of candidates) {
        if (attempt([f], onLast)) {
          accepted = true;
          break;
        }
        if (budgetHit) break;
      }
      if (!accepted && !budgetHit && candidates.length > 1) accepted = attempt(candidates, onLast);
      if (!accepted) break;
    }
    if (budgetHit) warnings.push(CONSOLIDATION_BUDGET_WARNING);
  }

  warnings.push(...result.warnings);
  if (result.unplaced.length > 0) spillToLeftover(result.unplaced, leftover);

  const trailers = result.trailers;
  const topOffStacks = trailers.reduce((s, t) => s + t.mixedStacks, 0);
  const shortenedStacks = Array.from(breaksByFamily.values()).reduce((s, b) => s + b, 0);
  const consolidation: PackConsolidation = {
    applied,
    pureTrailers: pureResult.trailers.length,
    trailers: trailers.length,
    topOffStacks: applied ? topOffStacks : 0,
    shortenedStacks: applied ? shortenedStacks : 0,
    note: applied ? consolidationNote(pureResult.trailers.length, trailers.length, topOffStacks, shortenedStacks) : null,
  };
  return { trailers, leftover, warnings, consolidation };
}

// Score, lower-is-better lexicographically: fewest trailers; then fewest total rows; then highest
// average row width utilization (negated so "lower" still means "better"); then least wasted
// depth; then fewest distinct orientation labels in play (operator predictability).
//
// Row count was added ahead of width utilization in lb-engine-03 (A1 fallout): once a
// single-member family can choose any of six orientations, one of them can tip the SKU's own
// thickness onto the length axis (e.g. colLength becomes 8" instead of 90.75"), leaving only 1
// piece per column height-wise but letting dozens of near-perfect-width-utilization rows fit
// inside the length budget — a trailer-count tie that average width utilization alone scored as a
// WIN, producing 40+ physical rows out of what should be a handful. Row count catches exactly this
// (more, thinner rows always lose to fewer, fatter ones at equal trailer count) without needing a
// height-utilization term, and doesn't regress genuine width-utilization wins since packing more
// tightly into a row is how row count comes down in the first place.
function scoreResult(result: SimResult, labels: string[]): [number, number, number, number, number] {
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
  return [trailerCount, rowCount, -avgWidthUtil, wasteSum, distinctOrientations];
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
  effectiveHeight: number,
  opts: PackOptions,
  budget: PlannerBudget
): { chosen: FamilyOrientation[]; result: SimResult } {
  const combos = enumerateCombos(familyOptions);
  let best: { chosen: FamilyOrientation[]; result: SimResult; score: number[] } | null = null;
  for (const combo of combos) {
    const result = simulate(families, combo, dims, effectiveHeight, opts, budget);
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
const CONSOLIDATION_MAX_WORK = 50_000;

/**
 * Packs `cart` demand (against the `skus` catalog) into trailers of `dims`. Implements joint
 * orientation selection, width pairing and depth-aware row assembly (lb-engine-02 + lb-engine-03
 * A1/A2), the stack planner's pure-first column plans with consolidation (mix only to save a
 * trailer — lbr-03, which replaced lb-engine-03 B1/B2's exact fill), rule-5 rear->front row ordering
 * (B3 + lbr-03), and a running balance across up to `opts.trailerLimit` trailers (B4) — this is
 * the complete algorithm.
 */
export function pack(cart: CartLine[], skus: PackSku[], dims: Dimensions, options?: Partial<PackOptions>): PackPlan {
  const opts: PackOptions = { ...DEFAULT_PACK_OPTIONS, ...options };
  const warnings: string[] = [];
  const { effectiveHeight } = resolveEffectiveHeight(dims, opts, warnings);
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
  // lbr-rot-01: drop orientation options that can't stack even once on THIS trailer (footprint over
  // the floor, or — single-member families only — a unit taller than the effective height). The
  // combo score ranks trailers first and never counts leftover, so a dead option (place nothing,
  // 0 trailers) would otherwise beat a live rotated one. Legality still lives in skuOrientations; if
  // every option is dead the original list is kept so the existing "cannot stack" warning fires.
  const familyOptions = families.map((f) => {
    const all = familyOrientationOptions(f, opts);
    const live = all.filter(
      (o) =>
        approxLte(o.length, dims.length) &&
        approxLte(o.width, dims.width) &&
        (f.members.length > 1 || approxLte(o.height, effectiveHeight))
    );
    return live.length > 0 ? live : all;
  });
  // lbr-03: one deterministic consolidation work budget for this whole pack() call, shared across
  // every orientation combination simulate() tries (place() attempts, never wall-clock).
  const budget: PlannerBudget = { remaining: CONSOLIDATION_MAX_WORK };

  let simResult: SimResult;
  if (families.length === 0) {
    simResult = {
      trailers: [],
      leftover: new Map(),
      warnings: [],
      consolidation: { applied: false, pureTrailers: 0, trailers: 0, topOffStacks: 0, shortenedStacks: 0, note: null },
    };
  } else {
    const comboCount = familyOptions.reduce((p, o) => p * o.length, 1);
    if (comboCount <= COMBO_GUARD) {
      simResult = bestCombo(families, familyOptions, dims, effectiveHeight, opts, budget).result;
    } else {
      warnings.push(
        `orientation search space (${comboCount}) exceeds guard (${COMBO_GUARD}) — using greedy largest-family-first fallback`
      );
      simResult = simulate(families, greedyCombo(families, familyOptions), dims, effectiveHeight, opts, budget);
    }
  }

  applyStabilityWarnings(simResult.trailers, opts, simResult.warnings);

  for (const [skuId, qty] of Array.from(simResult.leftover.entries())) {
    balanceMap.set(skuId, (balanceMap.get(skuId) ?? 0) + qty);
  }
  warnings.push(...simResult.warnings);

  const trailers = simResult.trailers;
  if (opts.trailerTypeLabel) {
    for (const trailer of trailers) trailer.type = opts.trailerTypeLabel;
  }

  // lb-ui-12: auto-downsize. The last trailer built above is the one most likely to be only
  // partially filled — if everything already placed on it would ALSO fit a smaller "26ft Box
  // Truck", repack just that trailer's demand against box-truck dims instead of shipping it on the
  // primary (larger) trailer type. Mirrors legacy's own auto-downsize (load-builder.html, the
  // `calcLoading` "Auto-downsize last trailer" step), reimplemented against skuOrientations — the
  // actual fit primitive, matching every other fit check in this file — rather than ported
  // verbatim: legacy's own check sorts [length,width,height] on both the SKU and the box and
  // compares elementwise, which asks "could this piece fit the box in SOME orientation" while
  // ignoring allowRotation and the piece's already-fixed placement orientation; that can green-
  // light a downsize whose repacked trailer then fails validatePlan's sku-unplaceable rule.
  // Recurses into pack() itself with autoDownsize forced off (so it can't recurse a second time)
  // and only accepts the result if it collapses to exactly ONE trailer with NOTHING left in its
  // balance — a downsize that would actually need two box trucks, or strand a piece that doesn't
  // fit the smaller envelope at all, is rejected outright and the original, primary-dims trailer
  // is kept exactly as built above.
  if (opts.autoDownsize && trailers.length >= 1) {
    const boxDims = TRAILER_TYPES["26ft Box Truck"];
    if (dims.length > boxDims.length) {
      const lastTrailer = trailers[trailers.length - 1];
      const lastTrailerCartMap = new Map<string, number>();
      for (const row of lastTrailer.rows) {
        for (const column of row.columns) {
          for (const layer of column.layers) {
            lastTrailerCartMap.set(layer.skuId, (lastTrailerCartMap.get(layer.skuId) ?? 0) + layer.count);
          }
        }
      }
      const allSkusFitBox =
        lastTrailerCartMap.size > 0 &&
        Array.from(lastTrailerCartMap.keys()).every((skuId) => {
          const sku = skuById.get(skuId);
          return (
            !!sku &&
            skuOrientations(sku, opts).some(
              (o) => approxLte(o.length, boxDims.length) && approxLte(o.width, boxDims.width) && approxLte(o.height, boxDims.height)
            )
          );
        });
      if (allSkusFitBox) {
        const boxCart: CartLine[] = Array.from(lastTrailerCartMap.entries()).map(([skuId, qty]) => ({ skuId, qty }));
        const boxResult = pack(boxCart, skus, boxDims, { ...opts, autoDownsize: false, trailerTypeLabel: "26ft Box Truck" });
        if (boxResult.trailers.length === 1 && boxResult.balance.length === 0) {
          trailers[trailers.length - 1] = boxResult.trailers[0];
          warnings.push(...boxResult.warnings);
        }
      }
    }
  }

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
    // Auto-downsize keeps the outer call's numbers: the box-truck repack is a single trailer, so
    // it is pure-only by construction.
    consolidation: simResult.consolidation,
  };
}

// --- planMetrics() ---
// lb-engine-04 Part B: the numbers the UI will show and the regression ratchet asserts against.
// Pure — reads only what pack() already produced plus the trailer dims used to size it.

export interface PlanMetrics {
  trailerCount: number;
  rowCount: number;
  usedLength: number; // summed across trailers
  meanHeightUtilization: number; // mean column totalHeight / effective height (dims.height - runnerHeight), across all columns
  meanWidthUtilization: number; // mean row rowWidthUsed / dims.width, across all rows
  wastedFloorArea: number; // summed across rows
  mixedStacks: number;
  balancePieces: number; // total pieces left in balance
}

// lb-engine-05: gained the `options` param (was `(plan, dims)`) so meanHeightUtilization can be
// computed against effective height rather than nominal — a breaking signature change; lb-ui-01
// is the only planned consumer and hasn't landed yet, so this has no callers outside this file's
// own selfcheck at the time of the change.
// lb-ui-12: dropped the plan-wide `dims` param — each column/row is now weighted against its OWN
// trailer's dims (trailer.dims), not one global envelope. With every trailer sharing dims (the
// only case before auto-downsize existed) this is numerically identical to the old flattened
// computation; it only diverges once a trailer's dims differ from the rest.
export function planMetrics(plan: PackPlan, options: PackOptions): PlanMetrics {
  const rows = plan.trailers.flatMap((t) => t.rows);
  let heightRatioSum = 0;
  let heightRatioCount = 0;
  let widthRatioSum = 0;
  let widthRatioCount = 0;
  for (const trailer of plan.trailers) {
    const { effectiveHeight } = resolveEffectiveHeight(trailer.dims, options, []);
    for (const row of trailer.rows) {
      widthRatioSum += row.rowWidthUsed / trailer.dims.width;
      widthRatioCount += 1;
      for (const column of row.columns) {
        heightRatioSum += column.totalHeight / effectiveHeight;
        heightRatioCount += 1;
      }
    }
  }

  return {
    trailerCount: plan.trailers.length,
    rowCount: rows.length,
    usedLength: plan.trailers.reduce((s, t) => s + t.usedLength, 0),
    meanHeightUtilization: heightRatioCount > 0 ? heightRatioSum / heightRatioCount : 0,
    meanWidthUtilization: widthRatioCount > 0 ? widthRatioSum / widthRatioCount : 0,
    wastedFloorArea: rows.reduce((s, r) => s + r.wastedFloorArea, 0),
    mixedStacks: plan.mixedStacks,
    balancePieces: plan.balance.reduce((s, b) => s + b.remaining, 0),
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
    // Every check below is scoped to THIS trailer, so it reads trailer.dims rather than a single
    // plan-wide dims — lb-ui-12: a trailer auto-downsized to a smaller type carries its own dims,
    // and validating it against the plan's primary dims would be checking the wrong envelope.
    const dims = trailer.dims;
    const { effectiveHeight, runnerHeight } = resolveEffectiveHeight(dims, options, []);
    let runningLength = 0;

    const summedRowLength = trailer.rows.reduce((sum, r) => sum + r.rowLength, 0);
    // trailer-length: catches rows that overflow the trailer bed lengthwise.
    if (!approxLte(summedRowLength, dims.length)) {
      violate("trailer-length", `sum of row lengths ${summedRowLength} exceeds trailer length ${dims.length}`, ti);
    }

    // weight: NOT a load-planning warning — it is a data canary. Foam at ~1 lb/ft³ cannot approach
    // a 636x98x109 trailer's 44,000 lb rated capacity by any realistic load, so if this rule ever
    // fires it means a SKU weight in the parts library is wrong by orders of magnitude, not that
    // the load is actually heavy. Keep it for that reason — do not delete it as dead weight.
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

        // column-height: catches a stack taller than the trailer's usable clearance (nominal
        // height minus any runner — see resolveEffectiveHeight).
        if (!approxLte(column.totalHeight, effectiveHeight)) {
          violate(
            "column-height",
            runnerHeight > EPS
              ? `column totalHeight ${column.totalHeight} exceeds effective height ${effectiveHeight} (trailer ${dims.height} − runner ${runnerHeight})`
              : `column totalHeight ${column.totalHeight} exceeds trailer height ${dims.height}`,
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
        // Holey Board is exempt (holey-sequential-fill, 2026-09-16) — it sequentially chains through as many
        // distinct thicknesses as physically fit in one column's height, by design, not a policy
        // violation; the real constraint there is already physical (column-height/weight above).
        const firstColumnSku = column.layers[0] ? skuById.get(column.layers[0].skuId) : undefined;
        const isHoleyColumn = firstColumnSku?.category === HOLEY_BOARD_CATEGORY;
        if (!isHoleyColumn && distinctSkuIds.size > options.maxSkusPerColumn) {
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
