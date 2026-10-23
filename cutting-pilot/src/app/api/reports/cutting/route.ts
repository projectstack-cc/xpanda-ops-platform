// src/app/api/reports/cutting/route.ts  ->  GET /v2/api/reports/cutting?from=YYYY-MM-DD&to=YYYY-MM-DD
// rpt-01: raw rows for the v2 Cutting activity report (port of legacy handleCuttingActivityReport,
// _worker.js/routes/reports.js). One D1 batch of three SELECTs, each windowed in UTC from the day
// before `from` to two days after `to` (covers the ET offset either way); lib/reports/cutting.ts does
// the exact ET-day cut, filters and every aggregate client-side, so the page never refetches for a
// filter. Range rules: validRange (YYYY-MM-DD, from ≤ to, ≤ 92 days). Read-only — no logActivity.
// Gated on `reports` by middleware (GET → view).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { validRange, type RawChunkRow, type RawItemRow, type RawSessionRow } from "@/lib/reports/cutting";

// String comparison against date(...) works for both stored shapes ("… HH:MM:SS" and ISO "…T…Z").
const win = (col: string) => `${col} >= date(?1, '-1 day') AND ${col} < date(?2, '+2 day')`;

export async function GET(request: NextRequest) {
  const from = (request.nextUrl.searchParams.get("from") ?? "").trim();
  const to = (request.nextUrl.searchParams.get("to") ?? "").trim();
  const v = validRange(from, to);
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error, detail: `from=${from} to=${to}` }, { status: 400 });
  }
  try {
    const { DB } = await getEnv();
    const [sessions, items, chunk] = await DB.batch([
      DB.prepare(
        `SELECT cs.id, cs.job_id, cs.line, cs.operator_id, cs.operator_name, cs.status, cs.started_at, cs.ended_at,
                cs.handoff_note, j.invoice_number, j.customer, u.shift AS operator_shift
           FROM cutting_sessions cs
           LEFT JOIN jobs j  ON j.id = cs.job_id
           LEFT JOIN users u ON u.id = cs.operator_id
          WHERE ${win("cs.started_at")}
          ORDER BY cs.started_at DESC`
      ).bind(from, to),
      DB.prepare(
        `SELECT clp.id, clp.job_id, clp.line, j.invoice_number, j.customer,
                COALESCE(clp.description, li.description) AS description,
                COALESCE(clp.dimensions,  li.dimensions)  AS dimensions,
                COALESCE(clp.part_number, li.part_number) AS part_number,
                COALESCE(u.display_name, clp.updated_by)  AS cut_by,
                u.shift AS cut_by_shift, clp.updated_by, clp.updated_at
           FROM cutting_line_progress clp
           LEFT JOIN jobs j            ON j.id  = clp.job_id
           LEFT JOIN job_line_items li ON li.id = clp.line_item_id
           LEFT JOIN users u           ON u.id  = clp.updated_by
          WHERE clp.completed = 1 AND ${win("clp.updated_at")}
          ORDER BY clp.updated_at DESC`
      ).bind(from, to),
      DB.prepare(
        `SELECT ch.id, ch.board, ch.ref_id, COALESCE(cca.label, hcs.label, ch.ref_id) AS work_item,
                ch.operator_id, ch.operator_name, u.shift AS operator_shift, ch.started_at, ch.ended_at, ch.status
           FROM chunk_sessions ch
           LEFT JOIN cc_assignments cca ON ch.board = 'cc' AND cca.id = ch.ref_id
           LEFT JOIN hc_slots       hcs ON ch.board = 'hc' AND hcs.slot_key = ch.ref_id
           LEFT JOIN users u            ON u.id = ch.operator_id
          WHERE ${win("ch.started_at")}
          ORDER BY ch.started_at DESC`
      ).bind(from, to),
    ]);
    return NextResponse.json({
      ok: true,
      sessions: (sessions.results ?? []) as unknown as RawSessionRow[],
      items: (items.results ?? []) as unknown as RawItemRow[],
      chunk: (chunk.results ?? []) as unknown as RawChunkRow[],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't load cutting activity.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
