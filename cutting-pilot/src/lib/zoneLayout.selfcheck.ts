// src/lib/zoneLayout.selfcheck.ts
// lbz-v2-03: guarded dev self-check for zoneLayout.ts. Pure, no network; same shape as the other
// Load Builder selfchecks. Not part of the production build path.
import { isZonedTrailer, zoneSegments, zoneBand, zoneOutlineEdges, zoneOrderWarning, loadOrderWallToDoors, zoneCellsOf, type ZoneCell } from "./zoneLayout";
import { zonedPack, UNZONED_LABEL } from "./zonedPack";
import { FOUR_ZONE, FOUR_ZONE_SKUS } from "./zonedPack.selfcheck";
import { pack, TRAILER_TYPES, DEFAULT_PACK_OPTIONS } from "./packEngine";
import type { CartLine, PackTrailer } from "./packEngine";
import { clonePlan, recomputePlan } from "./loadEditor";

interface CheckResult {
  name: string;
  pass: boolean;
  detail?: string;
}

const T53 = TRAILER_TYPES["53ft Standard"];
const OPTS = { ...DEFAULT_PACK_OPTIONS };

function zonesOn(t: PackTrailer): string[] {
  return Array.from(new Set(t.rows.flatMap((r) => r.columns.map((c) => c.zoneLabel ?? "")).filter((l) => l !== ""))).sort();
}

function cell(x: number, y: number, w: number, h: number, zoneLabel: string): ZoneCell {
  return { x, y, w, h, zoneLabel, zoneColor: "#000000" };
}

export function runZoneLayoutSelfCheck(): { pass: boolean; results: CheckResult[] } {
  const results: CheckResult[] = [];
  function check(name: string, pass: boolean, detail?: string) {
    results.push({ name, pass, detail });
  }

  const plan = zonedPack(FOUR_ZONE, FOUR_ZONE_SKUS, T53, OPTS);
  const t0 = plan.trailers[0];

  // isZonedTrailer / zoneSegments
  {
    const plain = pack(FOUR_ZONE.map(({ skuId, qty }) => ({ skuId, qty })), FOUR_ZONE_SKUS, T53, OPTS);
    check("isZonedTrailer: zoned plan true, plain pack() false", isZonedTrailer(t0) && !isZonedTrailer(plain.trailers[0]));
    check("zoneSegments: nothing on a non-zoned trailer", zoneSegments(plain.trailers[0]).length === 0);
    const segs = zoneSegments(t0);
    check("zoneSegments: four zones in delivery order", JSON.stringify(segs.map((s) => s.label)) === JSON.stringify(["ZONE 1", "ZONE 2", "ZONE 3", "ZONE 4"]), JSON.stringify(segs.map((s) => s.label)));
    const want: Record<string, number> = {};
    for (const l of FOUR_ZONE) want[l.zoneLabel as string] = (want[l.zoneLabel as string] ?? 0) + l.qty;
    check("zoneSegments: pieces per zone match the cart", segs.every((s) => s.pieces === want[s.label]), JSON.stringify(segs.map((s) => [s.label, s.pieces])));
    check("zoneSegments: pieces sum to trailer.totalUnits", segs.reduce((n, s) => n + s.pieces, 0) === t0.totalUnits);
    const z2 = segs.find((s) => s.label === "ZONE 2")!;
    const z1 = segs.find((s) => s.label === "ZONE 1")!;
    check("zoneSegments: a shared row's stack counts only toward its own zone (ZONE 2 HB_8 = 17, ZONE 1 HB_8 = 40)", z2.skuBreakdown.HB_8?.pieces === 17 && z1.skuBreakdown.HB_8?.pieces === 40, JSON.stringify([z2.skuBreakdown.HB_8, z1.skuBreakdown.HB_8]));
    check("zoneSegments: extents overlap only on a shared row (ZONE 1 ends where ZONE 2's first row ends)", z1.startX === 0 && z2.startX === z1.endX - 48, JSON.stringify([z1.startX, z1.endX, z2.startX, z2.endX]));
    check("zoneSegments: colors carried", segs.every((s) => typeof s.color === "string"));
    check("loadOrderWallToDoors: ZONE 4, 3, 2, 1", JSON.stringify(loadOrderWallToDoors(t0).map((s) => s.label)) === JSON.stringify(["ZONE 4", "ZONE 3", "ZONE 2", "ZONE 1"]));
  }

  // Band: every zone appears on FOUR_ZONE; rows partitioned.
  {
    const band = zoneBand(t0);
    const shown = new Set([...band.segments.map((s) => s.label), ...band.markers.map((m) => m.label)]);
    check("zoneBand FOUR_ZONE: every zone appears", zonesOn(t0).every((z) => shown.has(z)), JSON.stringify(band.segments.map((s) => [s.label, s.rowIndices])));
    const covered = band.segments.flatMap((s) => s.rowIndices).sort((a, b) => a - b);
    check("zoneBand FOUR_ZONE: each row in exactly one band segment", JSON.stringify(covered) === JSON.stringify(t0.rows.map((_, i) => i)));
    check("zoneBand FOUR_ZONE: segments run doors -> wall in delivery order", JSON.stringify(band.segments.map((s) => s.label)) === JSON.stringify(["ZONE 1", "ZONE 2", "ZONE 3", "ZONE 4"]));
  }

  // The sliver fix (v2 only): a zone that exists only as a gap-filled stack inside another zone's row.
  {
    const cart: CartLine[] = [
      { skuId: "HB_4", qty: 81, offloadSeq: 1, zoneLabel: "BIG" },
      { skuId: "HB_6", qty: 10, offloadSeq: 2, zoneLabel: "SLIVER" },
    ];
    const ps = zonedPack(cart, FOUR_ZONE_SKUS, T53, OPTS);
    const t = ps.trailers[0];
    const band = zoneBand(t);
    check("sliver: fixture is one row shared by both zones", ps.trailers.length === 1 && t.rows.length === 1 && zonesOn(t).length === 2, JSON.stringify(t.rows.map((r) => r.columns.map((c) => c.zoneLabel))));
    check("sliver: the band shows BIG only", band.segments.length === 1 && band.segments[0].label === "BIG");
    check("sliver: SLIVER comes back as a marker with its stack", band.markers.length === 1 && band.markers[0].label === "SLIVER" && band.markers[0].columns.length === 1 && t.rows[band.markers[0].columns[0].rowIndex].columns[band.markers[0].columns[0].columnIndex].zoneLabel === "SLIVER");
    check("sliver: every zone appears (band or marker)", zonesOn(t).every((z) => band.segments.some((s) => s.label === z) || band.markers.some((m) => m.label === z)));
  }

  // Outlines (edge cancellation).
  {
    const pair = zoneOutlineEdges([cell(0, 0, 10, 10, "A"), cell(10, 0, 10, 10, "A")]);
    check("outline: two touching cells of one zone -> 6 edges (shared edge cancels)", pair.length === 1 && pair[0].edges.length === 6, JSON.stringify(pair));
    const two = zoneOutlineEdges([cell(0, 0, 10, 10, "A"), cell(10, 0, 10, 10, "B")]);
    check("outline: touching cells of two zones keep their edges (4 + 4)", two.length === 2 && two.every((z) => z.edges.length === 4));
    const island = zoneOutlineEdges([cell(0, 0, 10, 10, "A"), cell(30, 0, 10, 10, "A")]);
    check("outline: islands each keep their own outline (8 edges)", island[0].edges.length === 8);
    // L-shape: a full row of A, then a row that is half A, half B (a shared row).
    const l = zoneOutlineEdges([cell(0, 0, 10, 10, "A"), cell(0, 10, 10, 10, "A"), cell(10, 0, 10, 10, "A"), cell(10, 10, 10, 10, "B")]);
    const a = l.find((z) => z.label === "A")!;
    check("outline: a zone steps around a shared row (A is an L: 8 unit edges)", a.edges.length === 8, JSON.stringify(a.edges));
    // On the real plan: built through a cell mapping, every zone gets an outline.
    const cells = zoneCellsOf(t0, (ri, ci) => {
      const row = t0.rows[ri];
      const c = row.columns[ci];
      return { x: row.posFromFront, y: c.posY, w: c.colLength, h: c.colWidth };
    });
    const outlines = zoneOutlineEdges(cells);
    check("outline FOUR_ZONE: one outline per zone, each non-empty", outlines.length === 4 && outlines.every((o) => o.edges.length >= 4));
  }

  // Order warning (v2 direction: doors = posFromFront 0).
  {
    check("zoneOrderWarning: FOUR_ZONE as packed -> none", zoneOrderWarning(t0) === null);
    // Swap the doors row with the wall row: ZONE 4 at the doors, ZONE 1 at the wall.
    const swapped = clonePlan(plan);
    const rows = swapped.trailers[0].rows;
    const first = rows[0];
    rows[0] = rows[rows.length - 1];
    rows[rows.length - 1] = first;
    recomputePlan(swapped, OPTS);
    const w = zoneOrderWarning(swapped.trailers[0]);
    check("zoneOrderWarning: an earlier zone behind a later one warns", w !== null && w.startsWith("ZONE 1 is behind ZONE 4"), String(w));
    // Different zones side by side in one row: fine.
    const side = zonedPack(
      [
        { skuId: "HB_4", qty: 81, offloadSeq: 1, zoneLabel: "A" },
        { skuId: "HB_6", qty: 10, offloadSeq: 2, zoneLabel: "B" },
      ],
      FOUR_ZONE_SKUS,
      T53,
      OPTS
    );
    check("zoneOrderWarning: two zones side by side in one row -> none", zoneOrderWarning(side.trailers[0]) === null);
    // Unzoned stacks are ignored.
    const unz = zonedPack([...FOUR_ZONE.slice(0, 2), { skuId: "HB_3", qty: 10 }], FOUR_ZONE_SKUS, T53, OPTS);
    check("zoneOrderWarning: Unzoned stacks ignored", zoneOrderWarning(unz.trailers[0]) === null && zonesOn(unz.trailers[0]).includes(UNZONED_LABEL));
  }

  return { pass: results.every((r) => r.pass), results };
}
