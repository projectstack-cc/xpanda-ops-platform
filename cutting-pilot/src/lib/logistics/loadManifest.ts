// src/lib/logistics/loadManifest.ts
// lgx-loadsheet-02: the per-load item list a load builder captures at BOL generation, stored as JSON
// on bols.load_manifest so the loading sheet can print one sheet per load. Written by both load
// builders (legacy load-builder.html via bol-compose.js, v2 BolGenerateModal) through the two BOL
// POST handlers; BOL edits (PUT) never touch it, so hand-editing a BOL's commodity text never
// changes the sheet. The legacy worker (_worker.js/routes/bols.js) can't import TS and reproduces
// parseLoadManifest's rule inline — keep the two in step.

export interface LoadManifestItem {
  /** SKU display name (legacy item.name / v2 PieceTableRow.name). */
  name: string;
  /** SKU code; "" when none. */
  sku: string;
  /** "L x W x H" in inches, plain numbers, e.g. "48 x 96 x 10.25"; "" if unknown. */
  dims: string;
  /** Integer > 0. */
  pieces: number;
}

/** Accepts a JSON string or an array. Keeps only items with a non-empty name and finite pieces > 0
 * (pieces rounded to an integer, at least 1). null when the input is empty, malformed, or yields no items. */
export function parseLoadManifest(raw: unknown): LoadManifestItem[] | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    if (!value.trim()) return null;
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  const items: LoadManifestItem[] = [];
  for (const it of value) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const n = Number(o.pieces);
    if (!name || !Number.isFinite(n) || n <= 0) continue;
    const pieces = Math.max(1, Math.round(n));
    items.push({
      name,
      sku: typeof o.sku === "string" ? o.sku.trim() : "",
      dims: typeof o.dims === "string" ? o.dims.trim() : "",
      pieces,
    });
  }
  return items.length ? items : null;
}
