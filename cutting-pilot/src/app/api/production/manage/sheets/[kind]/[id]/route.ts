// src/app/api/production/manage/sheets/[kind]/[id]/route.ts
//   → DELETE /v2/api/production/manage/sheets/{molding|expansion}/:id           (soft delete)
//   → DELETE /v2/api/production/manage/sheets/{molding|expansion}/:id?hard=1    (admin purge)
// Gated production.manage by the middleware prefix; also checked directly below as
// defense-in-depth, mirroring X-User-Can-Manage-Loading in api/loading-assignments.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";

const TABLES: Record<string, { session: string; rows: string; rowLabel: string }> = {
  molding: {
    session: "production_molding_sessions",
    rows: "production_molding_blocks",
    rowLabel: "production_molding_block",
  },
  expansion: {
    session: "production_expansion_sessions",
    rows: "production_expansion_batches",
    rowLabel: "production_expansion_batch",
  },
};

export async function DELETE(
  request: NextRequest,
  ctx: { params: Promise<{ kind: string; id: string }> }
) {
  const { kind, id } = await ctx.params;
  const tables = TABLES[kind];
  if (!tables) return NextResponse.json({ ok: false, error: "Invalid sheet kind." }, { status: 400 });

  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  const canManage = request.headers.get("X-User-Can-Manage-Production") === "1";
  const isAdmin = request.headers.get("X-User-Is-Admin") === "1";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const hard = new URL(request.url).searchParams.get("hard") === "1";

  try {
    if (hard) {
      if (!isAdmin) return NextResponse.json({ ok: false, error: "admin_only" }, { status: 403 });

      const session = await DB.prepare(`SELECT * FROM ${tables.session} WHERE id = ?`).bind(id).first<any>();
      if (!session) return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });

      const rows = await DB.prepare(`SELECT * FROM ${tables.rows} WHERE session_id = ?`).bind(id).all();

      await logActivity(
        DB, "purge", "production_" + kind + "_session", id,
        `${request.headers.get("X-User-Name") || actorId} permanently deleted a ${kind} sheet`,
        { session, rows: rows.results ?? [] }, actorId
      );

      await DB.batch([
        DB.prepare(`DELETE FROM ${tables.rows} WHERE session_id = ?`).bind(id),
        DB.prepare(`DELETE FROM ${tables.session} WHERE id = ?`).bind(id),
      ]);

      return NextResponse.json({ ok: true, purged: true });
    }

    if (!canManage) return NextResponse.json({ ok: false, error: "Manager access required." }, { status: 403 });

    const session = await DB.prepare(
      `SELECT * FROM ${tables.session} WHERE id = ? AND deleted_at IS NULL`
    ).bind(id).first<any>();
    if (!session) return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });

    const rowCount = await DB.prepare(
      `SELECT COUNT(*) AS cnt FROM ${tables.rows} WHERE session_id = ?`
    ).bind(id).first<{ cnt: number }>();

    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    await DB.prepare(
      `UPDATE ${tables.session} SET deleted_at = ?, deleted_by = ? WHERE id = ?`
    ).bind(ts, actorId, id).run();

    await logActivity(
      DB, "delete", "production_" + kind + "_session", id,
      `${request.headers.get("X-User-Name") || actorId} hid a ${kind} sheet`,
      { session, row_count: Number(rowCount?.cnt) || 0 }, actorId
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
