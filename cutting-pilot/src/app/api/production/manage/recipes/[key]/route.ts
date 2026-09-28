// src/app/api/production/manage/recipes/[key]/route.ts  →  /v2/api/production/manage/recipes/:key
// PUT = new immutable version (values only; key fields can't change — retire + create instead).
// DELETE = retire (active = 0). No hard delete: sheets snapshot recipe_id/version. prod-c-01.
// Gated production.manage by the middleware prefix; also checked directly as defense-in-depth.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { canManageProduction, now } from "@/lib/productionSilos";
import { normDensity, validateRecipeValues, type RecipeRow } from "@/lib/productionRecipes";

const text = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

function keyChanged(p: any, cur: RecipeRow): boolean {
  if ("kind" in p && p.kind !== cur.kind) return true;
  for (const f of ["bead_supplier", "bead_type", "block_type"] as const) {
    if (f in p && (text(p[f]) ?? null) !== cur[f]) return true;
  }
  if ("density" in p && normDensity(p.density) !== cur.density) return true;
  return false;
}

async function activeVersion(DB: any, key: string): Promise<RecipeRow | null> {
  return DB.prepare(`SELECT * FROM production_recipes WHERE recipe_key = ? AND active = 1`).bind(key).first();
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageProduction(request.headers)) {
    return NextResponse.json({ ok: false, error: "manage_required" }, { status: 403 });
  }

  let p: any;
  try {
    p = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  p = p ?? {};

  try {
    const cur = await activeVersion(DB, key);
    if (!cur) return NextResponse.json({ ok: false, error: "recipe_not_found" }, { status: 404 });
    if (keyChanged(p, cur)) return NextResponse.json({ ok: false, error: "key_immutable" }, { status: 400 });

    const vals = validateRecipeValues(cur.kind, p);
    if (!vals.ok) {
      return NextResponse.json({ ok: false, error: vals.error, detail: vals.detail }, { status: 400 });
    }
    const v = vals.values;
    const newId = crypto.randomUUID();
    const nextVersion = cur.version + 1;
    const ts = now();

    // One transaction: retire the version we read, then insert N+1 only if THIS request's retire
    // stamp is on vN and no active row remains (a concurrent DELETE can't resurrect the recipe).
    // Either statement changing 0 rows means someone else edited/retired it first.
    const [retire, insert] = await DB.batch([
      DB.prepare(
        `UPDATE production_recipes SET active = 0, retired_by = ?, retired_at = ?
          WHERE recipe_key = ? AND version = ? AND active = 1`
      ).bind(actorId, ts, key, cur.version),
      DB.prepare(
        `INSERT INTO production_recipes
           (id, recipe_key, version, kind, bead_supplier, bead_type, density, block_type, heating_time_s,
            rc_pct_open, rc_speed, virgin_pct_open, virgin_speed, notes, active, created_by, created_at)
         SELECT ?, recipe_key, ?, kind, bead_supplier, bead_type, density, block_type, ?, ?, ?, ?, ?, ?, 1, ?, ?
           FROM production_recipes
          WHERE recipe_key = ? AND version = ? AND active = 0 AND retired_by = ? AND retired_at = ?
            AND NOT EXISTS (SELECT 1 FROM production_recipes WHERE recipe_key = ? AND active = 1)`
      ).bind(
        newId, nextVersion, v.heating_time_s, v.rc_pct_open, v.rc_speed, v.virgin_pct_open, v.virgin_speed,
        text(p.notes), actorId, ts, key, cur.version, actorId, ts, key
      ),
    ]);
    if (!retire.meta.changes || !insert.meta.changes) {
      return NextResponse.json({ ok: false, error: "recipe_changed" }, { status: 409 });
    }

    const recipe = await DB.prepare(`SELECT * FROM production_recipes WHERE id = ?`).bind(newId).first<RecipeRow>();
    await logActivity(
      DB, "update", "production_recipe", newId,
      `${actorName || actorId} saved ${cur.kind} recipe v${nextVersion}`,
      { recipe_id: newId, recipe_key: key, version: nextVersion, prior_id: cur.id, prior_version: cur.version },
      actorId
    );

    return NextResponse.json({ ok: true, recipe });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageProduction(request.headers)) {
    return NextResponse.json({ ok: false, error: "manage_required" }, { status: 403 });
  }

  try {
    const cur = await activeVersion(DB, key);
    if (!cur) return NextResponse.json({ ok: false, error: "recipe_not_found" }, { status: 404 });

    const result = await DB.prepare(
      `UPDATE production_recipes SET active = 0, retired_by = ?, retired_at = ?
        WHERE recipe_key = ? AND version = ? AND active = 1`
    ).bind(actorId, now(), key, cur.version).run();
    if (!result.meta.changes) return NextResponse.json({ ok: false, error: "recipe_not_found" }, { status: 404 });

    await logActivity(
      DB, "delete", "production_recipe", cur.id,
      `${actorName || actorId} retired ${cur.kind} recipe v${cur.version}`,
      { recipe_id: cur.id, recipe_key: key, version: cur.version }, actorId
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
