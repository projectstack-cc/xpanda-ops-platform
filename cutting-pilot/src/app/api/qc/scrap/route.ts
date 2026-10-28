// src/app/api/qc/scrap/route.ts  ->  GET /v2/api/qc/scrap?week=YYYY-MM-DD, POST /v2/api/qc/scrap
// qc-04: the native scrap database (scrap_events). One table, two entry points: the /v2/qc Scrap log
// popup (here, source='qc') and the cutting board's Mark Complete + clock-out (qc-05, source='cutting',
// POST /v2/api/cutting/scrap — both write through lib/qc/scrapWrite.ts saveScrapEntries). The 11
// legacy form rows carried over as source='legacy'. The scrap_log compatibility VIEW (legacy scrap
// reports) was retired in rpt-05.
//   GET  — that Monday..Sunday's rows by event_date, newest first, voided rows included (flagged);
//          totals cover non-voided rows only.
//   POST — { entries: Entry[] } (1–20), all-or-nothing: every entry is validated first and one bad
//          entry rejects the batch with per-entry errors. Volume (pieces × T × W × L, bdft = in³ ÷ 144),
//          week_number and month_name are computed here; job_id re-reads the job for customer + INV.
// Gated on `qc` by middleware (GET → view, POST → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { addDaysYmd, isValidYmd, type ScrapRow } from "@/lib/qc/scrap";
import { saveScrapEntries } from "@/lib/qc/scrapWrite";

const COLUMNS = `id, event_date, week_number, month_name, shift, source, job_id, line_item_id, cutting_line_id,
  inv_number, customer, line_machine, operator_id, operator_name, part_product, material_density, pieces,
  thickness_in, width_in, length_in, scrap_cubic_in, scrap_board_ft, scrap_reason, notes, created_by_id,
  created_by_name, created_at, voided_at, voided_by_name, void_reason`;

function bad(error: string, detail = "", extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, detail, ...extra }, { status: 400 });
}

export async function GET(request: NextRequest) {
  const week = request.nextUrl.searchParams.get("week") ?? "";
  if (!isValidYmd(week)) {
    return bad("week is required (YYYY-MM-DD Monday).", `week=${week}`);
  }
  try {
    const { DB } = await getEnv();
    const res = await DB.prepare(
      `SELECT ${COLUMNS} FROM scrap_events
        WHERE event_date >= ? AND event_date <= ?
        ORDER BY event_date DESC, created_at DESC`
    )
      .bind(week, addDaysYmd(week, 6))
      .all<ScrapRow>();
    const rows = res.results ?? [];
    let entries = 0;
    let boardFt = 0;
    for (const r of rows) {
      if (r.voided_at) continue;
      entries++;
      boardFt += Number(r.scrap_board_ft) || 0;
    }
    return NextResponse.json({
      ok: true,
      rows,
      totals: { entries, boardFt: Math.round(boardFt * 1000) / 1000 },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't load the scrap log.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const actorId = request.headers.get("X-User-Id");
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const actorName = request.headers.get("X-User-Name") || "";

  let body: any;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const raw: unknown[] = Array.isArray(body?.entries) ? body.entries : [];

  try {
    const { DB } = await getEnv();
    // qc-05: the validate + insert + activity body lives in saveScrapEntries (shared with the cutting board).
    const r = await saveScrapEntries(DB, raw, { source: "qc", actorId, actorName });
    if (r.ok) return NextResponse.json({ ok: true, entries: r.rows }, { status: 201 });
    if (r.status === 400) return bad(r.error, r.detail ?? "", r.errors ? { errors: r.errors } : {});
    return NextResponse.json({ ok: false, error: r.error, detail: r.detail }, { status: r.status });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't save the scrap entries.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
