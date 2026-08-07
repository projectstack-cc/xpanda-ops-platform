// src/app/api/board/[id]/route.ts  →  PUT /v2/api/board/:id
// Board inline-edit: updates ONLY ship_date, priority(+level), notes, status on jobs.
// Everything else on the order is edited in /v2/orders. Gated on `jobs` (edit, via the
// existing /v2/api/board middleware prefix from P341 — no new permission key).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const STATUSES = ["not_started", "in_production", "done", "loading", "shipped"];

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  try {
    const job = await DB.prepare(`
      SELECT id, customer, invoice_number, status, ship_date, carrier,
             ship_to_company, ship_to_attention, ship_to_street, ship_to_street2,
             ship_to_city, ship_to_state, ship_to_zip,
             (packing_slip_key IS NOT NULL OR packing_slip_pdf IS NOT NULL) AS has_packing_slip
        FROM jobs WHERE id = ?
    `).bind(id).first<any>();
    if (!job) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    const li = await DB.prepare(`
      SELECT part_number, description, quantity, dimensions, density
        FROM job_line_items WHERE job_id = ? ORDER BY sort_order ASC
    `).bind(id).all();
    return NextResponse.json({
      ok: true,
      job: { ...job, has_packing_slip: !!job.has_packing_slip },
      line_items: li.results ?? [],
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let p: any;
  try { p = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  const sets: string[] = [];
  const binds: any[] = [];
  const s = (v: any) => String(v ?? "").trim();

  if ("ship_date" in p) { sets.push("ship_date = ?"); binds.push(s(p.ship_date)); }
  if ("notes" in p)     { sets.push("notes = ?");     binds.push(s(p.notes)); }
  if ("priority" in p)  { sets.push("priority = ?");  binds.push(s(p.priority)); }
  if ("priority_level" in p) {
    const n = Number(p.priority_level);
    sets.push("priority_level = ?"); binds.push(Number.isFinite(n) ? n : 0);
  }
  if ("status" in p) {
    const v = s(p.status);
    if (!STATUSES.includes(v)) return NextResponse.json({ ok: false, error: "Invalid status." }, { status: 400 });
    // Guard: don't let the board downgrade a job out of a terminal/loading state. This is a
    // deliberately narrower rule than the legacy PUT /api/jobs (which allows any of the 5
    // states unconditionally on that endpoint) — the board's editable subset is intentionally
    // conservative per the locked scoping; full status control stays in the legacy/job-detail flow.
    const cur = await DB.prepare("SELECT status, archived_at FROM jobs WHERE id = ?").bind(id).first<any>();
    if (!cur) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
    if (cur.archived_at) return NextResponse.json({ ok: false, error: "Job is archived." }, { status: 400 });
    if ((cur.status === "shipped" || cur.status === "loading") && v !== cur.status) {
      return NextResponse.json({ ok: false, error: "Can't change a loading/shipped job from the board." }, { status: 400 });
    }
    sets.push("status = ?"); binds.push(v);
  }

  if (!sets.length) return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
  sets.push("updated_at = ?"); binds.push(now());

  try {
    await DB.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id).run();
    // Activity log — same live schema as P338/P341's writes:
    // (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at).
    try {
      const ts = now();
      await DB.prepare(
        `INSERT INTO activity_log
           (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
         VALUES (?, ?, 'update', 'job', ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), ts, id,
        `Job updated via board (${Object.keys(p).join(", ")})`,
        JSON.stringify({ via: "board", fields: Object.keys(p) }),
        actorId, ts,
      ).run();
    } catch (e: any) { console.error("activity_log failed:", String(e?.message || e)); }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
