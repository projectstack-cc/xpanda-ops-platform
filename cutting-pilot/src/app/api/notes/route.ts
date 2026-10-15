// src/app/api/notes/route.ts  →  /v2/api/notes
// Shift Notes: freeform, no edit; delete allowed for the author or notes.manage (notes-del-01). Globally viewed once a manager
// marks a note (viewed_* is never overwritten once set). Standalone table — no job_id, no FK.
// Gated on `notes` by middleware (GET view, POST/DELETE edit). DELETE additionally requires
// author === actor OR X-User-Can-Manage-Notes === "1", checked here.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const canManage = request.headers.get("X-User-Can-Manage-Notes") === "1";

    const rows = await DB.prepare(
      `SELECT id, subject, body, author_id, author_name, created_at, viewed_at, viewed_by_name
         FROM shift_notes
        ORDER BY created_at DESC
        LIMIT 100`
    ).all();

    const actorId = request.headers.get("X-User-Id") || "";
    const notes = ((rows.results ?? []) as any[]).map(({ author_id, ...n }) => ({
      ...n,
      can_delete: canManage || (!!actorId && author_id === actorId),
    }));

    return NextResponse.json({ ok: true, notes, can_manage: canManage });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let p: any;
  try { p = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const subject = String(p.subject ?? "").trim();
  const body = String(p.body ?? "").trim();
  if (!subject) return NextResponse.json({ ok: false, error: "Subject is required." }, { status: 400 });
  if (!body) return NextResponse.json({ ok: false, error: "Body is required." }, { status: 400 });

  const id = crypto.randomUUID();
  const ts = now();

  try {
    await DB.prepare(
      `INSERT INTO shift_notes (id, subject, body, author_id, author_name, created_at, viewed_at, viewed_by_id, viewed_by_name)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`
    ).bind(id, subject, body, actorId, actorName, ts).run();

    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

// DELETE /v2/api/notes?id=…  (notes-del-01). Author may delete their own note; notes.manage any.
export async function DELETE(request: NextRequest) {
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const canManage = request.headers.get("X-User-Can-Manage-Notes") === "1";

  const id = (request.nextUrl.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  try {
    const note = await DB.prepare(
      `SELECT id, subject, author_id, author_name FROM shift_notes WHERE id = ?`
    ).bind(id).first<{ id: string; subject: string; author_id: string; author_name: string }>();

    if (!note) return NextResponse.json({ ok: false, error: "Note not found." }, { status: 404 });
    if (!canManage && note.author_id !== actorId) {
      return NextResponse.json({ ok: false, error: "You can only delete your own notes." }, { status: 403 });
    }

    await DB.prepare(`DELETE FROM shift_notes WHERE id = ?`).bind(id).run();
    await logActivity(
      DB, "delete", "shift_note", id, `Deleted shift note "${note.subject}"`,
      { subject: note.subject, author_name: note.author_name, by_manager: note.author_id !== actorId },
      actorId
    );

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
