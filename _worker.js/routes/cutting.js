import { json, logActivity, safeJsonParse } from '../lib/core.js';
import { reconcileCuttingSteps, syncJobFromSteps, applyStepCompletionToProcesses } from '../lib/cutting.js';

// Helpers are in lib/cutting.js (not exported from here) so routes/jobs.js can also import them
// without creating a cross-routes import cycle.

export async function handleApiCutting(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Missing D1 binding' }, 500);

  const url = new URL(request.url);
  const pathParts = url.pathname.replace('/api/cutting', '').split('/').filter(Boolean);
  // pathParts[0]: 'start' | stepId | undefined

  // ── GET /api/cutting — board payload ────────────────────────────────────────
  if (request.method === 'GET') {
    try {
      const rows = await db.prepare(`
        SELECT j.id, j.customer, j.invoice_number, j.po_number, j.ship_date,
               j.status, j.total_bdft,
               (SELECT json_group_array(json_object(
                  'id',           cs.id,
                  'job_id',       cs.job_id,
                  'process_name', cs.process_name,
                  'step_status',  cs.step_status,
                  'operator',     cs.operator,
                  'notes',        cs.notes,
                  'started_at',   cs.started_at,
                  'completed_at', cs.completed_at,
                  'sort_order',   cs.sort_order
               ) ORDER BY cs.sort_order ASC)
               FROM cutting_steps cs WHERE cs.job_id = j.id) AS steps_json
        FROM jobs j
        WHERE j.archived_at IS NULL
          AND EXISTS (SELECT 1 FROM cutting_steps cs2 WHERE cs2.job_id = j.id)
        ORDER BY j.ship_date ASC, j.invoice_number ASC
      `).all();

      const jobs = (rows.results || []).map(r => {
        const { steps_json, ...rest } = r;
        return { ...rest, steps: safeJsonParse(steps_json, []) };
      });

      return json({ ok: true, jobs });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  // ── POST /api/cutting/start — job-level Start ────────────────────────────────
  if (request.method === 'POST' && pathParts[0] === 'start') {
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    const job_id = String(payload.job_id || '').trim();
    if (!job_id) return json({ ok: false, error: 'job_id is required.' }, 400);

    try {
      const now = new Date().toISOString();
      await db.prepare(`
        UPDATE cutting_steps SET step_status = 'in_progress', started_at = ?, updated_at = ?
        WHERE job_id = ? AND step_status = 'queued'
      `).bind(now, now, job_id).run();

      await db.prepare(`
        UPDATE jobs SET status = 'in_production', updated_at = ?
        WHERE id = ? AND status = 'not_started'
      `).bind(now, job_id).run();

      await logActivity(db, 'update', 'job', job_id,
        `Started cutting for job ${job_id}`,
        { action: 'cutting_start' }
      );
      return json({ ok: true, message: 'Job started.' });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  // ── PUT /api/cutting/:stepId — update a step ─────────────────────────────────
  if (request.method === 'PUT' && pathParts[0]) {
    const stepId = pathParts[0];
    let payload;
    try { payload = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON' }, 400); }

    const step = await db.prepare("SELECT * FROM cutting_steps WHERE id = ?").bind(stepId).first();
    if (!step) return json({ ok: false, error: 'Step not found.' }, 404);

    const sets = [];
    const binds = [];
    const now = new Date().toISOString();

    if ('step_status' in payload) {
      const s = String(payload.step_status);
      if (!['queued', 'in_progress', 'completed'].includes(s))
        return json({ ok: false, error: 'Invalid step_status.' }, 400);
      sets.push('step_status = ?'); binds.push(s);

      if (s === 'in_progress' && step.step_status !== 'in_progress') {
        sets.push('started_at = ?'); binds.push(step.started_at || now);
        sets.push('completed_at = ?'); binds.push(null);
      } else if (s === 'completed' && step.step_status !== 'completed') {
        sets.push('completed_at = ?'); binds.push(now);
        if (!step.started_at) { sets.push('started_at = ?'); binds.push(now); }
      } else if (s !== 'completed') {
        sets.push('completed_at = ?'); binds.push(null);
      }
    }
    if ('operator' in payload) { sets.push('operator = ?'); binds.push(String(payload.operator || '')); }
    if ('notes'    in payload) { sets.push('notes = ?');    binds.push(String(payload.notes || '')); }

    if (sets.length === 0) return json({ ok: false, error: 'Nothing to update.' }, 400);
    sets.push('updated_at = ?'); binds.push(now);
    binds.push(stepId);

    try {
      await db.prepare(`UPDATE cutting_steps SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

      if ('step_status' in payload) {
        await applyStepCompletionToProcesses(db, step.job_id);
        await syncJobFromSteps(db, step.job_id);
      }

      await logActivity(db, 'update', 'cutting_step', stepId,
        `Updated cutting step "${step.process_name}" for job ${step.job_id}`,
        { step_status: payload.step_status }
      );

      const updated = await db.prepare("SELECT * FROM cutting_steps WHERE id = ?").bind(stepId).first();
      return json({ ok: true, step: updated });
    } catch (e) {
      return json({ ok: false, error: 'Server error.', detail: String(e?.message || e) }, 500);
    }
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
}
