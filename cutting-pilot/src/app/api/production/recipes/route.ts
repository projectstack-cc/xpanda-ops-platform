// src/app/api/production/recipes/route.ts  →  GET /v2/api/production/recipes
// Production recipes (prod-c-01). Active recipes by default; ?include_retired=1 returns every
// version (version history); ?kind=expansion|molding filters. Gated production.log by middleware.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const params = new URL(request.url).searchParams;
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (params.get("include_retired") !== "1") clauses.push("active = 1");
  const kind = params.get("kind");
  if (kind === "expansion" || kind === "molding") {
    clauses.push("kind = ?");
    binds.push(kind);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  try {
    const rows = await DB.prepare(
      `SELECT * FROM production_recipes ${where}
        ORDER BY kind, bead_supplier, bead_type, density, block_type, recipe_key, version DESC`
    ).bind(...binds).all();
    return NextResponse.json({ ok: true, recipes: rows.results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
