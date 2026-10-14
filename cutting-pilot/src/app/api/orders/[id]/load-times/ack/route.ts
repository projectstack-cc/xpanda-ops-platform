// src/app/api/orders/[id]/load-times/ack/route.ts  →  POST /v2/api/orders/:id/load-times/ack
// dlv-02: acknowledge sheet-driven delivery-time changes for one job (clears the v2 logistics
// dashboard's "Time changed" badge, dlv-04). Gate: the same permission as editing a shipment on the
// v2 logistics dashboard — `logistics.dashboard` edit — via middleware's PATTERN_PERMISSION_MAP
// (the prefix-only /v2/api/orders row would otherwise demand `orders`). The actor always comes from
// the session X-User-* headers, never the body.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  try {
    const job = await DB.prepare(`SELECT id, invoice_number FROM jobs WHERE id = ?`).bind(id).first<{ id: string; invoice_number: string | null }>();
    if (!job) return NextResponse.json({ ok: false, error: "Order not found.", detail: `no job ${id}` }, { status: 404 });

    const res = await DB.prepare(
      `UPDATE job_load_times SET change_acked_at = datetime('now'), change_acked_by = ?
        WHERE job_id = ? AND changed_at IS NOT NULL AND change_acked_at IS NULL`
    ).bind(actorId || null, id).run();
    const acked = Number(res.meta?.changes ?? 0);

    await logActivity(
      DB, "delivery_time.ack", "job", id,
      `${actorName || "Someone"} acknowledged delivery-time changes — INV ${job.invoice_number || "?"}`,
      { loads_acked: acked },
      actorId || null,
    );
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Couldn't acknowledge the change.", detail: String(e?.message || e) }, { status: 500 });
  }
}
