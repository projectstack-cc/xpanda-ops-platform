// src/lib/partMatch.ts
// P432 — logic port of jobs/index.html's client-side line-item → parts-library matcher (unported
// in the original v2 order flow). Multi-pass: exact part_number token, dimension match (±0.25"),
// Holey-Board-by-thickness, Holey-Board-by-height. BILATERAL PARITY: keep in sync with the legacy
// matchLineItemToPart / parseDimensionValues in jobs/index.html.

export interface Part {
  id: string;
  part_number: string;
  name?: string;
  customer?: string;
  category?: string;
  density_material?: string;
  length_in: number | string;
  width_in: number | string;
  height_in: number | string;
}

export interface MatchableLine {
  description?: string;
  category?: string;
  dimensions?: string;
  thickness?: number;
}

export interface MatchResult {
  part: Part;
  method: string;
}

function num(v: number | string | undefined | null): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : NaN;
}

export function parseDimensionValues(
  dimStr: string | undefined | null
): { length: number; width: number; height: number } | null {
  if (!dimStr) return null;
  const s = dimStr.replace(/[“”„‟""]/g, '"').replace(/[×xX]/g, "x");
  const parts = s.split(/\s*x\s*/i);
  if (parts.length < 2) return null;
  const parseInches = (raw: string): number | null => {
    const str = raw.replace(/["'\s]/g, "").trim();
    const mixed = str.match(/^(\d+)-(\d+)\/(\d+)$/);
    if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
    const frac = str.match(/^(\d+)\/(\d+)$/);
    if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
    const n = parseFloat(str);
    return Number.isNaN(n) ? null : n;
  };
  const length = parseInches(parts[0]);
  const width = parseInches(parts[1]);
  const height = parts.length >= 3 ? parseInches(parts[2]) : null;
  if (length === null || width === null) return null;
  return { length, width, height: height ?? width };
}

export function matchLineItemToPart(
  lineItem: MatchableLine,
  partsLibrary: Part[]
): MatchResult | null {
  const desc = (lineItem.description || "").toLowerCase();
  const cat = (lineItem.category || "").toLowerCase();
  const dims = lineItem.dimensions || "";
  const parsedDims = parseDimensionValues(dims);
  const partNumRe = /\b([A-Z]{1,4}[-]?\d{2,6}[-]?\d{0,4})\b/gi;

  // Pass 1: exact part_number token — description first, then category.
  for (const src of [desc, cat]) {
    const candidates = src.match(partNumRe) || [];
    for (const c of candidates) {
      const hit = partsLibrary.find(
        (p) => (p.part_number || "").toLowerCase() === c.toLowerCase()
      );
      if (hit) return { part: hit, method: "part_number" };
    }
  }

  // Pass 2: exact dimension match (±0.25").
  if (parsedDims) {
    const tol = 0.25;
    const dimMatches = partsLibrary.filter(
      (p) =>
        Math.abs(num(p.length_in) - parsedDims.length) <= tol &&
        Math.abs(num(p.width_in) - parsedDims.width) <= tol &&
        Math.abs(num(p.height_in) - parsedDims.height) <= tol
    );
    if (dimMatches.length === 1) return { part: dimMatches[0], method: "dimensions" };
    if (dimMatches.length > 1) {
      const narrowed = dimMatches.find((p) => {
        const pDesc = `${p.name ?? ""} ${p.part_number} ${p.customer ?? ""} ${p.density_material ?? ""}`.toLowerCase();
        if (desc.includes("holey board") || desc.includes("insulperm") || cat.includes("holey board"))
          return p.category === "Holey Board";
        if (desc.includes("laminate") || cat.includes("laminate"))
          return pDesc.includes("laminate") || p.category === "Sheets";
        if (desc.includes("plug")) return pDesc.includes("plug");
        if (desc.includes("notch")) return pDesc.includes("notch");
        return false;
      });
      if (narrowed) return { part: narrowed, method: "dimensions+keyword" };
      return { part: dimMatches[0], method: "dimensions_fuzzy" };
    }
  }

  // Pass 3b: Holey Board by thickness (footprint-agnostic; catalog keyed by height_in).
  {
    const isHB =
      desc.includes("holey board") || desc.includes("insulperm") || /\bHB\b/i.test(desc) ||
      cat.includes("holey board") || /\bHB\b/i.test(cat);
    let thickness = typeof lineItem.thickness === "number" ? lineItem.thickness : null;
    if (isHB && thickness == null) {
      const src = `${dims} ${desc} ${cat}`.replace(/\([^)]*\)/g, " ");
      const tm = Array.from(src.matchAll(/(\d+(?:\.\d+)?)\s*["“”″]/g));
      if (tm.length) thickness = parseFloat(tm[tm.length - 1][1]);
    }
    if (isHB && thickness != null && !Number.isNaN(thickness)) {
      const thk = thickness;
      const hbByThk = partsLibrary.filter(
        (p) => p.category === "Holey Board" && Math.abs(num(p.height_in) - thk) <= 0.1
      );
      if (hbByThk.length) {
        const pref = hbByThk.find((p) => {
          const h = `${p.name ?? ""} ${p.part_number} ${p.customer ?? ""} ${p.density_material ?? ""}`.toLowerCase();
          if (desc.includes("siplast") || cat.includes("siplast")) return h.includes("siplast");
          if (desc.includes("1.0") || cat.includes("1.0")) return h.includes("1.0");
          return false;
        });
        return { part: pref || hbByThk[0], method: "holey_board_thickness" };
      }
    }
  }

  // Pass 3: Holey Board by height.
  if (
    (desc.includes("holey board") || desc.includes("insulperm") || /\bHB\b/i.test(desc) ||
      cat.includes("holey board") || /\bHB\b/i.test(cat)) &&
    parsedDims
  ) {
    const hb = partsLibrary.find(
      (p) =>
        p.category === "Holey Board" &&
        Math.abs(num(p.height_in) - parsedDims.height) <= 0.25 &&
        Math.abs(num(p.length_in) - parsedDims.length) <= 0.5 &&
        Math.abs(num(p.width_in) - parsedDims.width) <= 0.5
    );
    if (hb) return { part: hb, method: "holey_board_height" };
  }

  return null;
}

// Cached parts-library fetch (legacy /api/parts, same host + shared session cookie).
let partsCache: Part[] | null = null;
export async function loadPartsLibrary(): Promise<Part[]> {
  if (partsCache) return partsCache;
  const res = await fetch("/api/parts");
  const body = await res.json();
  if (!res.ok || !body?.ok) throw new Error("parts load failed");
  partsCache = (body.parts as Part[]) || [];
  return partsCache;
}
