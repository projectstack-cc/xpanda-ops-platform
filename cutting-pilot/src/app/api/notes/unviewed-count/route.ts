// src/app/api/notes/unviewed-count/route.ts  →  /v2/api/notes/unviewed-count
// Polled by the legacy homepage (P361) for the Shift Notes card indicator. Gated on `notes`
// view by middleware. Payload stays tiny — this is polled, not the note list itself.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";

export async function GET() {
  const { DB } = await getEnv();
  try {
    const countRow = await DB.prepare(
      `SELECT COUNT(*) AS c FROM shift_notes WHERE viewed_at IS NULL`
    ).first<{ c: number }>();

    const latestRow = await DB.prepare(
      `SELECT subject FROM shift_notes WHERE viewed_at IS NULL ORDER BY created_at DESC LIMIT 1`
    ).first<{ subject: string }>();

    return NextResponse.json({
      ok: true,
      unviewed_count: countRow?.c ?? 0,
      latest_subject: latestRow?.subject ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
