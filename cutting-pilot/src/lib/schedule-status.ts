// src/lib/schedule-status.ts
// Derives a floor-facing status for each matched schedule-board job from live platform state
// (jobs, loading_assignments, cutting_lines, cutting_sessions) — NOT from the sheet's own
// status column, which is only ever a fallback for unmatched rows (see schedule-ingest.ts).
import type { D1Database } from "@cloudflare/workers-types";

export type ScheduleStatus = "Shipped" | "Loaded" | "Loading" | "Ready" | "Cutting" | "Not Started";

const CHUNK = 90; // D1 100-bound-param ceiling

async function allByJobIds<T>(
  db: D1Database,
  ids: string[],
  sqlFor: (placeholders: string) => string
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(sqlFor(placeholders))
      .bind(...chunk)
      .all<T>();
    out.push(...(results ?? []));
  }
  return out;
}

/**
 * Precedence ladder (highest wins):
 *   0. jobs.status = 'archived'                                      → Shipped
 *   1. jobs.status = 'shipped'                                       → Shipped
 *   2. any loading_assignments.loading_status = 'loaded' for the job → Loaded
 *   3. any loading_assignments row assigned to the job                → Loading
 *   4. all of the job's cutting_lines are 'complete' (or jobs.status = 'done') → Ready
 *   5. any cutting_lines 'in_progress', or an open cutting_sessions row → Cutting
 *   6. else                                                           → Not Started
 * Archived is authoritative and terminal: it's a human "this is done and off my board"
 * signal, so it outranks every floor-data signal even if cutting/loading was never fully
 * ticked (see PXXX — archived jobs were showing stale mid-production status).
 * jobs.id (and every id here) is TEXT, never numeric.
 */
export async function deriveStatuses(db: D1Database, jobIds: string[]): Promise<Map<string, ScheduleStatus>> {
  const statuses = new Map<string, ScheduleStatus>();
  const distinctIds = Array.from(new Set(jobIds));
  if (distinctIds.length === 0) return statuses;

  const [jobRows, assignmentRows, lineRows, openSessionRows] = await Promise.all([
    allByJobIds<{ id: string; status: string }>(
      db,
      distinctIds,
      (ph) => `SELECT id, status FROM jobs WHERE id IN (${ph})`
    ),
    allByJobIds<{ job_id: string; loading_status: string }>(
      db,
      distinctIds,
      (ph) =>
        `SELECT job_id, loading_status FROM loading_assignments
         WHERE job_id IN (${ph}) AND loading_status != 'archived'`
    ),
    allByJobIds<{ job_id: string; line_status: string }>(
      db,
      distinctIds,
      (ph) => `SELECT job_id, line_status FROM cutting_lines WHERE job_id IN (${ph})`
    ),
    allByJobIds<{ job_id: string }>(
      db,
      distinctIds,
      (ph) => `SELECT DISTINCT job_id FROM cutting_sessions WHERE status = 'open' AND job_id IN (${ph})`
    ),
  ]);

  const jobStatusById = new Map<string, string>();
  for (const row of jobRows) jobStatusById.set(row.id, row.status);

  const assignmentsByJob = new Map<string, string[]>();
  for (const row of assignmentRows) {
    if (!assignmentsByJob.has(row.job_id)) assignmentsByJob.set(row.job_id, []);
    assignmentsByJob.get(row.job_id)!.push(row.loading_status);
  }

  const linesByJob = new Map<string, string[]>();
  for (const row of lineRows) {
    if (!linesByJob.has(row.job_id)) linesByJob.set(row.job_id, []);
    linesByJob.get(row.job_id)!.push(row.line_status);
  }

  const openSessionJobIds = new Set(openSessionRows.map((r) => r.job_id));

  for (const jobId of distinctIds) {
    statuses.set(
      jobId,
      deriveOne(jobStatusById.get(jobId) ?? null, assignmentsByJob.get(jobId) ?? [], linesByJob.get(jobId) ?? [], openSessionJobIds.has(jobId))
    );
  }

  return statuses;
}

function deriveOne(
  jobStatus: string | null,
  assignmentStatuses: string[],
  lineStatuses: string[],
  hasOpenSession: boolean
): ScheduleStatus {
  if (jobStatus === "archived" || jobStatus === "shipped") return "Shipped";
  if (assignmentStatuses.includes("loaded")) return "Loaded";
  if (assignmentStatuses.length > 0) return "Loading";

  const allLinesComplete = lineStatuses.length > 0 && lineStatuses.every((s) => s === "complete");
  if (jobStatus === "done" || allLinesComplete) return "Ready";

  if (lineStatuses.some((s) => s === "in_progress") || hasOpenSession) return "Cutting";

  return "Not Started";
}
