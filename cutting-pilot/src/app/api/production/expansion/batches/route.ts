// src/app/api/production/expansion/batches/route.ts  →  POST /v2/api/production/expansion/batches
// Appends one batch row to an Expansion session. lot_no serves as the batch #; silo is per row.
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
  const operatorName = request.headers.get("X-User-Name") || "";
  if (!operatorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { session_id, lot_no, silo, weight_kg, heating_time_s, bucket_weight_g } = body ?? {};

  if (!session_id) return NextResponse.json({ ok: false, error: "session_id is required." }, { status: 400 });

  try {
    const session = await DB.prepare(
      `SELECT id, status FROM production_expansion_sessions WHERE id = ? AND deleted_at IS NULL`
    ).bind(session_id).first<{ id: string; status: string }>();
    if (!session) return NextResponse.json({ ok: false, error: "sheet_not_found" }, { status: 404 });
    if (session.status === "closed") {
      return NextResponse.json({ ok: false, error: "sheet_closed" }, { status: 409 });
    }

    const id = crypto.randomUUID();
    const ts = now();

    await DB.prepare(
      `INSERT INTO production_expansion_batches
         (id, session_id, lot_no, silo, weight_kg, heating_time_s, bucket_weight_g,
          operator_id, operator_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, session_id,
      lot_no ?? null, numOrNull(silo), numOrNull(weight_kg), numOrNull(heating_time_s), numOrNull(bucket_weight_g),
      operatorId, operatorName || operatorId,
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
