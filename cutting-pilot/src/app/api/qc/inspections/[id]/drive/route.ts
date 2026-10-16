// src/app/api/qc/inspections/[id]/drive/route.ts  ->  POST /v2/api/qc/inspections/:id/drive
// qc-03: manual "Retry Drive" from the /v2/qc board. Forwards the inspection to the Inspection Tool
// Apps Script now (awaited — the user is watching a spinner; bounded by the forwarder's 25 s POST
// timeout), ignoring the 3-attempt cap the cron sweep honours. Same atomic claim as every other path,
// so a row already sent or mid-send returns 409. Gated on `qc` by middleware (POST → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getEnv } from "@/lib/db";
import { forwardInspection } from "@/lib/qc/driveForward";
import { toLineInspection, type QcInspectionRow } from "@/lib/qc/board";

interface Row extends QcInspectionRow {
  current_quantity: number | null;
  current_dimensions: string | null;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const actorId = request.headers.get("X-User-Id");
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const id = String(params?.id ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "Inspection id is required.", detail: "" }, { status: 400 });

  try {
    const { DB } = await getEnv();
    const { env } = await getCloudflareContext();

    const outcome = await forwardInspection(DB, (env as any).QC_GAS_URL, id, { manual: true, actorId });
    if (outcome === "skipped") {
      return NextResponse.json(
        { ok: false, error: "Already sent or being sent — refresh in a minute.", detail: id },
        { status: 409 }
      );
    }

    // Fresh row, mapped exactly as the board maps it (stale vs the line's current qty/dims).
    const row = await DB.prepare(
      `SELECT q.id, q.result, q.inspector_name, q.inspected_at, q.drive_status, q.drive_file_id, q.drive_error,
              q.drive_attempted_at, q.line_quantity, q.dimensions_text,
              li.quantity AS current_quantity, li.dimensions AS current_dimensions
         FROM qc_inspections q
         LEFT JOIN job_line_items li ON li.id = q.line_item_id
        WHERE q.id = ?`
    )
      .bind(id)
      .first<Row>();
    if (!row) return NextResponse.json({ ok: false, error: "Inspection not found.", detail: id }, { status: 404 });

    return NextResponse.json({
      ok: true,
      inspection: toLineInspection(row, row.current_quantity ?? row.line_quantity, row.current_dimensions ?? row.dimensions_text),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't retry the Drive upload.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
