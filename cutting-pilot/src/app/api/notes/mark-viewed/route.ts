// src/app/api/notes/mark-viewed/route.ts  →  /v2/api/notes/mark-viewed
// Manager-only (gated on `notes.manage` by middleware). Global viewed model: first manager
// to mark a note viewed wins — viewed_* is stamped only when still unset, so a later
// mark-viewed call on an already-viewed note is a no-op that preserves the original viewer.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let p: any;
  try { p = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const id = String(p.id ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

  try {
    await DB.prepare(
      `UPDATE shift_notes
          SET viewed_at = ?, viewed_by_id = ?, viewed_by_name = ?
        WHERE id = ? AND viewed_at IS NULL`
    ).bind(now(), actorId, actorName, id).run();

    const note = await DB.prepare(
      `SELECT id, subject, body, author_name, created_at, viewed_at, viewed_by_name
         FROM shift_notes
        WHERE id = ?`
    ).bind(id).first();

    if (!note) return NextResponse.json({ ok: false, error: "Note not found." }, { status: 404 });

    return NextResponse.json({ ok: true, note });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
