// src/lib/logistics/jobSync.ts
// lgx-editmodal-01: job -> shipment field sync + load_count -> loading_assignments reconcile, shared by
// PUT /v2/api/orders/:id (OrderEditModal) and PUT /v2/api/shipments/:id (ShipmentEditModal write-through).
// The job is the source of truth for these fields; the shipment row is a mirror (legacy
// _worker.js/routes/jobs.js SYNC_FIELDS_JOB_TO_SHIPMENT ~L1146). `method` is deliberately absent: it's
// retired from the logistics UI (lgx-editmodal-01) and only set on the Orders form now.

import type { D1Database } from "@cloudflare/workers-types";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

/** Legacy SYNC_FIELDS_JOB_TO_SHIPMENT (jobs.js ~L1146), minus the retired `method`. job field -> shipment column. */
export const JOB_TO_SHIPMENT_SYNC = {
  customer: "customer", carrier: "carrier", ship_date: "ship_date",
  location: "destination", total_bdft: "total_bdft", load_count: "load_count",
} as const;

export type JobSyncField = keyof typeof JOB_TO_SHIPMENT_SYNC;

/** Legacy coercion (jobs.js ~L1161): numerics -> Number(v) || 0, everything else trimmed string. */
export function coerceJobSyncValue(field: JobSyncField, v: unknown): string | number {
  return field === "total_bdft" || field === "load_count"
    ? Number(v) || 0
    : String(v ?? "").trim();
}

/** Mirror already-validated job field values onto the job's outbound shipment. No-op if there are none or no shipment. */
export async function syncJobFieldsToShipment(
  DB: D1Database,
  jobId: string,
  fields: Partial<Record<JobSyncField, string | number>>
): Promise<void> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const [jobField, shipField] of Object.entries(JOB_TO_SHIPMENT_SYNC) as [JobSyncField, string][]) {
    if (!(jobField in fields)) continue;
    sets.push(`${shipField} = ?`);
    binds.push(coerceJobSyncValue(jobField, fields[jobField]));
  }
  if (!sets.length) return;

  const shipment = await DB.prepare(
    "SELECT id FROM shipments WHERE job_id = ? AND direction = 'outbound' LIMIT 1"
  ).bind(jobId).first<{ id: string }>();
  if (!shipment) return;

  sets.push("updated_at = datetime('now')");
  await DB.prepare(`UPDATE shipments SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, shipment.id).run();
}

/** Reconcile loading_assignments to load_count. Hoisted VERBATIM from orders/[id]/route.ts (legacy jobs.js:820–861):
 *  skip customer pickup, insert 'awaiting' rows up to target, delete only surplus rows that are untouched
 *  (awaiting, no bay, no trailer, no photos), highest load_number first. */
export async function reconcileLoadingAssignments(
  DB: D1Database,
  jobId: string,
  loadCount: number,
  method: string | null
): Promise<void> {
  const isPickup = (method || "").toLowerCase() === "customer pickup";
  if (isPickup) return;
  const target = loadCount;
  const curRow = await DB.prepare(
    "SELECT COUNT(*) AS cnt FROM loading_assignments WHERE job_id = ?"
  ).bind(jobId).first<any>();
  const current = Number(curRow?.cnt || 0);
  if (target > current) {
    const nowR = now();
    for (let n = current + 1; n <= target; n++) {
      await DB.prepare(`
        INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
        VALUES (?, ?, NULL, '', 'awaiting', NULL, '', ?, ?, ?)
      `).bind(crypto.randomUUID(), jobId, n, nowR, nowR).run();
    }
  } else if (target < current) {
    const surplus = current - target;
    const safe = await DB.prepare(`
      SELECT la.id FROM loading_assignments la
       WHERE la.job_id = ?
         AND la.loading_status = 'awaiting'
         AND la.bay_id IS NULL
         AND COALESCE(la.trailer_number, '') = ''
         AND NOT EXISTS (SELECT 1 FROM loading_photos lp WHERE lp.assignment_id = la.id)
       ORDER BY la.load_number DESC, la.created_at DESC
       LIMIT ?
    `).bind(jobId, surplus).all<any>();
    for (const r of (safe?.results || [])) {
      await DB.prepare("DELETE FROM loading_assignments WHERE id = ?").bind(r.id).run();
    }
  }
}
