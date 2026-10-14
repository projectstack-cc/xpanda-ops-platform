// src/app/api/orders/[id]/load-times/route.ts  →  GET/PUT /v2/api/orders/:id/load-times
// dlv-03: per-load delivery times (job_load_times) for the order-entry / Job Board / logistics
// editors, and the BOL modal + shipment drill-down readers (dlv-04).
// Gate (middleware PATTERN_PERMISSION_MAP): GET is open to `orders` OR any logistics surface that
// reads it (dashboard, BOL, Load Builder, dock) — the prefix-only /v2/api/orders row would 403 a
// logistics-only role. PUT is re-checked here: `orders` edit (Job Board / order entry, the same as
// PUT /v2/api/orders/:id) OR `logistics.dashboard` edit (ShipmentEditModal, the shipment-edit gate).
// PUT writes source='manual'; `display` is always computed server-side with formatLoadTime. It does
// NOT touch BOLs — the BOL auto-update is sheet-driven only (dlv-02); manual times reach new BOLs
// through dlv-04's prefill. The sheet sync still overrides manual times on its next change.
import { NextResponse, type NextRequest } from "next/server";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { formatLoadTime, summarizeLoadTimes } from "@/lib/loadTimes";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);

interface LoadTimeRow {
  load_number: number;
  delivery_date: string | null;
  delivery_minutes: number | null;
  display: string;
  source: "sheet" | "manual";
  prev_display: string | null;
  changed_at: string | null;
  change_acked_at: string | null;
}

async function readPayload(DB: D1Database, id: string) {
  const job = await DB.prepare(`SELECT id, invoice_number, load_count, ship_date FROM jobs WHERE id = ?`)
    .bind(id)
    .first<{ id: string; invoice_number: string | null; load_count: number | null; ship_date: string | null }>();
  if (!job) return null;
  const times =
    (await DB.prepare(
      `SELECT load_number, delivery_date, delivery_minutes, display, source, prev_display, changed_at, change_acked_at
         FROM job_load_times WHERE job_id = ? ORDER BY load_number`
    ).bind(id).all<LoadTimeRow>()).results ?? [];
  // jb-03 "Assign Ship Days" per-load overrides — the editor's day default only.
  const days =
    (await DB.prepare(
      `SELECT load_number, ship_date FROM loading_assignments
        WHERE job_id = ? AND load_number IS NOT NULL AND ship_date IS NOT NULL AND ship_date <> ''`
    ).bind(id).all<{ load_number: number; ship_date: string }>()).results ?? [];
  const assigned_days: Record<number, string> = {};
  for (const d of days) if (DATE_RE.test(d.ship_date)) assigned_days[Number(d.load_number)] = d.ship_date;
  return {
    job,
    payload: {
      times,
      load_count: Math.max(Number(job.load_count) || 1, 1),
      ship_date: job.ship_date || null,
      assigned_days,
    },
  };
}

function canEdit(request: NextRequest): boolean {
  if (request.headers.get("X-User-Is-Admin") === "1") return true;
  let perms: any = {};
  try { perms = JSON.parse(request.headers.get("X-User-Permissions") || "{}"); } catch {}
  return !!(perms["orders"]?.edit || perms["logistics.dashboard"]?.edit);
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  try {
    const r = await readPayload(DB, id);
    if (!r) return NextResponse.json({ ok: false, error: "Order not found.", detail: `no job ${id}` }, { status: 404 });
    return NextResponse.json({ ok: true, ...r.payload });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Couldn't load delivery times.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  if (!canEdit(request)) {
    return NextResponse.json({ ok: false, error: "You don't have permission to edit delivery times." }, { status: 403 });
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
    const before = await readPayload(DB, id);
    if (!before) return NextResponse.json({ ok: false, error: "Order not found.", detail: `no job ${id}` }, { status: 404 });
    const loadCount = before.payload.load_count;

    // Validate everything before writing anything.
    const incoming = new Map<number, { date: string | null; minutes: number | null }>();
    for (const t of body.times) {
      const n = Number(t?.load_number);
      if (!Number.isInteger(n) || n < 1 || n > loadCount) {
        return NextResponse.json({ ok: false, error: `Load number must be 1–${loadCount}.`, detail: `load_number=${t?.load_number}` }, { status: 400 });
      }
      const m = t?.delivery_minutes;
      if (m != null && !(Number.isInteger(m) && m >= 0 && m <= 1439)) {
        return NextResponse.json({ ok: false, error: "Time must be between 12:00 AM and 11:59 PM.", detail: `delivery_minutes=${m}` }, { status: 400 });
      }
      const d = t?.delivery_date;
      if (d != null && !(typeof d === "string" && DATE_RE.test(d))) {
        return NextResponse.json({ ok: false, error: "Day must be a YYYY-MM-DD date.", detail: `delivery_date=${d}` }, { status: 400 });
      }
      incoming.set(n, { date: d ?? null, minutes: m ?? null });
    }

    const stored = new Map(before.payload.times.map((r) => [Number(r.load_number), r]));
    const stmts: D1PreparedStatement[] = [];
    const written: { load_number: number; display: string }[] = [];
    const deleted: number[] = [];
    for (const [n, v] of Array.from(incoming.entries())) {
      const cur = stored.get(n);
      if (v.date == null && v.minutes == null) {
        if (cur) {
          stmts.push(DB.prepare(`DELETE FROM job_load_times WHERE job_id = ? AND load_number = ?`).bind(id, n));
          deleted.push(n);
        }
        continue;
      }
      // Unchanged rows are left alone so a sheet-sourced row keeps its source + sheet_raw.
      if (cur && cur.delivery_date === v.date && cur.delivery_minutes === v.minutes) continue;
      const display = formatLoadTime(v.date, v.minutes);
      written.push({ load_number: n, display });
      stmts.push(
        DB.prepare(
          `INSERT INTO job_load_times (job_id, load_number, delivery_date, delivery_minutes, display, source, updated_at)
           VALUES (?, ?, ?, ?, ?, 'manual', datetime('now'))
           ON CONFLICT(job_id, load_number) DO UPDATE SET
             delivery_date = excluded.delivery_date, delivery_minutes = excluded.delivery_minutes,
             display = excluded.display, source = 'manual', updated_at = datetime('now')`
        ).bind(id, n, v.date, v.minutes, display)
      );
    }
    const overflow = before.payload.times.filter((r) => Number(r.load_number) > loadCount).map((r) => Number(r.load_number));
    if (overflow.length) {
      stmts.push(DB.prepare(`DELETE FROM job_load_times WHERE job_id = ? AND load_number > ?`).bind(id, loadCount));
      deleted.push(...overflow);
    }

    if (stmts.length) {
      await DB.batch(stmts);
      // Mirror the summary onto the single-field surfaces, same as the dlv-02 sheet sync.
      const rows =
        (await DB.prepare(
          `SELECT load_number, delivery_date AS date, delivery_minutes AS minutes, display FROM job_load_times WHERE job_id = ?`
        ).bind(id).all<{ load_number: number; date: string | null; minutes: number | null; display: string }>()).results ?? [];
      const summary = summarizeLoadTimes(rows);
      await DB.batch([
        DB.prepare(`UPDATE jobs SET delivery_time = ?, updated_at = ? WHERE id = ?`).bind(summary, now(), id),
        DB.prepare(`UPDATE shipments SET delivery_time = ? WHERE job_id = ? AND direction = 'outbound'`).bind(summary, id),
      ]);
      await logActivity(
        DB, "update", "job", id,
        `${actorName || "Someone"} set delivery times — INV ${before.job.invoice_number || "?"}: ${summary || "(cleared)"}`,
        { delivery_time: summary, loads_written: written, loads_cleared: deleted, via: "load-times" },
        actorId || null,
      );
    }

    const after = await readPayload(DB, id);
    return NextResponse.json({ ok: true, ...(after ? after.payload : before.payload) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Couldn't save delivery times.", detail: String(e?.message || e) }, { status: 500 });
  }
}
