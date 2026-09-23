// src/app/api/production/expansion/sessions/route.ts  →  /v2/api/production/expansion/sessions
// Standalone v2 Expansion log sessions. No job_id, no jobs.status writes, no inventory side-effects.
// Control #, header lot, and operators removed — lot + silo now live per batch row (prod-a-02).
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
         (SELECT COUNT(*) FROM production_expansion_batches b WHERE b.session_id = s.id) AS batch_count,
         (SELECT COALESCE(SUM(b.weight_kg), 0) FROM production_expansion_batches b WHERE b.session_id = s.id) AS total_kg
       FROM production_expansion_sessions s
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

  const {
    bead_supplier, bead_type, density, target_weight_g, start_time, finish_time, log_date,
  } = body ?? {};

  if (!bead_supplier || !bead_type) {
    return NextResponse.json({ ok: false, error: "unknown_bead_type" }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const ts = now();

  try {
    const supplierOption = await DB.prepare(
      `SELECT id FROM production_options WHERE kind = 'bead_supplier' AND value = ? AND active = 1`
    ).bind(bead_supplier).first<{ id: string }>();
    if (!supplierOption) {
      return NextResponse.json({ ok: false, error: "unknown_bead_type" }, { status: 400 });
    }
    const typeOption = await DB.prepare(
      `SELECT id FROM production_options WHERE kind = 'bead_type' AND grp = ? AND value = ? AND active = 1`
    ).bind(bead_supplier, bead_type).first<{ id: string }>();
    if (!typeOption) {
      return NextResponse.json({ ok: false, error: "unknown_bead_type" }, { status: 400 });
    }

    await DB.prepare(
      `INSERT INTO production_expansion_sessions
         (id, log_date, start_time, finish_time, bead_supplier, bead_type, density, target_weight_g,
          status, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`
    ).bind(
      id,
      log_date || etToday(),
      start_time ?? null,
      finish_time ?? null,
      bead_supplier,
      bead_type,
      numOrNull(density),
      numOrNull(target_weight_g),
      operatorId,
      ts
    ).run();

    await logActivity(
      DB, "create", "production_expansion_session", id,
      `${operatorName || operatorId} opened an Expansion sheet (${bead_supplier} ${bead_type})`,
      { session_id: id, bead_supplier, bead_type }, operatorId
    );

    return NextResponse.json({ ok: true, session_id: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
