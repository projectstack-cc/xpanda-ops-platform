// src/lib/boardRows.ts
// board-search-01: the Job Board row loader, shared by GET /v2/api/board (active feed) and
// GET /v2/api/board/search (archived/shipped matches) so both return the identical row shape.
// Extracted verbatim from api/board/route.ts — SELECT column list + assignee / in_cutting /
// is_loading enrichment. Adds `is_archived` (archived_at IS NOT NULL).
import type { D1Database } from "@cloudflare/workers-types";
import { parseProcesses } from "@/lib/processes";
import { fetchLiveLoadByJob } from "@/lib/logistics/liveLoad";

// `whereSql` / `orderSql` are trusted SQL fragments written by the caller (no user text);
// user input goes through `binds` only.
export async function loadBoardRows(
  DB: D1Database,
  whereSql: string,
  binds: unknown[],
  orderSql: string,
  limit?: number
) {
  // loading_assignments.loading_status vocabulary (confirmed against the live tree):
  // awaiting | not_started | loading | loaded | in_transit | delivered | archived.
  // "Actively loading" excludes the two terminal states — delivered (done) and archived
  // (dead row). There is no 'shipped' value on this column (that's jobs.status, a different
  // table) — do not filter on it here.
  const limitSql = limit != null ? `LIMIT ${Math.max(0, Math.floor(limit))}` : "";
  const jobsRows = await DB.prepare(`
    SELECT j.id, j.customer, j.po_number, j.invoice_number, j.status, j.priority, j.priority_level,
           j.ship_date, j.notes, j.cutting_instructions, j.packing_instructions,
           j.ship_to_company, j.ship_to_attention, j.ship_to_street, j.ship_to_city,
           j.ship_to_state, j.ship_to_zip, j.processes, j.trailer_group_id, j.archived_at, j.load_count,
           EXISTS (SELECT 1 FROM cutting_lines cl
                     WHERE cl.job_id = j.id AND cl.line_status = 'in_progress') AS in_cutting,
           EXISTS (SELECT 1 FROM loading_assignments la
                     WHERE la.job_id = j.id
                       AND la.loading_status NOT IN ('delivered','archived')) AS is_loading
      FROM jobs j
     WHERE ${whereSql}
     ORDER BY ${orderSql}
     ${limitSql}
  `).bind(...binds).all();

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

  // live-01: per-job live-load flags (best-effort; empty map on error).
  const liveMap = await fetchLiveLoadByJob(DB, ids);

  return jobs.map((j) => ({
    ...j,
    in_cutting: !!j.in_cutting,
    is_loading: !!j.is_loading,
    is_archived: j.archived_at != null,
    assignees: assigneeMap[j.id] ?? [],
    processes: parseProcesses(j.processes),
    live_load: liveMap.get(j.id)?.live ?? false,
    live_loads: liveMap.get(j.id)?.live_loads ?? [],
  }));
}
