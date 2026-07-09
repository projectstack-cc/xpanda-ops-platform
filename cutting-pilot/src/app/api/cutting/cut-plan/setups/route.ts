// GET /v2/api/cutting/cut-plan/setups?job_id=… — saved setups for the planner to rehydrate,
// so re-saving replaces a full list rather than wiping parts the user didn't re-enter.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const operatorId = request.headers.get("X-User-Id") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const jobId = new URL(request.url).searchParams.get("job_id") || "";
    if (!jobId) {
      return NextResponse.json({ ok: false, error: "job_id is required." }, { status: 400 });
    }
    const rows = await DB.prepare(
      `SELECT id, label, block_l, block_w, block_h, kerf, mode,
              part_l, part_w, part_h, qty, per_block, blocks_needed, sort_order
       FROM cut_plan_setups WHERE job_id = ? ORDER BY sort_order ASC`
    ).bind(jobId).all<any>();
    return NextResponse.json({ ok: true, setups: rows.results || [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
