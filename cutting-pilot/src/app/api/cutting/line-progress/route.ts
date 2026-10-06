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

    const valid = items.filter((it: any) => it && it.line_item_id != null && it.completed_qty != null);

    // cutting-ids-01: every line item must still exist on this job (one stale id → 409, nothing
    // written), and each row snapshots its part identity for the cutting activity report.
    type LiSnap = { id: string; part_number: string | null; description: string | null; dimensions: string | null };
    const liRes = await DB.prepare(
      "SELECT id, part_number, description, dimensions FROM job_line_items WHERE job_id = ?"
    ).bind(job_id).all<LiSnap>();
    const liById = new Map((liRes.results ?? []).map((r) => [r.id, r]));
    if (valid.some((it: any) => !liById.has(String(it.line_item_id)))) {
      return NextResponse.json(
        { ok: false, code: "stale_line_item", error: "This order was edited — refresh the board." },
        { status: 409 }
      );
    }

    const stmts = valid.map((it: any) => {
      const li = liById.get(String(it.line_item_id))!;
      return DB.prepare(
        `INSERT INTO cutting_line_progress
           (id, job_id, line, line_item_id, completed, completed_qty, updated_by, updated_at,
            part_number, description, dimensions)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (job_id, line, line_item_id)
         DO UPDATE SET completed_qty = excluded.completed_qty,
                       updated_by = excluded.updated_by,
                       updated_at = excluded.updated_at,
                       part_number = excluded.part_number,
                       description = excluded.description,
                       dimensions = excluded.dimensions`
      ).bind(
        crypto.randomUUID(),
        job_id,
        line,
        String(it.line_item_id),
        Math.max(0, parseInt(String(it.completed_qty), 10) || 0),
        operatorId,
        now,
        li.part_number,
        li.description,
        li.dimensions
      );
    });

    if (stmts.length) await DB.batch(stmts);

    // Recompute the derived line-level count from the per-item sum — completed_qty is the
    // source of truth (P351); cutting_lines.qty_done stays a synced cache, not an increment.
    if (stmts.length) {
      await DB.prepare(
        `UPDATE cutting_lines
         SET qty_done = (
           SELECT COALESCE(SUM(completed_qty), 0) FROM cutting_line_progress
           WHERE job_id = ? AND line = ?
         ), updated_at = ?
         WHERE job_id = ? AND line = ?`
      ).bind(job_id, line, now, job_id, line).run();
    }

    return NextResponse.json({ ok: true, count: stmts.length });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
