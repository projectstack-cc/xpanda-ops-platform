// src/app/api/safety/complete/route.ts  →  POST /v2/api/safety/complete   (saf-01)
// Self completion for today (ET). Body { block_id, attested: true }. The row is always the CALLER's (identity from
// X-User-* headers), so middleware lets this exact path POST at `safety` VIEW level (VIEW_LEVEL_POSTS).
// Double-tap guard: an existing non-voided `self` row for the same block today → 409 already_today.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { getBlock } from "@/lib/safety/trainingBlocks";
import { actorOf, etToday, getCompletion, insertCompletionStmt, type CompletionRow } from "@/lib/safety/records";

export async function POST(request: NextRequest) {
  const actor = actorOf(request.headers);
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let p: any;
  try { p = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  if (!p || typeof p !== "object") return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });

  const blockId = typeof p.block_id === "string" ? p.block_id.trim() : "";
  const block = getBlock(blockId);
  if (!block) return NextResponse.json({ ok: false, error: "unknown_block", detail: `No training block "${blockId}".` }, { status: 400 });
  if (!block.ready) return NextResponse.json({ ok: false, error: "block_not_ready", detail: `${block.id} is not available yet.` }, { status: 400 });
  if (p.attested !== true) return NextResponse.json({ ok: false, error: "attest_required", detail: "Confirm you watched the block." }, { status: 400 });

  try {
    const { DB } = await getEnv();
    const today = etToday();
    const existing = await DB.prepare(
      `SELECT id, block_id, completed_on, source, created_at FROM safety_training_completions
        WHERE user_id = ? AND block_id = ? AND completed_on = ? AND source = 'self' AND voided_at IS NULL
        ORDER BY created_at DESC LIMIT 1`
    ).bind(actor.id, block.id, today).first<Pick<CompletionRow, "id" | "block_id" | "completed_on" | "source" | "created_at">>();
    if (existing) {
      return NextResponse.json({ ok: false, error: "already_today", completion: existing }, { status: 409 });
    }

    const id = crypto.randomUUID();
    await insertCompletionStmt(DB, {
      id, user_id: actor.id, user_name: actor.name, block_id: block.id, completed_on: today, source: "self",
      recorded_by_id: actor.id, recorded_by_name: actor.name, note: null,
    }).run();
    const row = await getCompletion(DB, id);

    await logActivity(
      DB, "create", "safety_training", id,
      `${actor.name} completed safety training Block ${block.n} — ${block.titleEn}`,
      { block_id: block.id, completed_on: today, source: "self" },
      actor.id
    );
    return NextResponse.json({ ok: true, completion: row }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
