// src/lib/carrier/rows.ts
// Shared row builder for the carrier load views (carrier-04): GET /v2/api/carrier (Upcoming —
// today through the next business day, ET, inclusive range) and GET /v2/api/carrier/history (delivered in the last 7 days, ET). ONE
// SELECT (extracted from app/api/carrier/route.ts, carrier-01..03) + geocode enrichment + carrier
// charges, so the two tabs can never drift on row shape. Distance data: Upcoming warms up to
// MAX_WARM_PER_REQUEST uncached addresses via ORS; History is cache-only (warm: false).
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";
import { normalizeAddressKey } from "@/lib/logistics/freightInvoice";
import { singleLineAddress } from "@/lib/logistics/address";
import { resolveOrigin, resolveDestRoute } from "@/lib/logistics/routeCache";
import type { GeoPoint } from "@/lib/logistics/ors";
import { fetchBolDocs, fetchBolRowsForJobs, loadKey, pickLoadDocs } from "@/lib/logistics/signedBolDocs";
import { CARRIER_JOB_FILTER } from "./scope";

const MAX_WARM_PER_REQUEST = 3;
const IN_CHUNK = 90;

export type DistanceStatus = "ok" | "pending" | "unavailable";

export interface GeoInfo {
  lat: number | null;
  lng: number | null;
  miles: number | null;
  duration_sec: number | null;
  ok: boolean;
}

export function addressKeyOf(r: any): string | null {
  if (!String(r.ship_to_zip ?? "").trim()) return null; // same rule as the distances route
  return normalizeAddressKey(r.ship_to_street || "", r.ship_to_city || "", r.ship_to_state || "", r.ship_to_zip || "");
}

export async function readGeoCache(DB: D1Database, keys: string[]): Promise<Map<string, GeoInfo>> {
  const out = new Map<string, GeoInfo>();
  for (let i = 0; i < keys.length; i += IN_CHUNK) {
    const chunk = keys.slice(i, i + IN_CHUNK);
    const res = await DB.prepare(
      `SELECT address_key, lat, lng, miles_from_origin, duration_sec_from_origin, status
         FROM geocode_cache WHERE address_key IN (${chunk.map(() => "?").join(",")})`
    )
      .bind(...chunk)
      .all<any>();
    for (const c of res.results ?? []) {
      out.set(c.address_key, {
        lat: c.lat ?? null,
        lng: c.lng ?? null,
        miles: c.miles_from_origin ?? null,
        duration_sec: c.duration_sec_from_origin ?? null,
        ok: c.status === "ok" && c.miles_from_origin != null && c.duration_sec_from_origin != null,
      });
    }
  }
  return out;
}

/** Cache read + (optionally) bounded ORS warm. Returns per-address-key geo info + status. */
export async function resolveGeo(
  DB: D1Database,
  rows: any[],
  warm: boolean
): Promise<Map<string, { info: GeoInfo | null; status: DistanceStatus }>> {
  const keyToRow = new Map<string, any>();
  for (const r of rows) {
    const k = addressKeyOf(r);
    if (k && !keyToRow.has(k)) keyToRow.set(k, r);
  }
  const keys = Array.from(keyToRow.keys());
  const result = new Map<string, { info: GeoInfo | null; status: DistanceStatus }>();
  if (!keys.length) return result;

  const cache = await readGeoCache(DB, keys);
  const missing = keys.filter((k) => !cache.get(k)?.ok);

  let apiKey = "";
  if (warm && missing.length) {
    const { env } = await getCloudflareContext();
    apiKey = (env as any).ORS_API_KEY ?? "";
  }

  const warmed = new Set<string>();
  if (apiKey && missing.length) {
    let origin: GeoPoint | null = null;
    try {
      origin = await resolveOrigin(DB, apiKey);
    } catch (e) {
      console.error("carrier: resolveOrigin failed", e);
    }
    // Sequential, like the distances route — never burst ORS.
    for (const k of missing.slice(0, MAX_WARM_PER_REQUEST)) {
      const r = keyToRow.get(k);
      try {
        await resolveDestRoute(DB, origin, apiKey, r.ship_to_street || "", r.ship_to_city || "", r.ship_to_state || "", r.ship_to_zip || "");
      } catch (e) {
        console.error("carrier: resolveDestRoute failed", e);
      }
      warmed.add(k);
    }
    if (warmed.size) {
      const fresh = await readGeoCache(DB, Array.from(warmed));
      fresh.forEach((v, k) => cache.set(k, v));
    }
  }

  for (const k of keys) {
    const info = cache.get(k) ?? null;
    let status: DistanceStatus;
    if (info?.ok) status = "ok";
    else if (!warm) status = "unavailable"; // cache-only view (History): never calls ORS, never "pending"
    else if (!apiKey || warmed.has(k)) status = "unavailable"; // no key, or tried this request and failed
    else status = "pending"; // beyond this request's warm cap — next poll picks it up
    result.set(k, { info, status });
  }
  return result;
}

export interface CarrierCharge {
  fee_amount_cents: number;
  notes: string;
  created_by_name: string | null;
  created_at: string;
}

async function chargesByBol(DB: D1Database, bolIds: string[]): Promise<Map<string, CarrierCharge[]>> {
  const out = new Map<string, CarrierCharge[]>();
  for (let i = 0; i < bolIds.length; i += IN_CHUNK) {
    const chunk = bolIds.slice(i, i + IN_CHUNK);
    const res = await DB.prepare(
      `SELECT bol_id, fee_amount_cents, notes, created_by_name, created_at
         FROM carrier_charges WHERE bol_id IN (${chunk.map(() => "?").join(",")})
        ORDER BY created_at DESC`
    )
      .bind(...chunk)
      .all<any>();
    for (const c of res.results ?? []) {
      const list = out.get(c.bol_id) ?? [];
      list.push({
        fee_amount_cents: Number(c.fee_amount_cents) || 0,
        notes: c.notes ?? "",
        created_by_name: c.created_by_name ?? null,
        created_at: c.created_at,
      });
      out.set(c.bol_id, list);
    }
  }
  return out;
}

/**
 * carrier-09: load-level signed-BOL flags (digital / photo / carrier copy) for every job in the
 * result — one bols pass + one bol_documents pass (chunked under the bind ceiling), selected with the
 * same rules as the logistics board (lib/logistics/signedBolDocs.ts), so a regenerated BOL row can't
 * hide an artifact captured on an older row of the same load. Keyed `${job_id}|${loadKey}`.
 */
async function loadArtifactsByJob(
  DB: D1Database,
  raw: any[]
): Promise<Map<string, { digital: boolean; photo: boolean; carrier: boolean }>> {
  const out = new Map<string, { digital: boolean; photo: boolean; carrier: boolean }>();
  const jobIds = Array.from(new Set(raw.map((r) => r.job_id).filter(Boolean))) as string[];
  if (!jobIds.length) return out;
  const bols = await fetchBolRowsForJobs(DB, jobIds);
  const docs = bols.length ? await fetchBolDocs(DB, bols.map((b) => b.id)) : [];
  const bolsByJob = new Map<string, typeof bols>();
  for (const b of bols) {
    const list = bolsByJob.get(b.job_id as string) ?? [];
    list.push(b);
    bolsByJob.set(b.job_id as string, list);
  }
  bolsByJob.forEach((jobBols, jobId) => {
    const ids = new Set(jobBols.map((b) => b.id));
    for (const l of pickLoadDocs(jobBols, docs.filter((d) => ids.has(d.bol_id)))) {
      out.set(`${jobId}|${l.load_number}`, { digital: !!l.signed, photo: !!l.photo, carrier: !!l.carrier });
    }
  });
  return out;
}

const SELECT_SQL = `SELECT
         j.invoice_number,
         j.customer,
         j.ship_to_city,
         j.delivery_time,
         j.trailer_group_id,
         j.ship_to_street,
         j.ship_to_street2,
         j.ship_to_zip,
         j.ship_to_state,
         lb.bay_number,
         la.trailer_number,
         la.loading_status,
         la.load_number,
         la.delivered_at,
         la.job_id,
         b.id AS bol_id,
         b.access_token,
         b.load_count,
         b.load_number AS bol_load_number,
         b.signed_bol_additional_info AS additional_info,
         substr(COALESCE(la.ship_date, j.ship_date), 1, 10) AS ship_day
       FROM loading_assignments la
       JOIN jobs j ON j.id = la.job_id
       LEFT JOIN loading_bays lb ON lb.id = la.bay_id
       LEFT JOIN bols b
         ON b.job_id = la.job_id
        AND (
              b.load_number = la.load_number
           OR (b.load_number IS NULL AND (SELECT COUNT(*) FROM bols b2 WHERE b2.job_id = la.job_id) = 1)
            )
        AND b.created_at = (
              SELECT MAX(b3.created_at) FROM bols b3
              WHERE b3.job_id = la.job_id
                AND (
                      b3.load_number = la.load_number
                   OR (b3.load_number IS NULL AND (SELECT COUNT(*) FROM bols b2 WHERE b2.job_id = la.job_id) = 1)
                    )
            )
       WHERE ${CARRIER_JOB_FILTER}
         AND la.loading_status <> 'archived'`;

export type CarrierView =
  | { kind: "upcoming"; today: string; next_day: string }
  | { kind: "history"; sinceUtc: string };

export async function fetchCarrierRows(DB: D1Database, view: CarrierView) {
  const rows =
    view.kind === "upcoming"
      ? await DB.prepare(
          `${SELECT_SQL}
         AND la.bay_id IS NOT NULL AND la.bay_id <> ''
         AND la.trailer_number IS NOT NULL AND la.trailer_number <> ''
         AND substr(COALESCE(la.ship_date, j.ship_date), 1, 10) BETWEEN ? AND ?
       ORDER BY ship_day ASC, lb.bay_number ASC, la.load_number ASC`
        )
          .bind(view.today, view.next_day)
          .all()
      : await DB.prepare(
          `${SELECT_SQL}
         AND la.loading_status = 'delivered'
         AND la.delivered_at IS NOT NULL AND la.delivered_at <> ''
         AND datetime(la.delivered_at) >= datetime(?)
       ORDER BY datetime(la.delivered_at) DESC, la.load_number ASC`
        )
          .bind(view.sinceUtc)
          .all();

  const raw = (rows.results ?? []) as any[];
  const geo = await resolveGeo(DB, raw, view.kind === "upcoming");
  const bolIds = Array.from(new Set(raw.map((r) => r.bol_id).filter(Boolean))) as string[];
  const charges = bolIds.length ? await chargesByBol(DB, bolIds) : new Map<string, CarrierCharge[]>();
  const artifacts = await loadArtifactsByJob(DB, raw);
  const shaped = raw.map((r) => {
    const key = addressKeyOf(r);
    const g = key ? geo.get(key) : undefined;
    const ok = g?.status === "ok";
    const art = r.bol_id ? artifacts.get(`${r.job_id}|${loadKey(r.bol_load_number)}`) : undefined;
    const rowCharges: CarrierCharge[] = (r.bol_id && charges.get(r.bol_id)) || [];
    const count = Number(r.load_count) || 0;
    const n = Number(r.load_number) || 0;
    const suffix = count > 1 && n > 0 ? `-${String(n).padStart(2, "0")}` : "";
    return {
      invoice_number: r.invoice_number,
      customer: r.customer,
      ship_to_city: r.ship_to_city,
      ship_to_state: r.ship_to_state,
      bay_number: r.bay_number,
      trailer_number: r.trailer_number,
      loading_status: r.loading_status,
      load_number: r.load_number,
      load_count: r.load_count ?? null,
      suffix,
      access_token: r.access_token ?? null,
      has_signed_digital: !!art?.digital,
      has_signed_photo: !!art?.photo,
      additional_info: r.additional_info ?? null,
      ship_day: r.ship_day,
      has_carrier_copy: !!art?.carrier,
      delivered_at: r.delivered_at ?? null,
      delivery_time: r.delivery_time ?? null,
      trailer_group_id: (r.trailer_group_id ?? null) as string | null,
      address: singleLineAddress(r),
      miles: ok ? g!.info!.miles : null,
      duration_sec: ok ? g!.info!.duration_sec : null,
      lat: g?.info?.lat ?? null,
      lng: g?.info?.lng ?? null,
      distance_status: (g?.status ?? "unavailable") as DistanceStatus,
      charges: rowCharges,
      charges_total_cents: rowCharges.reduce((sum, c) => sum + c.fee_amount_cents, 0),
    };
  });

  return shaped;
}
