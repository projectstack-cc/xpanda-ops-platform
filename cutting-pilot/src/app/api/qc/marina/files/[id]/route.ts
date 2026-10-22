// src/app/api/qc/marina/files/[id]/route.ts  →  GET/PATCH/DELETE /v2/api/qc/marina/files/:id
// marina-02. GET streams the PDF inline from BOL_PHOTOS R2 (r2_key resolved server-side only).
// PATCH flips kind and/or superseded (true stamps superseded_at, false clears it); attaching an
// inbox file to a job is marina-09. DELETE is for a mistaken upload: 409 code "file_in_use" while any
// marina_parts row references the file (supersede instead), else the row goes, then the object
// best-effort. Gated on `qc.marina` by middleware (GET → view, PATCH/DELETE → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { FILE_KINDS, actor, fileR2Key, headerSafeFilename, loadFile } from "@/lib/marina/store";
import type { MarinaFileKind } from "@/lib/marina/types";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ ok: false, error: "Marina file not found." }, { status: 404 });

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { DB, BOL_PHOTOS } = await getEnv();
    const row = await fileR2Key(DB, id);
    if (!row) return new Response("Not found", { status: 404 });
    const obj = await BOL_PHOTOS.get(row.r2_key);
    if (!obj) return new Response("Not found", { status: 404 });
    const safe = headerSafeFilename(row.filename || "marina.pdf");
    return new Response(obj.body as unknown as ReadableStream, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safe}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e: any) {
    return new Response(`Server error: ${String(e?.message || e)}`, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { DB } = await getEnv();
    const who = actor(request);
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
    }

    const sets: string[] = [];
    const binds: unknown[] = [];
    const changed: Record<string, unknown> = {};
    if ("kind" in body) {
      if (!FILE_KINDS.includes(body.kind as MarinaFileKind)) {
        return NextResponse.json({ ok: false, error: "kind must be cut_sheet or customer_drawing." }, { status: 400 });
      }
      sets.push("kind = ?"); binds.push(body.kind); changed.kind = body.kind;
    }
    if ("superseded" in body) {
      if (typeof body.superseded !== "boolean") {
        return NextResponse.json({ ok: false, error: "superseded must be true or false." }, { status: 400 });
      }
      sets.push(body.superseded ? "superseded_at = COALESCE(superseded_at, datetime('now'))" : "superseded_at = NULL");
      changed.superseded = body.superseded;
    }
    if (!sets.length) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });

    const before = await loadFile(DB, id);
    if (!before) return notFound();
    await DB.prepare(`UPDATE marina_files SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id).run();
    const file = await loadFile(DB, id);

    const action = "superseded" in changed && Object.keys(changed).length === 1
      ? (changed.superseded ? "supersede" : "unsupersede")
      : "update";
    await logActivity(DB, action, "marina_file", id, before.filename || id,
      { job_id: before.job_id, ...changed }, who.id);
    return NextResponse.json({ ok: true, file });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { DB, BOL_PHOTOS } = await getEnv();
    const who = actor(request);
    const row = await DB.prepare("SELECT job_id, filename, r2_key FROM marina_files WHERE id = ?").bind(id)
      .first<{ job_id: string | null; filename: string | null; r2_key: string }>();
    if (!row) return notFound();

    const inUse = await DB.prepare("SELECT COUNT(*) AS n FROM marina_parts WHERE file_id = ?").bind(id)
      .first<{ n: number }>();
    if (Number(inUse?.n ?? 0) > 0) {
      return NextResponse.json(
        { ok: false, code: "file_in_use", error: "Parts were set up from this file — supersede it instead of deleting.", detail: `parts: ${inUse?.n}` },
        { status: 409 }
      );
    }

    await DB.prepare("DELETE FROM marina_files WHERE id = ?").bind(id).run();
    try { await BOL_PHOTOS.delete(row.r2_key); } catch { /* best-effort; the row is already gone */ }

    await logActivity(DB, "delete", "marina_file", id, row.filename || id,
      { job_id: row.job_id, filename: row.filename }, who.id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
