// src/lib/zoneBol.ts
// lbz-v2-04: the zone data a zoned trailer's BOL carries (render_overrides.zoneColumns.zoneData), built
// from THIS truck's stacks only — zoneSegments(trailer) (lbz-v2-03) plus a port of legacy's
// enrichZoneSkuBreakdown (logistics/load-builder.html): each breakdown entry gains `height` from the
// SKU and `density` from the job's line items matching part_id + offload_seq + zone_label, set only
// when exactly one distinct density matches (never guess a density onto a BOL). Pure. Output matches
// bolShared.ts's ZoneSegment / ZoneColumnSkuBreakdownEntry; bolShared.ts itself is not touched.
import type { PackSku, PackTrailer } from "./packEngine";
import type { JobZoneLineItem, ZoneColumnSkuBreakdownEntry, ZoneSegment as BolZoneSegment } from "./bolShared";
import { zoneSegments } from "./zoneLayout";

export type BolZoneData = BolZoneSegment & { startX: number; endX: number; pieces: number; skuBreakdown: Record<string, ZoneColumnSkuBreakdownEntry> };

/** A line item's offload_seq as the number zonedPack stamped (D1 gives a number; tolerate a string). */
function seqOf(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** The zones on this truck with this truck's quantities, in delivery order, enriched for the BOL.
 * Empty on a non-zoned trailer. `jobLineItems` null/empty (a manual load) = no densities. */
export function buildBolZoneData(trailer: PackTrailer, skus: PackSku[], jobLineItems: JobZoneLineItem[] | null | undefined): BolZoneData[] {
  const lines = Array.isArray(jobLineItems) ? jobLineItems : [];
  const skuById = new Map(skus.map((s) => [s.id, s]));
  return zoneSegments(trailer).map((seg) => {
    const skuBreakdown: Record<string, ZoneColumnSkuBreakdownEntry> = {};
    for (const entry of Object.values(seg.skuBreakdown)) {
      const skuId = entry.skuId ?? "";
      const sku = skuById.get(skuId);
      const matches = lines.filter(
        (li) => String(li.part_id ?? "") === skuId && seqOf(li.offload_seq) === (seg.offloadSeq ?? null) && (li.zone_label || "").trim() === (seg.label || "")
      );
      const densities = Array.from(new Set(matches.map((li) => (li.density || "").trim()).filter(Boolean)));
      skuBreakdown[skuId] = { ...entry, height: sku ? sku.height : null, density: densities.length === 1 ? densities[0] : null };
    }
    const out: BolZoneData = { offloadSeq: seg.offloadSeq, label: seg.label, startX: seg.startX, endX: seg.endX, pieces: seg.pieces, skuBreakdown };
    if (seg.color !== undefined) out.color = seg.color;
    return out;
  });
}
