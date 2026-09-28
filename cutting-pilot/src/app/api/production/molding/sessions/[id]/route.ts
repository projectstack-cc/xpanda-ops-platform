// src/app/api/production/molding/sessions/[id]/route.ts  →  /v2/api/production/molding/sessions/:id
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { resolveMoldingRecipe } from "@/lib/productionRecipes";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  try {
    const session = await DB.prepare(
      `SELECT * FROM production_molding_sessions WHERE id = ? AND deleted_at IS NULL`
    ).bind(id).first<any>();
    if (!session) return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });

    const blocks = await DB.prepare(
      `SELECT * FROM production_molding_blocks WHERE session_id = ? ORDER BY created_at ASC`
    ).bind(id).all();

    return NextResponse.json({ ok: true, session, blocks: blocks.results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let p: any;
  try {
    p = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const existing = await DB.prepare(
      `SELECT id FROM production_molding_sessions WHERE id = ? AND deleted_at IS NULL`
    ).bind(id).first<{ id: string }>();
    if (!existing) return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });

    const sets: string[] = [];
    const binds: any[] = [];
    const changed: string[] = [];

    if ("status" in p) {
      if (p.status !== "open" && p.status !== "closed") {
        return NextResponse.json({ ok: false, error: "Invalid status." }, { status: 400 });
      }
      sets.push("status = ?");
      binds.push(p.status);
      changed.push("status");
    }
    if ("block_type" in p) {
      const option = await DB.prepare(
        `SELECT id FROM production_options WHERE kind = 'block_type' AND value = ? AND active = 1`
      ).bind(p.block_type).first<{ id: string }>();
      if (!option) return NextResponse.json({ ok: false, error: "unknown_block_type" }, { status: 400 });
      sets.push("block_type = ?");
      binds.push(p.block_type);
      changed.push("block_type");
      const recipe = await resolveMoldingRecipe(DB, p.block_type);
      sets.push(
        "recipe_id = ?", "recipe_version = ?", "recipe_rc_pct_open = ?", "recipe_rc_speed = ?",
        "recipe_virgin_pct_open = ?", "recipe_virgin_speed = ?"
      );
      binds.push(
        recipe?.id ?? null, recipe?.version ?? null, recipe?.rc_pct_open ?? null, recipe?.rc_speed ?? null,
        recipe?.virgin_pct_open ?? null, recipe?.virgin_speed ?? null
      );
      changed.push("recipe");
    }

    if (!sets.length) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
    sets.push("updated_at = ?");
    binds.push(now());

    const result = await DB.prepare(
      `UPDATE production_molding_sessions SET ${sets.join(", ")} WHERE id = ?`
    ).bind(...binds, id).run();
    if (!result.meta.changes) return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });

    await logActivity(
      DB, "update", "production_molding_session", id,
      `${actorName || actorId} edited a Molding sheet`,
      { session_id: id, fields: changed }, actorId
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
