// src/app/api/orders/desk/route.ts  →  GET /v2/api/orders/desk?from=YYYY-MM-DD&to=YYYY-MM-DD
// ord-dash-01: data for the Orders intake desk (UI is ord-dash-02). from/to are ET dates for the
// recent-intake list (default = the current ET week). KPIs use the current ET week regardless of
// from/to. Fetch only — lib/orders/desk.ts (buildDesk) does the exact ET cut, the attention rules
// and ordering. jobs.created_at has two UTC shapes (ISO "…T…Z" and "YYYY-MM-DD HH:MM:SS"); both start
// with the UTC date, so the SQL windows on substr(created_at,1,10) ± 1 day and buildDesk cuts by
// etDateKey. Read-only — no logActivity. Gated on `orders` by middleware (existing /v2/api/orders row).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { etNowWallClock } from "@/lib/etDateTime";
import {
  ATTENTION_STATUSES, addDaysEt, buildDesk, etWeekRange, validDeskRange,
  type DeskJobRow, type DeskLineRow, type DeskScheduleRow, type DeskScopeJobRow,
} from "@/lib/orders/desk";
import type { DeskResponse } from "@/types/ordersDesk";

const CHUNK = 90;

const RECENT_SQL = `SELECT j.id, j.invoice_number, j.customer, j.ship_date, j.status, j.source, j.total_bdft, j.load_count,
       j.created_at, j.archived_at,
       (SELECT COUNT(*) FROM job_line_items li WHERE li.job_id = j.id) AS line_count
  FROM jobs j
 WHERE substr(j.created_at, 1, 10) BETWEEN ? AND ?`;

export async function GET(request: NextRequest) {
  const today = etNowWallClock().date;
  const week = etWeekRange(today);
  const sp = request.nextUrl.searchParams;
  const from = (sp.get("from") ?? "").trim() || week.from;
  const to = (sp.get("to") ?? "").trim() || week.to;
  const v = validDeskRange(from, to);
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error }, { status: 400 });
  }

  try {
    const { DB } = await getEnv();

    // 1. Recent superset (± 1 UTC day around the ET range).
    const recent = await DB.prepare(RECENT_SQL)
      .bind(addDaysEt(from, -1), addDaysEt(to, 1))
      .all<DeskJobRow>();
    const recentJobs = recent.results ?? [];

    // 2. KPI week superset — reuse (1) when the range already covers the week.
    let weekJobs = recentJobs;
    if (!(from <= week.from && to >= week.to)) {
      const wk = await DB.prepare(RECENT_SQL)
        .bind(addDaysEt(week.from, -1), addDaysEt(week.to, 1))
        .all<DeskJobRow>();
      weekJobs = wk.results ?? [];
    }

    // 3. Attention candidates (buildDesk re-applies inAttentionScope).
    const scope = await DB.prepare(
      `SELECT id, invoice_number, customer, ship_date, status, archived_at, method, ship_to_company,
              ship_to_verified, processes
         FROM jobs
        WHERE archived_at IS NULL
          AND status IN (${ATTENTION_STATUSES.map(() => "?").join(", ")})
          AND (ship_date IS NULL OR trim(ship_date) = '' OR ship_date >= ?)`
    ).bind(...ATTENTION_STATUSES, today).all<DeskScopeJobRow>();
    const scopeJobs = scope.results ?? [];

    // 4. Their line items, ≤ 90 binds per statement.
    const lines: DeskLineRow[] = [];
    const ids = scopeJobs.map((j) => j.id);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const part = ids.slice(i, i + CHUNK);
      const res = await DB.prepare(
        `SELECT job_id, part_number, description, dimensions, sort_order
           FROM job_line_items
          WHERE job_id IN (${part.map(() => "?").join(", ")})
          ORDER BY job_id, sort_order`
      ).bind(...part).all<DeskLineRow>();
      lines.push(...(res.results ?? []));
    }

    // 5. Schedule gaps: unmatched rows from yesterday on with no job (archived or not) for the invoice.
    const sched = await DB.prepare(
      `SELECT s.invoice_number, s.ship_date, s.customer, s.sheet_status, s.match_job_id
         FROM schedule_rows s
         LEFT JOIN jobs j ON trim(j.invoice_number) = trim(s.invoice_number)
        WHERE s.match_job_id IS NULL AND s.ship_date >= ? AND j.id IS NULL`
    ).bind(addDaysEt(today, -1)).all<DeskScheduleRow>();

    const desk = buildDesk(
      { from, to, recentJobs, weekJobs, scopeJobs, lines, schedule: sched.results ?? [] },
      today
    );
    const body: DeskResponse = { ok: true, today, range: { from, to }, ...desk };
    return NextResponse.json(body);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
