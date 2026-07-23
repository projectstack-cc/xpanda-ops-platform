// src/lib/truckType.ts
// Maps the schedule sheet's free-text `method` column (col D) to a short truck-type code for
// the TV board's load column. The sheet is hand-entered, so matching is case-insensitive and
// whitespace-tolerant (confirmed live variants: "FLATBED", "dry van", "XPanda truck"). Anything
// unrecognized (CPU, HAND DELIVER, blank, etc.) falls through to the raw method text — never
// invent a code, never blank it.
const TRUCK_TYPE_MATCHERS: Array<{ test: (normalized: string) => boolean; code: string }> = [
  { test: (m) => m.includes("flatbed"), code: "FB" },
  { test: (m) => m.includes("dry van"), code: "TL" },
  { test: (m) => m.includes("xpanda"), code: "XP" },
];

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The short code (FB/TL/XP) for a known method, or the raw trimmed text for anything else. */
export function truckTypeCode(method: string | null): string {
  const raw = (method ?? "").trim();
  if (!raw) return "";
  const normalized = normalize(raw);
  const match = TRUCK_TYPE_MATCHERS.find((m) => m.test(normalized));
  return match ? match.code : raw;
}

/** `<CODE> x<N>` for the load column, or the code alone when `load_count` is NULL (continuation rows). */
export function formatLoadLabel(method: string | null, loadCount: number | null): string {
  const code = truckTypeCode(method);
  if (loadCount == null) return code;
  return code ? `${code} x${loadCount}` : `x${loadCount}`;
}
