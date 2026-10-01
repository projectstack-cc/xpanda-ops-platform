// src/lib/bdft.ts
// qb-01: extracted verbatim from OrderEntryForm.tsx so order entry and the QuickBooks invoice
// mapper share one board-foot calculation. computeTotalBdft takes a structural line type so both
// string (form) and numeric (mapper) quantities work.

// Board-foot per piece = (L × W × H) / 144 (inches). Ported from jobs/index.html's
// liBdftPerPiece — same "L x W x H" free-text convention, fractions included. Returns null
// (contributes 0 to the total) when the dimensions string doesn't parse to three positive numbers.
export function bdftPerPiece(dimStr: string): number | null {
  if (!dimStr) return null;
  const parts = dimStr.replace(/[“”„‟""]/g, '"').split(/\s*[x×X]\s*/i);
  if (parts.length < 3) return null;
  const num = (s: string): number | null => {
    const t = s.replace(/["'\s]/g, "").trim();
    let m = t.match(/^(\d+)-(\d+)\/(\d+)$/);
    if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
    m = t.match(/^(\d+)\/(\d+)$/);
    if (m) return Number(m[1]) / Number(m[2]);
    const n = parseFloat(t);
    return isNaN(n) ? null : n;
  };
  const L = num(parts[0]), W = num(parts[1]), H = num(parts[2]);
  if ([L, W, H].some((v) => v == null || v <= 0)) return null;
  return ((L as number) * (W as number) * (H as number)) / 144;
}

export function computeTotalBdft(items: Array<{ dimensions: string; quantity: string | number }>): number {
  let total = 0;
  for (const li of items) {
    const bpp = bdftPerPiece(li.dimensions);
    const qty = parseFloat(String(li.quantity));
    if (bpp != null && Number.isFinite(qty) && qty > 0) total += bpp * qty;
  }
  return Math.round(total * 100) / 100;
}
