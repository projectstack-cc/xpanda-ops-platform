// src/app/api/qc/marina/parts/[id]/dims/route.ts  →  PUT /v2/api/qc/marina/parts/:id/dims
// marina-03. Replaces the part's dim set ({ dims: NewDimInput[] }, 1–20): delete then insert in one
// batch, new ids. 409 dims_locked once any piece on the part has a measurement (unlock = DELETE
// /parts/:id/pieces); 409 job_complete on a completed job.
// Gated on `qc.marina` by middleware (PUT → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import {
  JOB_COMPLETE_ERROR, actor, cleanDims, jobForPart, loadPartSummary, partLogSummary, readJsonObject,
} from "@/lib/marina/store";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { DB } = await getEnv();
    const who = actor(request);
    const owner = await jobForPart(DB, id);
    if (!owner) return NextResponse.json({ ok: false, error: "Marina part not found." }, { status: 404 });
    if (owner.job.status === "complete") return NextResponse.json(JOB_COMPLETE_ERROR, { status: 409 });

    const body = await readJsonObject(request);
    if (!body) return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
    const dims = cleanDims(body.dims, owner.part.label);
    if (!dims.ok) return NextResponse.json({ ok: false, error: dims.error }, { status: 400 });

    const measured = await DB.prepare(
      `SELECT COUNT(*) AS n FROM marina_measurements WHERE piece_id IN (SELECT id FROM marina_pieces WHERE part_id = ?)`
    ).bind(id).first<{ n: number }>();
    if (Number(measured?.n ?? 0) > 0) {
      return NextResponse.json(
        { ok: false, code: "dims_locked", error: "Pieces have been measured — delete this part's pieces to change its dimensions.", detail: `measurements: ${measured?.n}` },
        { status: 409 }
      );
    }

    await DB.batch([
      DB.prepare("DELETE FROM marina_part_dims WHERE part_id = ?").bind(id),
      ...dims.value.map((d, i) =>
        DB.prepare(
          `INSERT INTO marina_part_dims (id, part_id, label, nominal_in, nominal_text, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), id, d.label, d.nominal_in, d.nominal_text, i + 1)
      ),
    ]);
    const part = await loadPartSummary(DB, id);
    await logActivity(DB, "update_dims", "marina_part", id, partLogSummary(owner.job.name, owner.part.label),
      { job_id: owner.job.id, dims: dims.value }, who.id);
    return NextResponse.json({ ok: true, part });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
