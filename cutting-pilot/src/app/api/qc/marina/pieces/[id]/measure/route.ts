// src/app/api/qc/marina/pieces/[id]/measure/route.ts  →  POST /v2/api/qc/marina/pieces/:id/measure
// marina-03. Re-measure a rework_pending piece (MeasureBody): evaluateMeasurements vs the part's dims
// and the job's tolerance → nextStatus(current) (anything but rework_pending → 409 not_rework_pending)
// → one batch: attempt MAX+1 measurement rows + the piece's status / updated_at / note (when sent).
// A UNIQUE (piece_id, dim_id, attempt) rejection is a double tap → 409 attempt_conflict.
// 409 job_complete on a completed job. Gated on `qc.marina` by middleware (POST → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { evaluateMeasurements, nextStatus } from "@/lib/marina/pieces";
import {
  JOB_COMPLETE_ERROR, actor, cleanMeasureBody, isUniqueViolation, jobForPiece, loadPartSummary, loadPiece,
  partDimNominals, partLogSummary, readJsonObject,
} from "@/lib/marina/store";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { DB } = await getEnv();
    const who = actor(request);
    const owner = await jobForPiece(DB, id);
    if (!owner) return NextResponse.json({ ok: false, error: "Marina piece not found." }, { status: 404 });
    if (owner.job.status === "complete") return NextResponse.json(JOB_COMPLETE_ERROR, { status: 409 });

    const body = await readJsonObject(request);
    if (!body) return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
    const input = cleanMeasureBody(body);
    if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: 400 });

    // State gate first, so a re-measure of a final piece is 409 whatever values were typed.
    const gate = nextStatus({ current: owner.piece.status, allIn: true });
    if (!gate.ok) return NextResponse.json({ ok: false, code: gate.code, error: gate.error }, { status: 409 });
    const dims = await partDimNominals(DB, owner.part.id);
    const ev = evaluateMeasurements(dims, input.value.measurements, owner.job.tolerance_in);
    if (!ev.ok) {
      return NextResponse.json({ ok: false, code: ev.code, error: ev.error, ...(ev.dim_id ? { dim_id: ev.dim_id } : {}) }, { status: 400 });
    }
    const next = nextStatus({ current: owner.piece.status, allIn: ev.allIn, disposition: input.value.disposition });
    if (!next.ok) {
      return NextResponse.json({ ok: false, code: next.code, error: next.error }, { status: next.code === "not_rework_pending" ? 409 : 400 });
    }

    const max = await DB.prepare("SELECT COALESCE(MAX(attempt), 0) AS a FROM marina_measurements WHERE piece_id = ?")
      .bind(id).first<{ a: number }>();
    const attempt = Number(max?.a ?? 0) + 1;
    try {
      await DB.batch([
        ...ev.rows.map((r) =>
          DB.prepare(
            `INSERT INTO marina_measurements (id, piece_id, dim_id, attempt, nominal_in, measured_in, measured_text, in_tol, measured_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(crypto.randomUUID(), id, r.dim_id, attempt, r.nominal_in, r.measured_in, r.measured_text, r.in_tol ? 1 : 0, who.name)
        ),
        input.value.noteGiven
          ? DB.prepare("UPDATE marina_pieces SET status = ?, disposition_note = ?, updated_at = datetime('now') WHERE id = ?")
              .bind(next.status, input.value.note, id)
          : DB.prepare("UPDATE marina_pieces SET status = ?, updated_at = datetime('now') WHERE id = ?").bind(next.status, id),
      ]);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      return NextResponse.json(
        { ok: false, code: "attempt_conflict", error: "This piece was just re-measured — refresh and check.", detail: String((e as any)?.message || e) },
        { status: 409 }
      );
    }

    const [piece, part] = await Promise.all([loadPiece(DB, id), loadPartSummary(DB, owner.part.id)]);
    await logActivity(DB, "measure", "marina_piece", id, partLogSummary(owner.job.name, owner.part.label, owner.piece.piece_no),
      { job_id: owner.job.id, part_id: owner.part.id, attempt, from: owner.piece.status, status: next.status,
        disposition: next.dispositionUsed, all_in: ev.allIn }, who.id);
    return NextResponse.json({ ok: true, piece, part });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
