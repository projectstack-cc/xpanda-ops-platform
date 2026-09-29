// src/lib/logistics/routeCache.ts
// geocode_cache-backed origin + destination route resolution (miles + drive duration) via ORS.
// Moved verbatim (carrier-03) out of app/api/shipments/distances/route.ts so the carrier route
// (/v2/api/carrier) can warm the same cache. Shared ONLY by those two routes -- the invoice
// routes (api/logistics/invoice/route.ts, invoice/resolve-line/route.ts) keep their own local
// copies on purpose so nothing here can ever risk the live invoice-ingest path.
import type { D1Database } from "@cloudflare/workers-types";
import { normalizeAddressKey, composeAddress } from "@/lib/logistics/freightInvoice";
import { FACILITY_ORIGIN_ADDRESS, ORIGIN_CACHE_KEY } from "@/lib/logistics/origin";
import { geocode, drivingMilesAndDuration, type GeoPoint } from "@/lib/logistics/ors";

const NEGATIVE_CACHE_HOURS = 24;

interface CacheRow {
  lat: number | null;
  lng: number | null;
  miles_from_origin: number | null;
  duration_sec_from_origin: number | null;
  status: string;
  updated_at: string;
}

export async function resolveOrigin(DB: D1Database, apiKey: string): Promise<GeoPoint | null> {
  const cached = await DB.prepare("SELECT lat, lng, status FROM geocode_cache WHERE address_key = ?")
    .bind(ORIGIN_CACHE_KEY)
    .first<{ lat: number | null; lng: number | null; status: string }>();
  if (cached && cached.status === "ok" && cached.lat != null && cached.lng != null) {
    return { lat: cached.lat, lng: cached.lng };
  }

  const point = await geocode(FACILITY_ORIGIN_ADDRESS, apiKey);
  const now = new Date().toISOString();
  await DB.prepare(
    `INSERT INTO geocode_cache (address_key, raw_address, lat, lng, miles_from_origin, ors_label, confidence, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
     ON CONFLICT(address_key) DO UPDATE SET
       raw_address = excluded.raw_address, lat = excluded.lat, lng = excluded.lng,
       ors_label = excluded.ors_label, confidence = excluded.confidence, status = excluded.status,
       updated_at = excluded.updated_at`
  )
    .bind(
      ORIGIN_CACHE_KEY,
      FACILITY_ORIGIN_ADDRESS,
      point?.lat ?? null,
      point?.lng ?? null,
      point?.label ?? null,
      point?.confidence ?? null,
      point ? "ok" : "geocode_failed",
      now,
      now
    )
    .run();

  return point;
}

// Three-tier resolve: (1) full cache hit (miles + duration both present) -> zero ORS calls.
// (2) partial cache hit (lat/lng geocoded already -- e.g. by Invoice Analytics -- but duration
// missing, the expected state for every pre-existing row right after the migration) -> one
// matrix call reusing the cached coordinates, writes miles + duration together so they're never
// a mismatched pair. (3) no cache row -> geocode + matrix, full insert. A `geocode_failed` or
// `route_failed` row is only retried if it's more than NEGATIVE_CACHE_HOURS old, so one bad
// address doesn't get re-hit by ORS on every dashboard load.
export async function resolveDestRoute(
  DB: D1Database,
  origin: GeoPoint | null,
  apiKey: string,
  street: string,
  city: string,
  state: string,
  zip: string
): Promise<{ miles: number | null; durationSec: number | null }> {
  const key = normalizeAddressKey(street, city, state, zip);
  const cached = await DB.prepare(
    "SELECT lat, lng, miles_from_origin, duration_sec_from_origin, status, updated_at FROM geocode_cache WHERE address_key = ?"
  )
    .bind(key)
    .first<CacheRow>();

  if (cached && cached.status === "ok" && cached.miles_from_origin != null && cached.duration_sec_from_origin != null) {
    return { miles: cached.miles_from_origin, durationSec: cached.duration_sec_from_origin };
  }

  if (cached && cached.status !== "ok") {
    // updated_at is written as a JS toISOString() value (already has a trailing Z) by every
    // geocode_cache writer in this codebase -- parse directly, don't append another Z.
    const ageMs = Date.now() - Date.parse(cached.updated_at);
    if (Number.isFinite(ageMs) && ageMs < NEGATIVE_CACHE_HOURS * 3600 * 1000) {
      return { miles: null, durationSec: null }; // too recent a failure -- don't re-hit ORS
    }
  }

  if (!origin) return { miles: null, durationSec: null };

  let dest: GeoPoint | null = null;
  if (cached && cached.lat != null && cached.lng != null) {
    dest = { lat: cached.lat, lng: cached.lng }; // already geocoded (e.g. by Invoice Analytics) -- skip Pelias
  } else {
    dest = await geocode(composeAddress(street, city, state, zip), apiKey);
  }

  let miles: number | null = null;
  let durationSec: number | null = null;
  let status = "geocode_failed";
  if (dest) {
    const result = await drivingMilesAndDuration(origin, dest, apiKey);
    miles = result?.miles ?? null;
    durationSec = result?.durationSec ?? null;
    status = result ? "ok" : "route_failed";
  }

  const address = composeAddress(street, city, state, zip);
  const now = new Date().toISOString();
  await DB.prepare(
    `INSERT INTO geocode_cache (address_key, raw_address, lat, lng, miles_from_origin, duration_sec_from_origin, ors_label, confidence, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(address_key) DO UPDATE SET
       raw_address = excluded.raw_address, lat = excluded.lat, lng = excluded.lng,
       miles_from_origin = excluded.miles_from_origin, duration_sec_from_origin = excluded.duration_sec_from_origin,
       ors_label = excluded.ors_label, confidence = excluded.confidence, status = excluded.status,
       updated_at = excluded.updated_at`
  )
    .bind(
      key,
      address,
      dest?.lat ?? null,
      dest?.lng ?? null,
      miles,
      durationSec,
      dest?.label ?? null,
      dest?.confidence ?? null,
      status,
      now,
      now
    )
    .run();

  return { miles, durationSec };
}
