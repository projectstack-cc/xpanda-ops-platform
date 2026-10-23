// src/app/api/qc/marina/parts/[id]/pieces/route.ts  →  POST/DELETE /v2/api/qc/marina/parts/:id/pieces
// marina-03. POST = new piece, attempt 1 (MeasureBody): evaluateMeasurements vs the part's dims and
// the JOB's tolerance (never the client's) → nextStatus(current null) → one batch: the piece
// (piece_no = MAX+1 computed inside the INSERT) + its measurement rows (nominal snapshot from the dim).
// A UNIQUE (part_id, piece_no) rejection is retried once, then 409 piece_conflict.
// DELETE = unlock: every piece of the part + their measurements, one batch.
// Both → 409 job_complete on a completed job. Gated on `qc.marina` by middleware (→ edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { evaluateMeasurements, nextStatus } from "@/lib/marina/pieces";
import {
  JOB_COMPLETE_ERROR, actor, cleanMeasureBody, isUniqueViolation, jobForPart, loadPartSummary, loadPiece,
  partDimNominals, partLogSummary, readJsonObject,
} from "@/lib/marina/store";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ ok: false, error: "Marina part not found." }, { status: 404 });

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { DB } = await getEnv();
    const who = actor(request);
    const owner = await jobForPart(DB, id);
    if (!owner) return notFound();
    if (owner.job.status === "complete") return NextResponse.json(JOB_COMPLETE_ERROR, { status: 409 });

    const body = await readJsonObject(request);
    if (!body) return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
    const input = cleanMeasureBody(body);
    if (!input.ok) return NextResponse.json({ ok: false, error: input.error }, { status: 400 });

    const dims = await partDimNominals(DB, id);
    if (!dims.length) return NextResponse.json({ ok: false, error: "This part has no dimensions yet." }, { status: 400 });
    const ev = evaluateMeasurements(dims, input.value.measurements, owner.job.tolerance_in);
    if (!ev.ok) {
      return NextResponse.json({ ok: false, code: ev.code, error: ev.error, ...(ev.dim_id ? { dim_id: ev.dim_id } : {}) }, { status: 400 });
    }
    const next = nextStatus({ current: null, allIn: ev.allIn, disposition: input.value.disposition });
    if (!next.ok) return NextResponse.json({ ok: false, code: next.code, error: next.error }, { status: 400 });

    let pieceId = "";
    for (let tries = 0; ; tries++) {
      pieceId = crypto.randomUUID();
      try {
        await DB.batch([
          DB.prepare(
            `INSERT INTO marina_pieces (id, part_id, piece_no, status, disposition_note, created_by)
             SELECT ?, ?, COALESCE(MAX(piece_no), 0) + 1, ?, ?, ? FROM marina_pieces WHERE part_id = ?`
          ).bind(pieceId, id, next.status, input.value.note, who.name, id),
          ...ev.rows.map((r) =>
            DB.prepare(
              `INSERT INTO marina_measurements (id, piece_id, dim_id, attempt, nominal_in, measured_in, measured_text, in_tol, measured_by)
               VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`
            ).bind(crypto.randomUUID(), pieceId, r.dim_id, r.nominal_in, r.measured_in, r.measured_text, r.in_tol ? 1 : 0, who.name)
          ),
        ]);
        break;
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        if (tries >= 1) {
          return NextResponse.json(
            { ok: false, code: "piece_conflict", error: "Another piece was saved at the same moment — try again.", detail: String((e as any)?.message || e) },
            { status: 409 }
          );
        }
      }
    }

    const [piece, part] = await Promise.all([loadPiece(DB, pieceId), loadPartSummary(DB, id)]);
    await logActivity(DB, "create", "marina_piece", pieceId, partLogSummary(owner.job.name, owner.part.label, piece?.piece_no),
      { job_id: owner.job.id, part_id: id, status: next.status, disposition: next.dispositionUsed, all_in: ev.allIn }, who.id);
    return NextResponse.json({ ok: true, piece, part }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { DB } = await getEnv();
    const who = actor(request);
    const owner = await jobForPart(DB, id);
    if (!owner) return notFound();
    if (owner.job.status === "complete") return NextResponse.json(JOB_COMPLETE_ERROR, { status: 409 });

    const counts = await DB.prepare(
      `SELECT (SELECT COUNT(*) FROM marina_pieces WHERE part_id = ?1) AS pieces,
              (SELECT COUNT(*) FROM marina_measurements WHERE piece_id IN (SELECT id FROM marina_pieces WHERE part_id = ?1)) AS measurements`
    ).bind(id).first<{ pieces: number; measurements: number }>();
    await DB.batch([
      DB.prepare("DELETE FROM marina_measurements WHERE piece_id IN (SELECT id FROM marina_pieces WHERE part_id = ?)").bind(id),
      DB.prepare("DELETE FROM marina_pieces WHERE part_id = ?").bind(id),
    ]);
    const deleted = { pieces: Number(counts?.pieces ?? 0), measurements: Number(counts?.measurements ?? 0) };
    const part = await loadPartSummary(DB, id);
    await logActivity(DB, "unlock", "marina_part", id, partLogSummary(owner.job.name, owner.part.label),
      { job_id: owner.job.id, ...deleted }, who.id);
    return NextResponse.json({ ok: true, deleted, part });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
