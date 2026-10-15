// src/lib/coreCoverLabels.ts
// jb-12 adapter: job line items → SkuLine[], so the job board (/v2/board) can print Core Covers
// bag labels through bagLabels.ts (the Block Calculator's P413/P417 generator). Pure module (no
// DOM, no React).
//
// Expected input (live D1, Prestige Spas LLC aka CORE COVERS, 2026-10-15):
//   description: 1.5# VIRGIN - TAPERED - BAGGED - LABEL — DIRECTLY ON FOAM DIMENSIONS, INCLUDING TAPER — Item 2136 — 2-4" x 53" x 96"
//   dimensions:  2-4" x 53" x 96"      (taper lo-hi x width x length)
//   density:     1.5 V                  (also seen: 2.0 V)
//   quantity:    16
//   part_number: ""                     (empty — the SKU lives in the description as "Item NNNN")
// → SKU 2136, SIZE 53 × (2×4) × 96, DENSITY 1.5#.
import type { SkuLine } from "./blockTypes";

export interface CoreCoverLineItem {
  part_number?: string | null;
  description?: string | null;
  quantity?: number | string | null;
  dimensions?: string | null;
  density?: string | null;
}

/** Case-insensitive "core covers" anywhere in the name (real name: "Prestige Spas LLC aka CORE COVERS"). */
export function isCoreCoversCustomer(customer: string | null | undefined): boolean {
  return !!customer && customer.toLowerCase().includes("core covers");
}

/** SKU shown on the label: "Item NNNN" from the description → "NNNN"; else trimmed part_number;
 *  else "" (caller treats "" as unparsed). */
export function coreCoverItemNumber(li: CoreCoverLineItem): string {
  const m = /\bItem\s+([A-Za-z0-9][A-Za-z0-9.\-]*)/i.exec(li.description || "");
  if (m) return m[1];
  return (li.part_number || "").trim();
}

function parseDims(li: CoreCoverLineItem): { width: number; tlo: number; thi: number; length: number } | null {
  let src = (li.dimensions || "").trim();
  if (!src) {
    const segs = (li.description || "").split("—");
    src = segs.length > 1 ? segs[segs.length - 1].trim() : "";
  }
  if (!src) return null;
  const tokens = src.replace(/["″]/g, "").split(/\s*[xX×]\s*/).map((t) => t.trim());
  if (tokens.length !== 3) return null;
  const taperIdx = tokens.findIndex((t) => /^([\d.]+)\s*-\s*([\d.]+)$/.test(t));
  if (taperIdx < 0) return null;
  const tm = /^([\d.]+)\s*-\s*([\d.]+)$/.exec(tokens[taperIdx])!;
  const a = parseFloat(tm[1]);
  const b = parseFloat(tm[2]);
  const rest = tokens.filter((_, i) => i !== taperIdx).map((t) => parseFloat(t));
  const out = { width: rest[0], tlo: Math.min(a, b), thi: Math.max(a, b), length: rest[1] };
  if ([out.width, out.tlo, out.thi, out.length].some((n) => Number.isNaN(n))) return null;
  return out;
}

function parseDensity(li: CoreCoverLineItem): number {
  let d = parseFloat(li.density || "");
  if (Number.isNaN(d)) {
    const m = /([\d.]+)\s*#/.exec(li.description || "");
    d = m ? parseFloat(m[1]) : NaN;
  }
  return d;
}

/** One SkuLine per line item, same order, NEVER merged. parsed=false (with raw = the source text)
 *  when the item number, taper, width, length or density can't be read. */
export function coreCoverSkuLines(items: CoreCoverLineItem[]): SkuLine[] {
  return items.map((li) => {
    const item = coreCoverItemNumber(li);
    const dims = parseDims(li);
    const density = parseDensity(li);
    const qty = Number(li.quantity) || 0;
    const raw = li.description || li.dimensions || "";
    const parsed = !!item && !!dims && !Number.isNaN(density) && density > 0;
    return {
      item,
      width: dims?.width ?? 0,
      length: dims?.length ?? 0,
      tlo: dims?.tlo ?? 0,
      thi: dims?.thi ?? 0,
      density: Number.isNaN(density) ? 0 : density,
      qty,
      parsed,
      raw,
    };
  });
}
