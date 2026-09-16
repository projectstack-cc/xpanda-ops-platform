// src/lib/jobPull.ts
// lb-ui-05 Part A: job pull-in -> cart. Pure functions only (no React, no fetch) -- mirrors
// dissolve.ts staying headless. Takes already-fetched job line items and an already-fetched SKU
// set, returns a match result the caller (JobPullModal.tsx) turns into a CartLine[].
//
// Ports legacy's prefillFromJob (logistics/load-builder.html:2970-3034) faithfully: match order is
// part_id -> part_number -> parsed dimensions, first hit wins. The one piece of prefillFromJob NOT
// ported is on-the-fly part creation for an unmatched line (createPartOnTheFly, :2752) -- that
// writes to the unfenced production /api/parts, explicitly deferred to this sprint's Phase 3 (see
// Prompts/sprint-load-builder-parity.md). An unmatched line stays unmatched here; the caller
// surfaces it as a warning instead of silently creating or dropping it.
import type { CartLine, PackSku } from "./packEngine";

export interface JobLineItem {
  id: string;
  job_id: string;
  part_id: string | null;
  part_number: string;
  description: string;
  quantity: number;
  dimensions: string;
  sort_order: number;
}

export interface DimensionParseResult {
  length: number;
  width: number;
  height: number;
}

// Ported byte-for-byte from legacy's parseDimensionString (logistics/load-builder.html:2731-2750),
// including the `height: height || width` fallback for a two-part "L x W" string (no third
// segment) -- a legacy quirk (implicit square footprint), kept faithfully rather than "fixed" here.
export function parseDimensionString(raw: string): DimensionParseResult | null {
  if (!raw) return null;
  const normalized = raw.replace(/[“”„‟]/g, '"').replace(/[×xX]/g, "x");
  const parts = normalized.split(/\s*x\s*/i);
  if (parts.length < 2) return null;

  function parseInches(str: string): number | null {
    const s = str.replace(/["\s]/g, "").trim();
    const mixed = s.match(/^(\d+)-(\d+)\/(\d+)$/);
    if (mixed) return parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / parseInt(mixed[3], 10);
    const frac = s.match(/^(\d+)\/(\d+)$/);
    if (frac) return parseInt(frac[1], 10) / parseInt(frac[2], 10);
    const num = parseFloat(s);
    return Number.isNaN(num) ? null : num;
  }

  const length = parseInches(parts[0]);
  const width = parseInches(parts[1]);
  const height = parts.length >= 3 ? parseInches(parts[2]) : null;
  if (length === null || width === null) return null;
  return { length, width, height: height || width };
}

export interface JobPullMatch {
  lineItem: JobLineItem;
  matchedSkuId: string | null;
}

const DIM_TOLERANCE = 0.1;

/** Match order: part_id exact -> part_number exact (case-insensitive, against sku.sku) -> parsed
 * dimensions (length/width/height each within 0.1in) -- first hit wins, mirroring legacy exactly.
 * A line matching nothing on any of the three still appears in the result, matchedSkuId: null. */
export function matchLineItemsToSkus(lineItems: JobLineItem[], skus: PackSku[]): JobPullMatch[] {
  return lineItems.map((lineItem) => {
    let matched: PackSku | undefined;

    if (lineItem.part_id) {
      matched = skus.find((s) => s.id === lineItem.part_id);
    }
    if (!matched && lineItem.part_number) {
      const needle = lineItem.part_number.toLowerCase();
      matched = skus.find((s) => (s.sku || "").toLowerCase() === needle);
    }
    if (!matched && lineItem.dimensions) {
      const dims = parseDimensionString(lineItem.dimensions);
      if (dims) {
        matched = skus.find(
          (s) =>
            Math.abs(s.length - dims.length) < DIM_TOLERANCE &&
            Math.abs(s.width - dims.width) < DIM_TOLERANCE &&
            Math.abs(s.height - dims.height) < DIM_TOLERANCE
        );
      }
    }

    return { lineItem, matchedSkuId: matched ? matched.id : null };
  });
}

/** Excludes unmatched lines; sums quantity for a SKU appearing across more than one line item
 * (legacy's cartMap Map-accumulation behavior, prefillFromJob :3017-3018) -- first-seen order
 * preserved via Map insertion order. */
export function buildCartFromMatches(matches: JobPullMatch[]): CartLine[] {
  const bySkuId = new Map<string, number>();
  for (const m of matches) {
    if (!m.matchedSkuId) continue;
    bySkuId.set(m.matchedSkuId, (bySkuId.get(m.matchedSkuId) ?? 0) + (m.lineItem.quantity || 0));
  }
  return Array.from(bySkuId.entries()).map(([skuId, qty]) => ({ skuId, qty }));
}

// Mirrors packEngine.ts's private, unexported colorForSku (same palette array, same hash) so the
// pull preview's per-SKU swatch is the EXACT color that SKU will render as on the trailer diagram
// once pack() runs -- not just "a" distinct color, THE color the planner will see next. Deliberately
// duplicated rather than imported: packEngine.ts is closed/ratchet-guarded and does not export this
// helper. Keep this palette/hash in sync if a future engine prompt ever changes packEngine.ts's own
// copy -- flagged in BACKLOG.md as a follow-up to export it instead and remove this duplicate.
const SKU_COLOR_PALETTE = [
  "#D97706", "#0F766E", "#2563EB", "#7C3AED", "#DC2626", "#059669", "#9333EA", "#0891B2",
  "#CA8A04", "#4F46E5", "#EA580C", "#16A34A", "#0284C7", "#BE123C", "#A21CAF", "#4338CA",
];

export function colorForSkuId(skuId: string): string {
  let hash = 0;
  for (let i = 0; i < skuId.length; i++) hash = (hash * 31 + skuId.charCodeAt(i)) % SKU_COLOR_PALETTE.length;
  return SKU_COLOR_PALETTE[Math.abs(hash) % SKU_COLOR_PALETTE.length];
}

// lb-ui-05/lb-ui-11: /api/load-builder-skus — a camelCase wrapper over the same `parts` D1 table
// PartsLibraryPanel.tsx manages via /api/parts (partsLibrary.ts's own header comment) — already
// returns records close enough to PackSku shape that coerceSku below only needs to validate/coerce
// types, not remap field names. Originally local to JobPullModal.tsx (lb-ui-05); moved here so
// lb-ui-11's parts-library-in-custom-builds picker (CustomizeEditor.tsx) can fetch the exact same
// SKU universe a job pull already draws from, rather than inventing a second conversion off
// PartRecord's snake_case /api/parts shape for the same underlying table.
function coerceSku(raw: any): PackSku | null {
  const length = Number(raw?.length);
  const width = Number(raw?.width);
  const height = Number(raw?.height);
  const weight = Number(raw?.weight);
  if (!raw?.id || !Number.isFinite(length) || length <= 0 || !Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  return {
    id: String(raw.id),
    name: String(raw.name || raw.sku || raw.id),
    sku: String(raw.sku || ""),
    length,
    width,
    height,
    weight: Number.isFinite(weight) && weight > 0 ? weight : 1,
    category: raw.category || undefined,
    allowRotation: !!raw.allowRotation,
    bundleQty: Number.isFinite(Number(raw.bundleQty)) && Number(raw.bundleQty) > 0 ? Number(raw.bundleQty) : undefined,
  };
}

export async function fetchLoadBuilderSkus(): Promise<PackSku[]> {
  const res = await fetch("/api/load-builder-skus");
  const json = await res.json();
  if (!res.ok || !Array.isArray(json)) throw new Error("Couldn't load the SKU library.");
  return json.map(coerceSku).filter((s): s is PackSku => s !== null);
}
