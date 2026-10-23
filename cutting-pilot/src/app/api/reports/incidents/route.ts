// src/app/api/reports/incidents/route.ts  ->  GET /v2/api/reports/incidents?from=YYYY-MM-DD&to=YYYY-MM-DD
// rpt-03: raw rows for the v2 Incidents report — qc_incidents only (native since qc-08, history
// backfilled by rpt-02; no gviz). One D1 batch: the incidents in [from, to] on incident_date, orders
// shipped per month from D1 jobs (from D1_SHIPMENTS_FROM on; earlier months come from the tracker
// baseline in lib/reports/incidents.ts), and MIN(incident_date) for the year switch. The page runs
// buildIncidentReport client-side, so filters never refetch. Range: validRange with maxDays 731.
// Read-only — no logActivity. Gated on `reports` by middleware (GET → view).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { etNowWallClock } from "@/lib/etDateTime";
import { INCIDENT_COLUMNS, type IncidentRow } from "@/lib/qc/incident";
import { validRange } from "@/lib/reports/range";
import { D1_SHIPMENTS_FROM, INCIDENT_MAX_DAYS, endOfMonth, firstOfMonth } from "@/lib/reports/incidents";

export async function GET(request: NextRequest) {
  const from = (request.nextUrl.searchParams.get("from") ?? "").trim();
  const to = (request.nextUrl.searchParams.get("to") ?? "").trim();
  const v = validRange(from, to, INCIDENT_MAX_DAYS);
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error, detail: `from=${from} to=${to}` }, { status: 400 });
  }
  const today = etNowWallClock().date;
  try {
    const { DB } = await getEnv();
    const [incidents, shipped, earliest] = await DB.batch([
      DB.prepare(
        `SELECT ${INCIDENT_COLUMNS} FROM qc_incidents
          WHERE incident_date >= ? AND incident_date <= ?
          ORDER BY incident_date DESC, created_at DESC`
      ).bind(from, to),
      // Shipped = marked shipped or archived — the population the Job Board treats as gone out.
      DB.prepare(
        `SELECT substr(ship_date, 1, 7) AS month, COUNT(*) AS n FROM jobs
          WHERE ship_date >= MAX(?, ?)
            AND ship_date <= ? AND ship_date <= ?
            AND (status = 'shipped' OR status = 'archived' OR archived_at IS NOT NULL)
          GROUP BY 1`
      ).bind(firstOfMonth(from), D1_SHIPMENTS_FROM, endOfMonth(to), today),
      DB.prepare(`SELECT MIN(incident_date) AS earliest FROM qc_incidents`),
    ]);
    const byMonth: Record<string, number> = {};
    for (const r of (shipped.results ?? []) as { month: string | null; n: number }[]) {
      if (r.month) byMonth[r.month] = Number(r.n) || 0;
    }
    return NextResponse.json({
      ok: true,
      rows: (incidents.results ?? []) as unknown as IncidentRow[],
      shipped: byMonth,
      earliest: ((earliest.results ?? [])[0] as { earliest: string | null } | undefined)?.earliest ?? null,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't load incidents.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
