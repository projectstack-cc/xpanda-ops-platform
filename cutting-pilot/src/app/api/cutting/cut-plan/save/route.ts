// POST /v2/api/cutting/cut-plan/save — persist a MULTI-PART block-calc plan for a job.
// Server authoritative: recompute each setup's blocks via blockEngine; cut_plans.blocks_needed is
// the SUM across setups (the number the queue reads). cut_plan_setups (child, one row per part) is
// replaced wholesale each save. Manual Cross/Hole chunk targets preserved.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { runFullCalc } from "@/lib/blockEngine";

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const operatorId = request.headers.get("X-User-Id") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const jobId = body?.job_id;
    if (!jobId) {
      return NextResponse.json({ ok: false, error: "job_id is required." }, { status: 400 });
    }
    const rawSetups = Array.isArray(body?.setups) ? body.setups : [];
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    const computed = rawSetups
      .map((s: any, i: number) => {
        const b = s?.block;
        const p = s?.part;
        if (
          !b || !p ||
          !(Number(b.l) > 0) || !(Number(b.w) > 0) || !(Number(b.h) > 0) ||
          !(Number(p.l) > 0) || !(Number(p.w) > 0) || !(Number(p.h) > 0)
        ) {
          return null;
        }
        const kerfN = Number(b.kerf);
        const kerf = Number.isFinite(kerfN) && kerfN >= 0 ? kerfN : 0.079;
        const mode = s?.mode === "fixed" ? "fixed" : "auto";
        const res = runFullCalc({
          bL: Number(b.l), bW: Number(b.w), bH: Number(b.h),
          pL: Number(p.l), pW: Number(p.w), pH: Number(p.h),
          kerf,
          primaryQty: Number(p.qty) > 0 ? Math.floor(Number(p.qty)) : null,
          mode,
          secondaryParts: [],
        });
        return {
          label: s.label ? String(s.label) : null,
          block: { l: Number(b.l), w: Number(b.w), h: Number(b.h), kerf },
          part: { l: Number(p.l), w: Number(p.w), h: Number(p.h), qty: Number(p.qty) > 0 ? Math.floor(Number(p.qty)) : null },
          mode,
          perBlock: res.primary.total,
          blocks: res.blocksNeeded,
          util: res.primary.utilPct,
          sort: i,
        };
      })
      .filter((x: any) => x !== null) as Array<{
        label: string | null;
        block: { l: number; w: number; h: number; kerf: number };
        part: { l: number; w: number; h: number; qty: number | null };
        mode: "auto" | "fixed";
        perBlock: number;
        blocks: number | null;
        util: number;
        sort: number;
      }>;

    if (computed.length === 0) {
      return NextResponse.json(
        { ok: false, error: "At least one valid setup (block + part dimensions) is required." },
        { status: 400 }
      );
    }

    const totalBlocks = computed.reduce((sum, c) => sum + (c.blocks ?? 0), 0);
    const first = computed[0];

    const snapshot = JSON.stringify({
      setups: computed.map((c) => ({
        label: c.label, block: c.block, part: c.part, mode: c.mode,
        perBlock: c.perBlock, blocks: c.blocks, util: c.util,
      })),
      totalBlocks, savedBy: operatorId, savedAt: now,
    });

    await DB.prepare(
      `INSERT OR IGNORE INTO cut_plans (id, job_id, source, created_at, updated_at)
       VALUES (?, ?, 'manual', ?, ?)`
    ).bind(crypto.randomUUID(), jobId, now, now).run();

    // cut_plans holds the aggregate the queue reads; block_l/w/h/kerf mirror the first setup.
    await DB.prepare(
      `UPDATE cut_plans
         SET block_l = ?, block_w = ?, block_h = ?, kerf = ?, blocks_needed = ?,
             snapshot = ?, source = 'manual', updated_at = ?
       WHERE job_id = ?`
    ).bind(first.block.l, first.block.w, first.block.h, first.block.kerf, totalBlocks, snapshot, now, jobId).run();

    // Replace child setups wholesale.
    await DB.prepare(`DELETE FROM cut_plan_setups WHERE job_id = ?`).bind(jobId).run();
    const inserts = computed.map((c) =>
      DB.prepare(
        `INSERT INTO cut_plan_setups
           (id, job_id, label, block_l, block_w, block_h, kerf, mode,
            part_l, part_w, part_h, qty, per_block, blocks_needed, util_pct, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), jobId, c.label,
        c.block.l, c.block.w, c.block.h, c.block.kerf, c.mode,
        c.part.l, c.part.w, c.part.h, c.part.qty,
        c.perBlock, c.blocks, c.util, c.sort, now, now
      )
    );
    for (let i = 0; i < inserts.length; i += 50) {
      await DB.batch(inserts.slice(i, i + 50));
    }

    // Optional manual chunk targets (Cross/Hole).
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

    return NextResponse.json({ ok: true, job_id: jobId, blocks_needed: totalBlocks, setups: computed.length });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
