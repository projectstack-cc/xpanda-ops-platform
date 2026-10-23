// src/app/api/qc/marina/parts/[id]/route.ts  →  GET/PATCH/DELETE /v2/api/qc/marina/parts/:id
// marina-03. GET = part detail (dims, tallies, locked, job, file, every piece with all attempts).
// PATCH edits label / notes / sort_order. DELETE removes measurements → pieces → dims → part in one
// batch. Mutations on a completed job → 409 job_complete.
// Gated on `qc.marina` by middleware (GET → view, PATCH/DELETE → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import {
  JOB_COMPLETE_ERROR, actor, cleanOptional, jobForPart, loadPartDetail, loadPartSummary, partLogSummary, readJsonObject,
} from "@/lib/marina/store";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ ok: false, error: "Marina part not found." }, { status: 404 });
const bad = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 });

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { DB } = await getEnv();
    const part = await loadPartDetail(DB, id);
    if (!part) return notFound();
    return NextResponse.json({ ok: true, part });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { DB } = await getEnv();
    const who = actor(request);
    const body = await readJsonObject(request);
    if (!body) return bad("Expected a JSON body.");

    const sets: string[] = [];
    const binds: unknown[] = [];
    const changed: Record<string, unknown> = {};
    if ("label" in body) {
      const label = typeof body.label === "string" ? body.label.trim() : "";
      if (!label || label.length > 80) return bad("Label must be 1–80 characters.");
      sets.push("label = ?"); binds.push(label); changed.label = label;
    }
    if ("notes" in body) {
      const r = cleanOptional(body.notes, 2000, "Notes");
      if (!r.ok) return bad(r.error);
      sets.push("notes = ?"); binds.push(r.value); changed.notes = r.value;
    }
    if ("sort_order" in body) {
      if (typeof body.sort_order !== "number" || !Number.isInteger(body.sort_order)) return bad("sort_order must be a whole number.");
      sets.push("sort_order = ?"); binds.push(body.sort_order); changed.sort_order = body.sort_order;
    }
    if (!sets.length) return bad("Nothing to update.");

    const owner = await jobForPart(DB, id);
    if (!owner) return notFound();
    if (owner.job.status === "complete") return NextResponse.json(JOB_COMPLETE_ERROR, { status: 409 });

    await DB.prepare(`UPDATE marina_parts SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id).run();
    const part = await loadPartSummary(DB, id);
    await logActivity(DB, "update", "marina_part", id, partLogSummary(owner.job.name, part?.label ?? owner.part.label),
      { job_id: owner.job.id, ...changed }, who.id);
    return NextResponse.json({ ok: true, part });
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

    const PIECES = "SELECT id FROM marina_pieces WHERE part_id = ?";
    const counts = await DB.prepare(
      `SELECT (SELECT COUNT(*) FROM marina_pieces WHERE part_id = ?1) AS pieces,
              (SELECT COUNT(*) FROM marina_measurements WHERE piece_id IN (SELECT id FROM marina_pieces WHERE part_id = ?1)) AS measurements`
    ).bind(id).first<{ pieces: number; measurements: number }>();
    await DB.batch([
      DB.prepare(`DELETE FROM marina_measurements WHERE piece_id IN (${PIECES})`).bind(id),
      DB.prepare("DELETE FROM marina_pieces WHERE part_id = ?").bind(id),
      DB.prepare("DELETE FROM marina_part_dims WHERE part_id = ?").bind(id),
      DB.prepare("DELETE FROM marina_parts WHERE id = ?").bind(id),
    ]);
    const deleted = { pieces: Number(counts?.pieces ?? 0), measurements: Number(counts?.measurements ?? 0) };
    await logActivity(DB, "delete", "marina_part", id, partLogSummary(owner.job.name, owner.part.label),
      { job_id: owner.job.id, label: owner.part.label, ...deleted }, who.id);
    return NextResponse.json({ ok: true, deleted });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
