// src/app/api/production/expansion/sessions/route.ts  →  /v2/api/production/expansion/sessions
// Standalone v2 Expansion log sessions. No job_id, no jobs.status writes, no inventory side-effects.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
}

function etDaysAgo(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
    new Date(Date.now() - days * 86400000)
  );
}

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

function numOrNull(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const days = Number(new URL(request.url).searchParams.get("days")) || 30;
  try {
    const rows = await DB.prepare(
      `SELECT s.*,
         (SELECT COUNT(*) FROM production_expansion_batches b WHERE b.session_id = s.id) AS batch_count
       FROM production_expansion_sessions s
       WHERE s.log_date >= ?
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

  const {
    silo, control_no, start_time, finish_time, density, target_weight_g,
    bead_type, lot, operator_1, operator_2, log_date,
  } = body ?? {};

  const siloNum = silo === "" || silo === undefined || silo === null ? null : Number(silo);
  const id = crypto.randomUUID();
  const ts = now();

  try {
    await DB.prepare(
      `INSERT INTO production_expansion_sessions
         (id, silo, log_date, control_no, start_time, finish_time, density, target_weight_g,
          bead_type, lot, operator_1, operator_2, status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    ).bind(
      id,
      Number.isFinite(siloNum) ? siloNum : null,
      log_date || etToday(),
      control_no ?? null,
      start_time ?? null,
      finish_time ?? null,
      numOrNull(density),
      numOrNull(target_weight_g),
      bead_type ?? null,
      lot ?? null,
      operator_1 ?? null,
      operator_2 ?? null,
      operatorId,
      ts
    ).run();

    try {
      await DB.prepare(
        `INSERT INTO activity_log
           (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
         VALUES (?, ?, 'create', 'production_expansion_session', ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(),
        ts,
        id,
        `${operatorName || operatorId} opened an Expansion sheet`,
        JSON.stringify({ session_id: id, silo: siloNum, control_no: control_no ?? null }),
        operatorId,
        ts
      ).run();
    } catch (e: any) {
      console.error("activity_log failed:", String(e?.message || e));
    }

    return NextResponse.json({ ok: true, session_id: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
