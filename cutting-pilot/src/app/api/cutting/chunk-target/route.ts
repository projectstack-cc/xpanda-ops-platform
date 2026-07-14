// POST /v2/api/cutting/chunk-target — set the manual Cross Cutter chunk target for a job, and
// mirror it to Hole Cutter when that line is required (Hole Cutter drills the same chunks).
// Chunk counts are a handling decision (manageable size / curing), not a geometry output — hence
// manual. Taper jobs are excluded: their Cross Cutter target is derived from taper_yield (P227).
// Identity gated by the middleware-injected X-User-Id header (never client-trusted).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

// Mirrors the taper detection in queue/route.ts (P227) — cut_plan_lines.taper_pair is a reserved
// column that is never written, so taper status is derived from job_line_items here instead.
const TAPER_RE = /(\d+(?:\.\d+)?)\s*"?\s*(?:->|→|>)\s*(\d+(?:\.\d+)?)\s*"?/;

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const operatorId = request.headers.get("X-User-Id") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const jobId = body?.job_id;
    const qty = Number(body?.qty_target);
    if (!jobId || !Number.isInteger(qty) || qty < 1 || qty > 10000) {
      return NextResponse.json(
        { ok: false, error: "job_id and an integer qty_target (1–10000) are required." },
        { status: 400 }
      );
    }

    // Taper jobs derive their Cross Cutter target from taper_yield — refuse to overwrite it.
    const items = await DB.prepare(
      `SELECT dimensions, quantity FROM job_line_items WHERE job_id = ?`
    ).bind(jobId).all<any>();
    const isTaper = (items.results || []).some(
      (it: any) => TAPER_RE.test(it.dimensions || "") && Number(it.quantity) > 0
    );
    if (isTaper) {
      return NextResponse.json(
        { ok: false, error: "Taper jobs derive their chunk target from yield. Set the yield instead." },
        { status: 409 }
      );
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    // Cross Cutter always gets the target. Hole Cutter mirrors it ONLY if that line already exists
    // for this job (i.e. it is a required line) — never create a Hole Cutter row that isn't routed.
    await DB.prepare(
      `UPDATE cut_plan_lines SET qty_target = ?, updated_at = ?
        WHERE job_id = ? AND line = 'Cross Cutter'`
    ).bind(qty, now, jobId).run();

    await DB.prepare(
      `UPDATE cut_plan_lines SET qty_target = ?, updated_at = ?
        WHERE job_id = ? AND line = 'Hole Cutter'`
    ).bind(qty, now, jobId).run();

    return NextResponse.json({ ok: true, job_id: jobId, qty_target: qty });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
