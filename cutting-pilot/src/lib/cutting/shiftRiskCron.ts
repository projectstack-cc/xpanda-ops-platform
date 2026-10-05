// src/lib/cutting/shiftRiskCron.ts
// Cutting shift-risk notifications (shift-alert-01). Runs from custom-worker.ts's scheduled() on
// every "*/5 * * * *" tick. At each due checkpoint (shiftRisk.ts: T-2h "at risk", end-of-shift "not
// finished"), every candidate job whose LAST assigned shift (job_shifts) is that shift and whose
// cutting isn't finished gets one `cutting.shift_risk` notification per (job, shift, shift_date,
// kind), via an atomic INSERT OR IGNORE claim on shift_risk_alerts — dispatch only when this run
// won the claim (same pattern as latePickupCron.ts). job_shifts has no date, so an unfinished job
// re-alerts every work day until cutting finishes or the chip is removed. Cron context: no session,
// no X-User-*, no cookies, and never getCloudflareContext() — the env comes from scheduled().
import type { D1Database } from "@cloudflare/workers-types";
import { dispatchNotification, type PushEnv } from "@/lib/push";
import { deriveStatuses } from "@/lib/schedule-status";
import { SHIFTS, dueCheckpoints, lastShift, type ShiftKey } from "./shiftRisk";

export interface ShiftRiskEnv extends PushEnv {
  DB: D1Database;
}

const CHUNK = 90; // D1 100-bound-param ceiling

interface CandidateJob {
  jobId: string;
  customer: string | null;
  invoiceNumber: string | null;
  status: string;
  shifts: string[];
}

async function allByJobIds<T>(db: D1Database, ids: string[], sqlFor: (ph: string) => string): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const { results } = await db.prepare(sqlFor(chunk.map(() => "?").join(","))).bind(...chunk).all<T>();
    out.push(...(results ?? []));
  }
  return out;
}

export async function runShiftRiskCheck(env: ShiftRiskEnv): Promise<void> {
  const due = dueCheckpoints(new Date());
  if (due.length === 0) return; // most ticks: no queries at all

  const { results } = await env.DB.prepare(
    `SELECT js.job_id, js.shift, j.customer, j.invoice_number, j.status
       FROM job_shifts js
       JOIN jobs j ON j.id = js.job_id
      WHERE j.archived_at IS NULL
        AND j.status IN ('not_started','in_production','loading')`
  ).all<{ job_id: string; shift: string; customer: string | null; invoice_number: string | null; status: string }>();

  const byJob = new Map<string, CandidateJob>();
  for (const r of results ?? []) {
    let job = byJob.get(r.job_id);
    if (!job) {
      job = { jobId: r.job_id, customer: r.customer, invoiceNumber: r.invoice_number, status: r.status, shifts: [] };
      byJob.set(r.job_id, job);
    }
    job.shifts.push(r.shift);
  }

  // Multi-shift jobs alert only on their last assigned shift.
  const dueShifts = new Set<ShiftKey>(due.map((d) => d.shift));
  const matched = Array.from(byJob.values()).filter((j) => {
    const last = lastShift(j.shifts);
    return last != null && dueShifts.has(last);
  });
  if (matched.length === 0) return;

  const ids = matched.map((j) => j.jobId);
  const [lineCounts, openSessions, derived] = await Promise.all([
    allByJobIds<{ job_id: string; n: number; complete: number }>(
      env.DB,
      ids,
      (ph) =>
        `SELECT job_id, COUNT(*) AS n, SUM(line_status = 'complete') AS complete
           FROM cutting_lines WHERE job_id IN (${ph}) GROUP BY job_id`
    ),
    // Derived status can read Loading while a session is still open, so check sessions directly.
    allByJobIds<{ job_id: string }>(
      env.DB,
      ids,
      (ph) => `SELECT DISTINCT job_id FROM cutting_sessions WHERE status = 'open' AND job_id IN (${ph})`
    ),
    deriveStatuses(env.DB, ids),
  ]);
  const countsByJob = new Map(lineCounts.map((r) => [r.job_id, { n: Number(r.n) || 0, complete: Number(r.complete) || 0 }]));
  const openSessionJobs = new Set(openSessions.map((r) => r.job_id));

  let claimed = 0;
  let notified = 0;

  for (const job of matched) {
    const { n, complete } = countsByJob.get(job.jobId) ?? { n: 0, complete: 0 };
    if (n > 0 && complete === n) continue; // cutting finished
    if (n === 0 && job.status === "loading") continue; // no cutting work

    const last = lastShift(job.shifts) as ShiftKey;
    const d = derived.get(job.jobId);
    const statusLabel = n === 0 ? "Not started" : d?.status ?? "Unknown";
    const pct = d?.progressPct ?? null;
    const cuttingNow = d?.status === "Cutting" || openSessionJobs.has(job.jobId);

    for (const cp of due) {
      if (cp.shift !== last) continue;
      try {
        const claim = await env.DB.prepare(
          `INSERT OR IGNORE INTO shift_risk_alerts (id, job_id, shift, shift_date, kind, notified_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
          .bind(crypto.randomUUID(), job.jobId, cp.shift, cp.shiftDate, cp.kind, new Date().toISOString())
          .run();
        if (claim.meta.changes !== 1) continue; // already sent (or another run won the claim)
        claimed++;

        const endLabel = SHIFTS[cp.shift].endLabel;
        const title =
          cp.kind === "t_minus_2h" ? `Cutting at risk — ${cp.shift} shift` : `Cutting not finished — ${cp.shift} shift`;
        const message =
          `${job.customer || "—"} · INV# ${job.invoiceNumber || "—"} · ${statusLabel}${pct != null ? ` ${pct}%` : ""}` +
          ` · ${cuttingNow ? "being cut now" : "not being cut now"}` +
          ` · ${cp.kind === "t_minus_2h" ? `shift ends ${endLabel}` : `shift ended ${endLabel}`}`;
        await dispatchNotification(env.DB, env, "cutting.shift_risk", title, message, "job", job.jobId);
        notified++;
      } catch (e) {
        console.error("shift-risk: failed for job", job.jobId, cp, e);
      }
    }
  }

  if (claimed > 0) console.log(`shift-risk: ${claimed} claimed, ${notified} notified`);
}
