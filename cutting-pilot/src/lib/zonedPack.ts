// src/lib/zonedPack.ts
// lbz-v2-01: offload zones for the v2 Load Builder. A wrapper around pack(). packEngine.ts and
// stackPlanner.ts are not edited; the only packEngine.ts change is the optional zone fields on
// CartLine and PackColumn, which pack() never reads.
//
// Direction. v2's posFromFront = 0 is the DOORS and the highest value is the WALL. That is the mirror
// of legacy. Legacy (load-builder.html calcZonedLoading) packs zones in reverse (`packOrder`) so zone 1
// lands at its doors end. v2 packs zones in DELIVERY ORDER and zone 1 lands at the doors on its own.
// Packing in delivery order also gives deliver-first zones the first claim on Truck 1.
//
// Per zone:
//   1. pack() the zone's remaining demand against what is left of the open truck (length and weight),
//      trailerLimit 1, auto-downsize off. Leftover closes the truck and continues on a new one.
//   2. Before placing that segment, rows narrower than its widest row move (stable) to the segment's
//      wall end. pack() leaves a size's partial row at its doors end, so without this a gap never
//      reaches a zone boundary (the prototype got 2 trucks without it and 1 with it, on the real
//      four-zone order).
//   3. When the zone is done and its truck is still open with the zone's row last, later zones fill
//      that row's spare width (boundary gap-fill), chaining in delivery order. Rows never move after
//      a gap-fill has run (legacy follow-up #3).
// Every column is stamped with offloadSeq / zoneLabel / zoneColor. A stack is single-zone by
// construction. A row may hold stacks from two zones side by side after a gap-fill.
import type { CartLine, Dimensions, PackBalance, PackOptions, PackPlan, PackRow, PackSku, PackTrailer } from "./packEngine";
import { DEFAULT_PACK_OPTIONS, pack } from "./packEngine";
import { recomputePlan } from "./loadEditor";

/** Group label for cart lines with no zone. Packs last, at the wall. */
export const UNZONED_LABEL = "Unzoned";

/** Zone colors by delivery index, from legacy's ZONE_COLORS (logistics/load-builder.html). Data, not
 * theme, like SKU_COLOR_PALETTE. The Unzoned group gets no color. */
export const ZONE_COLORS = ["#D97706", "#2563EB", "#059669", "#7C3AED", "#DC2626", "#0891B2", "#CA8A04", "#BE123C", "#4F46E5", "#16A34A"];

const MAX_SEGMENTS_PER_ZONE = 40;
const EPS = 1e-6;

export interface ZoneGroup {
  label: string;
  offloadSeq: number | null;
  color: string | undefined;
  /** Merged by SKU. Mutated as segments and gap-fills place pieces. */
  cart: CartLine[];
}

function cleanLabel(label: string | null | undefined): string | null {
  const s = (label ?? "").toString().trim();
  return s ? s : null;
}

/** Groups cart lines by zoneLabel in delivery order (ascending offloadSeq; a labeled zone with no
 * sequence after the numbered ones). Unlabeled lines form one Unzoned group, last. Each group's cart
 * is merged by SKU. */
export function groupCartByZone(cart: CartLine[]): ZoneGroup[] {
  const groups = new Map<string, { label: string; seq: number | null; unzoned: boolean; qty: Map<string, number>; first: number }>();
  cart.forEach((line, i) => {
    if (!(line.qty > 0)) return;
    const label = cleanLabel(line.zoneLabel);
    const key = label ?? `\u0000${UNZONED_LABEL}`;
    let g = groups.get(key);
    if (!g) {
      g = { label: label ?? UNZONED_LABEL, seq: null, unzoned: label === null, qty: new Map(), first: i };
      groups.set(key, g);
    }
    const seq = line.offloadSeq;
    if (!g.unzoned && typeof seq === "number" && Number.isFinite(seq) && (g.seq === null || seq < g.seq)) g.seq = seq;
    g.qty.set(line.skuId, (g.qty.get(line.skuId) ?? 0) + line.qty);
  });
  const rank = (g: { seq: number | null; unzoned: boolean }) => (g.unzoned ? 2 : g.seq === null ? 1 : 0);
  const sorted = Array.from(groups.values()).sort((a, b) => rank(a) - rank(b) || (a.seq ?? 0) - (b.seq ?? 0) || a.first - b.first);
  let colorIndex = 0;
  return sorted.map((g) => ({
    label: g.label,
    offloadSeq: g.unzoned ? null : g.seq,
    color: g.unzoned ? undefined : ZONE_COLORS[colorIndex++ % ZONE_COLORS.length],
    cart: Array.from(g.qty.entries()).map(([skuId, qty]) => ({ skuId, qty })),
  }));
}

function placedBySku(rows: PackRow[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const row of rows) for (const column of row.columns) for (const layer of column.layers) m.set(layer.skuId, (m.get(layer.skuId) ?? 0) + layer.count);
  return m;
}

function subtractInPlace(cart: CartLine[], placed: Map<string, number>): void {
  for (const line of cart) {
    const n = placed.get(line.skuId) ?? 0;
    if (n > 0) {
      const take = Math.min(n, line.qty);
      line.qty -= take;
      placed.set(line.skuId, n - take);
    }
  }
}

const live = (cart: CartLine[]) => cart.filter((l) => l.qty > 0);

function stamp(rows: PackRow[], zone: ZoneGroup): void {
  for (const row of rows) for (const column of row.columns) stampColumn(column, zone);
}

function stampColumn(column: PackRow["columns"][number], zone: ZoneGroup): void {
  column.offloadSeq = zone.offloadSeq;
  column.zoneLabel = zone.label;
  if (zone.color !== undefined) column.zoneColor = zone.color;
  else delete column.zoneColor;
}

// Segment-call warnings that only describe the truncated per-segment call (trailerLimit 1 against
// what's left of the truck), not the load: the demand they mention is re-packed on the next truck.
const SEGMENT_ONLY = [/^trailerLimit \(/, /^unable to place remaining /];
const PER_TRAILER = /^trailer (\d+) ([\s\S]*)$/;

interface OpenTruck {
  rows: PackRow[];
  usedLength: number;
  usedWeight: number;
}

/** Packs a cart whose lines carry offload zones. Zone 1 at the doors (posFromFront 0), later zones
 * toward the wall, Unzoned last. Zones may span trucks; deliver-first zones fill Truck 1 first. */
export function zonedPack(cart: CartLine[], skus: PackSku[], dims: Dimensions, options?: Partial<PackOptions>): PackPlan {
  const opts: PackOptions = { ...DEFAULT_PACK_OPTIONS, ...options, autoDownsize: false };
  const segOpts: Partial<PackOptions> = { ...options, autoDownsize: false, trailerLimit: 1 };
  const trailerLimit = opts.trailerLimit ?? 20;
  const zones = groupCartByZone(cart);

  const warnings: string[] = [];
  const seen = new Set<string>();
  const addPlain = (w: string) => {
    if (!seen.has(w)) {
      seen.add(w);
      warnings.push(w);
    }
  };
  const balanceMap = new Map<string, number>();
  const toBalance = (zone: ZoneGroup, lines: CartLine[], why: string) => {
    for (const l of lines) {
      if (l.qty <= 0) continue;
      balanceMap.set(l.skuId, (balanceMap.get(l.skuId) ?? 0) + l.qty);
      addPlain(`[${zone.label}] ${l.qty} pcs of ${l.skuId} ${why}`);
      l.qty = 0;
    }
  };

  const trucks: OpenTruck[] = [];
  let truck: OpenTruck = { rows: [], usedLength: 0, usedWeight: 0 };
  const closeTruck = () => {
    if (truck.rows.length) trucks.push(truck);
    truck = { rows: [], usedLength: 0, usedWeight: 0 };
  };

  // Boundary gap-fill: later zones fill the spare width of the open truck's last row. Never touches a
  // closed truck and never adds length. A failed sub-pack skips to the next zone.
  const fillBoundaryGap = (fromIndex: number) => {
    for (let j = fromIndex; j < zones.length; j++) {
      const donor = zones[j];
      const donorCart = live(donor.cart);
      if (!donorCart.length) continue;
      const lastRow = truck.rows[truck.rows.length - 1];
      if (!lastRow) return;
      if (lastRow.columns.some((c) => c.onEdge)) return;
      const base = lastRow.rowWidthUsed; // once per donor batch: the sub-pack's posY starts at 0
      const gap = dims.width - base;
      if (gap <= EPS) return;
      let sub: PackPlan;
      try {
        sub = pack(donorCart, skus, { ...dims, holeyEdgeSlot: undefined, length: lastRow.rowLength, width: gap, maxWeight: dims.maxWeight - truck.usedWeight }, segOpts);
      } catch {
        continue;
      }
      const subRow = sub.trailers[0]?.rows[0];
      if (!subRow || !subRow.columns.length || subRow.rowLength > lastRow.rowLength + EPS) continue;
      for (const column of subRow.columns) {
        stampColumn(column, donor);
        column.posY += base;
        lastRow.columns.push(column);
        lastRow.rowWidthUsed += column.colWidth;
        lastRow.totalUnits += column.stackCount;
        lastRow.totalWeight += column.totalWeight;
        truck.usedWeight += column.totalWeight;
      }
      subtractInPlace(donor.cart, placedBySku([subRow]));
    }
  };

  for (let zi = 0; zi < zones.length; zi++) {
    const zone = zones[zi];
    let guard = 0;
    while (live(zone.cart).length > 0) {
      if (guard++ >= MAX_SEGMENTS_PER_ZONE) {
        toBalance(zone, zone.cart, "not placed: zone needed too many segments.");
        break;
      }
      const available = dims.length - truck.usedLength;
      if (available <= EPS) {
        closeTruck();
        continue;
      }
      if (truck.rows.length === 0 && trucks.length >= trailerLimit) {
        toBalance(zone, zone.cart, `not placed: trailerLimit (${trailerLimit}) reached.`);
        break;
      }
      const segment = pack(live(zone.cart), skus, { ...dims, length: available, maxWeight: dims.maxWeight - truck.usedWeight }, segOpts);
      const segTrailer = segment.trailers[0];
      if (!segTrailer || segTrailer.rows.length === 0) {
        if (truck.rows.length > 0) {
          closeTruck();
          continue;
        }
        // An empty full-length truck still takes none of it: truly unplaced. Keep pack()'s reasons.
        for (const w of segment.warnings) if (!SEGMENT_ONLY.some((re) => re.test(w))) addPlain(`[${zone.label}] ${w}`);
        toBalance(zone, zone.cart, "could not be placed on any trailer.");
        break;
      }

      // Partial rows to the segment's wall end (stable), then posFromFront from the truck's used length.
      const rows = segTrailer.rows;
      const widest = Math.max(...rows.map((r) => r.rowWidthUsed));
      const ordered = [...rows.filter((r) => r.rowWidthUsed >= widest - EPS), ...rows.filter((r) => r.rowWidthUsed < widest - EPS)];
      let x = truck.usedLength;
      for (const row of ordered) {
        row.posFromFront = x;
        x += row.rowLength;
      }
      stamp(ordered, zone);

      // Per-trailer lines (stability notes) re-indexed to the global truck. Their row index is the
      // segment's own (before the partial-row move), so it is not a global row index.
      const ti = trucks.length; // the open truck's global index
      for (const w of segment.warnings) {
        const m = PER_TRAILER.exec(w);
        if (m) {
          if (Number(m[1]) === 0) warnings.push(`trailer ${ti} [${zone.label}] ${m[2]}`);
        } else if (!SEGMENT_ONLY.some((re) => re.test(w)) && !/ does not fit trailer \d/.test(w)) {
          addPlain(`[${zone.label}] ${w}`);
        }
      }

      truck.rows.push(...ordered);
      truck.usedLength = x;
      truck.usedWeight += segTrailer.usedWeight;
      subtractInPlace(zone.cart, placedBySku(ordered));
      if (live(zone.cart).length > 0) closeTruck();
    }

    const lastRow = truck.rows[truck.rows.length - 1];
    if (lastRow && lastRow.columns[0]?.zoneLabel === zone.label) fillBoundaryGap(zi + 1);
  }
  closeTruck();

  const trailers: PackTrailer[] = trucks.map((t) => ({
    ...(opts.trailerTypeLabel ? { type: opts.trailerTypeLabel } : {}),
    dims,
    rows: t.rows,
    usedLength: 0,
    usedFloorArea: 0,
    usedWeight: 0,
    totalStacks: 0,
    totalUnits: 0,
    mixedStacks: 0,
    widthUtilization: 0,
    heightUtilization: 0,
  }));
  const balance: PackBalance = Array.from(balanceMap.entries())
    .filter(([, n]) => n > 0)
    .map(([skuId, remaining]) => ({ skuId, remaining }));
  const plan: PackPlan = { trailers, balance, warnings, totalWeight: 0, totalUnits: 0, totalStacks: 0, mixedStacks: 0 };
  // Row waste, widths and totals. recomputeTrailer re-runs posFromFront in array order from 0, which
  // is exactly the order built above (zonedPack.selfcheck asserts it is unchanged).
  recomputePlan(plan, opts);
  return plan;
}
