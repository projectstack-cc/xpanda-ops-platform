// src/app/v2/api/cutting/my-session/route.ts  →  GET /v2/api/cutting/my-session
// Authoritative "am I clocked in?" check — no job-status filtering, unlike the queue. A session
// survives here even if its job is archived, shipped, or otherwise dropped off the board.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  try {
    const operatorId = request.headers.get("X-User-Id") || "";
    if (!operatorId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const row = await DB.prepare(
      `SELECT cs.id AS session_id, cs.job_id, cs.line, cs.started_at,
              j.invoice_number, j.customer, j.status AS job_status
       FROM cutting_sessions cs
       LEFT JOIN jobs j ON j.id = cs.job_id
       WHERE cs.operator_id = ? AND cs.status = 'open'
       ORDER BY cs.started_at ASC
       LIMIT 1`
    )
      .bind(operatorId)
      .first<{
        session_id: string;
        job_id: string;
        line: string;
        started_at: string;
        invoice_number: string | null;
        customer: string | null;
        job_status: string | null;
      }>();

    if (!row) {
      return NextResponse.json({ ok: true, session: null });
    }

    const orphaned = row.job_status == null || ["archived", "shipped"].includes(row.job_status);

    return NextResponse.json({
      ok: true,
      session: {
        session_id: row.session_id,
        job_id: row.job_id,
        line: row.line,
        started_at: row.started_at,
        invoice_number: row.invoice_number,
        customer: row.customer,
        job_status: row.job_status,
        orphaned,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
