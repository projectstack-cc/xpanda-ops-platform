// src/lib/carrier/scope.ts
// Carrier-account guard for token-addressed carrier routes (/v2/api/carrier/*). A BOL resolves
// ONLY when its job's carrier matches the same filter GET /v2/api/carrier uses — anything else is
// treated as not found, so the carrier account can never read another carrier's BOL by token.
import type { D1Database } from "@cloudflare/workers-types";

/** SQL predicate over `jobs j` — keep identical to the filter in app/api/carrier/route.ts. */
export const CARRIER_JOB_FILTER = "(j.carrier LIKE 'LISMA%' OR j.carrier LIKE 'SEAL%')";

/** Resolve an access token to its full `bols` row, or null if unknown / not a carrier job. */
export async function resolveCarrierBol(
  DB: D1Database,
  token: string | null | undefined
): Promise<Record<string, any> | null> {
  const t = String(token ?? "").trim();
  if (t.length < 8) return null;
  const row = await DB.prepare(
    `SELECT b.* FROM bols b
       JOIN jobs j ON j.id = b.job_id
      WHERE b.access_token = ?
        AND ${CARRIER_JOB_FILTER}
      LIMIT 1`
  )
    .bind(t)
    .first<Record<string, any>>();
  return row ?? null;
}
