// src/lib/logistics/loadCarriers.ts — per-load carrier overrides (mlc-01).
// job_load_carriers is a SPARSE override layer: effective carrier of load N = the row for (job, N)
// if one exists, else jobs.carrier. A row is stored only when its carrier is non-empty and differs
// (normCarrier) from jobs.carrier at save time, so single-carrier orders have zero rows. Rows with
// load_number > jobs.load_count are ignored by readers and deleted on the next PUT.
import type { D1Database } from "@cloudflare/workers-types";

export interface LoadCarrierRow {
  load_number: number;
  carrier: string;
}

export interface LoadCarriersPayload {
  default_carrier: string | null;
  load_count: number;
  carriers: LoadCarrierRow[];
}

// null when the job doesn't exist.
export async function readLoadCarriers(db: D1Database, jobId: string): Promise<LoadCarriersPayload | null> {
  const job = await db.prepare(`SELECT carrier, load_count FROM jobs WHERE id = ?`)
    .bind(jobId)
    .first<{ carrier: string | null; load_count: number | null }>();
  if (!job) return null;
  const loadCount = Math.max(Number(job.load_count) || 1, 1);
  const rows =
    (await db.prepare(
      `SELECT load_number, carrier FROM job_load_carriers WHERE job_id = ? AND load_number <= ? ORDER BY load_number`
    ).bind(jobId, loadCount).all<LoadCarrierRow>()).results ?? [];
  return {
    default_carrier: job.carrier ?? null,
    load_count: loadCount,
    carriers: rows.map((r) => ({ load_number: Number(r.load_number), carrier: r.carrier })),
  };
}

// The rule. A blank override never counts as a carrier.
export function effectiveLoadCarrier(
  jobCarrier: string | null,
  overrides: Map<number, string>,
  loadNumber: number | null
): string | null {
  if (loadNumber != null) {
    const o = overrides.get(Number(loadNumber));
    if (o != null && o.trim() !== "") return o;
  }
  return jobCarrier;
}

// SQL helpers for readers that join loads (mlc-04). The join alias is always `jlc`.
export function LOAD_CARRIER_JOIN(laAlias: string): string {
  return `LEFT JOIN job_load_carriers jlc ON jlc.job_id = ${laAlias}.job_id AND jlc.load_number = ${laAlias}.load_number`;
}

export function effectiveCarrierSql(jobAlias: string): string {
  return `COALESCE(NULLIF(TRIM(jlc.carrier), ''), ${jobAlias}.carrier)`;
}
