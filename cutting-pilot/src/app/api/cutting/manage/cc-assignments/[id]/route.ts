// src/app/api/cutting/manage/cc-assignments/[id]/route.ts
//   PATCH  /v2/api/cutting/manage/cc-assignments/[id] — edit label/target_chunks
//   DELETE /v2/api/cutting/manage/cc-assignments/[id] — remove an assignment
// Manager-only: gated by middleware (manufacturing.cutting.manage); header check is
// defense-in-depth.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { DB } = await getEnv();
  try {
    if (request.headers.get("X-User-Can-Manage-Cutting") !== "1") {
      return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });
    }
    const { id } = params;

    const existing = await DB.prepare(
      `SELECT id FROM cc_assignments WHERE id = ? LIMIT 1`
    ).bind(id).first<{ id: string }>();
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    }

    const body = await request.json();
    const fields: string[] = [];
    const values: any[] = [];

    if (body?.label != null) {
      const label = String(body.label).trim();
      if (!label) {
        return NextResponse.json({ ok: false, error: "label cannot be empty." }, { status: 400 });
      }
      fields.push("label = ?");
      values.push(label);
    }
    if (body?.target_chunks != null) {
      const targetChunks = Number(body.target_chunks);
      if (!Number.isFinite(targetChunks) || targetChunks < 0) {
        return NextResponse.json(
          { ok: false, error: "target_chunks must be a non-negative number." },
          { status: 400 }
        );
      }
      fields.push("target_chunks = ?");
      values.push(Math.floor(targetChunks));
    }

    if (fields.length === 0) {
      return NextResponse.json({ ok: true });
    }

    values.push(id);
    await DB.prepare(`UPDATE cc_assignments SET ${fields.join(", ")} WHERE id = ?`)
      .bind(...values)
      .run();

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { DB } = await getEnv();
  try {
    if (request.headers.get("X-User-Can-Manage-Cutting") !== "1") {
      return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });
    }
    const { id } = params;

    const existing = await DB.prepare(
      `SELECT id FROM cc_assignments WHERE id = ? LIMIT 1`
    ).bind(id).first<{ id: string }>();
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    // Best-effort: close any open sessions against this assignment before removing it.
    await DB.prepare(
      `UPDATE chunk_sessions SET status = 'closed', ended_at = ?
       WHERE board = 'cc' AND ref_id = ? AND status = 'open'`
    ).bind(now, id).run();

    await DB.prepare(`DELETE FROM cc_assignments WHERE id = ?`).bind(id).run();

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
