// src/app/api/board/route.ts  →  GET /v2/api/board
// Read-only board payload: active (non-archived) jobs + assignees + cutting/loading flags,
// and Open/Cutting/Loading counts. Gated on `jobs` (view). No writes here — see [id]/route.ts
// (P343) for the PUT endpoint.
// P343 additive extension: a few more read-only columns (invoice_number, notes, cutting/packing
// instructions, full ship-to) for the board's row-expand "Order spec" read-only block — the
// board table itself (P342) still only renders the original field set.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { parseProcesses } from "@/lib/processes";

export async function GET() {
  const { DB } = await getEnv();
  // jb-01: 14-day auto-archive sweep, ported verbatim from legacy GET /api/jobs (routes/jobs.js).
  // Legacy keeps its copy until the legacy board retires (jb-09); running both is harmless —
  // the UPDATE is idempotent via archived_at IS NULL. Sets archived_at only, never status.
  // Archives FINISHED jobs only: ship_date > 14 days ago AND (status done/shipped OR a delivered
  // outbound shipment). Best-effort — a sweep failure must never break the board.
  try {
    await DB.prepare(
      `UPDATE jobs SET archived_at = ?
       WHERE archived_at IS NULL
         AND ship_date IS NOT NULL AND ship_date <> ''
         AND ship_date < date('now','-14 days')
         AND (
           status IN ('done', 'shipped')
           OR EXISTS (
             SELECT 1 FROM shipments s
             WHERE s.job_id = jobs.id AND s.direction = 'outbound' AND s.status = 'delivered'
           )
         )`
    ).bind(new Date().toISOString()).run();
  } catch (e) {
    console.error("stale-job auto-archive sweep failed:", e);
  }
  try {
    // loading_assignments.loading_status vocabulary (confirmed against the live tree):
    // awaiting | not_started | loading | loaded | in_transit | delivered | archived.
    // "Actively loading" excludes the two terminal states — delivered (done) and archived
    // (dead row). There is no 'shipped' value on this column (that's jobs.status, a different
    // table) — do not filter on it here.
    const jobsRows = await DB.prepare(`
      SELECT j.id, j.customer, j.po_number, j.invoice_number, j.status, j.priority, j.priority_level,
             j.ship_date, j.notes, j.cutting_instructions, j.packing_instructions,
             j.ship_to_company, j.ship_to_attention, j.ship_to_street, j.ship_to_city,
             j.ship_to_state, j.ship_to_zip, j.processes, j.trailer_group_id,
             EXISTS (SELECT 1 FROM cutting_lines cl
                       WHERE cl.job_id = j.id AND cl.line_status = 'in_progress') AS in_cutting,
             EXISTS (SELECT 1 FROM loading_assignments la
                       WHERE la.job_id = j.id
                         AND la.loading_status NOT IN ('delivered','archived')) AS is_loading
        FROM jobs j
       WHERE j.archived_at IS NULL
         AND j.status IN ('not_started','in_production','done','loading')
       ORDER BY COALESCE(j.priority_level, 0) DESC, j.ship_date ASC
    `).all();

    const jobs = (jobsRows.results ?? []) as any[];

    // Assignees per job (name list) — one query, grouped client-side. Mirrors the exact pattern
    // (and the real `u.display_name` column — NOT `u.name`) from _worker.js/routes/jobs.js's
    // GET /api/jobs assignee enrichment, chunked at 90 like that same call site.
    const ids = jobs.map((j) => j.id);
    let assigneeMap: Record<string, string[]> = {};
    const CHUNK = 90;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      if (!slice.length) continue;
      const placeholders = slice.map(() => "?").join(",");
      const aRows = await DB.prepare(
        `SELECT ja.job_id, u.display_name AS user_name
           FROM job_assignments ja JOIN users u ON u.id = ja.user_id
          WHERE ja.job_id IN (${placeholders})`
      ).bind(...slice).all();
      for (const r of (aRows.results ?? []) as any[]) {
        (assigneeMap[r.job_id] ??= []).push(r.user_name);
      }
    }

    const enriched = jobs.map((j) => ({
      ...j,
      in_cutting: !!j.in_cutting,
      is_loading: !!j.is_loading,
      assignees: assigneeMap[j.id] ?? [],
      processes: parseProcesses(j.processes),
    }));

    const counts = {
      open: enriched.filter((j) => j.status === "not_started" || j.status === "in_production").length,
      cutting: enriched.filter((j) => j.in_cutting).length,
      loading: enriched.filter((j) => j.is_loading).length,
    };

    return NextResponse.json({ ok: true, jobs: enriched, counts });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
