// src/app/api/qc/marina/jobs/[id]/files/route.ts  →  POST /v2/api/qc/marina/jobs/:id/files
// marina-02. Manual upload of a cut sheet / customer drawing (PDF only, 25 MB cap) into BOL_PHOTOS
// R2 at marina/<fileId>.pdf. Same write order as board prints: R2 first, then D1; a failed insert
// best-effort deletes the orphaned object. r2_key is never returned. page_count comes from the
// client's pdf.js (optional, 1–500). Open and complete jobs both accept uploads.
// Gated on `qc.marina` by middleware (POST → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { FILE_KINDS, MARINA_MAX_FILE_BYTES, actor, loadFile, loadJob, sanitizeFilename } from "@/lib/marina/store";
import type { MarinaFileKind } from "@/lib/marina/types";

type Ctx = { params: Promise<{ id: string }> };

// Some phones send a PDF with an empty or octet-stream type — accept those when the name ends .pdf.
function isPdf(file: File): boolean {
  if (file.type === "application/pdf") return true;
  return (file.type === "" || file.type === "application/octet-stream") && /\.pdf$/i.test(file.name || "");
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { DB, BOL_PHOTOS } = await getEnv();
    const who = actor(request);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ ok: false, error: "Expected multipart form data with a file." }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "file is required." }, { status: 400 });
    }
    if (!isPdf(file)) {
      return NextResponse.json(
        { ok: false, error: "Marina files must be a PDF.", detail: `type: ${file.type || "unknown"}` },
        { status: 400 }
      );
    }
    if (file.size > MARINA_MAX_FILE_BYTES) {
      return NextResponse.json(
        { ok: false, error: "File is too large. The limit is 25 MB.", detail: `size: ${file.size}` },
        { status: 400 }
      );
    }
    const kindRaw = form.get("kind");
    const kind = (kindRaw === null || kindRaw === "" ? "cut_sheet" : String(kindRaw)) as MarinaFileKind;
    if (!FILE_KINDS.includes(kind)) {
      return NextResponse.json({ ok: false, error: "kind must be cut_sheet or customer_drawing." }, { status: 400 });
    }
    const pcRaw = form.get("page_count");
    let pageCount: number | null = null;
    if (pcRaw !== null && pcRaw !== "") {
      const n = Number(pcRaw);
      if (!Number.isInteger(n) || n < 1 || n > 500) {
        return NextResponse.json({ ok: false, error: "page_count must be a whole number from 1 to 500." }, { status: 400 });
      }
      pageCount = n;
    }

    const job = await loadJob(DB, id);
    if (!job) return NextResponse.json({ ok: false, error: "Marina job not found." }, { status: 404 });

    const fileId = crypto.randomUUID();
    const key = `marina/${fileId}.pdf`;
    const filename = sanitizeFilename(file.name, "pdf");

    // Write order: R2 first, then D1. A failed insert best-effort deletes the orphaned object.
    await BOL_PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: "application/pdf" } });
    try {
      await DB.prepare(
        `INSERT INTO marina_files (id, job_id, kind, r2_key, filename, size_bytes, page_count, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(fileId, id, kind, key, filename, file.size, pageCount, who.name).run();
    } catch (e) {
      try { await BOL_PHOTOS.delete(key); } catch { /* best-effort */ }
      throw e;
    }

    const saved = await loadFile(DB, fileId);
    await logActivity(DB, "create", "marina_file", fileId, filename,
      { job_id: id, job_name: job.name, kind, filename, size_bytes: file.size, page_count: pageCount }, who.id);
    return NextResponse.json({ ok: true, file: saved }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
