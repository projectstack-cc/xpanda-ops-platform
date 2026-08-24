// src/app/api/production/expansion/batches/route.ts  →  POST /v2/api/production/expansion/batches
// Appends one batch row to an open (or any existing) Expansion session.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

function numOrNull(v: any): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  const operatorId = request.headers.get("X-User-Id") || "";
  if (!operatorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { session_id, batch_no, weight_kg, heating_time_s, bucket_weight_g } = body ?? {};

  if (!session_id) return NextResponse.json({ ok: false, error: "session_id is required." }, { status: 400 });

  try {
    const session = await DB.prepare(
      `SELECT id FROM production_expansion_sessions WHERE id = ?`
    ).bind(session_id).first<{ id: string }>();
    if (!session) return NextResponse.json({ ok: false, error: "Session not found." }, { status: 404 });

    const id = crypto.randomUUID();
    const ts = now();

    await DB.prepare(
      `INSERT INTO production_expansion_batches
         (id, session_id, batch_no, weight_kg, heating_time_s, bucket_weight_g, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, session_id,
      batch_no ?? null, numOrNull(weight_kg), numOrNull(heating_time_s), numOrNull(bucket_weight_g),
      ts
    ).run();

    return NextResponse.json({ ok: true, batch_id: id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
