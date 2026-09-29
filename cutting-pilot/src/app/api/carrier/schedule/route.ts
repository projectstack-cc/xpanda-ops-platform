// src/app/api/carrier/schedule/route.ts  →  GET /v2/api/carrier/schedule
// Carrier "Schedule" tab (carrier-05): this week's Seal/Lisma orders from the same data as the
// internal 2-week schedule board — `schedule_rows` (Google Sheet ingest), NOT jobs /
// loading_assignments. Read-only; gated on logistics.carrier_view (GET = view) by the
// /v2/api/carrier middleware prefix. A consumer of the schedule libs only — schedule-board/route.ts,
// schedule-status.ts and schedule-ingest.ts are untouched.
//
// Week: ET calendar date → UTC-midnight Date → currentAndNextShipWeekTabs(). On Saturday/Sunday the
// NEXT tab is used (the week just ended is useless to a carrier on the weekend).
// Deliberately NOT sent: total_bdft, chunks, shifts, sheet_status, carrier, method,
// raw delivery_time (the sheet cell carries internal driver notes), match_job_id, progress.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { currentAndNextShipWeekTabs } from "@/lib/schedule-ingest";
import { deriveStatuses, type ScheduleStatus } from "@/lib/schedule-status";
import { formatLoadLabel } from "@/lib/truckType";
import { parseDeliveryTime } from "@/lib/deliveryTime";

const JOB_CHUNK = 90; // D1 100-bound-param ceiling — same as the internal route
const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"] as const;

export type CarrierScheduleStatus = "In production" | "Ready" | "Shipped";

// Carrier-facing status, derived server-side from the internal board status.
const CARRIER_STATUS = {
  "Not Started": "In production",
  Cutting: "In production",
  "In Production": "In production",
  Ready: "Ready",
  Loading: "Ready",
  Loaded: "Ready",
  Shipped: "Shipped",
} satisfies Record<ScheduleStatus, CarrierScheduleStatus>;

interface ScheduleRowDb {
  invoice_number: string;
  ship_week: string;
  ship_date: string | null;
  day_of_week: string;
  sort_order: number;
  customer: string | null;
  load_count: number | null;
  method: string | null;
  location: string | null;
  delivery_time: string | null;
  carrier: string | null;
  scrap_pickup: string | null;
  match_job_id: string | null;
  last_seen_at: string;
}

function etTodayUtcMidnight(): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function addUtcDaysStr(date: Date, days: number): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchJobPlaces(DB: any, jobIds: string[]) {
  const out = new Map<string, { ship_to_city: string | null; ship_to_state: string | null; trailer_group_id: string | null }>();
  for (let i = 0; i < jobIds.length; i += JOB_CHUNK) {
    const chunk = jobIds.slice(i, i + JOB_CHUNK);
    const { results } = await DB.prepare(
      `SELECT id, ship_to_city, ship_to_state, trailer_group_id FROM jobs WHERE id IN (${chunk.map(() => "?").join(",")})`
    )
      .bind(...chunk)
      .all();
    for (const r of (results ?? []) as any[]) {
      out.set(r.id, {
        ship_to_city: r.ship_to_city ?? null,
        ship_to_state: r.ship_to_state ?? null,
        trailer_group_id: r.trailer_group_id ?? null,
      });
    }
  }
  return out;
}

export async function GET() {
  try {
    const { DB } = await getEnv();

    const etDay = etTodayUtcMidnight();
    const weekday = etDay.getUTCDay(); // 0=Sun..6=Sat
    const weekend = weekday === 0 || weekday === 6;
    const [currentTab, nextTab] = currentAndNextShipWeekTabs(etDay);
    const tab = weekend ? nextTab : currentTab;
    // Monday of the chosen week (same Monday rule as the tab name; +7 on the weekend).
    const toMonday = weekday === 0 ? -6 : 1 - weekday;
    const monday = addUtcDaysStr(etDay, toMonday + (weekend ? 7 : 0));

    const { results } = await DB.prepare(
      `SELECT invoice_number, ship_week, ship_date, day_of_week, sort_order, customer,
              load_count, method, location, delivery_time, carrier, scrap_pickup,
              match_job_id, last_seen_at
         FROM schedule_rows
        WHERE ship_week = ?
          AND (carrier LIKE 'SEAL%' OR carrier LIKE 'LISMA%')
        ORDER BY sort_order ASC`
    )
      .bind(tab)
      .all<ScheduleRowDb>();
    const rows = results ?? [];

    let sourceUpdatedAt: string | null = null;
    for (const r of rows) {
      if (!sourceUpdatedAt || r.last_seen_at > sourceUpdatedAt) sourceUpdatedAt = r.last_seen_at;
    }

    const jobIds = Array.from(new Set(rows.map((r) => r.match_job_id).filter((id): id is string => !!id)));
    const [statusByJob, placeByJob] = await Promise.all([
      deriveStatuses(DB, jobIds),
      fetchJobPlaces(DB, jobIds),
    ]);

    const days = DAYS.map((day, i) => ({
      day_of_week: day,
      ship_date: addUtcDaysStr(new Date(`${monday}T00:00:00Z`), i),
      rows: [] as Array<{
        invoice_number: string;
        customer: string | null;
        load_label: string;
        delivery_time_label: string | null;
        city_state: string | null;
        status: CarrierScheduleStatus | null;
        scrap_pickup: boolean;
        unmatched: boolean;
        trailer_group_id: string | null;
      }>,
    }));

    for (const r of rows) {
      const day = days.find((d) => d.day_of_week === String(r.day_of_week || "").toUpperCase());
      if (!day) continue; // e.g. the sheet's "pending" section — not a ship day this week
      const jobId = r.match_job_id;
      const derived = jobId ? statusByJob.get(jobId) : undefined;
      const place = jobId ? placeByJob.get(jobId) : undefined;
      const cityState = place
        ? [place.ship_to_city, place.ship_to_state].filter(Boolean).join(", ") || null
        : (r.location || "").trim() || null;
      day.rows.push({
        invoice_number: r.invoice_number,
        customer: r.customer,
        load_label: formatLoadLabel(r.method, r.load_count),
        delivery_time_label: parseDeliveryTime(r.delivery_time),
        city_state: cityState,
        status: jobId && derived ? CARRIER_STATUS[derived.status] : null,
        scrap_pickup: (r.scrap_pickup ?? "").trim().toUpperCase().startsWith("Y"),
        unmatched: !jobId,
        trailer_group_id: place?.trailer_group_id ?? null,
      });
    }

    return NextResponse.json({
      ok: true,
      week: { tab, monday },
      days,
      source_updated_at: sourceUpdatedAt,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
