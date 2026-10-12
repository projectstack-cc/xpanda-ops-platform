// src/app/api/board/[id]/prints/route.ts  →  GET/POST /v2/api/board/:id/prints
// board-prints-01. Job prints (customer drawings / spec sheets). Objects live in BOL_PHOTOS R2 under
// job-prints/<jobId>/<uuid>.<ext>; r2_key is resolved server-side only and never returned to the
// client (same rule as api/shipments/signed-bol/file). Gated on `jobs` (view/edit) by middleware.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_BYTES = 25 * 1024 * 1024;
const PUBLIC_COLS = "id, filename, content_type, size_bytes, uploaded_by_name, created_at";

// Strip any path, control characters and double quotes (it lands in Content-Disposition); cap at 150.
function sanitizeFilename(raw: string, ext: string): string {
  let name = String(raw || "").split(/[\\/]/).pop() || "";
  name = name.replace(/[\x00-\x1f\x7f"]/g, "").trim().slice(0, 150).trim();
  return name || `print.${ext}`;
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const { DB } = await getEnv();
    const job = await DB.prepare("SELECT id FROM jobs WHERE id = ?").bind(id).first();
    if (!job) return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });
    const rows = await DB.prepare(
      `SELECT ${PUBLIC_COLS} FROM job_prints WHERE job_id = ? ORDER BY created_at DESC`
    ).bind(id).all();
    return NextResponse.json({ ok: true, prints: rows.results ?? [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const { DB, BOL_PHOTOS } = await getEnv();
    const userId = request.headers.get("X-User-Id") || null;
    const userName = request.headers.get("X-User-Name") || null;

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
    const ext = EXT[file.type];
    if (!ext) {
      return NextResponse.json(
        { ok: false, error: "Prints must be a PDF, PNG, JPG or WEBP file.", detail: `type: ${file.type || "unknown"}` },
        { status: 400 }
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: "File is too large. The limit is 25 MB.", detail: `size: ${file.size}` },
        { status: 400 }
      );
    }

    // Archived jobs are allowed — prints are reference material.
    const job = await DB.prepare("SELECT id FROM jobs WHERE id = ?").bind(id).first();
    if (!job) return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });

    const printId = crypto.randomUUID();
    const key = `job-prints/${id}/${printId}.${ext}`;
    const filename = sanitizeFilename(file.name, ext);

    // Write order: R2 first, then D1. A failed insert best-effort deletes the orphaned object.
    await BOL_PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    try {
      await DB.prepare(
        `INSERT INTO job_prints (id, job_id, filename, content_type, size_bytes, r2_key, uploaded_by, uploaded_by_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(printId, id, filename, file.type, file.size, key, userId, userName).run();
    } catch (e) {
      try { await BOL_PHOTOS.delete(key); } catch { /* best-effort */ }
      throw e;
    }

    const print = await DB.prepare(`SELECT ${PUBLIC_COLS} FROM job_prints WHERE id = ?`).bind(printId).first();
    await logActivity(DB, "create", "job_print", printId, filename,
      { job_id: id, filename, content_type: file.type, size_bytes: file.size }, userId);
    return NextResponse.json({ ok: true, print }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
