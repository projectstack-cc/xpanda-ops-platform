// src/app/api/qc/board/route.ts  ->  GET /v2/api/qc/board?week=YYYY-MM-DD
// qc-01: read-only Final Inspection board feed for /v2/qc. Orders shipping Mon..Sun of `week`
// (Saturday ship days included), each with its inspectable line items. Holey Board lines
// (parts.category = 'Holey Board' via part_id — same test as _worker.js/routes/jobs.js) are never
// inspected, so they're left out; an order with no other lines drops off entirely. Lines with no
// part_id are inspectable. Jobs: not archived, or archived but shipped (shipped-then-archived
// stays visible for its week). No status filter — inspection can happen before or after cutting.
// qc-02: each line carries its latest (non-superseded) qc_inspections row, or null, with `stale`
// set when the line's quantity/dimensions no longer match that inspection's snapshot.
// Gated on `qc` by middleware (GET view). Read-only, so no logActivity.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { isStale, type QcLine, type QcLineInspection, type QcOrder } from "@/lib/qc/board";

interface JobRow {
  id: string;
  invoice_number: string;
  customer: string;
  ship_date: string;
  status: string;
}

interface InspectionRow {
  id: string;
  line_item_id: string;
  result: "pass" | "fail";
  inspector_name: string | null;
  inspected_at: string;
  drive_status: "pending" | "synced" | "failed";
  line_quantity: number | null;
  dimensions_text: string | null;
}

interface LineRow {
  id: string;
  job_id: string;
  description: string | null;
  dimensions: string | null;
  quantity: number | null;
  sort_order: number | null;
}

export async function GET(request: NextRequest) {
  const week = request.nextUrl.searchParams.get("week") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) {
    return NextResponse.json({ ok: false, error: "week is required (YYYY-MM-DD Monday)." }, { status: 400 });
  }

  try {
    const { DB } = await getEnv();

    const jobsRes = await DB.prepare(
      `SELECT id, invoice_number, customer, ship_date, status
         FROM jobs
        WHERE ship_date >= ? AND ship_date <= date(?, '+6 days')
          AND (archived_at IS NULL OR status = 'shipped')
        ORDER BY ship_date, invoice_number`
    )
      .bind(week, week)
      .all<JobRow>();
    const jobs = jobsRes.results ?? [];

    const linesByJob = new Map<string, QcLine[]>();
    const jobIds = jobs.map((j) => j.id);
    const CHUNK = 90; // stay under D1's bind-parameter limit
    for (let i = 0; i < jobIds.length; i += CHUNK) {
      const chunk = jobIds.slice(i, i + CHUNK);
      if (!chunk.length) continue;
      const res = await DB.prepare(
        `SELECT li.id, li.job_id, li.description, li.dimensions, li.quantity, li.sort_order
           FROM job_line_items li
           LEFT JOIN parts p ON p.id = li.part_id
          WHERE li.job_id IN (${chunk.map(() => "?").join(",")})
            AND (p.category IS NULL OR p.category <> 'Holey Board')
          ORDER BY li.sort_order, li.id`
      )
        .bind(...chunk)
        .all<LineRow>();
      for (const r of res.results ?? []) {
        const list = linesByJob.get(r.job_id) ?? [];
        list.push({
          id: r.id,
          description: r.description ?? "",
          dimensions: r.dimensions ?? "",
          quantity: Number(r.quantity) || 0,
          sort_order: Number(r.sort_order) || 0,
          inspection: null,
        });
        linesByJob.set(r.job_id, list);
      }
    }

    // Latest inspection per line (superseded rows are audit-only), one chunked query.
    const lineIds = Array.from(linesByJob.values()).flatMap((ls) => ls.map((l) => l.id));
    const inspByLine = new Map<string, InspectionRow>();
    for (let i = 0; i < lineIds.length; i += CHUNK) {
      const chunk = lineIds.slice(i, i + CHUNK);
      if (!chunk.length) continue;
      const res = await DB.prepare(
        `SELECT id, line_item_id, result, inspector_name, inspected_at, drive_status, line_quantity, dimensions_text
           FROM qc_inspections WHERE superseded_at IS NULL AND line_item_id IN (${chunk.map(() => "?").join(",")})`
      )
        .bind(...chunk)
        .all<InspectionRow>();
      for (const r of res.results ?? []) inspByLine.set(r.line_item_id, r);
    }
    for (const lines of Array.from(linesByJob.values())) {
      for (const l of lines) {
        const r = inspByLine.get(l.id);
        l.inspection = r
          ? ({
              id: r.id,
              result: r.result,
              inspector_name: r.inspector_name ?? "",
              inspected_at: r.inspected_at,
              drive_status: r.drive_status,
              stale: isStale(r.line_quantity, r.dimensions_text, l.quantity, l.dimensions),
            } satisfies QcLineInspection)
          : null;
      }
    }

    const orders: QcOrder[] = [];
    for (const j of jobs) {
      const lines = linesByJob.get(j.id);
      if (!lines || !lines.length) continue;
      orders.push({
        job_id: j.id,
        invoice_number: j.invoice_number ?? "",
        customer: j.customer ?? "",
        ship_date: j.ship_date ?? "",
        status: j.status ?? "",
        lines,
      });
    }

    return NextResponse.json({ ok: true, orders });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't load the QC board.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
