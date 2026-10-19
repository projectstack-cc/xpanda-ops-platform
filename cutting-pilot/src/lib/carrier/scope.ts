// src/lib/carrier/scope.ts
// Carrier-account guards for token-addressed carrier routes (/v2/api/carrier/*). A BOL resolves
// ONLY when its LOAD's effective carrier matches the same filter the carrier board uses — anything
// else is treated as not found, so the carrier account can never read another carrier's BOL by token.
// mlc-04: per load — a job_load_carriers override for (job, load) wins, else jobs.carrier
// (lib/logistics/loadCarriers.ts). A BOL with load_number NULL never matches an override row, so it
// falls back to the job carrier (the pre-mlc-04 behavior).
import type { D1Database } from "@cloudflare/workers-types";
import { LOAD_CARRIER_JOIN, effectiveCarrierSql } from "@/lib/logistics/loadCarriers";
import { addDays, etDayBoundsUtc, etToday, nextBusinessDay } from "@/lib/productionSchedule";

/** The one LISMA/SEAL carrier match, over any SQL expression. */
export const CARRIER_MATCH = (expr: string) => `(${expr} LIKE 'LISMA%' OR ${expr} LIKE 'SEAL%')`;

/**
 * Load-level predicate every carrier route uses (rows.ts too). Requires `jobs j` and the
 * `LOAD_CARRIER_JOIN(<load alias>)` join (alias `jlc`) in the same query.
 */
export const CARRIER_LOAD_FILTER = CARRIER_MATCH(effectiveCarrierSql("j"));

/** Delivered loads stay addable/visible for this many ET calendar days (incl. today). */
export const CARRIER_HISTORY_DAYS = 7;

/** UTC "YYYY-MM-DD HH:MM:SS" of ET midnight starting the oldest day of the history window. */
export function historyCutoffUtc(): string {
  return etDayBoundsUtc(addDays(etToday(), -(CARRIER_HISTORY_DAYS - 1)))[0];
}

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
       ${LOAD_CARRIER_JOIN("b")}
      WHERE b.access_token = ?
        AND ${CARRIER_LOAD_FILTER}
      LIMIT 1`
  )
    .bind(t)
    .first<Record<string, any>>();
  return row ?? null;
}

/**
 * The carrier may act on a load only while it's on their board: ship day (ET) is today through
 * the next business day inclusive (Fri → Mon, so a weekend ship day in between counts — same range
 * as the Upcoming board, carrier-11), OR it was delivered within the history window. The BOL's load resolves with the same
 * rule as /api/public/bol-delivery (exact load_number, else the job's sole non-archived assignment).
 */
export async function isWithinCarrierWindow(DB: D1Database, bol: Record<string, any>): Promise<boolean> {
  const la = await DB.prepare(
    bol.load_number != null
      ? `SELECT substr(COALESCE(la.ship_date, j.ship_date), 1, 10) AS ship_day, la.loading_status,
                (la.delivered_at IS NOT NULL AND la.delivered_at <> '' AND datetime(la.delivered_at) >= datetime(?)) AS recent_delivery
           FROM loading_assignments la JOIN jobs j ON j.id = la.job_id
          WHERE la.job_id = ? AND la.load_number = ? AND la.loading_status <> 'archived'`
      : `SELECT substr(COALESCE(la.ship_date, j.ship_date), 1, 10) AS ship_day, la.loading_status,
                (la.delivered_at IS NOT NULL AND la.delivered_at <> '' AND datetime(la.delivered_at) >= datetime(?)) AS recent_delivery
           FROM loading_assignments la JOIN jobs j ON j.id = la.job_id
          WHERE la.job_id = ? AND la.loading_status <> 'archived'`
  )
    .bind(...(bol.load_number != null ? [historyCutoffUtc(), bol.job_id, bol.load_number] : [historyCutoffUtc(), bol.job_id]))
    .first<{ ship_day: string | null; loading_status: string; recent_delivery: number }>();
  if (!la) return false;
  const today = etToday();
  const nextDay = nextBusinessDay(today);
  if (la.ship_day && la.ship_day >= today && la.ship_day <= nextDay) return true;
  return la.loading_status === "delivered" && !!la.recent_delivery;
}
