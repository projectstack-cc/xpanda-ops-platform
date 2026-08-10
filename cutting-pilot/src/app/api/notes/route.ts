// src/app/api/notes/route.ts  →  /v2/api/notes
// Shift Notes: freeform, immutable (no edit/delete in v1), globally viewed once a manager
// marks a note (viewed_* is never overwritten once set). Standalone table — no job_id, no FK.
// Gated on `notes` by middleware (GET view, POST edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const canManage = request.headers.get("X-User-Can-Manage-Notes") === "1";

    const rows = await DB.prepare(
      `SELECT id, subject, body, author_name, created_at, viewed_at, viewed_by_name
         FROM shift_notes
        ORDER BY created_at DESC
        LIMIT 100`
    ).all();

    return NextResponse.json({ ok: true, notes: rows.results ?? [], can_manage: canManage });
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
