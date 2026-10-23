// src/app/api/qc/marina/pieces/[id]/route.ts  →  PATCH/DELETE /v2/api/qc/marina/pieces/:id
// marina-03. PATCH is a correction only: { disposition_note?, status? }. The only status moves are
// rework_pending → scrapped and scrapped → rework_pending (a changed mind); pass / accepted can't be
// set or left by hand → 400 bad_transition. The note is editable in any state. DELETE removes the
// piece + its measurements (no renumbering — gaps are fine).
// Both → 409 job_complete on a completed job. Gated on `qc.marina` by middleware (→ edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import {
  JOB_COMPLETE_ERROR, actor, cleanOptional, jobForPiece, loadPartSummary, loadPiece, partLogSummary, readJsonObject,
} from "@/lib/marina/store";
import type { MarinaPieceStatus } from "@/lib/marina/types";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ ok: false, error: "Marina piece not found." }, { status: 404 });
const STATUSES: MarinaPieceStatus[] = ["pass", "rework_pending", "accepted", "scrapped"];
const CORRECTABLE: MarinaPieceStatus[] = ["rework_pending", "scrapped"];

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { DB } = await getEnv();
    const who = actor(request);
    const body = await readJsonObject(request);
    if (!body) return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });

    const owner = await jobForPiece(DB, id);
    if (!owner) return notFound();
    if (owner.job.status === "complete") return NextResponse.json(JOB_COMPLETE_ERROR, { status: 409 });

    const sets: string[] = [];
    const binds: unknown[] = [];
    const changed: Record<string, unknown> = {};
    if ("status" in body && body.status !== owner.piece.status) {
      if (!STATUSES.includes(body.status as MarinaPieceStatus)) {
        return NextResponse.json({ ok: false, error: "status must be rework_pending or scrapped." }, { status: 400 });
      }
      if (!CORRECTABLE.includes(body.status as MarinaPieceStatus) || !CORRECTABLE.includes(owner.piece.status)) {
        return NextResponse.json(
          { ok: false, code: "bad_transition", error: "Only Rework ↔ Scrap can be changed by hand.", detail: `${owner.piece.status} → ${String(body.status)}` },
          { status: 400 }
        );
      }
      sets.push("status = ?"); binds.push(body.status); changed.status = { from: owner.piece.status, to: body.status };
    }
    if ("disposition_note" in body) {
      const r = cleanOptional(body.disposition_note, 2000, "Note");
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
      sets.push("disposition_note = ?"); binds.push(r.value); changed.disposition_note = r.value;
    }
    if (!sets.length) {
      if ("status" in body) {
        // Re-sending the current status: nothing to change.
        const [piece, part] = await Promise.all([loadPiece(DB, id), loadPartSummary(DB, owner.part.id)]);
        return NextResponse.json({ ok: true, piece, part });
      }
      return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
    }

    await DB.prepare(`UPDATE marina_pieces SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`).bind(...binds, id).run();
    const [piece, part] = await Promise.all([loadPiece(DB, id), loadPartSummary(DB, owner.part.id)]);
    await logActivity(DB, "update", "marina_piece", id, partLogSummary(owner.job.name, owner.part.label, owner.piece.piece_no),
      { job_id: owner.job.id, part_id: owner.part.id, ...changed }, who.id);
    return NextResponse.json({ ok: true, piece, part });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { DB } = await getEnv();
    const who = actor(request);
    const owner = await jobForPiece(DB, id);
    if (!owner) return notFound();
    if (owner.job.status === "complete") return NextResponse.json(JOB_COMPLETE_ERROR, { status: 409 });

    await DB.batch([
      DB.prepare("DELETE FROM marina_measurements WHERE piece_id = ?").bind(id),
      DB.prepare("DELETE FROM marina_pieces WHERE id = ?").bind(id),
    ]);
    const part = await loadPartSummary(DB, owner.part.id);
    await logActivity(DB, "delete", "marina_piece", id, partLogSummary(owner.job.name, owner.part.label, owner.piece.piece_no),
      { job_id: owner.job.id, part_id: owner.part.id, status: owner.piece.status }, who.id);
    return NextResponse.json({ ok: true, part });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
