// POST /v2/api/cutting/line-progress — set completed_qty for several (job, line, line_item) rows.
// Leaves the `completed` flag untouched (reconciliation is for UNCHECKED parts).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const operatorId = request.headers.get("X-User-Id") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { job_id, line, items } = body ?? {};
    if (!job_id || !line || !Array.isArray(items)) {
      return NextResponse.json(
        { ok: false, error: "job_id, line, items[] are required." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    const stmts = items
      .filter((it: any) => it && it.line_item_id != null && it.completed_qty != null)
      .map((it: any) =>
        DB.prepare(
          `INSERT INTO cutting_line_progress
             (id, job_id, line, line_item_id, completed, completed_qty, updated_by, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?)
           ON CONFLICT (job_id, line, line_item_id)
           DO UPDATE SET completed_qty = excluded.completed_qty,
                         updated_by = excluded.updated_by,
                         updated_at = excluded.updated_at`
        ).bind(
          crypto.randomUUID(),
          job_id,
          line,
          String(it.line_item_id),
          Math.max(0, parseInt(String(it.completed_qty), 10) || 0),
          operatorId,
          now
        )
      );

    if (stmts.length) await DB.batch(stmts);
    return NextResponse.json({ ok: true, count: stmts.length });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
