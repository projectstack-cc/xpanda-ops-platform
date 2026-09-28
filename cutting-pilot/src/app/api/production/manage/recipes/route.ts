// src/app/api/production/manage/recipes/route.ts  →  POST /v2/api/production/manage/recipes
// Create version 1 of a production recipe (prod-c-01). Expansion recipes key on supplier + bead
// type + density; molding recipes key on block type. Gated production.manage by the middleware
// prefix; also checked directly below as defense-in-depth.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { canManageProduction, now } from "@/lib/productionSilos";
import { normDensity, validateRecipeValues, type RecipeRow } from "@/lib/productionRecipes";

const text = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

export async function POST(request: NextRequest) {
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

  const kind = p.kind;
  if (kind !== "expansion" && kind !== "molding") {
    return NextResponse.json({ ok: false, error: "invalid_kind" }, { status: 400 });
  }

  try {
    let supplier: string | null = null;
    let beadType: string | null = null;
    let density: number | null = null;
    let blockType: string | null = null;

    if (kind === "expansion") {
      supplier = text(p.bead_supplier);
      beadType = text(p.bead_type);
      const supplierOption = supplier
        ? await DB.prepare(
            `SELECT id FROM production_options WHERE kind = 'bead_supplier' AND value = ? AND active = 1`
          ).bind(supplier).first<{ id: string }>()
        : null;
      const typeOption = supplierOption && beadType
        ? await DB.prepare(
            `SELECT id FROM production_options WHERE kind = 'bead_type' AND grp = ? AND value = ? AND active = 1`
          ).bind(supplier, beadType).first<{ id: string }>()
        : null;
      if (!supplierOption || !typeOption) {
        return NextResponse.json({ ok: false, error: "unknown_bead_type" }, { status: 400 });
      }
      density = normDensity(p.density);
      if (density === null) return NextResponse.json({ ok: false, error: "density_required" }, { status: 400 });
    } else {
      blockType = text(p.block_type);
      const option = blockType
        ? await DB.prepare(
            `SELECT id FROM production_options WHERE kind = 'block_type' AND value = ? AND active = 1`
          ).bind(blockType).first<{ id: string }>()
        : null;
      if (!option) return NextResponse.json({ ok: false, error: "unknown_block_type" }, { status: 400 });
    }

    const vals = validateRecipeValues(kind, p);
    if (!vals.ok) {
      return NextResponse.json({ ok: false, error: vals.error, detail: vals.detail }, { status: 400 });
    }

    const existing = kind === "expansion"
      ? await DB.prepare(
          `SELECT recipe_key FROM production_recipes
            WHERE kind = 'expansion' AND active = 1 AND bead_supplier = ? AND bead_type = ? AND density = ?`
        ).bind(supplier, beadType, density).first<{ recipe_key: string }>()
      : await DB.prepare(
          `SELECT recipe_key FROM production_recipes WHERE kind = 'molding' AND active = 1 AND block_type = ?`
        ).bind(blockType).first<{ recipe_key: string }>();
    if (existing) {
      return NextResponse.json({ ok: false, error: "recipe_exists", recipe_key: existing.recipe_key }, { status: 409 });
    }

    const id = crypto.randomUUID();
    const ts = now();
    const v = vals.values;
    try {
      await DB.prepare(
        `INSERT INTO production_recipes
           (id, recipe_key, version, kind, bead_supplier, bead_type, density, block_type, heating_time_s,
            rc_pct_open, rc_speed, virgin_pct_open, virgin_speed, notes, active, created_by, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).bind(
        id, id, kind, supplier, beadType, density, blockType, v.heating_time_s,
        v.rc_pct_open, v.rc_speed, v.virgin_pct_open, v.virgin_speed, text(p.notes), actorId, ts
      ).run();
    } catch (e: any) {
      // Lost a race against the partial unique index on the active key.
      if (/UNIQUE constraint failed/i.test(String(e?.message || e))) {
        const again = kind === "expansion"
          ? await DB.prepare(
              `SELECT recipe_key FROM production_recipes
                WHERE kind = 'expansion' AND active = 1 AND bead_supplier = ? AND bead_type = ? AND density = ?`
            ).bind(supplier, beadType, density).first<{ recipe_key: string }>()
          : await DB.prepare(
              `SELECT recipe_key FROM production_recipes WHERE kind = 'molding' AND active = 1 AND block_type = ?`
            ).bind(blockType).first<{ recipe_key: string }>();
        return NextResponse.json(
          { ok: false, error: "recipe_exists", recipe_key: again?.recipe_key ?? null },
          { status: 409 }
        );
      }
      throw e;
    }

    const recipe = await DB.prepare(`SELECT * FROM production_recipes WHERE id = ?`).bind(id).first<RecipeRow>();
    const label = kind === "expansion" ? `${supplier} ${beadType} ${density} pcf` : `${blockType}`;
    await logActivity(
      DB, "create", "production_recipe", id,
      `${actorName || actorId} created a ${kind} recipe (${label})`,
      { recipe_id: id, recipe_key: id, version: 1, kind, bead_supplier: supplier, bead_type: beadType, density, block_type: blockType },
      actorId
    );

    return NextResponse.json({ ok: true, recipe }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
