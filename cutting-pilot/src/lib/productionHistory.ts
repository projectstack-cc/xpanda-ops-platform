// src/lib/productionHistory.ts
// Production Log v2 History (prod-c-03): shared types + pure helpers for the history route, the
// History view, and prod-c-04's report. Pure and client-safe — no DB, no React, no DOM.

// `now()` stamps (`YYYY-MM-DD HH:MM:SS`) and ISO strings are both UTC. Returns epoch ms or null.
export function parseUtcTs(ts: string | null | undefined): number | null {
  if (!ts || typeof ts !== "string") return null;
  const s = ts.trim();
  let iso: string;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) iso = s.replace(" ", "T") + "Z";
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) iso = s + "Z";
  else iso = s;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

// Bead aging at mold = block created_at − silo_full_at, hours to 1 dp. Display only — never
// enforced, no target. Null if either is missing or the result is negative.
export function agingHours(createdAt: string | null | undefined, siloFullAt: string | null | undefined): number | null {
  const a = parseUtcTs(createdAt);
  const b = parseUtcTs(siloFullAt);
  if (a === null || b === null) return null;
  const h = (a - b) / 3_600_000;
  if (h < 0) return null;
  return Math.round(h * 10) / 10;
}

export interface HistoryFilters {
  from: string;
  to: string;
  supplier?: string;
  bead_type?: string;
  density?: string;
  block_type?: string;
  lot?: string;
}

// URLSearchParams string of the non-blank filters.
export function filtersToQuery(f: HistoryFilters): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (typeof v === "string" && v.trim() !== "") q.set(k, v.trim());
  }
  return q.toString();
}

// A molding block row + its (non-deleted) session's date, block type and recipe snapshot.
export interface HistoryBlock {
  id: string;
  session_id: string;
  block_no: string | null;
  block_size: string | null;
  silo: number | null;
  lot_no: string | null;
  rc_pct_open: number | null;
  rc_speed: number | null;
  virgin_pct_open: number | null;
  virgin_speed: number | null;
  mold_time: string | null;
  block_weight_lbs: number | null;
  operator_id: string | null;
  operator_name: string | null;
  created_at: string;
  updated_at: string | null;
  bead_supplier: string | null;
  bead_type: string | null;
  density: number | null;
  silo_full_at: string | null;
  // session
  log_date: string;
  block_type: string | null;
  recipe_id: string | null;
  recipe_version: number | null;
  recipe_rc_pct_open: number | null;
  recipe_rc_speed: number | null;
  recipe_virgin_pct_open: number | null;
  recipe_virgin_speed: number | null;
}

// An expansion batch row + its (non-deleted) session header.
export interface HistoryBatch {
  id: string;
  session_id: string;
  lot_no: string | null;
  silo: number | null;
  weight_kg: number | null;
  heating_time_s: number | null;
  bucket_weight_g: number | null;
  operator_id: string | null;
  operator_name: string | null;
  created_at: string;
  updated_at: string | null;
  // session
  log_date: string;
  bead_supplier: string | null;
  bead_type: string | null;
  density: number | null;
  target_weight_g: number | null;
  recipe_id: string | null;
  recipe_version: number | null;
  recipe_density: number | null;
  recipe_heating_time_s: number | null;
  bucket_volume_l: number | null;
}

// prod-c-04's report consumes this shape — keep the name and fields exact.
export interface HistoryData {
  range: { from: string; to: string };
  blocks: HistoryBlock[];
  batches: HistoryBatch[];
  facets: { densities: number[]; block_types: string[] };
  truncated: { blocks: boolean; batches: boolean };
}
