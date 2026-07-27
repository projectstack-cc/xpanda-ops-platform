// src/app/api/cutting/manage/cc-assignments/reorder/route.ts
//   POST /v2/api/cutting/manage/cc-assignments/reorder — { order: string[] }
// Manager-only: rewrite sort_order to the array index for each id in the new top-to-bottom
// order. Ids not present in cc_assignments are ignored. Gated by middleware
// (manufacturing.cutting.manage); header check is defense-in-depth.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    if (request.headers.get("X-User-Can-Manage-Cutting") !== "1") {
      return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });
    }

    const body = await request.json();
    const order = Array.isArray(body?.order) ? body.order.filter((id: any) => typeof id === "string") : null;
    if (!order) {
      return NextResponse.json({ ok: false, error: "order must be an array of ids." }, { status: 400 });
    }

    // Respect D1's 100-bound-parameter ceiling; the queue is small but chunk defensively at 90.
    for (let i = 0; i < order.length; i += 90) {
      const chunk = order.slice(i, i + 90);
      const stmts = chunk.map((id: string, idx: number) =>
        DB.prepare(`UPDATE cc_assignments SET sort_order = ? WHERE id = ?`).bind(i + idx, id)
      );
      await DB.batch(stmts);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
