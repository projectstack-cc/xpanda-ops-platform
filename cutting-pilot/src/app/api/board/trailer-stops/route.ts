// src/app/api/board/trailer-stops/route.ts  →  PUT /v2/api/board/trailer-stops
// stops-01 — sets a whole trailer group's stop order in one call:
//   body { group_id, stops: { [jobId]: number | null } }
// One call per group so a 1↔2 swap never passes through a duplicate. Writes jobs.trailer_stop and
// the copy on every one of the job's BOLs (bols.trailer_stop — invariant: always equals its job's)
// in one D1 batch. Gated on `jobs` by the existing /v2/api/board middleware row (mutation → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { validateStops, type TrailerStopMember } from "@/lib/trailerStops";

export async function PUT(request: NextRequest) {
  const actorId = request.headers.get("X-User-Id") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let p: any;
  try { p = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const groupId = String(p?.group_id ?? "").trim();
  if (!groupId) return NextResponse.json({ ok: false, error: "group_id is required." }, { status: 400 });
  const stops = p?.stops;

  const { DB } = await getEnv();
  try {
    const res = await DB.prepare(
      "SELECT id, status, archived_at, trailer_stop FROM jobs WHERE trailer_group_id = ?"
    ).bind(groupId).all<TrailerStopMember>();
    const members = (res.results ?? []) as TrailerStopMember[];
    if (members.length === 0) {
      return NextResponse.json({ ok: false, error: "That trailer group no longer exists." }, { status: 404 });
    }

    const v = validateStops(members, stops);
    if (!v.ok) return NextResponse.json({ ok: false, error: v.error }, { status: v.status });

    const now = new Date().toISOString();
    const before: Record<string, number | null> = {};
    const after: Record<string, number | null> = {};
    const stmts = [];
    for (const m of members) {
      if (!(m.id in stops)) continue;
      const next = stops[m.id] === null ? null : Number(stops[m.id]);
      const prev = m.trailer_stop ?? null;
      if (prev === next) continue;
      before[m.id] = prev;
      after[m.id] = next;
      stmts.push(DB.prepare("UPDATE jobs SET trailer_stop = ?, updated_at = ? WHERE id = ?").bind(next, now, m.id));
      stmts.push(DB.prepare("UPDATE bols SET trailer_stop = ? WHERE job_id = ?").bind(next, m.id));
    }

    if (stmts.length) {
      await DB.batch(stmts);
      await logActivity(
        DB, "update", "trailer_group", groupId,
        `Set trailer stop order (${Object.keys(after).length} order${Object.keys(after).length === 1 ? "" : "s"})`,
        { group_id: groupId, before, after },
        actorId
      );
    }

    const saved: Record<string, number | null> = {};
    for (const m of members) saved[m.id] = m.id in after ? after[m.id] : (m.trailer_stop ?? null);
    return NextResponse.json({ ok: true, stops: saved });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
