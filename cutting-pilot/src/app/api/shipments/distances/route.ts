// src/app/api/shipments/distances/route.ts  ->  GET /v2/api/shipments/distances?ids=a,b,c
// The ONLY route that talks to ORS for the shipment-board distance/ETA feature. Bounded and
// client-paced: GET /v2/api/shipments (the list route) is cache-only and never calls ORS, so
// this route exists to warm geocode_cache for a small number of shipments at a time, called by
// ShipmentDashboard.tsx only from its default List + This-Week view (never Calendar or "Show
// All", which can span up to 365 days of rows -- see the list route's header comment for why
// that split exists: an unbounded ORS-per-row loop risks an edge timeout and could burn the
// ORS_API_KEY quota that Invoice Analytics depends on for its own mileage stats).
//
// Kept as GET, not POST: middleware.ts maps POST/PUT/DELETE to the `edit` permission, but this
// is read-triggered enrichment (a view of an order's distance) that should stay on the same
// `logistics.dashboard` view-level grant the list route uses. It does write to geocode_cache,
// which is unusual for a GET, but the writes are pure cache population, invisible to anyone but
// this feature and idempotent from any client's point of view.
//
// resolveOrigin/resolveDestRoute now live in src/lib/logistics/routeCache.ts (carrier-03), shared
// with the carrier route (/v2/api/carrier) only. They remain a deliberate, self-contained THIRD
// copy of the cache-read/write pattern already duplicated between invoice/route.ts and
// invoice/resolve-line/route.ts (see the comment on the latter) -- the invoice routes do NOT import
// the shared module, so this feature's failure modes can never risk the live invoice-ingest path,
// which handles real financial data. This copy is a variant, not an exact
// duplicate: it resolves duration alongside miles, backfills duration onto rows the invoice
// feature already geocoded (3-tier, see routeCache.ts), and skips retrying addresses that failed recently
// (negative-cache backoff) so a bad address isn't re-hit by ORS on every dashboard load.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { resolveOrigin, resolveDestRoute } from "@/lib/logistics/routeCache";

const MAX_IDS_PER_CALL = 8;

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids") || "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS_PER_CALL);

  if (!ids.length) {
    return NextResponse.json({ ok: true, results: {} });
  }

  try {
    const { env } = await getCloudflareContext();
    const apiKey = (env as any).ORS_API_KEY ?? "";

    const placeholders = ids.map(() => "?").join(",");
    const shipRows = await DB.prepare(
      `SELECT shipments.id, j.ship_to_street, j.ship_to_city, j.ship_to_state, j.ship_to_zip
         FROM shipments LEFT JOIN jobs j ON j.id = shipments.job_id
        WHERE shipments.id IN (${placeholders})`
    )
      .bind(...ids)
      .all<{
        id: string;
        ship_to_street: string | null;
        ship_to_city: string | null;
        ship_to_state: string | null;
        ship_to_zip: string | null;
      }>();

    const results: Record<string, { miles: number | null; durationSec: number | null; status: string }> = {};

    if (!apiKey) {
      for (const id of ids) results[id] = { miles: null, durationSec: null, status: "unavailable" };
      return NextResponse.json({ ok: true, results });
    }

    const origin = await resolveOrigin(DB, apiKey);

    // Sequential, not Promise.all -- matches the invoice route's deliberate pattern, avoids
    // bursting ORS with concurrent cold-cache calls within one small batch.
    for (const row of shipRows.results ?? []) {
      const zip = (row.ship_to_zip || "").trim();
      if (!zip) {
        results[row.id] = { miles: null, durationSec: null, status: "unavailable" };
        continue;
      }
      const { miles, durationSec } = await resolveDestRoute(
        DB,
        origin,
        apiKey,
        row.ship_to_street || "",
        row.ship_to_city || "",
        row.ship_to_state || "",
        zip
      );
      results[row.id] =
        miles != null && durationSec != null
          ? { miles, durationSec, status: "ok" }
          : { miles: null, durationSec: null, status: "unavailable" };
    }

    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
