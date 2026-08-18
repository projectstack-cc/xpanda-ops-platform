// _worker.js/lib/cutting-lines.js
// Shared backfill for the v2 cutting session model (cutting_lines + cutting_sessions),
// invoked from legacy delivery/loading transitions. Data-integrity backstop for missed
// clock-ins: once a job is provably past cutting (loaded / in_transit / delivered), force
// its cutting lines complete so downstream metrics/history aren't left with dangling lines.
//
// Cross-ref xpanda-ops-agents §9a:
//   - Writes ONLY cutting_lines + cutting_sessions. NEVER touches jobs.status — the caller
//     has already advanced the job past 'done'; the all-lines-complete → job-done cascade
//     would be a wrong downgrade here.
//   - Idempotent: the `line_status != 'complete'` guard makes repeat calls no-ops.
//   - No INSERT: a job never tracked in v2 has no cutting_lines rows; nothing to complete.
import { logActivity } from './core.js';

export async function completeCuttingLinesForJob(db, jobId, reason) {
  if (!jobId) return;
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // P385: Only complete cutting when the job is provably, FULLY past cutting — i.e. NO
  // loading_assignment is still pre-loaded. A single loaded trailer on a multi-trailer job used to
  // force-complete every cutting line here (and auto-close the operator's open session via the
  // block below), stopping "Start" mid-run. 'archived' rows are ignored; loaded/in_transit/delivered
  // all count as past cutting. Zero assignments → vacuously past cutting, preserving the job-level
  // status caller's whole-job semantics (it mirrors all assignments before calling). This makes the
  // backstop honor its own "provably past cutting" contract for every caller — the per-trailer
  // loading and driver-QR callers now no-op until the LAST trailer, without any caller-side change.
  const gate = await db.prepare(
    `SELECT COUNT(*) AS pending FROM loading_assignments
     WHERE job_id = ? AND loading_status NOT IN ('loaded','in_transit','delivered','archived')`
  ).bind(jobId).first();
  if ((gate?.pending ?? 0) > 0) return;

  // Complete any not-yet-complete lines.
  const res = await db.prepare(
    `UPDATE cutting_lines SET line_status = 'complete', updated_at = ?
     WHERE job_id = ? AND line_status != 'complete'`
  ).bind(now, jobId).run();

  // Close any still-open sessions (delivered job shouldn't have anyone clocked in).
  await db.prepare(
    `UPDATE cutting_sessions
     SET status = 'closed', ended_at = ?,
         handoff_note = CASE WHEN handoff_note IS NULL OR handoff_note = ''
                             THEN ? ELSE handoff_note END
     WHERE job_id = ? AND status = 'open'`
  ).bind(now, `Auto-closed: job reached ${reason}.`, jobId).run();

  const changed = res?.meta?.changes ?? 0;
  if (changed > 0) {
    await logActivity(
      db, 'update', 'cutting_lines', jobId,
      `Auto-completed ${changed} cutting line(s) — job reached ${reason}`,
      { reason, changed }, null
    );
  }
}
