// Pure PO-line parser for the Block Nesting module. No DOM, no Cloudflare context — usable
// client- or server-side. See src/lib/blockTypes.ts for the SkuLine contract.
import type { SkuLine } from "./blockTypes";

export interface PoInputRow {
  item: string;
  desc: string;
  qty: number;
}

interface DecodedSku {
  width: number;
  length: number;
  tlo: number;
  thi: number;
  density: number;
}

// Format: A x (B x C) x D - E#
//   A = width, (B x C) = taper heights (either order), D = length, E = density in #.
// Messy variants this MUST tolerate (seen in the real sheet, validated by hand against PO#1):
//   - case-insensitive x/X, extra spaces inside parens: "(5 x 6)", "( 3x5 )"
//   - missing the "x" before D: "41.25 X (4X2) 84.25 - 1.5#"
//   - no "#" and/or no dash before E: "46.13 x (3x4) x 92.25 - 1.5", "... - 2"
//   - trailing notes/newlines/parenthetical suffixes after E — anything past the density
//     number is simply not captured, so it's ignored for free.
const SKU_REGEX =
  /([\d.]+)\s*[xX]\s*\(\s*([\d.]+)\s*[xX]\s*([\d.]+)\s*\)\s*[xX]?\s*([\d.]+)\s*-?\s*([\d.]+)?/;

/** Decodes one PO line description. Returns null if the row can't be decoded (goes to the
 *  grid as an unparsed row rather than being dropped). */
export function parseSkuDescription(desc: string): DecodedSku | null {
  const m = SKU_REGEX.exec(desc ?? "");
  if (!m) return null;

  const width = parseFloat(m[1]);
  const b = parseFloat(m[2]);
  const c = parseFloat(m[3]);
  const length = parseFloat(m[4]);
  const density = m[5] !== undefined ? parseFloat(m[5]) : NaN;

  if ([width, b, c, length, density].some((n) => Number.isNaN(n))) return null;

  // tlo/thi normalization: 2>4 and 4>2 are the same part.
  return { width, length, tlo: Math.min(b, c), thi: Math.max(b, c), density };
}

function skuKey(d: DecodedSku): string {
  return `${d.width}|${d.length}|${d.tlo}|${d.thi}|${d.density}`;
}

/** Parses raw PO rows into SkuLines. Rows that decode to the identical SKU (same
 *  width/length/tlo/thi/density — including a taper-order flip like 4>2 vs 2>4, which
 *  normalizes to the same tlo/thi) are combined by summing qty. Unparsed rows are kept
 *  individually and flagged, never dropped, so they can be hand-corrected in the grid. */
export function parsePoRows(rows: PoInputRow[]): SkuLine[] {
  const out: SkuLine[] = [];
  const indexByKey = new Map<string, number>();

  for (const row of rows) {
    const desc = row.desc ?? "";
    const qty = row.qty ?? 0;
    if (!desc.trim() && !qty) continue; // fully blank spreadsheet row

    const decoded = parseSkuDescription(desc);
    if (!decoded) {
      out.push({
        item: row.item ?? "",
        width: 0,
        length: 0,
        tlo: 0,
        thi: 0,
        density: 0,
        qty,
        parsed: false,
        raw: desc,
      });
      continue;
    }

    const key = skuKey(decoded);
    const existingIdx = indexByKey.get(key);
    if (existingIdx !== undefined) {
      out[existingIdx].qty += qty;
    } else {
      indexByKey.set(key, out.length);
      out.push({
        item: row.item ?? "",
        width: decoded.width,
        length: decoded.length,
        tlo: decoded.tlo,
        thi: decoded.thi,
        density: decoded.density,
        qty,
        parsed: true,
        raw: desc,
      });
    }
  }

  return out;
}
