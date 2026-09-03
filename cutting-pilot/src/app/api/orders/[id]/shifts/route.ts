// src/app/api/orders/[id]/shifts/route.ts  →  GET/POST /v2/api/orders/:id/shifts
// P439 — v2 mirror of the legacy /api/jobs/:id/shifts block (_worker.js/routes/jobs.js
// lines 168–201). GET is ungated (read-only); POST is manager-gated on
// X-User-Is-Admin / X-User-Permissions (new header injected by middleware in P439). DELETE
// for the dynamic shift segment lives in the sibling route at
// src/app/api/orders/[id]/shifts/[shift]/route.ts (mirror of legacy parts[4] dispatch).
// Middleware auto-gates /v2/api/orders/* on the existing `orders` permission.
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

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  try {
    const rows = await DB.prepare(
      `SELECT shift FROM job_shifts WHERE job_id = ? ORDER BY shift`
    ).bind(id).all();
    return NextResponse.json({ ok: true, shifts: (rows.results ?? []).map((r: any) => r.shift) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  if (!isManager(request)) {
    return NextResponse.json(
      { ok: false, error: "Manager access required to assign production." },
      { status: 403 }
    );
  }
  const actorId = request.headers.get("X-User-Id") || "";

  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const shift = body?.shift;
  if (!VALID_SHIFTS.includes(shift)) {
    return NextResponse.json({ ok: false, error: "shift must be one of 1st, 2nd, 3rd" }, { status: 400 });
  }

  try {
    await DB.prepare(
      `INSERT OR IGNORE INTO job_shifts (id, job_id, shift, assigned_by, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).bind(crypto.randomUUID(), id, shift, actorId || null).run();

    try {
      const ts = now();
      await DB.prepare(
        `INSERT INTO activity_log
           (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
         VALUES (?, ?, 'assign_shift', 'job', ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), ts, id,
        `Assigned ${shift} shift`,
        JSON.stringify({ shift, via: "v2-board-edit" }),
        actorId, ts,
      ).run();
    } catch (e: any) { console.error("activity_log failed:", String(e?.message || e)); }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
