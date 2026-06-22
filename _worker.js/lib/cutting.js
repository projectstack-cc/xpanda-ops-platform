// Cutting Dashboard shared helpers — imported by both routes/cutting.js and routes/jobs.js.
// Keeping helpers in lib/ avoids cross-routes imports.
import { safeJsonParse } from './core.js';

const PROCESS_ORDER = ['Cross Cutter', 'Hole Cutter', 'Main Line', 'Blue Line', 'Laminate'];

// Insert a queued step for every checked process; delete queued-only steps whose process was unchecked.
// Never deletes in_progress or completed steps.
export async function reconcileCuttingSteps(db, jobId, processesArray) {
  if (!Array.isArray(processesArray)) return;

  const checkedNames = processesArray
    .map(p => p.name)
    .filter(n => PROCESS_ORDER.includes(n));

  const now = new Date().toISOString();
  for (const name of checkedNames) {
    const sortOrder = PROCESS_ORDER.indexOf(name);
    await db.prepare(`
      INSERT OR IGNORE INTO cutting_steps (id, job_id, process_name, step_status, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', ?, ?, ?)
    `).bind(crypto.randomUUID(), jobId, name, sortOrder, now, now).run();
  }

  const unchecked = PROCESS_ORDER.filter(n => !checkedNames.includes(n));
  for (const name of unchecked) {
    await db.prepare(
      "DELETE FROM cutting_steps WHERE job_id = ? AND process_name = ? AND step_status = 'queued'"
    ).bind(jobId, name).run();
  }
}

// After any step status change: advance job status if all steps done, or if any in_progress.
// Never downgrades loading/shipped/archived jobs.
export async function syncJobFromSteps(db, jobId) {
  const steps = await db.prepare(
    "SELECT step_status FROM cutting_steps WHERE job_id = ?"
  ).bind(jobId).all();

  const rows = steps.results || [];
  if (rows.length === 0) return;

  const allCompleted = rows.every(r => r.step_status === 'completed');
  const anyInProgress = rows.some(r => r.step_status === 'in_progress');

  const job = await db.prepare("SELECT status FROM jobs WHERE id = ?").bind(jobId).first();
  if (!job) return;

  const now = new Date().toISOString();
  if (allCompleted && job.status === 'in_production') {
    await db.prepare("UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?").bind(now, jobId).run();
  } else if (anyInProgress && job.status === 'not_started') {
    await db.prepare("UPDATE jobs SET status = 'in_production', updated_at = ? WHERE id = ?").bind(now, jobId).run();
  }
}

// Recompute jobs.processes[].completed from cutting_steps and persist (step→pill direction).
export async function applyStepCompletionToProcesses(db, jobId) {
  const job = await db.prepare("SELECT processes FROM jobs WHERE id = ?").bind(jobId).first();
  if (!job) return;

  const steps = await db.prepare(
    "SELECT process_name, step_status FROM cutting_steps WHERE job_id = ?"
  ).bind(jobId).all();

  const stepMap = {};
  for (const s of (steps.results || [])) {
    stepMap[s.process_name] = s.step_status;
  }

  const procs = safeJsonParse(job.processes, []);
  const updated = procs.map(p => ({
    ...p,
    completed: stepMap[p.name] === 'completed',
  }));

  await db.prepare("UPDATE jobs SET processes = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(updated), new Date().toISOString(), jobId).run();
}

// Mirror jobs.processes[].completed → cutting_steps.step_status (pill→step direction).
// Used when the Job Board's pill toggle fires a PUT /api/jobs/:id { processes }.
export async function mirrorProcessesToSteps(db, jobId, processesArray) {
  if (!Array.isArray(processesArray)) return;

  const job = await db.prepare("SELECT status FROM jobs WHERE id = ?").bind(jobId).first();
  const inProduction = ['in_production', 'done', 'loading', 'shipped'].includes(job?.status || '');
  const now = new Date().toISOString();

  for (const p of processesArray) {
    if (!p.name) continue;
    const step = await db.prepare(
      "SELECT id, step_status FROM cutting_steps WHERE job_id = ? AND process_name = ?"
    ).bind(jobId, p.name).first();
    if (!step) continue;

    if (p.completed && step.step_status !== 'completed') {
      await db.prepare(
        "UPDATE cutting_steps SET step_status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?"
      ).bind(now, now, step.id).run();
    } else if (!p.completed && step.step_status === 'completed') {
      const revert = inProduction ? 'in_progress' : 'queued';
      await db.prepare(
        "UPDATE cutting_steps SET step_status = ?, completed_at = NULL, updated_at = ? WHERE id = ?"
      ).bind(revert, now, step.id).run();
    }
  }
}
