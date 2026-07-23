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
 *   0. jobs.status = 'archived' (legacy sentinel only — see below)      → Shipped
 *   1. jobs.status = 'shipped'                                         → Shipped
 *   2. any loading_assignments.loading_status = 'loaded' for the job   → Loaded
 *   3. any loading_assignments row assigned to the job                 → Loading
 *   4. all of the job's cutting_lines are 'complete' (or jobs.status = 'done') → Ready
 *   5. any cutting_lines 'in_progress', or an open cutting_sessions row → Cutting
 *   6. else                                                            → Not Started
 *
 * Rung 0 is a legacy compatibility shim, not a general design rule. The archive refactor
 * (DB_Migrations/jobs-archived-at.sql, 1/3) made archiving orthogonal to lifecycle status via a
 * new archived_at column: jobs archived from that point on keep their real status and derive
 * normally through rungs 1-6 like any other job — including one archived while still mid-
 * production, which must NOT resolve to "Shipped". Only the finite, shrinking population of rows
 * already archived before the refactor (real prior status unrecoverable, backfilled with
 * archived_at but left at the literal status='archived') still needs rung 0 — without it those
 * rows would fall through to "Not Started", misreporting an old completed order as untouched.
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
  // Legacy sentinel only (see docblock above) — not a general "archived is always Shipped" rule.
  if (jobStatus === "archived") return "Shipped";

  if (jobStatus === "shipped") return "Shipped";
  if (assignmentStatuses.includes("loaded")) return "Loaded";
  if (assignmentStatuses.length > 0) return "Loading";

  const allLinesComplete = lineStatuses.length > 0 && lineStatuses.every((s) => s === "complete");
  if (jobStatus === "done" || allLinesComplete) return "Ready";

  if (lineStatuses.some((s) => s === "in_progress") || hasOpenSession) return "Cutting";

  return "Not Started";
}
