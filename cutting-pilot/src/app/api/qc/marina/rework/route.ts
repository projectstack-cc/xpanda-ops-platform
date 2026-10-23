// src/app/api/qc/marina/rework/route.ts  →  GET /v2/api/qc/marina/rework?job_id=
// marina-03. The rework queue: every rework_pending piece on OPEN jobs (or, with job_id, on that one
// job), oldest updated_at / created_at first, each with its part (label + dims) and job.
// Gated on `qc.marina` by middleware (GET → view).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { listRework } from "@/lib/marina/store";

export async function GET(request: NextRequest) {
  try {
    const { DB } = await getEnv();
    const jobId = request.nextUrl.searchParams.get("job_id")?.trim() || null;
    const items = await listRework(DB, jobId);
    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
