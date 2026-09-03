// src/lib/holeyChunks.ts
// P439 — extracted verbatim from cutting-pilot/src/app/api/orders/route.ts (P438) so the new
// PUT /v2/api/orders/:id handler can reuse it without duplicating the nester. Reads the
// job's line items, resolves HB thickness from the parts catalog, runs the FFD nester,
// writes jobs.hb_chunks_required + hb_chunk_breakdown. Non-HB jobs (no HB line items) get
// NULL / NULL. Best-effort by convention — callers log + swallow on failure so a nester bug
// never blocks the surrounding save.
import { nestHoleyChunks } from "@/lib/holeyNester";

export async function computeAndPersistHoleyChunks(db: any, jobId: string) {
  const rows = await db
    .prepare(
      `SELECT jli.quantity AS qty, p.height_in AS thickness
         FROM job_line_items jli
         JOIN parts p ON p.id = jli.part_id
        WHERE jli.job_id = ? AND p.category = 'Holey Board' AND p.height_in > 0`
    )
    .bind(jobId)
    .all();

  const items = (rows.results || []).map((r: any) => ({
    thickness: Number(r.thickness),
    qty: Number(r.qty),
  }));

  let chunksRequired: number | null = null;
  let breakdownJson: string | null = null;
  if (items.length) {
    const res = nestHoleyChunks(items);
    chunksRequired = res.chunks_required;
    breakdownJson = JSON.stringify(res);
  }

  await db
    .prepare(`UPDATE jobs SET hb_chunks_required = ?, hb_chunk_breakdown = ? WHERE id = ?`)
    .bind(chunksRequired, breakdownJson, jobId)
    .run();
}
