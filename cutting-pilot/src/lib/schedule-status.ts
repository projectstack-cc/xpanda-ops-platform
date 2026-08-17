// src/lib/schedule-status.ts
// Derives a floor-facing status for each matched schedule-board job from live platform state
// (jobs, loading_assignments, cutting_lines, cutting_sessions) — NOT from the sheet's own
// status column, which is only ever a fallback for unmatched rows (see schedule-ingest.ts).
import type { D1Database } from "@cloudflare/workers-types";

export type ScheduleStatus = "Shipped" | "Loaded" | "Loading" | "Ready" | "In Production" | "Cutting" | "Not Started";

export interface DerivedStatus {
  status: ScheduleStatus;
  progressPct: number | null;
  // P377: multi-load "Loading X of Y". Non-null only when status === "Loading". loadsTotal (Y) is
  // the order's full load count; loadsDone (X) is loads at loaded-or-beyond. Null otherwise.
  loadsDone: number | null;
  loadsTotal: number | null;
}

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
 *   2. any loading_assignments.loading_status = 'delivered'            → Shipped
 *   3. any loading_assignments.loading_status = 'in_transit'           → Shipped
 *   4. any loading_assignments.loading_status = 'loaded'                → Loaded
 *   5. any loading_assignments.loading_status = 'loading'                → Loading
 *   6. all of the job's cutting_lines are 'complete' (or jobs.status = 'done') → Ready
 *   7. open session → Cutting; else in_progress → In Production (X% = checked items ÷
 *      items×lines); else Not Started
 *
 * Rung 0 is a legacy compatibility shim, not a general design rule. The archive refactor
 * (DB_Migrations/jobs-archived-at.sql, 1/3) made archiving orthogonal to lifecycle status via a
 * new archived_at column: jobs archived from that point on keep their real status and derive
 * normally through rungs 1-8 like any other job — including one archived while still mid-
 * production, which must NOT resolve to "Shipped". Only the finite, shrinking population of rows
 * already archived before the refactor (real prior status unrecoverable, backfilled with
 * archived_at but left at the literal status='archived') still needs rung 0 — without it those
 * rows would fall through to "Not Started", misreporting an old completed order as untouched.
 * jobs.id (and every id here) is TEXT, never numeric.
 *
 * loading_assignments.loading_status spans not_started → awaiting → loading → loaded →
 * in_transit → delivered (plus archived, already excluded by the query filter below).
 * `awaiting`/`not_started` are deliberately NOT dock signals — a row is seeded at
 * loading_status='awaiting' the moment a job is created (load_count expansion in
 * _worker.js/routes/jobs.js), so its mere existence means "a slot exists," not "work is
 * happening." Reading it as dock activity (the prior bug) made rungs 6-8 unreachable for any
 * job with load_count >= 1. Only 'loading' and above count; 'awaiting'/'not_started' fall
 * through to the cutting rungs like a job with no assignment row at all.
 *
 * Cutting rungs (6-7) read v2 cutting_lines/cutting_sessions only — no legacy cutting_steps
 * fallback, by design (Steve-locked: the legacy cutting model was never finished and is
 * scheduled for retirement). A job that has never surfaced in the v2 cutting queue has zero
 * cutting_lines rows (they're created lazily by the queue read's INSERT OR IGNORE) and reads
 * "Not Started" until a loading assignment reaches 'loading'. Correct for a job with genuinely
 * no cutting work; if it's wrong for a job that should be cutting, the bug is in queue
 * reconciliation, not this ladder.
 */
export async function deriveStatuses(db: D1Database, jobIds: string[]): Promise<Map<string, DerivedStatus>> {
  const statuses = new Map<string, DerivedStatus>();
  const distinctIds = Array.from(new Set(jobIds));
  if (distinctIds.length === 0) return statuses;

  const [jobRows, assignmentRows, lineRows, openSessionRows, itemCountRows, doneCountRows] = await Promise.all([
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
    allByJobIds<{ job_id: string; n: number }>(
      db,
      distinctIds,
      (ph) => `SELECT job_id, COUNT(*) AS n FROM job_line_items WHERE job_id IN (${ph}) GROUP BY job_id`
    ),
    allByJobIds<{ job_id: string; n: number }>(
      db,
      distinctIds,
      (ph) =>
        `SELECT job_id, COUNT(*) AS n FROM cutting_line_progress
         WHERE completed = 1 AND job_id IN (${ph}) GROUP BY job_id`
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

  const itemCountByJob = new Map<string, number>();
  for (const row of itemCountRows) itemCountByJob.set(row.job_id, row.n);

  const doneByJob = new Map<string, number>();
  for (const row of doneCountRows) doneByJob.set(row.job_id, row.n);

  for (const jobId of distinctIds) {
    const one = deriveOne(
      jobStatusById.get(jobId) ?? null,
      assignmentsByJob.get(jobId) ?? [],
      linesByJob.get(jobId) ?? [],
      openSessionJobIds.has(jobId)
    );
    const status = one.status;
    let progressPct: number | null = null;
    if (status === "In Production") {
      const itemCount = itemCountByJob.get(jobId) ?? 0;
      const lineCount = (linesByJob.get(jobId) ?? []).length;
      const denom = itemCount * lineCount;
      const done = doneByJob.get(jobId) ?? 0;
      progressPct = denom > 0 ? Math.min(100, Math.floor((done / denom) * 100)) : null;
    }
    statuses.set(jobId, { status, progressPct, loadsDone: one.loadsDone, loadsTotal: one.loadsTotal });
  }

  return statuses;
}

type OneResult = { status: ScheduleStatus; loadsDone: number | null; loadsTotal: number | null };

function deriveOne(
  jobStatus: string | null,
  assignmentStatuses: string[],
  lineStatuses: string[],
  hasOpenSession: boolean
): OneResult {
  const plain = (status: ScheduleStatus): OneResult => ({ status, loadsDone: null, loadsTotal: null });

  // Legacy sentinel only (see docblock above) — not a general "archived is always Shipped" rule.
  if (jobStatus === "archived") return plain("Shipped");
  if (jobStatus === "shipped") return plain("Shipped");

  // Count-aware loading→shipping band (P377). Previously each rung used `.includes(...)`, so a
  // SINGLE loaded/in_transit/delivered load flipped the whole order to Loaded/Shipped. Now the
  // band is proportion-based over the order's real dock loads:
  //   Y (loadsTotal) = all non-archived loads for the order (assignment rows, incl. awaiting slots)
  //   X (loadsDone)  = loads at loaded-or-beyond (loaded | in_transit | delivered)
  // all loads shipped → Shipped; all loaded-or-beyond → Loaded; else if any dock activity →
  // "Loading X of Y". 'awaiting'/'not_started' are seeded slots, NOT dock activity (see docblock),
  // so an order with only those falls through to the cutting rungs exactly as before — but they
  // still count toward Y so the denominator is stable as loads reach the dock. Single-load orders
  // (Y === 1) render as plain "Loading"/"Loaded"; the badge only shows the "of Y" suffix when Y > 1.
  const total = assignmentStatuses.length;
  if (total > 0) {
    const shipped = assignmentStatuses.filter((s) => s === "in_transit" || s === "delivered").length;
    const loadedOrBeyond = assignmentStatuses.filter(
      (s) => s === "loaded" || s === "in_transit" || s === "delivered"
    ).length;
    const anyDock = assignmentStatuses.some(
      (s) => s === "loading" || s === "loaded" || s === "in_transit" || s === "delivered"
    );
    if (shipped === total) return plain("Shipped");
    if (loadedOrBeyond === total) return plain("Loaded");
    if (anyDock) return { status: "Loading", loadsDone: loadedOrBeyond, loadsTotal: total };
  }

  const allLinesComplete = lineStatuses.length > 0 && lineStatuses.every((s) => s === "complete");
  if (jobStatus === "done" || allLinesComplete) return plain("Ready");

  if (hasOpenSession) return plain("Cutting");
  if (lineStatuses.some((s) => s === "in_progress")) return plain("In Production");

  return plain("Not Started");
}
