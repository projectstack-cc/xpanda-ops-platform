// src/app/api/board/route.ts  →  GET /v2/api/board
// Read-only board payload: active (non-archived) jobs + assignees + cutting/loading flags,
// and Open/Cutting/Loading counts. Gated on `jobs` (view). No writes (P343).
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET() {
  const { DB } = await getEnv();
  try {
    // loading_assignments.loading_status vocabulary (confirmed against the live tree):
    // awaiting | not_started | loading | loaded | in_transit | delivered | archived.
    // "Actively loading" excludes the two terminal states — delivered (done) and archived
    // (dead row). There is no 'shipped' value on this column (that's jobs.status, a different
    // table) — do not filter on it here.
    const jobsRows = await DB.prepare(`
      SELECT j.id, j.customer, j.po_number, j.status, j.priority, j.priority_level,
             j.ship_date, j.ship_to_city, j.ship_to_state,
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
