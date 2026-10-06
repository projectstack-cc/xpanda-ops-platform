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
import { expandShipmentDays, inWeek, sortEntries, weekTileCounts, type LoadDayRow } from "@/lib/logistics/splitDays";

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
    } else if (
      cached &&
      cached.status === "ok" &&
      cached.miles_from_origin != null &&
      cached.duration_sec_from_origin != null
    ) {
      // lgx-eta-01: require BOTH values, matching lib/carrier/rows.ts and routeCache.ts's full-hit
      // rule. Miles-only rows (written by Invoice Analytics) fall through to "pending" so the
      // dashboard warm-up sends them to /distances, where resolveDestRoute's tier-2 partial hit
      // backfills duration with one matrix call (no re-geocode).
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
// archived-hide-01: a job archived before departure (QB void, cancelled order) drops off the board;
// shipped-then-archived jobs stay visible so delivered history is intact. NOT EXISTS (not j.archived_at)
// so it works in the list query (joins jobs j), the stats query and loadsSubquery (which don't).
const NOT_ARCHIVED_PREDEPARTURE =
  "(shipments.status IN ('in_transit','delivered') OR NOT EXISTS (SELECT 1 FROM jobs ja WHERE ja.id = shipments.job_id AND ja.archived_at IS NOT NULL))";

// split-days-01: order date in [?, ?+6] OR any non-archived load with its own ship_date in [?, ?+6]. 4 binds.
const WEEK_SUPERSET =
  "(shipments.ship_date >= ? AND shipments.ship_date <= date(?, '+6 days') OR EXISTS (SELECT 1 FROM loading_assignments lw WHERE lw.job_id = shipments.job_id AND lw.loading_status <> 'archived' AND TRIM(COALESCE(lw.ship_date, '')) <> '' AND substr(lw.ship_date, 1, 10) >= ? AND substr(lw.ship_date, 1, 10) <= date(?, '+6 days')))";

const STAT_PREDICATES: Record<string, { sql: string; binds: (curMonStr: string) => unknown[] }> = {
  outbound_this_week: {
    // split-days-01: SUPERSET (order date in week OR any load's own ship_date in week), used only for the
    // ?stat=outbound_this_week drilldown + the tile's current-week query. Exact membership comes from
    // expandShipmentDays + inWeek in GET -- never counted directly in SQL.
    sql: "shipments.direction = 'outbound' AND " + WEEK_SUPERSET + " AND " + NOT_ARCHIVED_PREDEPARTURE,
    binds: (curMonStr) => [curMonStr, curMonStr, curMonStr, curMonStr],
  },
  pending_outbound: {
    sql: "shipments.direction = 'outbound' AND shipments.status IN ('not_started', 'in_production', 'ready_to_ship') AND " + NOT_ARCHIVED_PREDEPARTURE,
    binds: () => [],
  },
  in_transit: {
    sql: "shipments.direction = 'outbound' AND shipments.status = 'in_transit' AND " + NOT_ARCHIVED_PREDEPARTURE,
    binds: () => [],
  },
  delivered_30d: {
    sql: "shipments.direction = 'outbound' AND shipments.status = 'delivered' AND (shipments.ship_date >= date('now', '-30 days') OR shipments.created_at >= datetime('now', '-30 days')) AND " + NOT_ARCHIVED_PREDEPARTURE,
    binds: () => [],
  },
};

// lgx-widgets-01: loads (trailers) for a stat predicate. Each order = its load_count (min 1); orders linked on
// one trailer (jobs.trailer_group_id) collapse to one group counted at MAX(load_count). The inner FROM shadows
// the outer stats query's `shipments`, so the predicate text (already `shipments.`-qualified) binds here.
function loadsSubquery(predicateSql: string, alias: string): string {
  return `(SELECT COALESCE(SUM(l), 0) FROM (
            SELECT MAX(COALESCE(NULLIF(shipments.load_count, 0), 1)) AS l
              FROM shipments LEFT JOIN jobs j ON j.id = shipments.job_id
             WHERE ${predicateSql}
             GROUP BY COALESCE(j.trailer_group_id, shipments.id)
          )) AS ${alias}`;
}

// split-days-01: non-archived per-load ship days for a set of jobs, grouped by job_id. Chunked to stay under
// D1's bind-parameter limit.
async function loadDaysByJob(DB: D1Database, jobIds: string[]): Promise<Map<string, LoadDayRow[]>> {
  const out = new Map<string, LoadDayRow[]>();
  const CHUNK = 90;
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    const chunk = jobIds.slice(i, i + CHUNK);
    if (!chunk.length) continue;
    const res = await DB.prepare(
      `SELECT job_id, load_number, ship_date FROM loading_assignments
        WHERE loading_status <> 'archived' AND job_id IN (${chunk.map(() => "?").join(",")})`
    )
      .bind(...chunk)
      .all<LoadDayRow>();
    for (const r of res.results ?? []) {
      const list = out.get(r.job_id) ?? [];
      list.push(r);
      out.set(r.job_id, list);
    }
  }
  return out;
}

// split-days-01: list SELECT shared by the main list query and the tile's current-week query.
function listSelect(whereSql: string): string {
  // shipments.* already carries delivered_at (typed on ShipmentListItem since carrier-03).
  return `SELECT shipments.*, j.invoice_number,
                j.ship_to_street, j.ship_to_city, j.ship_to_state, j.ship_to_zip,
                j.trailer_group_id,
                (SELECT COUNT(*) FROM bols b WHERE b.job_id = shipments.job_id) AS bol_count,
                EXISTS (SELECT 1 FROM bols b
                         WHERE b.job_id = shipments.job_id
                           AND (b.signed_bol_photo_key IS NOT NULL
                                OR EXISTS (SELECT 1 FROM bol_documents d WHERE d.bol_id = b.id))) AS has_signed_bol,
                (SELECT group_concat(t, ', ') FROM (
                   SELECT la.trailer_number AS t FROM loading_assignments la
                    WHERE la.job_id = shipments.job_id AND la.loading_status <> 'archived'
                      AND TRIM(COALESCE(la.trailer_number, '')) <> ''
                    ORDER BY la.load_number ASC)) AS trailer_numbers,
                (LOWER(TRIM(COALESCE(j.method, ''))) = 'customer pickup') AS is_customer_pickup,
                (SELECT COALESCE(SUM(cc.fee_amount_cents), 0) FROM carrier_charges cc WHERE cc.job_id = shipments.job_id) AS carrier_charges_total_cents,
                (SELECT COUNT(*) FROM carrier_charges cc WHERE cc.job_id = shipments.job_id) AS carrier_charges_count
           FROM shipments
           LEFT JOIN jobs j ON j.id = shipments.job_id
          WHERE ${whereSql}
          ORDER BY (shipments.ship_date IS NULL OR shipments.ship_date = ''),
                   shipments.ship_date ASC, shipments.created_at ASC`;
}

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const url = new URL(request.url);
  const jobId = url.searchParams.get("job_id");
  // quickwin-05: single-shipment lookup for the dock board's ?shipment= notification deep link
  // (legacy GET /api/shipments?id= parity). Bypasses the date window like job_id.
  const shipmentId = url.searchParams.get("id");
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
    // archived-hide-01: explicit job/shipment lookups are never filtered.
    if (!jobId && !shipmentId) where.push(NOT_ARCHIVED_PREDEPARTURE);

    if (shipmentId) {
      where.push("shipments.id = ?");
      binds.push(shipmentId);
    } else if (jobId) {
      // A specific job's shipment is wanted regardless of date window (e.g. an older shipment
      // whose ship_date/created_at has aged out of the default range) -- mirrors legacy's
      // job_id-bypasses-the-date-filter behavior on GET /api/bols.
      where.push("shipments.job_id = ?");
      binds.push(jobId);
    } else if (week) {
      // split-days-01: superset -- order date in week OR any load's own ship_date in week. Exact per-day
      // windowing happens after expansion (expandShipmentDays + inWeek) below.
      where.push(WEEK_SUPERSET);
      binds.push(week, week);
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
      where.push("(LOWER(shipments.customer) LIKE ? OR LOWER(j.invoice_number) LIKE ? OR EXISTS (SELECT 1 FROM loading_assignments la2 WHERE la2.job_id = shipments.job_id AND la2.loading_status <> 'archived' AND LOWER(la2.trailer_number) LIKE ?) OR LOWER(shipments.carrier) LIKE ? OR LOWER(shipments.bol_number) LIKE ?)");
      const qPattern = `%${q}%`;
      binds.push(qPattern, qPattern, qPattern, qPattern, qPattern);
    }
  }

  try {
    const [listResult, statsResult] = await Promise.all([
      DB.prepare(listSelect(where.join(" AND "))).bind(...binds).all(),
      DB.prepare(
        `SELECT
           COUNT(CASE WHEN ${STAT_PREDICATES.pending_outbound.sql} THEN 1 END) AS pending_outbound,
           COUNT(CASE WHEN ${STAT_PREDICATES.in_transit.sql} THEN 1 END) AS in_transit,
           COUNT(CASE WHEN ${STAT_PREDICATES.delivered_30d.sql} THEN 1 END) AS delivered_30d,
           ${loadsSubquery(STAT_PREDICATES.pending_outbound.sql, "pending_outbound_loads")},
           ${loadsSubquery(STAT_PREDICATES.in_transit.sql, "in_transit_loads")},
           ${loadsSubquery(STAT_PREDICATES.delivered_30d.sql, "delivered_30d_loads")}
         FROM shipments`
      ).bind(
        ...STAT_PREDICATES.pending_outbound.binds(curMonStr),
        ...STAT_PREDICATES.in_transit.binds(curMonStr),
        ...STAT_PREDICATES.delivered_30d.binds(curMonStr),
        ...STAT_PREDICATES.pending_outbound.binds(curMonStr),
        ...STAT_PREDICATES.in_transit.binds(curMonStr),
        ...STAT_PREDICATES.delivered_30d.binds(curMonStr)
      ).first(),
    ]);

    const rows = (listResult.results ?? []) as any[];
    await attachDistanceEta(DB, rows);

    // split-days-01: one entry per (order, effective ship day). Explicit job/shipment lookups keep the
    // 1-row-per-shipment shape (BolViewerModal / DockBoard depend on it) and are never expanded.
    const expand = async (base: any[]): Promise<any[]> => {
      const jobIds = Array.from(new Set(base.map((r) => r.job_id).filter((v): v is string => !!v)));
      const byJob = await loadDaysByJob(DB, jobIds);
      return base.flatMap((r) => expandShipmentDays(r, r.job_id ? byJob.get(r.job_id) ?? [] : []));
    };

    let data: any[] = rows;
    if (!jobId && !shipmentId) {
      let entries = await expand(rows);
      if (statKey === "outbound_this_week") entries = entries.filter((e) => inWeek(e.day_date, curMonStr));
      else if (!statKey && week) entries = entries.filter((e) => inWeek(e.day_date, week));
      data = sortEntries(entries);
    }

    // "Outbound this week" tile: computed from a current-week expansion so the tile and its drilldown can
    // never drift. Reuse this request's entries when they ARE that set (the drilldown itself, or an
    // unfiltered current-week list); otherwise run the drilldown query once more and expand it.
    let weekEntries: any[];
    if (statKey === "outbound_this_week" || (!statKey && !jobId && !shipmentId && week === curMonStr && !status && !q)) {
      weekEntries = data;
    } else {
      const wk = STAT_PREDICATES.outbound_this_week;
      const wr = await DB.prepare(listSelect(wk.sql)).bind(...wk.binds(curMonStr)).all();
      weekEntries = (await expand((wr.results ?? []) as any[])).filter((e) => inWeek(e.day_date, curMonStr));
    }
    const weekTile = weekTileCounts(weekEntries);

    return NextResponse.json({
      ok: true,
      data,
      stats: {
        outboundThisWeek: weekTile.orders,
        pendingOutbound: (statsResult as any)?.pending_outbound ?? 0,
        inTransit: (statsResult as any)?.in_transit ?? 0,
        delivered30d: (statsResult as any)?.delivered_30d ?? 0,
        outboundThisWeekLoads: weekTile.loads,
        pendingOutboundLoads: (statsResult as any)?.pending_outbound_loads ?? 0,
        inTransitLoads: (statsResult as any)?.in_transit_loads ?? 0,
        delivered30dLoads: (statsResult as any)?.delivered_30d_loads ?? 0,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
