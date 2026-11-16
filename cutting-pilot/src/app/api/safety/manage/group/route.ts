// src/app/api/safety/manage/group/route.ts  →  POST /v2/api/safety/manage/group   (saf-01)
// Group sign-off: one ready block for several trainees at once, on a date (not in the future, ET), optional note.
// Body { block_id, completed_on, user_ids: string[1..200], note? }. Every id must be an active trainee
// (lib/safety/records.ts TRAINEE_SQL), else 400 with the bad ids. Users who already hold a non-voided row for that
// block on that date are skipped. One DB.batch; ONE activity row. Middleware demands safety.manage EDIT (POST);
// canManageSafety re-checks the manage header.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { getBlock } from "@/lib/safety/trainingBlocks";
import {
  actorOf, canManageSafety, etToday, insertCompletionStmt, isValidYmd, listTrainees,
} from "@/lib/safety/records";

const MAX_USERS = 200;
const MAX_NOTE = 200;

export async function POST(request: NextRequest) {
  const actor = actorOf(request.headers);
  if (!actor) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!canManageSafety(request.headers)) return NextResponse.json({ ok: false, error: "Access denied." }, { status: 403 });

  let p: any;
  try { p = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  if (!p || typeof p !== "object") return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });

  const blockId = typeof p.block_id === "string" ? p.block_id.trim() : "";
  const block = getBlock(blockId);
  if (!block) return NextResponse.json({ ok: false, error: "unknown_block", detail: `No training block "${blockId}".` }, { status: 400 });
  if (!block.ready) return NextResponse.json({ ok: false, error: "block_not_ready", detail: `${block.id} is not available yet.` }, { status: 400 });

  const completedOn = p.completed_on;
  if (!isValidYmd(completedOn)) return NextResponse.json({ ok: false, error: "invalid_date", detail: "completed_on must be YYYY-MM-DD." }, { status: 400 });
  if (completedOn > etToday()) return NextResponse.json({ ok: false, error: "future_date", detail: "completed_on cannot be in the future." }, { status: 400 });

  if (!Array.isArray(p.user_ids) || p.user_ids.length < 1 || p.user_ids.length > MAX_USERS ||
      !p.user_ids.every((u: unknown) => typeof u === "string" && u.trim() !== "")) {
    return NextResponse.json({ ok: false, error: "invalid_user_ids", detail: `user_ids must be 1–${MAX_USERS} ids.` }, { status: 400 });
  }
  const userIds: string[] = p.user_ids.map((u: string) => u.trim());
  if (new Set(userIds).size !== userIds.length) {
    const dupes = Array.from(new Set(userIds.filter((u, i) => userIds.indexOf(u) !== i)));
    return NextResponse.json({ ok: false, error: "duplicate_user_ids", bad_ids: dupes }, { status: 400 });
  }

  if (p.note !== undefined && p.note !== null && typeof p.note !== "string") {
    return NextResponse.json({ ok: false, error: "invalid_note" }, { status: 400 });
  }
  const note = typeof p.note === "string" && p.note.trim() ? p.note.trim().slice(0, MAX_NOTE) : null;

  try {
    const { DB } = await getEnv();
    const trainees = new Map((await listTrainees(DB)).map((t) => [t.user_id, t]));
    const bad = userIds.filter((u) => !trainees.has(u));
    if (bad.length) {
      return NextResponse.json({ ok: false, error: "not_trainees", detail: "Not active trainees.", bad_ids: bad }, { status: 400 });
    }

    // No `IN (…ids)`: D1 caps bound parameters at 100 per statement and user_ids may hold 200.
    const existing = await DB.prepare(
      `SELECT DISTINCT user_id FROM safety_training_completions
        WHERE block_id = ? AND completed_on = ? AND voided_at IS NULL`
    ).bind(block.id, completedOn).all<{ user_id: string }>();
    const have = new Set((existing.results ?? []).map((r) => r.user_id));

    const skipped = userIds.filter((u) => have.has(u)).map((u) => ({ user_id: u, name: trainees.get(u)!.name }));
    const toRecord = userIds.filter((u) => !have.has(u));

    if (toRecord.length) {
      await DB.batch(
        toRecord.map((u) =>
          insertCompletionStmt(DB, {
            id: crypto.randomUUID(), user_id: u, user_name: trainees.get(u)!.name, block_id: block.id,
            completed_on: completedOn, source: "group", recorded_by_id: actor.id, recorded_by_name: actor.name, note,
          })
        )
      );
      await logActivity(
        DB, "create", "safety_training", block.id,
        `Group sign-off: Block ${block.n} — ${block.titleEn} on ${completedOn} for ${toRecord.length} ${toRecord.length === 1 ? "person" : "people"}`,
        { block_id: block.id, completed_on: completedOn, recorded: toRecord.length, skipped: skipped.length, user_ids: toRecord, note },
        actor.id
      );
    }
    return NextResponse.json({ ok: true, recorded: toRecord.length, skipped });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
