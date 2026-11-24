// src/app/api/board/[id]/hb-chunk-plan/route.ts  →  PUT /v2/api/board/:id/hb-chunk-plan
// hbplan-01: save / clear a job's custom Holey Board chunk list (jobs.hb_chunk_plan JSON).
// Body: { groups: HbPlanGroup[] | null } — null clears it (back to the auto nest).
// Gated on `jobs` edit by middleware (under /v2/api/board). The plan lives in its own column, so
// the hb_chunks_required / hb_chunk_breakdown writers (holeyChunks.ts, legacy jobs.js) never touch it.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { hbAllowedThicknesses, planTotal, validatePlanGroups, type HbChunkPlan } from "@/lib/hbChunkPlan";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  // Identity from the session headers, never the body.
  const actorName = request.headers.get("X-User-Name") || "";

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !("groups" in body)) {
    return NextResponse.json({ ok: false, error: "Send { groups: [...] } or { groups: null }." }, { status: 400 });
  }

  try {
    const job = await DB.prepare(`SELECT id, invoice_number, hb_chunks_required, hb_chunk_breakdown FROM jobs WHERE id = ?`)
      .bind(id)
      .first<any>();
    if (!job) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    if (job.hb_chunks_required == null) {
      return NextResponse.json({ ok: false, error: "not_holey", detail: "This job has no Holey Board lines." }, { status: 409 });
    }

    if (body.groups === null) {
      await DB.prepare(`UPDATE jobs SET hb_chunk_plan = NULL WHERE id = ?`).bind(id).run();
      await logActivity(DB, "hb_chunk_plan_cleared", "job", id, `Chunk list reverted to auto (Inv ${job.invoice_number ?? id})`, { via: "board" }, actorId);
      return NextResponse.json({ ok: true, hb_chunk_plan: null });
    }

    const v = validatePlanGroups(body.groups, hbAllowedThicknesses(job.hb_chunk_breakdown));
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: 400 });

    const plan: HbChunkPlan = { v: 1, groups: v.groups, total: planTotal(v.groups), updated_by: actorName, updated_at: now() };
    const json = JSON.stringify(plan);
    await DB.prepare(`UPDATE jobs SET hb_chunk_plan = ? WHERE id = ?`).bind(json, id).run();
    await logActivity(
      DB,
      "hb_chunk_plan_set",
      "job",
      id,
      `Custom chunk list saved: ${plan.total} chunks in ${plan.groups.length} group${plan.groups.length === 1 ? "" : "s"} (Inv ${job.invoice_number ?? id})`,
      { via: "board", total: plan.total, groups: plan.groups },
      actorId
    );
    return NextResponse.json({ ok: true, hb_chunk_plan: json });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
