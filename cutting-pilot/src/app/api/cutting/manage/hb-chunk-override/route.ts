// src/app/api/cutting/manage/hb-chunk-override/route.ts
// POST /v2/api/cutting/manage/hb-chunk-override — set/clear a manual Holey Board chunk override
// on a job's guillotine (Main/Blue) lines. qty_target=null reverts to geometry (queue reseeds from
// jobs.hb_chunks_required next read). Gated by middleware on manufacturing.cutting.manage
// (prefix /v2/api/cutting/manage/*); the X-User-Can-Manage-Cutting header check is defense-in-depth.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    if (request.headers.get("X-User-Can-Manage-Cutting") !== "1") {
      return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });
    }

    const operatorId = request.headers.get("X-User-Id") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const jobId = String(body?.job_id ?? "").trim();
    const raw = body?.qty_target;
    if (!jobId) {
      return NextResponse.json({ ok: false, error: "job_id is required." }, { status: 400 });
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const lines = ["Main Line", "Blue Line"];
    const stmts: ReturnType<typeof DB.prepare>[] = [];

    if (raw == null) {
      // Revert: drop the manual marker so the queue reseeds from geometry next read.
      for (const line of lines) {
        stmts.push(
          DB.prepare(
            `UPDATE cut_plan_lines SET source = NULL, updated_at = ? WHERE job_id = ? AND line = ?`
          ).bind(now, jobId, line)
        );
      }
    } else {
      const qty = Number(raw);
      if (!Number.isInteger(qty) || qty < 1) {
        return NextResponse.json(
          { ok: false, error: "qty_target must be a positive integer or null." },
          { status: 400 }
        );
      }
      for (const line of lines) {
        stmts.push(
          DB.prepare(
            `UPDATE cut_plan_lines SET unit = 'chunk', qty_target = ?, source = 'manual', updated_at = ?
              WHERE job_id = ? AND line = ?`
          ).bind(qty, now, jobId, line)
        );
        stmts.push(
          DB.prepare(
            `UPDATE cutting_lines SET qty_target = ?, updated_at = ? WHERE job_id = ? AND line = ?`
          ).bind(qty, now, jobId, line)
        );
      }
    }
    for (let i = 0; i < stmts.length; i += 50) {
      if (stmts.length) await DB.batch(stmts.slice(i, i + 50));
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
