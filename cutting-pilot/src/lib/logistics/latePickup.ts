// src/lib/logistics/latePickup.ts
// Suggested-pickup + Late Pickup math shared by the TV loading board (GET /v2/api/loading-board,
// late-pickup-01) and the late-pickup notification cron (late-pickup-02) — one helper so the TV
// and the notification can never disagree. Reuses the Carrier View math unchanged
// (parseAppointment + suggestedPickup from deliveryTime.ts). Drive time comes from geocode_cache
// ONLY — this path never calls ORS; an uncached address yields pickup = null (no time, never late).
// All times are ET wall clock (America/New_York), the same convention as deliveryTime.ts.
import type { D1Database } from "@cloudflare/workers-types";
import { parseAppointment, suggestedPickup, type WallClock } from "@/lib/deliveryTime";
import { etNowWallClock, formatClockMinutes, weekdayShort } from "@/lib/etDateTime";
import { addressKeyOf, readGeoCache } from "@/lib/carrier/rows";

/** Minutes past the suggested pickup before a load counts as late (pickup already has a 30-min buffer). */
export const LATE_GRACE_MIN = 15;

/** Absolute minute index of an ET wall-clock value (calendar math via Date.UTC — no TZ shift). */
export function wallClockOrdinal(w: WallClock): number {
  const [y, m, d] = w.date.split("-").map(Number);
  const days = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  return days * 1440 + w.minutes;
}

export interface PickupInfo {
  date: string;
  minutes: number;
  label: string;
  late: boolean;
}

export function evaluatePickup(
  deliveryTime: string | null,
  shipDay: string | null,
  durationSec: number | null,
  now: WallClock
): PickupInfo | null {
  if (!deliveryTime || !shipDay || durationSec == null) return null;
  const pickup = suggestedPickup(parseAppointment(deliveryTime, shipDay), durationSec);
  if (!pickup) return null;
  const late = wallClockOrdinal(now) > wallClockOrdinal(pickup) + LATE_GRACE_MIN;
  const clock = formatClockMinutes(pickup.minutes);
  const label = pickup.date !== now.date ? `${weekdayShort(pickup.date)} ${clock}` : clock;
  return { date: pickup.date, minutes: pickup.minutes, label, late };
}

export interface DockLoad {
  assignment_id: string;
  location: "bay" | "yard";
  bay_id: string | null;
  bay_number: number | null;
  customer: string | null;
  invoice_number: string | null;
  trailer_number: string | null;
  loading_status: string;
  load_number: number;
  load_count: number | null;
  ship_day: string | null;
  pickup: PickupInfo | null;
}

const COMMON_COLS = `la.id AS assignment_id, la.bay_id, la.location,
         la.trailer_number, la.loading_status, la.load_number,
         j.customer, j.invoice_number, j.load_count, j.delivery_time,
         j.ship_to_street, j.ship_to_street2, j.ship_to_city, j.ship_to_state, j.ship_to_zip,
         substr(COALESCE(la.ship_date, j.ship_date), 1, 10) AS ship_day`;

/**
 * Every load on the dock right now: bay loads (same population the TV board shows) + yard loads
 * (same rule as the legacy Yard section in logistics/loading.html), each with its pickup evaluated
 * against ONE ET "now" computed per call.
 */
export async function fetchDockLoads(DB: D1Database, nowMs?: number): Promise<DockLoad[]> {
  const bayRes = await DB.prepare(
    `SELECT ${COMMON_COLS}, lb.bay_number
       FROM loading_assignments la
       JOIN loading_bays lb ON lb.id = la.bay_id AND lb.is_active = 1
       JOIN jobs j ON j.id = la.job_id
      WHERE la.loading_status IN ('not_started','loading','loaded')`
  ).all<any>();
  // Yard rows live in 'awaiting' (among others) on live D1 — deliberately not the bay status list.
  const yardRes = await DB.prepare(
    `SELECT ${COMMON_COLS}, NULL AS bay_number
       FROM loading_assignments la
       JOIN jobs j ON j.id = la.job_id
      WHERE la.location = 'yard'
        AND la.loading_status NOT IN ('in_transit','delivered','archived')`
  ).all<any>();

  const tagged: Array<{ row: any; location: "bay" | "yard" }> = [
    ...(bayRes.results ?? []).map((row) => ({ row, location: "bay" as const })),
    ...(yardRes.results ?? []).map((row) => ({ row, location: "yard" as const })),
  ];

  const keys = Array.from(
    new Set(tagged.map(({ row }) => addressKeyOf(row)).filter((k): k is string => !!k))
  );
  const geo = keys.length ? await readGeoCache(DB, keys) : new Map();
  const now = etNowWallClock(nowMs);

  return tagged.map(({ row, location }) => {
    const key = addressKeyOf(row);
    const info = key ? geo.get(key) : undefined;
    const durationSec = info?.ok ? info.duration_sec : null;
    return {
      assignment_id: row.assignment_id,
      location,
      bay_id: row.bay_id ?? null,
      bay_number: row.bay_number ?? null,
      customer: row.customer ?? null,
      invoice_number: row.invoice_number ?? null,
      trailer_number: row.trailer_number ?? null,
      loading_status: row.loading_status ?? "awaiting",
      load_number: row.load_number ?? 1,
      load_count: row.load_count ?? null,
      ship_day: row.ship_day ?? null,
      pickup: evaluatePickup(row.delivery_time ?? null, row.ship_day ?? null, durationSec, now),
    };
  });
}
