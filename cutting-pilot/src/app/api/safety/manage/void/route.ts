// src/app/api/safety/manage/void/route.ts  →  POST /v2/api/safety/manage/void   (saf-01)
// Void one completion (e.g. a mis-tapped group sign-off). Body { id, reason } — reason required, ≤200 chars.
// Sets voided_at / voided_by_name / void_reason; rows are never deleted. Already voided → 409.
// Middleware demands safety.manage EDIT (POST); canManageSafety re-checks the manage header.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { actorOf, canManageSafety, getCompletion } from "@/lib/safety/records";

const MAX_REASON = 200;
const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

export async function POST(request: NextRequest) {
  const actor = actorOf(request.headers);
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageSafety(request.headers)) return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });

  let p: any;
  try { p = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  if (!p || typeof p !== "object") return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });

  const id = typeof p.id === "string" ? p.id.trim() : "";
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  const reason = typeof p.reason === "string" ? p.reason.trim() : "";
  if (!reason) return NextResponse.json({ ok: false, error: "reason_required" }, { status: 400 });
  if (reason.length > MAX_REASON) return NextResponse.json({ ok: false, error: "reason_too_long", detail: `Max ${MAX_REASON} characters.` }, { status: 400 });

  try {
    const { DB } = await getEnv();
    const row = await getCompletion(DB, id);
    if (!row) return NextResponse.json({ ok: false, error: "Completion not found." }, { status: 404 });
    if (row.voided_at) return NextResponse.json({ ok: false, error: "already_voided" }, { status: 409 });

    const ts = now();
    const res = await DB.prepare(
      `UPDATE safety_training_completions SET voided_at = ?, voided_by_name = ?, void_reason = ?
        WHERE id = ? AND voided_at IS NULL`
    ).bind(ts, actor.name, reason, id).run();
    if (!res.meta?.changes) return NextResponse.json({ ok: false, error: "already_voided" }, { status: 409 });

    await logActivity(
      DB, "void", "safety_training", id,
      `Voided safety training ${row.block_id} on ${row.completed_on} for ${row.user_name}`,
      { block_id: row.block_id, completed_on: row.completed_on, user_id: row.user_id, source: row.source, reason },
      actor.id
    );
    return NextResponse.json({ ok: true, completion: { ...row, voided_at: ts, voided_by_name: actor.name, void_reason: reason } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
