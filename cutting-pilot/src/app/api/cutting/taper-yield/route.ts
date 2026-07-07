// POST /v2/api/cutting/taper-yield — set the per-job taper yield-per-chunk used to derive
// Cross Cutter's chunk target. Planning parameter; identity gated by the middleware-injected
// X-User-Id header (never client-trusted). Activity logging intentionally omitted (low-stakes
// planning value; mirror the clock routes later if an audit trail is wanted).
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
    const jobId = body?.job_id;
    const yieldVal = Number(body?.yield);
    if (!jobId || !Number.isInteger(yieldVal) || yieldVal < 1 || yieldVal > 100) {
      return NextResponse.json(
        { ok: false, error: "job_id and an integer yield (1–100) are required." },
        { status: 400 }
      );
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    // Ensure a plan row exists (queue GET also lazily creates it), then set the yield.
    await DB.prepare(
      `INSERT OR IGNORE INTO cut_plans (id, job_id, source, created_at, updated_at)
       VALUES (?, ?, 'auto', ?, ?)`
    ).bind(crypto.randomUUID(), jobId, now, now).run();

    await DB.prepare(
      `UPDATE cut_plans SET taper_yield = ?, updated_at = ? WHERE job_id = ?`
    ).bind(yieldVal, now, jobId).run();

    return NextResponse.json({ ok: true, job_id: jobId, taper_yield: yieldVal });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
