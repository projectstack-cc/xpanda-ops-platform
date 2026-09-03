// src/app/api/orders/[id]/shifts/[shift]/route.ts  →  DELETE /v2/api/orders/:id/shifts/:shift
// P439 — v2 mirror of the legacy DELETE branch in /api/jobs/:id/shifts
// (_worker.js/routes/jobs.js lines 194–200). Same manager gate (X-User-Is-Admin OR
// X-User-Permissions["jobs.manage"]?.edit). Imports the params Promise-style to match the
// other v2 routes (see cutting-pilot/src/app/api/board/[id]/route.ts line 11).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const VALID_SHIFTS = ["1st", "2nd", "3rd"];

function isManager(request: NextRequest): boolean {
  if (request.headers.get("X-User-Is-Admin") === "1") return true;
  let perms: any = {};
  try { perms = JSON.parse(request.headers.get("X-User-Permissions") || "{}"); } catch {}
  return !!(perms["jobs.manage"]?.edit);
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string; shift: string }> }) {
  const { id, shift } = await ctx.params;
  const { DB } = await getEnv();
  if (!isManager(request)) {
    return NextResponse.json(
      { ok: false, error: "Manager access required to assign production." },
      { status: 403 }
    );
  }
  const actorId = request.headers.get("X-User-Id") || "";
  if (!VALID_SHIFTS.includes(shift)) {
    return NextResponse.json({ ok: false, error: "shift must be one of 1st, 2nd, 3rd" }, { status: 400 });
  }
  try {
    await DB.prepare(
      "DELETE FROM job_shifts WHERE job_id = ? AND shift = ?"
    ).bind(id, shift).run();
    try {
      const ts = now();
      await DB.prepare(
        `INSERT INTO activity_log
           (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
         VALUES (?, ?, 'unassign_shift', 'job', ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), ts, id,
        `Unassigned ${shift} shift`,
        JSON.stringify({ shift, via: "v2-board-edit" }),
        actorId, ts,
      ).run();
    } catch (e: any) { console.error("activity_log failed:", String(e?.message || e)); }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
