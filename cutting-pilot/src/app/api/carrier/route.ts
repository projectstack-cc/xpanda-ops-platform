// src/app/api/carrier/route.ts  →  /v2/api/carrier
// Carrier-facing read-only 2-day (today + tomorrow, ET) outgoing-loads view.
// Gated on logistics.carrier_view by middleware (GET view). Reads only — except geocode_cache
// warming (carrier-03): rows are enriched with miles / drive time / lat-lng from geocode_cache,
// and at most MAX_WARM_PER_REQUEST uncached addresses are resolved via ORS per request (same
// shared routeCache helpers as /v2/api/shipments/distances). The rest come back "pending" and
// fill in on the board's next 60s poll — ORS is never looped unbounded.
import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";
import { getEnv } from "@/lib/db";
import { normalizeAddressKey } from "@/lib/logistics/freightInvoice";
import { resolveOrigin, resolveDestRoute } from "@/lib/logistics/routeCache";
import type { GeoPoint } from "@/lib/logistics/ors";

const MAX_WARM_PER_REQUEST = 3;
const IN_CHUNK = 90;

function etDateStr(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

type DistanceStatus = "ok" | "pending" | "unavailable";

interface GeoInfo {
  lat: number | null;
  lng: number | null;
  miles: number | null;
  duration_sec: number | null;
  ok: boolean;
}

// Single-line ship-to incl. street2 (composeAddress-style, but tolerant of missing parts).
function singleLineAddress(r: any): string | null {
  const streetLine = [r.ship_to_street, r.ship_to_street2].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");
  const stateZip = [r.ship_to_state, r.ship_to_zip].map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");
  const cityLine = [String(r.ship_to_city ?? "").trim(), stateZip].filter(Boolean).join(", ");
  return [streetLine, cityLine].filter(Boolean).join(", ") || null;
}

function addressKeyOf(r: any): string | null {
  if (!String(r.ship_to_zip ?? "").trim()) return null; // same rule as the distances route
  return normalizeAddressKey(r.ship_to_street || "", r.ship_to_city || "", r.ship_to_state || "", r.ship_to_zip || "");
}

async function readGeoCache(DB: D1Database, keys: string[]): Promise<Map<string, GeoInfo>> {
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

/** Cache read + bounded ORS warm. Returns per-address-key geo info + status. */
async function resolveGeo(
  DB: D1Database,
  rows: any[]
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
  if (missing.length) {
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
    else if (!apiKey || warmed.has(k)) status = "unavailable"; // no key, or tried this request and failed
    else status = "pending"; // beyond this request's warm cap — next poll picks it up
    result.set(k, { info, status });
  }
  return result;
}

export async function GET() {
  const { DB } = await getEnv();
  const today = etDateStr(0);
  const tomorrow = etDateStr(1);
  try {
    const rows = await DB.prepare(
      `SELECT
         j.invoice_number,
         j.customer,
         j.ship_to_city,
         j.delivery_time,
         j.ship_to_street,
         j.ship_to_street2,
         j.ship_to_zip,
         j.ship_to_state,
         lb.bay_number,
         la.trailer_number,
         la.loading_status,
         la.load_number,
         la.delivered_at,
         EXISTS (SELECT 1 FROM bol_documents d WHERE d.bol_id = b.id AND d.doc_type = 'carrier_upload') AS has_carrier_copy,
         b.access_token,
         b.load_count,
         (b.signed_bol_photo_key IS NOT NULL) AS has_signed,
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
       WHERE (j.carrier LIKE 'LISMA%' OR j.carrier LIKE 'SEAL%')
         AND la.bay_id IS NOT NULL AND la.bay_id <> ''
         AND la.trailer_number IS NOT NULL AND la.trailer_number <> ''
         AND la.loading_status <> 'archived'
         AND substr(COALESCE(la.ship_date, j.ship_date), 1, 10) IN (?, ?)
       ORDER BY ship_day ASC, lb.bay_number ASC, la.load_number ASC`
    ).bind(today, tomorrow).all();

    const raw = (rows.results ?? []) as any[];
    const geo = await resolveGeo(DB, raw);
    const shaped = raw.map((r) => {
      const key = addressKeyOf(r);
      const g = key ? geo.get(key) : undefined;
      const ok = g?.status === "ok";
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
        has_signed: !!r.has_signed,
        additional_info: r.additional_info ?? null,
        ship_day: r.ship_day,
        has_carrier_copy: !!r.has_carrier_copy,
        delivered_at: r.delivered_at ?? null,
        delivery_time: r.delivery_time ?? null,
        address: singleLineAddress(r),
        miles: ok ? g!.info!.miles : null,
        duration_sec: ok ? g!.info!.duration_sec : null,
        lat: g?.info?.lat ?? null,
        lng: g?.info?.lng ?? null,
        distance_status: (g?.status ?? "unavailable") as DistanceStatus,
      };
    });

    return NextResponse.json({ ok: true, today, tomorrow, rows: shaped });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
