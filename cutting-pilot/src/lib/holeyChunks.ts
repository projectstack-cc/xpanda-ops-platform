// src/lib/holeyChunks.ts
// P439 — extracted verbatim from cutting-pilot/src/app/api/orders/route.ts (P438) so the new
// PUT /v2/api/orders/:id handler can reuse it without duplicating the nester. Reads the
// job's line items, resolves HB thickness from the parts catalog, runs the FFD nester,
// writes jobs.hb_chunks_required + hb_chunk_breakdown. Non-HB jobs (no HB line items) get
// NULL / NULL. Best-effort by convention — callers log + swallow on failure so a nester bug
// never blocks the surrounding save.
//
// hb-onhand-01: also nets against jobs.hb_on_hand (floor stock) and adds `lines`/`net` to the
// breakdown JSON, mirroring _worker.js/routes/jobs.js's computeAndPersistHoleyChunks exactly.
// Required so a v2 order save doesn't silently drop `net` and make floor stock disappear from
// the cut list. No v2 edit endpoint for hb_on_hand itself in this prompt (see BACKLOG.md).
import { nestHoleyChunks, netHoleyChunks, type HbLine, type NestInputItem } from "@/lib/holeyNester";

export async function computeAndPersistHoleyChunks(db: any, jobId: string) {
  const rows = await db
    .prepare(
      `SELECT jli.quantity AS qty, p.height_in AS thickness,
              jli.part_id AS part_id, jli.part_number AS part_number
         FROM job_line_items jli
         JOIN parts p ON p.id = jli.part_id
        WHERE jli.job_id = ? AND p.category = 'Holey Board' AND p.height_in > 0
        ORDER BY jli.sort_order ASC`
    )
    .bind(jobId)
    .all();

  const resultRows: any[] = rows.results || [];
  const items: NestInputItem[] = resultRows.map((r) => ({
    thickness: Number(r.thickness),
    qty: Number(r.qty),
  }));

  // Lines for netHoleyChunks — quantities summed across duplicate part_ids, in first-seen
  // sort_order (resultRows is already ORDER BY jli.sort_order ASC above).
  const lineMap = new Map<string, HbLine>();
  for (const r of resultRows) {
    const existing = lineMap.get(r.part_id);
    if (existing) existing.qty += Number(r.qty);
    else
      lineMap.set(r.part_id, {
        part_id: r.part_id,
        part_number: r.part_number,
        thickness: Number(r.thickness),
        qty: Number(r.qty),
      });
  }
  const lines = Array.from(lineMap.values());

  let chunksRequired: number | null = null;
  let breakdownJson: string | null = null;
  if (items.length) {
    const res: any = nestHoleyChunks(items);
    chunksRequired = res.chunks_required;

    res.lines = lines;
    const onHandRow = await db.prepare(`SELECT hb_on_hand FROM jobs WHERE id = ?`).bind(jobId).first();
    let parsedOnHand: any = null;
    try {
      parsedOnHand = onHandRow?.hb_on_hand ? JSON.parse(onHandRow.hb_on_hand) : null;
    } catch {
      parsedOnHand = null;
    }
    const net = netHoleyChunks(lines, parsedOnHand, res.chunks_required);
    if (net) res.net = net;

    breakdownJson = JSON.stringify(res);
  }

  await db
    .prepare(`UPDATE jobs SET hb_chunks_required = ?, hb_chunk_breakdown = ? WHERE id = ?`)
    .bind(chunksRequired, breakdownJson, jobId)
    .run();
}
