// src/app/api/qc/scrap/[id]/void/route.ts  ->  POST /v2/api/qc/scrap/:id/void
// qc-04: corrections are voids, never deletes. Sets voided_at / voided_by_name / void_reason (≤ 200).
// A voided row stays listed (struck through) but drops out of every total. (The scrap_log
// compatibility VIEW (legacy scrap reports) was retired in rpt-05.) Already voided → 409. Gated on
// `qc` by middleware (POST → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { VOID_REASON_MAX } from "@/lib/qc/scrap";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const actorId = request.headers.get("X-User-Id");
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const actorName = request.headers.get("X-User-Name") || "";
  const id = String(params?.id ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "Scrap entry id is required.", detail: "" }, { status: 400 });

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    // An empty body is fine — the reason is optional.
  }
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, VOID_REASON_MAX) || null : null;

  try {
    const { DB } = await getEnv();
    const row = await DB.prepare(`SELECT id, inv_number, part_product, voided_at FROM scrap_events WHERE id = ?`)
      .bind(id)
      .first<{ id: string; inv_number: string; part_product: string; voided_at: string | null }>();
    if (!row) return NextResponse.json({ ok: false, error: "Scrap entry not found.", detail: id }, { status: 404 });
    if (row.voided_at) {
      return NextResponse.json({ ok: false, error: "That entry is already voided.", detail: id }, { status: 409 });
    }

    const now = new Date().toISOString().slice(0, 19).replace("T", " ");
    const res = await DB.prepare(
      `UPDATE scrap_events SET voided_at = ?, voided_by_name = ?, void_reason = ? WHERE id = ? AND voided_at IS NULL`
    )
      .bind(now, actorName || null, reason, id)
      .run();
    if (Number(res.meta?.changes ?? 0) === 0) {
      return NextResponse.json({ ok: false, error: "That entry is already voided.", detail: id }, { status: 409 });
    }

    await logActivity(
      DB,
      "update",
      "scrap_event",
      id,
      `Voided scrap: INV ${row.inv_number} — ${row.part_product}${reason ? ` (${reason})` : ""}`,
      { voided_at: now, void_reason: reason },
      actorId
    );

    return NextResponse.json({ ok: true, id, voided_at: now, voided_by_name: actorName || null, void_reason: reason });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't void the entry.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
