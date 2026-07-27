// src/app/api/cutting/manage/cc-assignments/route.ts  →  POST /v2/api/cutting/manage/cc-assignments
// Manager-only: create a new Cross Cutter assignment. Gated by middleware on the
// manufacturing.cutting.manage permission (prefix /v2/api/cutting/manage/*); the
// X-User-Can-Manage-Cutting header check below is defense-in-depth.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    if (request.headers.get("X-User-Can-Manage-Cutting") !== "1") {
      return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });
    }

    const operatorName = request.headers.get("X-User-Name") || "";
    const operatorId = request.headers.get("X-User-Id") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const label = String(body?.label || "").trim();
    const targetChunks = Number(body?.target_chunks);

    if (!label) {
      return NextResponse.json({ ok: false, error: "label is required." }, { status: 400 });
    }
    if (!Number.isFinite(targetChunks) || targetChunks < 0) {
      return NextResponse.json(
        { ok: false, error: "target_chunks must be a non-negative number." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const id = crypto.randomUUID();

    const maxRow = await DB.prepare(
      `SELECT MAX(sort_order) AS max_sort FROM cc_assignments WHERE status != 'complete'`
    ).first<{ max_sort: number | null }>();
    const sortOrder = (maxRow?.max_sort ?? -1) + 1;

    await DB.prepare(
      `INSERT INTO cc_assignments
         (id, label, target_chunks, qty_done, status, sort_order, created_by, created_at)
       VALUES (?, ?, ?, 0, 'open', ?, ?, ?)`
    ).bind(id, label, Math.floor(targetChunks), sortOrder, operatorName, now).run();

    return NextResponse.json({ ok: true, id });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
