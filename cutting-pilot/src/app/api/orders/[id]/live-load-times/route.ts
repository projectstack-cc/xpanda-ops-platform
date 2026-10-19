// src/app/api/orders/[id]/live-load-times/route.ts  →  GET/PUT /v2/api/orders/:id/live-load-times
// live-03: per-load Live Load arrival time — when the third-party driver arrives at OUR dock (not the
// customer delivery time). Own table, job_live_load_times: the dlv-02 sheet sync rewrites
// job_load_times rows, which would wipe a column parked there. Modeled on load-carriers.
// Gate (middleware PATTERN_PERMISSION_MAP): GET = the load-carriers readers. PUT is re-checked here:
// `logistics.dashboard` edit or admin — only logistics sets it (the v2 Logistics edit modal).
// PUT takes one entry per load the editor shows; arrive_minutes null deletes that load's row.
import { NextResponse, type NextRequest } from "next/server";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { formatLoadTime } from "@/lib/loadTimes";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface LiveLoadTimeRow {
  load_number: number;
  arrive_date: string | null;
  arrive_minutes: number;
  display: string;
}

function canEdit(request: NextRequest): boolean {
  if (request.headers.get("X-User-Is-Admin") === "1") return true;
  let perms: any = {};
  try { perms = JSON.parse(request.headers.get("X-User-Permissions") || "{}"); } catch {}
  return !!perms["logistics.dashboard"]?.edit;
}

// null when the job doesn't exist.
async function readLiveLoadTimes(DB: D1Database, jobId: string) {
  const job = await DB.prepare(`SELECT load_count FROM jobs WHERE id = ?`).bind(jobId).first<{ load_count: number | null }>();
  if (!job) return null;
  const loadCount = Math.max(Number(job.load_count) || 1, 1);
  const rows =
    (await DB.prepare(
      `SELECT load_number, arrive_date, arrive_minutes, display FROM job_live_load_times
        WHERE job_id = ? AND load_number <= ? ORDER BY load_number`
    ).bind(jobId, loadCount).all<LiveLoadTimeRow>()).results ?? [];
  return {
    load_count: loadCount,
    times: rows.map((r) => ({
      load_number: Number(r.load_number),
      arrive_date: r.arrive_date ?? null,
      arrive_minutes: Number(r.arrive_minutes),
      display: r.display ?? "",
    })),
  };
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  try {
    const payload = await readLiveLoadTimes(DB, id);
    if (!payload) return NextResponse.json({ ok: false, error: "Order not found.", detail: `no job ${id}` }, { status: 404 });
    return NextResponse.json({ ok: true, ...payload });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Couldn't load live load times.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  if (!canEdit(request)) {
    return NextResponse.json({ ok: false, error: "You don't have permission to edit live load times." }, { status: 403 });
  }
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || "";

  let body: any;
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  if (!Array.isArray(body?.times)) {
    return NextResponse.json({ ok: false, error: "times must be an array.", detail: "body.times" }, { status: 400 });
  }

  try {
    const before = await readLiveLoadTimes(DB, id);
    if (!before) return NextResponse.json({ ok: false, error: "Order not found.", detail: `no job ${id}` }, { status: 404 });
    const loadCount = before.load_count;

    // Validate everything before writing anything.
    const incoming = new Map<number, { date: string | null; minutes: number | null }>();
    for (const t of body.times) {
      const n = Number(t?.load_number);
      if (!Number.isInteger(n) || n < 1 || n > loadCount) {
        return NextResponse.json({ ok: false, error: `Load number must be 1–${loadCount}.`, detail: `load_number=${t?.load_number}` }, { status: 400 });
      }
      const minutes = t?.arrive_minutes == null ? null : Number(t.arrive_minutes);
      if (minutes != null && (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439)) {
        return NextResponse.json({ ok: false, error: "Arrival time must be between 12:00 AM and 11:59 PM.", detail: `load ${n}: arrive_minutes=${t?.arrive_minutes}` }, { status: 400 });
      }
      const date = t?.arrive_date == null || t.arrive_date === "" ? null : String(t.arrive_date);
      if (date != null && !DATE_RE.test(date)) {
        return NextResponse.json({ ok: false, error: "Arrival date must be YYYY-MM-DD.", detail: `load ${n}: arrive_date=${t?.arrive_date}` }, { status: 400 });
      }
      incoming.set(n, { date, minutes });
    }

    const old = new Map(before.times.map((r) => [r.load_number, r]));
    const stmts: D1PreparedStatement[] = [];
    const changed: { load_number: number; from: string | null; to: string | null }[] = [];
    for (const [n, { date, minutes }] of Array.from(incoming.entries())) {
      const prev = old.get(n) ?? null;
      if (minutes == null) {
        if (prev) {
          stmts.push(DB.prepare(`DELETE FROM job_live_load_times WHERE job_id = ? AND load_number = ?`).bind(id, n));
          changed.push({ load_number: n, from: prev.display, to: null });
        }
        continue;
      }
      const display = formatLoadTime(date, minutes);
      if (prev && prev.arrive_date === date && prev.arrive_minutes === minutes && prev.display === display) continue;
      stmts.push(
        DB.prepare(
          `INSERT INTO job_live_load_times (job_id, load_number, arrive_date, arrive_minutes, display, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, datetime('now'), ?)
           ON CONFLICT(job_id, load_number) DO UPDATE SET
             arrive_date = excluded.arrive_date, arrive_minutes = excluded.arrive_minutes, display = excluded.display,
             updated_at = datetime('now'), updated_by = excluded.updated_by`
        ).bind(id, n, date, minutes, display, actorId || null)
      );
      changed.push({ load_number: n, from: prev?.display ?? null, to: display });
    }
    // Rows beyond load_count are invisible to readers; drop them now (also keeps the batch non-empty).
    stmts.push(DB.prepare(`DELETE FROM job_live_load_times WHERE job_id = ? AND load_number > ?`).bind(id, loadCount));
    await DB.batch(stmts);

    const after = (await readLiveLoadTimes(DB, id)) ?? before;
    if (changed.length) {
      const parts = changed.map((c) => `L${c.load_number} ${c.to || "(cleared)"}`);
      await logActivity(
        DB, "update", "job", id,
        `${actorName || "Someone"} set live load arrival: ${parts.join(", ")}`,
        { changed, via: "live-load-times" },
        actorId || null,
      );
    }
    return NextResponse.json({ ok: true, ...after });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Couldn't save live load times.", detail: String(e?.message || e) }, { status: 500 });
  }
}
