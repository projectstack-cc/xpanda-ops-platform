// src/lib/productionRecipes.ts
// Production Log v2 Group C recipes (prod-c-01). Pure density helpers + recipe/snapshot lookups.
// Recipes prefill, never block: a sheet with no matching recipe gets recipe_id = NULL. Recipes are
// versioned and immutable — an edit inserts version N+1 and retires the prior one; sheets snapshot
// the recipe values at create, so later edits never rewrite history. No React, no DOM, and no
// server-only imports (types only) so the pure helpers are client-safe.
import type { D1Database } from "@cloudflare/workers-types";

// The expansion bucket is 1 L. Also snapshotted onto each expansion sheet (bucket_volume_l) so a
// future bucket change doesn't corrupt historical pcf.
export const BUCKET_VOLUME_L = 1;
export const G_PER_L_PER_PCF = 16.0185;

// Decimal rounding via exponent notation so 1.255 -> 1.26 (v * 100 would give 125.4999…).
const round = (v: number, dp: number) => Number(`${Math.round(Number(`${v}e${dp}`))}e-${dp}`);

const posOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// Finite density > 0, rounded to 2 dp; else null.
export function normDensity(v: unknown): number | null {
  const n = posOrNull(v);
  return n === null ? null : posOrNull(round(n, 2));
}

// pcf = bucket_g / (16.0185 × V_L), 3 dp. Null unless both inputs are finite and > 0.
export function pcfFromBucket(bucketG: number | null, volumeL: number | null): number | null {
  const g = posOrNull(bucketG);
  const v = posOrNull(volumeL);
  if (g === null || v === null) return null;
  return posOrNull(round(g / (G_PER_L_PER_PCF * v), 3));
}

// Target bucket grams = pcf × 16.0185 × V_L, 1 dp. Same null rules.
export function targetGramsFromPcf(pcf: number | null, volumeL: number | null): number | null {
  const d = posOrNull(pcf);
  const v = posOrNull(volumeL);
  if (d === null || v === null) return null;
  return posOrNull(round(d * G_PER_L_PER_PCF * v, 1));
}

export interface RecipeRow {
  id: string;
  recipe_key: string;
  version: number;
  kind: "expansion" | "molding";
  bead_supplier: string | null;
  bead_type: string | null;
  density: number | null;
  block_type: string | null;
  heating_time_s: number | null;
  rc_pct_open: number | null;
  rc_speed: number | null;
  virgin_pct_open: number | null;
  virgin_speed: number | null;
  notes: string | null;
  active: number;
  created_by: string | null;
  created_at: string;
  retired_by: string | null;
  retired_at: string | null;
}

// Active expansion recipe on an exact supplier + bead type + density (normalized) match.
export async function resolveExpansionRecipe(
  DB: D1Database,
  supplier: string | null | undefined,
  beadType: string | null | undefined,
  density: unknown
): Promise<RecipeRow | null> {
  const d = normDensity(density);
  if (!supplier || !beadType || d === null) return null;
  return DB.prepare(
    `SELECT * FROM production_recipes
      WHERE kind = 'expansion' AND active = 1 AND bead_supplier = ? AND bead_type = ? AND density = ?`
  ).bind(supplier, beadType, d).first<RecipeRow>();
}

// Active molding recipe for a block type.
export async function resolveMoldingRecipe(
  DB: D1Database,
  blockType: string | null | undefined
): Promise<RecipeRow | null> {
  if (!blockType) return null;
  return DB.prepare(
    `SELECT * FROM production_recipes WHERE kind = 'molding' AND active = 1 AND block_type = ?`
  ).bind(blockType).first<RecipeRow>();
}

export interface BlockBeadSnapshot {
  bead_supplier: string | null;
  bead_type: string | null;
  density: number | null;
  silo_full_at: string | null;
}

// Bead snapshot for a block, derived from HISTORY (not the silo's current state, which may hold a
// different lot by now). Used only for manager silo/lot corrections on an existing block. Any field
// not found is null — never keep a stale value.
export async function deriveBlockBeadSnapshot(
  DB: D1Database,
  siloNo: number | null,
  lotNo: string | null,
  atTs: string
): Promise<BlockBeadSnapshot> {
  const empty: BlockBeadSnapshot = { bead_supplier: null, bead_type: null, density: null, silo_full_at: null };
  if (siloNo === null || !lotNo) return empty;
  const bead = await DB.prepare(
    `SELECT s.bead_supplier, s.bead_type, s.density
       FROM production_expansion_batches b
       JOIN production_expansion_sessions s ON s.id = b.session_id AND s.deleted_at IS NULL
      WHERE b.silo = ? AND b.lot_no = ? AND b.created_at <= ?
      ORDER BY b.created_at DESC LIMIT 1`
  ).bind(siloNo, lotNo, atTs).first<{ bead_supplier: string | null; bead_type: string | null; density: number | null }>();
  const full = await DB.prepare(
    `SELECT created_at FROM production_silo_events
      WHERE silo_no = ? AND lot_no = ? AND to_state = 'full' AND created_at <= ?
      ORDER BY created_at DESC LIMIT 1`
  ).bind(siloNo, lotNo, atTs).first<{ created_at: string }>();
  return {
    bead_supplier: bead?.bead_supplier ?? null,
    bead_type: bead?.bead_type ?? null,
    density: bead?.density ?? null,
    silo_full_at: full?.created_at ?? null,
  };
}

export interface RecipeValues {
  heating_time_s: number | null;
  rc_pct_open: number | null;
  rc_speed: number | null;
  virgin_pct_open: number | null;
  virgin_speed: number | null;
}

// Server-side value validation shared by recipe create (POST) and new-version (PUT). Expansion:
// heating_time_s finite > 0, molding fields stored NULL. Molding: all four setpoints finite >= 0,
// the two % fields <= 100, heating time stored NULL.
export function validateRecipeValues(
  kind: "expansion" | "molding",
  p: Record<string, unknown>
): { ok: true; values: RecipeValues } | { ok: false; error: "heating_time_required" | "invalid_param"; detail: string } {
  const num = (v: unknown) => (v === undefined || v === null || v === "" ? NaN : Number(v));
  if (kind === "expansion") {
    const h = num(p.heating_time_s);
    if (!(Number.isFinite(h) && h > 0)) return { ok: false, error: "heating_time_required", detail: "heating_time_s" };
    return { ok: true, values: { heating_time_s: h, rc_pct_open: null, rc_speed: null, virgin_pct_open: null, virgin_speed: null } };
  }
  const out: Record<string, number> = {};
  for (const f of ["rc_pct_open", "rc_speed", "virgin_pct_open", "virgin_speed"] as const) {
    const n = num(p[f]);
    if (!(Number.isFinite(n) && n >= 0) || (f.endsWith("_pct_open") && n > 100)) {
      return { ok: false, error: "invalid_param", detail: f };
    }
    out[f] = n;
  }
  return {
    ok: true,
    values: {
      heating_time_s: null,
      rc_pct_open: out.rc_pct_open, rc_speed: out.rc_speed,
      virgin_pct_open: out.virgin_pct_open, virgin_speed: out.virgin_speed,
    },
  };
}

// prod-c-02: row field -> session recipe-snapshot column, per board (deviation markers).
export const MOLDING_RECIPE_FIELDS = {
  rc_pct_open: "recipe_rc_pct_open",
  rc_speed: "recipe_rc_speed",
  virgin_pct_open: "recipe_virgin_pct_open",
  virgin_speed: "recipe_virgin_speed",
} as const;
export const EXPANSION_RECIPE_FIELDS = { heating_time_s: "recipe_heating_time_s" } as const;

/**
 * True only when both are finite numbers and differ. Null/undefined on either side → false.
 * Numeric strings are coerced with Number() first ("45" vs 45 → no deviation); blank strings
 * count as missing. Exact inequality — no tolerance band (Steve's call).
 */
export function isRecipeDeviation(value: unknown, recipeValue: unknown): boolean {
  const n = (v: unknown) => (v === null || v === undefined || v === "" ? NaN : Number(v));
  const a = n(value);
  const b = n(recipeValue);
  return Number.isFinite(a) && Number.isFinite(b) && a !== b;
}
