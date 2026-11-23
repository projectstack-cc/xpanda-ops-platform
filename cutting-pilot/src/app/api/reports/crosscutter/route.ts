// src/app/api/reports/crosscutter/route.ts  ->  GET /v2/api/reports/crosscutter?from=YYYY-MM-DD&to=YYYY-MM-DD
// cc-blocks-02: raw rows for the v2 Cross Cutter report. One D1 batch, all windowed in UTC from the day
// before `from` to two days after `to` on cc_assignments.completed_at (stored UTC "YYYY-MM-DD HH:MM:SS";
// covers the ET offset — lib/reports/crosscutter.ts does the exact ET-day cut): (a) completed
// assignments, (b) their cc_block_ids rows (cc-blocks-01), (c) their closed cc chunk_sessions. (b) and
// (c) select their assignment ids with the same subquery, never a built IN (...) list. Range rules:
// validRange (≤ 92 days). Read-only — no logActivity. Gated on `reports` by middleware (GET → view).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { validRange, type CcReportAssignment, type CcReportBlockId, type CcReportSession } from "@/lib/reports/crosscutter";

// String comparison against date(...) works for both stored shapes ("… HH:MM:SS" and ISO "…T…Z").
const win = (col: string) => `${col} >= date(?1, '-1 day') AND ${col} < date(?2, '+2 day')`;
const COMPLETED_IDS = `SELECT id FROM cc_assignments WHERE status = 'complete' AND ${win("completed_at")}`;

export async function GET(request: NextRequest) {
  const from = (request.nextUrl.searchParams.get("from") ?? "").trim();
  const to = (request.nextUrl.searchParams.get("to") ?? "").trim();
  const v = validRange(from, to);
  if (!v.ok) {
    return NextResponse.json({ ok: false, error: v.error, detail: `from=${from} to=${to}` }, { status: 400 });
  }
  try {
    const { DB } = await getEnv();
    const [assignments, blockIds, sessions] = await DB.batch([
      DB.prepare(
        `SELECT id, label, size_text, target_chunks, qty_done, created_by, created_at, completed_at
           FROM cc_assignments
          WHERE status = 'complete' AND ${win("completed_at")}
          ORDER BY completed_at DESC`
      ).bind(from, to),
      DB.prepare(
        `SELECT assignment_id, block_id, event, operator_name, created_at
           FROM cc_block_ids
          WHERE assignment_id IN (${COMPLETED_IDS})
          ORDER BY created_at, block_id`
      ).bind(from, to),
      DB.prepare(
        `SELECT ref_id, operator_name, started_at, ended_at
           FROM chunk_sessions
          WHERE board = 'cc' AND status = 'closed' AND ended_at IS NOT NULL
            AND ref_id IN (${COMPLETED_IDS})
          ORDER BY started_at`
      ).bind(from, to),
    ]);
    return NextResponse.json({
      ok: true,
      assignments: (assignments.results ?? []) as unknown as CcReportAssignment[],
      blockIds: (blockIds.results ?? []) as unknown as CcReportBlockId[],
      sessions: (sessions.results ?? []) as unknown as CcReportSession[],
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't load the Cross Cutter report.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
