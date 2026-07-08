// POST /v2/api/cutting/cut-plan/save — persist a block-calc plan for a job.
// Server is authoritative: RECOMPUTE blocks_needed from submitted block+part dims via blockEngine;
// never trust a client-sent total. Writes cut_plans (block dims, kerf, blocks_needed, snapshot) and,
// when manual chunk counts are supplied (P229), the Cross/Hole cut_plan_lines + cutting_lines targets.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { runFullCalc, type BlockCalcInput } from "@/lib/blockEngine";

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const operatorId = request.headers.get("X-User-Id") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const jobId = body?.job_id;
    const b = body?.block;
    const p = body?.primary;
    if (
      !jobId || !b || !p ||
      !(Number(b.l) > 0) || !(Number(b.w) > 0) || !(Number(b.h) > 0) ||
      !(Number(p.l) > 0) || !(Number(p.w) > 0) || !(Number(p.h) > 0)
    ) {
      return NextResponse.json(
        { ok: false, error: "job_id, block {l,w,h}, and primary {l,w,h} (all > 0) are required." },
        { status: 400 }
      );
    }

    const kerf = Number(b.kerf);
    const input: BlockCalcInput = {
      bL: Number(b.l), bW: Number(b.w), bH: Number(b.h),
      pL: Number(p.l), pW: Number(p.w), pH: Number(p.h),
      kerf: Number.isFinite(kerf) && kerf >= 0 ? kerf : 0.079,
      primaryQty: Number(p.qty) > 0 ? Math.floor(Number(p.qty)) : null,
      mode: body?.mode === "fixed" ? "fixed" : "auto",
      secondaryParts: Array.isArray(body?.secondaries)
        ? body.secondaries
            .filter((s: any) => Number(s?.l) > 0 && Number(s?.w) > 0 && Number(s?.h) > 0)
            .map((s: any, i: number) => ({
              id: String(s.id ?? i),
              label: String(s.label ?? `Secondary ${i + 1}`),
              L: Number(s.l), W: Number(s.w), H: Number(s.h),
              qty: Number(s.qty) > 0 ? Math.floor(Number(s.qty)) : null,
            }))
        : [],
    };

    const result = runFullCalc(input);
    const blocksNeeded = result.blocksNeeded;
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    const snapshot = JSON.stringify({
      block: { l: input.bL, w: input.bW, h: input.bH },
      kerf: input.kerf,
      mode: input.mode,
      primary: {
        l: input.pL, w: input.pW, h: input.pH, qty: input.primaryQty,
        perBlock: result.primary.total, utilPct: result.primary.utilPct,
      },
      secondaries: result.secondaries.map((s) => ({
        label: s.label, dims: s._dims, qty: s._qty, perBlock: s.totalPieces,
      })),
      blocksNeeded, totalProduced: result.totalProduced, surplus: result.surplus,
      savedBy: operatorId, savedAt: now,
    });

    await DB.prepare(
      `INSERT OR IGNORE INTO cut_plans (id, job_id, source, created_at, updated_at)
       VALUES (?, ?, 'manual', ?, ?)`
    ).bind(crypto.randomUUID(), jobId, now, now).run();

    await DB.prepare(
      `UPDATE cut_plans
         SET block_l = ?, block_w = ?, block_h = ?, kerf = ?, blocks_needed = ?,
             snapshot = ?, source = 'manual', updated_at = ?
       WHERE job_id = ?`
    ).bind(input.bL, input.bW, input.bH, input.kerf, blocksNeeded, snapshot, now, jobId).run();

    // Optional manual chunk targets (Cross/Hole) — forward-compat for P229's screen.
    const chunkUpdates: Array<[string, number]> = [];
    if (Number(body?.cross_cutter_chunks) > 0) {
      chunkUpdates.push(["Cross Cutter", Math.floor(Number(body.cross_cutter_chunks))]);
    }
    if (Number(body?.hole_cutter_chunks) > 0) {
      chunkUpdates.push(["Hole Cutter", Math.floor(Number(body.hole_cutter_chunks))]);
    }
    for (const [line, qty] of chunkUpdates) {
      await DB.prepare(
        `UPDATE cut_plan_lines SET qty_target = ?, updated_at = ? WHERE job_id = ? AND line = ?`
      ).bind(qty, now, jobId, line).run();
      await DB.prepare(
        `UPDATE cutting_lines SET qty_target = ?, updated_at = ? WHERE job_id = ? AND line = ?`
      ).bind(qty, now, jobId, line).run();
    }

    return NextResponse.json({ ok: true, job_id: jobId, blocks_needed: blocksNeeded });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
