// ord-dims-01: an order line with a part # or description must have dimensions.
// Blank-only check (tapers like 0-2" are valid; any typed text passes).
export interface DimCheckLine { part_number?: unknown; description?: unknown; dimensions?: unknown }

const t = (v: unknown) => String(v ?? "").trim();

/** 1-based positions (in the array as given) of real lines with blank dimensions. */
export function linesMissingDims(items: readonly DimCheckLine[]): number[] {
  const out: number[] = [];
  items.forEach((raw, i) => {
    const li = raw ?? {};
    const real = t(li.part_number) !== "" || t(li.description) !== "";
    if (real && t(li.dimensions) === "") out.push(i + 1);
  });
  return out;
}

/** User-facing message, or null when every real line has dims. */
export function missingDimsMessage(items: readonly DimCheckLine[]): string | null {
  const lines = linesMissingDims(items);
  if (!lines.length) return null;
  return lines.length === 1
    ? `Line ${lines[0]} has no dimensions. Add dimensions or remove the line before saving.`
    : `Lines ${lines.join(", ")} have no dimensions. Add dimensions or remove the lines before saving.`;
}
