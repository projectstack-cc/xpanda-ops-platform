// src/lib/zoneLayout.ts
// lbz-v2-03: pure zone geometry for the v2 Load Builder's diagram, PDF, Customize and BOL. No React,
// no pdf-lib. Zone data is DERIVED from a trailer's columns every time (zonedPack.ts stamps
// offloadSeq / zoneLabel / zoneColor on each column) and never frozen on the plan, so Customize
// edits can't leave it stale.
//
// v2 direction: posFromFront 0 is the DOORS, the highest value is the WALL (the mirror of legacy).
// Ports from logistics/load-builder.html: buildZoneSegmentsFromRows -> zoneSegments,
// buildZoneOutlineSegments + groupZoneCells -> zoneOutlineEdges, checkZoneOrderWarning ->
// zoneOrderWarning (walked doors -> wall, i.e. ascending posFromFront, for v2's direction).
//
// zoneBand is new: legacy draws each zone's band from its min..max row extent and clamps overlaps,
// which drops the label of a zone that only exists as gap-filled stacks inside another zone's row
// (BACKLOG, lbz-pack-02 follow-up). Here each row's band goes to the zone with the most width in it,
// and a zone that owns no row comes back in `markers` with its stacks, so the renderer can label it
// over them. Every zone appears in one or the other.
import type { PackColumn, PackTrailer } from "./packEngine";
import type { ZoneColumnSkuBreakdownEntry } from "./bolShared";

export interface ZoneSegment {
  offloadSeq: number | null;
  label: string;
  color: string | undefined;
  /** posFromFront extent of every row holding a stack of this zone. */
  startX: number;
  endX: number;
  pieces: number;
  /** Keyed by skuId, summed from this zone's own columns only (never a whole shared row). */
  skuBreakdown: Record<string, ZoneColumnSkuBreakdownEntry>;
}

function labelOf(column: PackColumn): string | null {
  const s = (column.zoneLabel ?? "").toString().trim();
  return s ? s : null;
}

const seqRank = (seq: number | null | undefined) => (typeof seq === "number" && Number.isFinite(seq) ? seq : Infinity);

/** True when any stack on the trailer carries a zone. */
export function isZonedTrailer(trailer: PackTrailer): boolean {
  return trailer.rows.some((r) => r.columns.some((c) => labelOf(c) !== null));
}

/** Per zone, in delivery order (Unzoned / no sequence last). Empty on a non-zoned trailer. */
export function zoneSegments(trailer: PackTrailer): ZoneSegment[] {
  const byLabel = new Map<string, ZoneSegment>();
  for (const row of trailer.rows) {
    const rowStart = row.posFromFront;
    const rowEnd = row.posFromFront + row.rowLength;
    for (const column of row.columns) {
      const label = labelOf(column);
      if (label === null) continue;
      let seg = byLabel.get(label);
      if (!seg) {
        seg = { offloadSeq: column.offloadSeq ?? null, label, color: column.zoneColor, startX: rowStart, endX: rowEnd, pieces: 0, skuBreakdown: {} };
        byLabel.set(label, seg);
      }
      if (rowStart < seg.startX) seg.startX = rowStart;
      if (rowEnd > seg.endX) seg.endX = rowEnd;
      if (seg.color === undefined && column.zoneColor) seg.color = column.zoneColor;
      const seq = column.offloadSeq;
      if (typeof seq === "number" && (seg.offloadSeq === null || seq < seg.offloadSeq)) seg.offloadSeq = seq;
      for (const layer of column.layers) {
        seg.pieces += layer.count;
        const entry = seg.skuBreakdown[layer.skuId] ?? (seg.skuBreakdown[layer.skuId] = { skuId: layer.skuId, name: layer.skuName, sku: layer.skuCode, color: layer.color, pieces: 0 });
        entry.pieces += layer.count;
      }
    }
  }
  return Array.from(byLabel.values()).sort((a, b) => seqRank(a.offloadSeq) - seqRank(b.offloadSeq));
}

/** The zones on this trailer in physical load order, WALL first (loaded first) to DOORS. Read from
 * where the stacks actually are, so it follows Customize moves. */
export function loadOrderWallToDoors(trailer: PackTrailer): ZoneSegment[] {
  return [...zoneSegments(trailer)].sort((a, b) => b.endX - a.endX || b.startX - a.startX);
}

export interface ZoneBandSegment {
  label: string;
  color: string | undefined;
  offloadSeq: number | null;
  /** Row indices (trailer.rows positions) this band covers, ascending posFromFront. */
  rowIndices: number[];
  startX: number;
  endX: number;
}

export interface ZoneMarker {
  label: string;
  color: string | undefined;
  offloadSeq: number | null;
  /** The stacks of this zone (it owns no row of its own, so the band has no label for it). */
  columns: Array<{ rowIndex: number; columnIndex: number }>;
}

/** The band over the rows: each row goes to the zone with the most width in it (ties: earlier
 * delivery), consecutive rows of one zone merge. A zone that owns no row is a marker instead. */
export function zoneBand(trailer: PackTrailer): { segments: ZoneBandSegment[]; markers: ZoneMarker[] } {
  const order = trailer.rows.map((_, i) => i).sort((a, b) => trailer.rows[a].posFromFront - trailer.rows[b].posFromFront);
  const segments: ZoneBandSegment[] = [];
  const meta = new Map<string, { color: string | undefined; offloadSeq: number | null }>();
  for (const ri of order) {
    const row = trailer.rows[ri];
    const width = new Map<string, number>();
    for (const c of row.columns) {
      const label = labelOf(c);
      if (label === null) continue;
      width.set(label, (width.get(label) ?? 0) + c.colWidth);
      if (!meta.has(label)) meta.set(label, { color: c.zoneColor, offloadSeq: c.offloadSeq ?? null });
    }
    if (width.size === 0) continue;
    const owner = Array.from(width.entries()).sort((a, b) => b[1] - a[1] || seqRank(meta.get(a[0])?.offloadSeq) - seqRank(meta.get(b[0])?.offloadSeq))[0][0];
    const last = segments[segments.length - 1];
    const end = row.posFromFront + row.rowLength;
    if (last && last.label === owner && Math.abs(last.endX - row.posFromFront) < 1e-6) {
      last.rowIndices.push(ri);
      last.endX = end;
    } else {
      const m = meta.get(owner)!;
      segments.push({ label: owner, color: m.color, offloadSeq: m.offloadSeq, rowIndices: [ri], startX: row.posFromFront, endX: end });
    }
  }
  const banded = new Set(segments.map((s) => s.label));
  const markers = new Map<string, ZoneMarker>();
  trailer.rows.forEach((row, rowIndex) =>
    row.columns.forEach((c, columnIndex) => {
      const label = labelOf(c);
      if (label === null || banded.has(label)) return;
      let m = markers.get(label);
      if (!m) {
        m = { label, color: c.zoneColor, offloadSeq: c.offloadSeq ?? null, columns: [] };
        markers.set(label, m);
      }
      m.columns.push({ rowIndex, columnIndex });
    })
  );
  return { segments, markers: Array.from(markers.values()).sort((a, b) => seqRank(a.offloadSeq) - seqRank(b.offloadSeq)) };
}

export interface ZoneCell {
  x: number;
  y: number;
  w: number;
  h: number;
  zoneLabel: string | null | undefined;
  zoneColor?: string;
}

export interface OutlineEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ZoneOutline {
  label: string;
  color: string | undefined;
  edges: OutlineEdge[];
}

/** Builds one cell per column through the renderer's own rectangle mapping (percent, px or PDF
 * points — the outline math doesn't care). `rectOf` returning null skips that column. */
export function zoneCellsOf(trailer: PackTrailer, rectOf: (rowIndex: number, columnIndex: number) => { x: number; y: number; w: number; h: number } | null): ZoneCell[] {
  const cells: ZoneCell[] = [];
  trailer.rows.forEach((row, rowIndex) =>
    row.columns.forEach((c, columnIndex) => {
      const label = labelOf(c);
      if (label === null) return;
      const r = rectOf(rowIndex, columnIndex);
      if (r) cells.push({ ...r, zoneLabel: label, zoneColor: c.zoneColor });
    })
  );
  return cells;
}

/** Edge cancellation (legacy buildZoneOutlineSegments + groupZoneCells): all four edges of every
 * cell of a zone; an edge shared by two cells of the SAME zone cancels, so each zone's outline steps
 * around shared rows and each island gets its own. Where two zones touch, both keep the edge. */
export function zoneOutlineEdges(cells: ZoneCell[]): ZoneOutline[] {
  const byLabel = new Map<string, { color: string | undefined; cells: ZoneCell[] }>();
  for (const c of cells) {
    if (c.zoneLabel == null) continue;
    let g = byLabel.get(c.zoneLabel);
    if (!g) {
      g = { color: c.zoneColor, cells: [] };
      byLabel.set(c.zoneLabel, g);
    }
    g.cells.push(c);
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return Array.from(byLabel.entries()).map(([label, g]) => {
    const edges = new Map<string, OutlineEdge & { count: number }>();
    const add = (ax: number, ay: number, bx: number, by: number) => {
      const p1 = [r2(ax), r2(ay)];
      const p2 = [r2(bx), r2(by)];
      const swap = p1[0] > p2[0] || (p1[0] === p2[0] && p1[1] > p2[1]);
      const lo = swap ? p2 : p1;
      const hi = swap ? p1 : p2;
      const key = `${lo[0]},${lo[1]}|${hi[0]},${hi[1]}`;
      const e = edges.get(key);
      if (e) e.count++;
      else edges.set(key, { count: 1, x1: lo[0], y1: lo[1], x2: hi[0], y2: hi[1] });
    };
    for (const c of g.cells) {
      add(c.x, c.y, c.x + c.w, c.y);
      add(c.x, c.y + c.h, c.x + c.w, c.y + c.h);
      add(c.x, c.y, c.x, c.y + c.h);
      add(c.x + c.w, c.y, c.x + c.w, c.y + c.h);
    }
    return {
      label,
      color: g.color,
      edges: Array.from(edges.values())
        .filter((e) => e.count === 1)
        .map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 })),
    };
  });
}

/** Non-blocking: walking DOORS -> WALL (ascending posFromFront), a zone that delivers earlier sits
 * further from the doors than a later one already seen. Zones side by side in one row are fine.
 * Unzoned stacks are ignored. null when the order is fine. */
export function zoneOrderWarning(trailer: PackTrailer): string | null {
  const rows = [...trailer.rows].sort((a, b) => a.posFromFront - b.posFromFront);
  let maxSeq = -Infinity;
  let maxLabel = "";
  for (const row of rows) {
    const zoned = row.columns.filter((c) => typeof c.offloadSeq === "number" && labelOf(c) !== null);
    if (!zoned.length) continue;
    const early = zoned.find((c) => (c.offloadSeq as number) < maxSeq);
    if (early) return `${labelOf(early)} is behind ${maxLabel} — ${maxLabel} has to come off first to reach it.`;
    for (const c of zoned) {
      if ((c.offloadSeq as number) > maxSeq) {
        maxSeq = c.offloadSeq as number;
        maxLabel = labelOf(c) as string;
      }
    }
  }
  return null;
}
