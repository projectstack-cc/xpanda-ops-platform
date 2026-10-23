// src/app/api/qc/marina/jobs/[id]/parts/route.ts  →  POST /v2/api/qc/marina/jobs/:id/parts
// marina-03. Bulk-create parts + dims: { parts: NewPartInput[] } (1–200). Any validation error rejects
// the whole request; everything is written in one D1 batch. sort_order continues after the job's
// current max (parts in array order, dims in array order). 409 job_complete on a completed job.
// Gated on `qc.marina` by middleware (POST → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import {
  JOB_COMPLETE_ERROR, actor, cleanDims, cleanOptional, loadJob, loadJobDetail, readJsonObject, type CleanDim,
} from "@/lib/marina/store";

type Ctx = { params: Promise<{ id: string }> };

const bad = (error: string) => NextResponse.json({ ok: false, error }, { status: 400 });

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { DB } = await getEnv();
    const who = actor(request);
    const job = await loadJob(DB, id);
    if (!job) return NextResponse.json({ ok: false, error: "Marina job not found." }, { status: 404 });
    if (job.status === "complete") return NextResponse.json(JOB_COMPLETE_ERROR, { status: 409 });

    const body = await readJsonObject(request);
    if (!body) return bad("Expected a JSON body.");
    const raw = body.parts;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 200) return bad("parts must be a list of 1–200 parts.");

    const jobFiles = await DB.prepare("SELECT id FROM marina_files WHERE job_id = ?").bind(id).all<{ id: string }>();
    const fileIds = new Set((jobFiles.results ?? []).map((r) => r.id));

    const clean: { label: string; notes: string | null; file_id: string | null; page_no: number | null; dims: CleanDim[] }[] = [];
    for (let i = 0; i < raw.length; i++) {
      const p = (raw[i] && typeof raw[i] === "object" ? raw[i] : {}) as Record<string, unknown>;
      const label = typeof p.label === "string" ? p.label.trim() : "";
      if (!label || label.length > 80) return bad(`Part #${i + 1}: label must be 1–80 characters.`);
      const notes = cleanOptional(p.notes, 2000, `Part "${label}" notes`);
      if (!notes.ok) return bad(notes.error);
      let fileId: string | null = null;
      if (p.file_id !== undefined && p.file_id !== null && p.file_id !== "") {
        if (typeof p.file_id !== "string" || !fileIds.has(p.file_id)) return bad(`Part "${label}": file_id is not a file of this job.`);
        fileId = p.file_id;
      }
      let pageNo: number | null = null;
      if (p.page_no !== undefined && p.page_no !== null) {
        if (typeof p.page_no !== "number" || !Number.isInteger(p.page_no) || p.page_no < 1) {
          return bad(`Part "${label}": page_no must be a whole number ≥ 1.`);
        }
        pageNo = p.page_no;
      }
      const dims = cleanDims(p.dims, label);
      if (!dims.ok) return bad(dims.error);
      clean.push({ label, notes: notes.value, file_id: fileId, page_no: pageNo, dims: dims.value });
    }

    const max = await DB.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM marina_parts WHERE job_id = ?")
      .bind(id).first<{ m: number }>();
    let sort = Number(max?.m ?? 0);
    const stmts = [];
    const created: { id: string; label: string }[] = [];
    for (const part of clean) {
      const partId = crypto.randomUUID();
      sort += 1;
      created.push({ id: partId, label: part.label });
      stmts.push(
        DB.prepare(
          `INSERT INTO marina_parts (id, job_id, file_id, page_no, label, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(partId, id, part.file_id, part.page_no, part.label, part.notes, sort)
      );
      part.dims.forEach((d, i) => {
        stmts.push(
          DB.prepare(
            `INSERT INTO marina_part_dims (id, part_id, label, nominal_in, nominal_text, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(crypto.randomUUID(), partId, d.label, d.nominal_in, d.nominal_text, i + 1)
        );
      });
    }
    await DB.batch(stmts);

    // One audit row per request (a cut-sheet setup can be dozens of parts).
    await logActivity(DB, "create", "marina_part", id, `${job.name} · ${created.length} part${created.length === 1 ? "" : "s"}`,
      { job_id: id, parts: created }, who.id);
    const detail = await loadJobDetail(DB, id);
    return NextResponse.json({ ok: true, detail }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
