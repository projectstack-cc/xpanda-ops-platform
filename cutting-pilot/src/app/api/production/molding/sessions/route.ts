// src/app/api/production/molding/sessions/route.ts  →  /v2/api/production/molding/sessions
// Standalone v2 Molding log sessions. No job_id, no jobs.status writes, no inventory side-effects.
// One sheet = one block type. Silo / lot / operator live on the block rows now (prod-a-02).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function etDaysAgo(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(Date.now() - days * 86400000)
  );
}

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const days = Number(new URL(request.url).searchParams.get("days")) || 30;
  try {
    const rows = await DB.prepare(
      `SELECT s.*,
         (SELECT COUNT(*) FROM production_molding_blocks b WHERE b.session_id = s.id) AS block_count,
         (SELECT COALESCE(SUM(b.block_weight_lbs), 0) FROM production_molding_blocks b WHERE b.session_id = s.id) AS total_lbs
       FROM production_molding_sessions s
       WHERE s.log_date >= ? AND s.deleted_at IS NULL
       ORDER BY s.log_date DESC, s.created_at DESC`
    ).bind(etDaysAgo(days)).all();

    return NextResponse.json({ ok: true, sessions: rows.results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  const operatorId = request.headers.get("X-User-Id") || "";
  const operatorName = request.headers.get("X-User-Name") || "";
  if (!operatorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { block_type, log_date } = body ?? {};
  if (!block_type) {
    return NextResponse.json({ ok: false, error: "block_type_required" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const ts = now();

  try {
    const option = await DB.prepare(
      `SELECT id FROM production_options WHERE kind = 'block_type' AND value = ? AND active = 1`
    ).bind(block_type).first<{ id: string }>();
    if (!option) {
      return NextResponse.json({ ok: false, error: "unknown_block_type" }, { status: 400 });
    }

    await DB.prepare(
      `INSERT INTO production_molding_sessions
         (id, log_date, block_type, status, created_by, created_at)
       VALUES (?, ?, ?, 'open', ?, ?)`
    ).bind(id, log_date || etToday(), block_type, operatorId, ts).run();

    await logActivity(
      DB, "create", "production_molding_session", id,
      `${operatorName || operatorId} opened a Molding sheet (${block_type})`,
      { session_id: id, block_type }, operatorId
    );

    return NextResponse.json({ ok: true, session_id: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
