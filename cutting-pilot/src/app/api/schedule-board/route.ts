// src/app/api/schedule-board/route.ts  →  GET /v2/api/schedule-board
// Read-only: returns the current + next ship-week schedule, grouped one day-entry per
// calendar date, each row carrying a live-derived status. Ingestion (2/5) already populated
// schedule_rows; this route never writes to it. (The PENDING/no-confirmed-date block was
// captured and shown here originally — removed by request; schedule-ingest.ts no longer
// captures those rows at all, the sheet itself stays the source of truth for that list.)
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { currentAndNextShipWeekTabs } from "@/lib/schedule-ingest";
import { deriveStatuses, type ScheduleStatus } from "@/lib/schedule-status";

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
  total_bdft: number | null;
  scrap_pickup: string | null;
  sheet_status: string | null;
  match_job_id: string | null;
}

interface ScheduleBoardRow {
  invoice_number: string;
  customer: string | null;
  load_count: number | null;
  method: string | null;
  location: string | null;
  delivery_time: string | null;
  carrier: string | null;
  total_bdft: number | null;
  scrap_pickup: string | null;
  status: ScheduleStatus | null;
  unmatched: boolean;
  sheet_status: string | null;
  job_id: string | null;
}

interface DayGroup {
  ship_week: string | null;
  day_of_week: string;
  ship_date: string | null;
  rows: ScheduleBoardRow[];
}

export async function GET() {
  const { DB } = await getEnv();
  try {
    const [currentTab, nextTab] = currentAndNextShipWeekTabs(new Date());

    const { results } = await DB.prepare(
      `SELECT invoice_number, ship_week, ship_date, day_of_week, sort_order, customer,
              load_count, method, location, delivery_time, carrier, total_bdft,
              scrap_pickup, sheet_status, match_job_id
       FROM schedule_rows
       WHERE ship_week IN (?, ?)
       ORDER BY ship_week ASC, sort_order ASC`
    )
      .bind(currentTab, nextTab)
      .all<ScheduleRowDb>();

    const rows = results ?? [];
    const jobIds = Array.from(
      new Set(rows.map((r) => r.match_job_id).filter((id): id is string => !!id))
    );
    const statusByJobId = await deriveStatuses(DB, jobIds);

    // One entry per calendar date (ship_date is unique across the two fetched weeks — they
    // never overlap — so this never collides two different weekdays together).
    const groups = new Map<string, DayGroup>();
    for (const row of rows) {
      const key = `${row.ship_week}::${row.ship_date}`;

      if (!groups.has(key)) {
        groups.set(key, {
          ship_week: row.ship_week,
          day_of_week: row.day_of_week,
          ship_date: row.ship_date,
          rows: [],
        });
      }

      const unmatched = !row.match_job_id;
      groups.get(key)!.rows.push({
        invoice_number: row.invoice_number,
        customer: row.customer,
        load_count: row.load_count,
        method: row.method,
        location: row.location,
        delivery_time: row.delivery_time,
        carrier: row.carrier,
        total_bdft: row.total_bdft,
        scrap_pickup: row.scrap_pickup,
        status: unmatched ? null : statusByJobId.get(row.match_job_id!) ?? "Not Started",
        unmatched,
        sheet_status: row.sheet_status,
        job_id: row.match_job_id,
      });
    }

    // Chronological by calendar date.
    const days = Array.from(groups.values()).sort((a, b) =>
      (a.ship_date ?? "").localeCompare(b.ship_date ?? "")
    );

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      weeks: [currentTab, nextTab],
      days,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
