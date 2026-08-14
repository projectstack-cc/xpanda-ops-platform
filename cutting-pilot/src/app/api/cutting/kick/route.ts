// src/app/api/cutting/kick/route.ts  →  POST /v2/api/cutting/kick
// Manager/override-only: closes a stuck-open cutting session so someone else can Start.
// Writes ONLY status + ended_at on cutting_sessions — no qty, no handoff note, and never
// touches cutting_lines.line_status or jobs.status (we cannot attest to what the kicked
// operator actually cut). Gated by middleware on manufacturing.cutting.override (prefix
// /v2/api/cutting/kick); the X-User-Can-Override-Cutting header check below is
// defense-in-depth. Audit is via activity_log only — no schema change.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    if (request.headers.get("X-User-Can-Override-Cutting") !== "1") {
      return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });
    }

    const kickerId = request.headers.get("X-User-Id") || "";
    const kickerName = request.headers.get("X-User-Name") || "";
    if (!kickerId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { session_id } = body ?? {};
    if (!session_id) {
      return NextResponse.json({ ok: false, error: "session_id is required." }, { status: 400 });
    }

    const session = await DB.prepare(
      `SELECT id, job_id, line, operator_id, operator_name, status
       FROM cutting_sessions WHERE id = ? LIMIT 1`
    ).bind(session_id).first<{
      id: string;
      job_id: string;
      line: string;
      operator_id: string;
      operator_name: string;
      status: string;
    }>();

    if (!session) {
      return NextResponse.json({ ok: false, error: "Session not found." }, { status: 404 });
    }
    if (session.status !== "open") {
      return NextResponse.json({ ok: false, error: "Session is not open." }, { status: 400 });
    }

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    await DB.prepare(
      `UPDATE cutting_sessions SET status = 'closed', ended_at = ? WHERE id = ?`
    ).bind(now, session_id).run();

    await DB.prepare(
      `INSERT INTO activity_log
         (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
       VALUES (?, ?, 'update', 'cutting_session', ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(),
      now,
      session_id,
      `${kickerName} kicked ${session.operator_name} off ${session.line}`,
      JSON.stringify({
        job_id: session.job_id,
        line: session.line,
        kicked_operator_id: session.operator_id,
        kicked_operator_name: session.operator_name,
        reason: "forgot_to_stop",
      }),
      kickerId,
      now
    ).run();

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
