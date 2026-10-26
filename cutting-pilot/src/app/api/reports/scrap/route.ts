// src/app/api/reports/scrap/route.ts  ->  GET /v2/api/reports/scrap?from=YYYY-MM-DD&to=YYYY-MM-DD
// rpt-04: raw rows for the v2 Scrap report (replaces legacy handleApiReportsScrap*, which read the
// scrap_log VIEW). Reads the scrap_events TABLE directly — never the VIEW (dropped in rpt-05). One D1
// batch: scrap rows in range by event_date (an ET calendar date; voided included, flagged), cutting
// activity + closed sessions windowed in UTC from the day before `from` to two days after `to` (covers
// the ET offset; lib/reports/scrap.ts does the exact ET-day cut), and a fixed last-6-months series
// independent of the range. buildScrapReport applies the line / reason / shift filters and Show voided
// client-side, so the page never refetches for a filter. Range rules: validRange (≤ 92 days).
// Read-only — no logActivity. Gated on `reports` by middleware (GET → view).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { etNowWallClock } from "@/lib/etDateTime";
import type { ScrapRow } from "@/lib/qc/scrap";
import { addMonths, monthOf } from "@/lib/reports/incidents";
import { validRange, type ScrapActivity } from "@/lib/reports/scrap";

// Same columns as GET /v2/api/qc/scrap.
const COLUMNS = `id, event_date, week_number, month_name, shift, source, job_id, line_item_id, cutting_line_id,
  inv_number, customer, line_machine, operator_id, operator_name, part_product, material_density, pieces,
  thickness_in, width_in, length_in, scrap_cubic_in, scrap_board_ft, scrap_reason, notes, created_by_id,
  created_by_name, created_at, voided_at, voided_by_name, void_reason`;

// String comparison against date(...) works for both stored shapes ("… HH:MM:SS" and ISO "…T…Z").
const win = (col: string) => `${col} >= date(?1, '-1 day') AND ${col} < date(?2, '+2 day')`;

export async function GET(request: NextRequest) {
  const from = (request.nextUrl.searchParams.get("from") ?? "").trim();
  const to = (request.nextUrl.searchParams.get("to") ?? "").trim();
  const v = validRange(from, to);
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error, detail: `from=${from} to=${to}` }, { status: 400 });
  }
  // First day of the month five months before ET today → six calendar months including this one.
  const monthsFrom = `${addMonths(monthOf(etNowWallClock().date), -5)}-01`;
  try {
    const { DB } = await getEnv();
    const [rows, activity, closed, months] = await DB.batch([
      DB.prepare(
        `SELECT ${COLUMNS} FROM scrap_events
          WHERE event_date >= ?1 AND event_date <= ?2
          ORDER BY event_date DESC, created_at DESC`
      ).bind(from, to),
      DB.prepare(
        `SELECT job_id, started_at AS ts, 'session' AS kind FROM cutting_sessions WHERE ${win("started_at")}
         UNION ALL
         SELECT job_id, updated_at AS ts, 'item' AS kind FROM cutting_line_progress WHERE completed = 1 AND ${win("updated_at")}`
      ).bind(from, to),
      DB.prepare(
        `SELECT ended_at FROM cutting_sessions WHERE ended_at IS NOT NULL AND ${win("ended_at")}`
      ).bind(from, to),
      DB.prepare(
        `SELECT substr(event_date, 1, 7) AS month, ROUND(SUM(scrap_board_ft), 3) AS boardFt, COUNT(*) AS entries
           FROM scrap_events
          WHERE voided_at IS NULL AND event_date >= ?
          GROUP BY 1`
      ).bind(monthsFrom),
    ]);
    return NextResponse.json({
      ok: true,
      rows: (rows.results ?? []) as unknown as ScrapRow[],
      activity: (activity.results ?? []) as unknown as ScrapActivity[],
      closedSessions: (closed.results ?? []) as unknown as { ended_at: string }[],
      months: (months.results ?? []) as unknown as { month: string; boardFt: number; entries: number }[],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't load the scrap report.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
