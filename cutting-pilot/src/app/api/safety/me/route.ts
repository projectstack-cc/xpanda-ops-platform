// src/app/api/safety/me/route.ts  →  GET /v2/api/safety/me   (saf-01)
// The caller's own training record: block readiness + their non-voided completions, newest first.
// Gated on `safety` view by middleware. Identity from X-User-* headers only.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { TRAINING_BLOCKS } from "@/lib/safety/trainingBlocks";
import { actorOf, listUserCompletions } from "@/lib/safety/records";

export async function GET(request: NextRequest) {
  const actor = actorOf(request.headers);
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  try {
    const { DB } = await getEnv();
    const rows = await listUserCompletions(DB, actor.id);
    return NextResponse.json({
      ok: true,
      blocks: TRAINING_BLOCKS.map((b) => ({ id: b.id, ready: b.ready })),
      completions: rows.map((r) => ({ id: r.id, block_id: r.block_id, completed_on: r.completed_on, source: r.source })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
