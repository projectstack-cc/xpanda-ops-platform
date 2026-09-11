// src/app/api/shipments/route.ts  ->  GET /v2/api/shipments
// Read-only outbound shipment list backing the /v2/logistics dashboard, plus single-shipment
// lookup by job_id (used by BolViewerModal to compute *fresh* lock state -- see Bug 2 in the
// prompt: never trust a shipment row already sitting in an in-memory list). Mirrors the shape
// of legacy's GET /api/shipments (_worker.js/routes/jobs.js handleApiShipments) -- same columns,
// same bol_count subquery -- but scoped to outbound only (inbound/bead shipments are out of
// scope for this unit) and, unlike legacy, orders soonest-ship-date-first: this is a live ops
// queue of what ships next, not an admin log.
// Gated on `logistics.dashboard` by middleware (GET view) -- same key as legacy's /api/shipments.
//
// Distance/ETA enrichment (miles + drive time to each ship-to address) is CACHE-ONLY here --
// this route makes zero ORS calls, on purpose. Callers can request any date window (Calendar
// view fetches up to 365 days), so resolving mileage inline would be unbounded -- hundreds of
// sequential ORS calls in one request risks an edge timeout AND could burn the ORS_API_KEY
// quota that Invoice Analytics depends on for its own (financial) mileage stats, degrading a
// live feature for a reason nobody would think to check. Warming the cache for cold addresses
// is the separate, bounded GET /v2/api/shipments/distances route, called client-side only from
// the dashboard's default List + This-Week view (see ShipmentDashboard.tsx).
import { NextResponse, type NextRequest } from "next/server";
import type { D1Database } from "@cloudflare/workers-types";
import { getEnv } from "@/lib/db";
import { normalizeAddressKey } from "@/lib/logistics/freightInvoice";

interface CacheRow {
  address_key: string;
  miles_from_origin: number | null;
  duration_sec_from_origin: number | null;
  status: string;
}

// Batched, cache-only distance/ETA lookup for a set of already-loaded shipment rows. Computes
// the address key in JS (never in SQL -- normalizeAddressKey's whitespace-collapse/punctuation
// strip can't be reproduced as a SQL expression without risking a key mismatch, which would be
// a silent 100% cache miss) and does one chunked `IN (...)` query. Never writes to the cache.
async function attachDistanceEta(DB: D1Database, rows: any[]): Promise<void> {
  const keyByRowIndex = new Map<number, string>();
  rows.forEach((row, i) => {
    const zip = (row.ship_to_zip || "").trim();
    if (!row.job_id || !zip) return;
    keyByRowIndex.set(
      i,
      normalizeAddressKey(row.ship_to_street || "", row.ship_to_city || "", row.ship_to_state || "", zip)
    );
  });

  const uniqueKeys = Array.from(new Set(keyByRowIndex.values()));
  const cacheByKey = new Map<string, CacheRow>();

  const CHUNK = 100; // stay under D1's bind-parameter limit
  for (let i = 0; i < uniqueKeys.length; i += CHUNK) {
    const chunk = uniqueKeys.slice(i, i + CHUNK);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const res = await DB.prepare(
      `SELECT address_key, miles_from_origin, duration_sec_from_origin, status
       FROM geocode_cache WHERE address_key IN (${placeholders})`
    )
      .bind(...chunk)
      .all<CacheRow>();
    for (const r of res.results ?? []) cacheByKey.set(r.address_key, r);
  }

  rows.forEach((row, i) => {
    const key = keyByRowIndex.get(i);
    const cached = key ? cacheByKey.get(key) : undefined;
    if (!key) {
      row.miles_from_origin = null;
      row.duration_sec = null;
      row.distance_status = "unavailable";
    } else if (cached && cached.status === "ok" && cached.miles_from_origin != null) {
      row.miles_from_origin = cached.miles_from_origin;
      row.duration_sec = cached.duration_sec_from_origin;
      row.distance_status = "ok";
    } else {
      row.miles_from_origin = null;
      row.duration_sec = null;
      row.distance_status = "pending";
    }
    // Trim the raw street off the response -- only needed server-side to build the key.
    delete row.ship_to_street;
  });
}

// Hoisted so the same exact predicate text backs both the stats CASE clauses below AND the
// optional ?stat= drilldown WHERE clause -- a drilldown fetch must return exactly the rows the
// tile counted, so the two can never drift. Every predicate is qualified `shipments.*` (never a
// bare column) because the row-list query is `FROM shipments LEFT JOIN jobs j`, and `jobs` has
// its own status/ship_date/created_at columns -- an unqualified predicate reused there throws
// "ambiguous column name". Each predicate already includes its own
// `shipments.direction = 'outbound'` clause, so the base outbound scope travels with it into the
// ?stat= path with no separate concatenation needed.
const STAT_PREDICATES: Record<string, { sql: string; binds: (curMonStr: string) => unknown[] }> = {
  outbound_this_week: {
    sql: "shipments.direction = 'outbound' AND shipments.ship_date >= ? AND shipments.ship_date <= date(?, '+6 days')",
    binds: (curMonStr) => [curMonStr, curMonStr],
  },
  pending_outbound: {
    sql: "shipments.direction = 'outbound' AND shipments.status IN ('not_started', 'in_production', 'ready_to_ship')",
    binds: () => [],
  },
  in_transit: {
    sql: "shipments.direction = 'outbound' AND shipments.status = 'in_transit'",
    binds: () => [],
  },
  delivered_30d: {
    sql: "shipments.direction = 'outbound' AND shipments.status = 'delivered' AND (shipments.ship_date >= date('now', '-30 days') OR shipments.created_at >= datetime('now', '-30 days'))",
    binds: () => [],
  },
};

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const url = new URL(request.url);
  const jobId = url.searchParams.get("job_id");
  const week = url.searchParams.get("week"); // YYYY-MM-DD Monday start
  const status = url.searchParams.get("status");
  const daysParam = url.searchParams.get("days");
  const days = daysParam !== null ? parseInt(daysParam, 10) : 60;
  const q = url.searchParams.get("q")?.trim().toLowerCase();
  const statKey = url.searchParams.get("stat");

  if (statKey && !Object.prototype.hasOwnProperty.call(STAT_PREDICATES, statKey)) {
    return NextResponse.json({ ok: false, error: "Invalid stat key." }, { status: 400 });
  }

  // Calculate Monday of current week for stats
  const now = new Date();
  const day = now.getUTCDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const curMon = new Date(now);
  curMon.setUTCDate(now.getUTCDate() + diffToMon);
  const curMonStr = curMon.toISOString().slice(0, 10);

  // Qualified with the `shipments.` prefix throughout -- the LEFT JOIN below pulls in `jobs`,
  // which has its own created_at/direction-shaped columns; an unqualified WHERE would be
  // ambiguous (or silently bind to the wrong table). This route is outbound-only end to end
  // (its own original purpose), so direction is a hardcoded literal, never a query-param
  // override -- there is no inbound consumer anywhere in cutting-pilot/src.
  let where: string[];
  let binds: unknown[];

  if (statKey) {
    // Drilldown mode: bypass the normal week/days/status/q filtering entirely so the row list
    // matches exactly what the stat tile counted.
    const predicate = STAT_PREDICATES[statKey];
    where = [predicate.sql];
    binds = predicate.binds(curMonStr);
  } else {
    where = ["shipments.direction = 'outbound'"];
    binds = [];

    if (jobId) {
      // A specific job's shipment is wanted regardless of date window (e.g. an older shipment
      // whose ship_date/created_at has aged out of the default range) -- mirrors legacy's
      // job_id-bypasses-the-date-filter behavior on GET /api/bols.
      where.push("shipments.job_id = ?");
      binds.push(jobId);
    } else if (week) {
      where.push("shipments.ship_date >= ? AND shipments.ship_date <= date(?, '+6 days')");
      binds.push(week, week);
    } else if (days > 0) {
      where.push("(shipments.created_at >= datetime('now', ? || ' days') OR (shipments.ship_date IS NOT NULL AND shipments.ship_date >= date('now', '-7 days')))");
      binds.push(`-${days}`);
    }

    if (status) {
      const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        where.push("shipments.status = ?");
        binds.push(statuses[0]);
      } else if (statuses.length > 1) {
        where.push(`shipments.status IN (${statuses.map(() => "?").join(",")})`);
        binds.push(...statuses);
      }
    }

    if (q) {
      where.push("(LOWER(shipments.customer) LIKE ? OR LOWER(j.invoice_number) LIKE ? OR LOWER(shipments.trailer_number) LIKE ? OR LOWER(shipments.carrier) LIKE ? OR LOWER(shipments.bol_number) LIKE ?)");
      const qPattern = `%${q}%`;
      binds.push(qPattern, qPattern, qPattern, qPattern, qPattern);
    }
  }

  try {
    const [listResult, statsResult] = await Promise.all([
      DB.prepare(
        `SELECT shipments.*, j.invoice_number,
                j.ship_to_street, j.ship_to_city, j.ship_to_state, j.ship_to_zip,
                (SELECT COUNT(*) FROM bols b WHERE b.job_id = shipments.job_id) AS bol_count
           FROM shipments
           LEFT JOIN jobs j ON j.id = shipments.job_id
          WHERE ${where.join(" AND ")}
          ORDER BY (shipments.ship_date IS NULL OR shipments.ship_date = ''),
                   shipments.ship_date ASC, shipments.created_at ASC`
      ).bind(...binds).all(),
      DB.prepare(
        `SELECT
           COUNT(CASE WHEN ${STAT_PREDICATES.outbound_this_week.sql} THEN 1 END) AS outbound_this_week,
           COUNT(CASE WHEN ${STAT_PREDICATES.pending_outbound.sql} THEN 1 END) AS pending_outbound,
           COUNT(CASE WHEN ${STAT_PREDICATES.in_transit.sql} THEN 1 END) AS in_transit,
           COUNT(CASE WHEN ${STAT_PREDICATES.delivered_30d.sql} THEN 1 END) AS delivered_30d
         FROM shipments`
      ).bind(
        ...STAT_PREDICATES.outbound_this_week.binds(curMonStr),
        ...STAT_PREDICATES.pending_outbound.binds(curMonStr),
        ...STAT_PREDICATES.in_transit.binds(curMonStr),
        ...STAT_PREDICATES.delivered_30d.binds(curMonStr)
      ).first(),
    ]);

    const rows = (listResult.results ?? []) as any[];
    await attachDistanceEta(DB, rows);

    return NextResponse.json({
      ok: true,
      data: rows,
      stats: {
        outboundThisWeek: (statsResult as any)?.outbound_this_week ?? 0,
        pendingOutbound: (statsResult as any)?.pending_outbound ?? 0,
        inTransit: (statsResult as any)?.in_transit ?? 0,
        delivered30d: (statsResult as any)?.delivered_30d ?? 0,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
