// src/app/api/orders/[id]/route.ts  →  PUT /v2/api/orders/:id
// P439 — in-place edit of an existing job from /v2/board's new OrderEditModal (Edit button).
// Mirrors the legacy /api/jobs PUT (`_worker.js/routes/jobs.js` lines 575–860) but deliberately
// scoped down: NO trailer_group_id, archived_at, packing_slip_pdf/key, or processes writes
// (out of scope for the v2 modal — trailer linking + packing-slip upload + cutting pills
// stay in their existing surfaces). Replaces line_items wholesale (DELETE + reinsert, same
// as legacy), recomputes HB chunks, reconciles loading_assignments to load_count (skipped for
// customer pickup), and sets ship_to_verified = "unverified" whenever any ship-to field is
// in the payload. Activity log mirrors the v2 board PUT (entity_type=job, action=update).
// Status guard mirrors the existing /v2/api/board/:id PUT rule — loading/shipped jobs can't
// change status away from themselves. Middleware auto-gates this on `orders` (view/edit);
// no new permission key.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { computeAndPersistHoleyChunks } from "@/lib/holeyChunks";

const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const STATUSES = ["not_started", "in_production", "done", "loading", "shipped"];
const PRIORITIES = ["normal", "rush"];
const SOURCES = ["manual", "packing_slip"];
// Fields the legacy PUT allows as free-text columns. `packing_slip_filename` +
// `packing_slip_invoice` are intentionally excluded here — the modal does not upload a
// packing slip, and packing_slip_pdf/key are out of scope per the prompt.
const TEXT_FIELDS = [
  "customer", "po_number", "invoice_number", "ship_date", "ship_day",
  "location", "delivery_time", "carrier", "scrap_pickup",
  "sales_lead", "bol_info", "payment_info", "notes",
  "cutting_instructions", "packing_instructions", "contact_name", "contact_phone",
  "ship_to_company", "ship_to_attention", "ship_to_street", "ship_to_street2",
  "ship_to_city", "ship_to_state", "ship_to_zip",
];
// Any of these in the payload flips ship_to_verified back to "unverified" (mirrors legacy
// PUT jobs.js:715 behavior).
const SHIP_TO_FIELDS = [
  "ship_to_company", "ship_to_attention", "ship_to_street", "ship_to_street2",
  "ship_to_city", "ship_to_state", "ship_to_zip",
];

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let p: any;
  try { p = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }

  // Verify the job exists (and not archived). Same 404/400 contract as /v2/api/board/:id.
  const existing = await DB.prepare(
    "SELECT id, status, archived_at, method FROM jobs WHERE id = ?"
  ).bind(id).first<any>();
  if (!existing) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  if (existing.archived_at) {
    return NextResponse.json({ ok: false, error: "Job is archived." }, { status: 400 });
  }

  const sets: string[] = [];
  const binds: any[] = [];
  const s = (v: any) => String(v ?? "").trim();

  // status — validate + apply the same loading/shipped self-lock the /v2/api/board/:id PUT
  // already enforces. (The prompt's "loading/shipped lock" rule.)
  if ("status" in p) {
    const v = s(p.status);
    if (!STATUSES.includes(v)) return NextResponse.json({ ok: false, error: "Invalid status." }, { status: 400 });
    if ((existing.status === "shipped" || existing.status === "loading") && v !== existing.status) {
      return NextResponse.json(
        { ok: false, error: "Can't change a loading/shipped job from the board." },
        { status: 400 }
      );
    }
    sets.push("status = ?"); binds.push(v);
  }

  if ("priority" in p) {
    const v = s(p.priority);
    if (!PRIORITIES.includes(v)) return NextResponse.json({ ok: false, error: "Invalid priority." }, { status: 400 });
    sets.push("priority = ?"); binds.push(v);
  }
  if ("priority_level" in p) {
    const n = Number(p.priority_level);
    if (!Number.isInteger(n) || n < 0 || n > 3) {
      return NextResponse.json({ ok: false, error: "Invalid priority level." }, { status: 400 });
    }
    sets.push("priority_level = ?"); binds.push(n);
  }

  // Free-text columns (validated via legacy allowlist + ship_date format check).
  if ("ship_date" in p) {
    const v = s(p.ship_date);
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      return NextResponse.json({ ok: false, error: "Invalid ship_date. Use YYYY-MM-DD." }, { status: 400 });
    }
    sets.push("ship_date = ?"); binds.push(v);
  }
  for (const f of TEXT_FIELDS) {
    if (f === "ship_date") continue; // already handled above
    if (f in p) { sets.push(`${f} = ?`); binds.push(s(p[f])); }
  }

  // Numeric coercion — mirror legacy defaults (load_count defaults to 1, total_bdft to 0).
  if ("load_count" in p) {
    sets.push("load_count = ?");
    binds.push(Number.isFinite(Number(p.load_count)) ? Number(p.load_count) : 1);
  }
  if ("total_bdft" in p) {
    sets.push("total_bdft = ?");
    binds.push(Number.isFinite(Number(p.total_bdft)) ? Number(p.total_bdft) : 0);
  }

  if ("confirmed_to_ship" in p) {
    sets.push("confirmed_to_ship = ?"); binds.push(p.confirmed_to_ship ? 1 : 0);
  }
  if ("source" in p) {
    const v = s(p.source);
    if (!SOURCES.includes(v)) return NextResponse.json({ ok: false, error: "Invalid source." }, { status: 400 });
    sets.push("source = ?"); binds.push(v);
  }

  // Ship-to changed → mark unverified (mirrors legacy PUT jobs.js:715). Deliberately does
  // NOT touch ship_to_standardized or ship_to_verified_at — the modal doesn't expose Lob
  // verification, so we just invalidate the badge.
  if (SHIP_TO_FIELDS.some((f) => f in p)) {
    sets.push("ship_to_verified = ?"); binds.push("unverified");
  }

  if (
    sets.length === 0
    && !Array.isArray(p.line_items)
    && !("load_count" in p)
  ) {
    return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
  }

  // If only line_items / load_count was sent (no column updates), still bump updated_at so
  // the row's activity-log timestamp tracks the save.
  if (sets.length === 0) sets.push("updated_at = ?"), binds.push(now());
  else sets.push("updated_at = ?"), binds.push(now());

  try {
    // Persist main jobs row.
    await DB.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id).run();

    // Replace line items wholesale (mirrors legacy jobs.js:800–818).
    let replacedLineItems = false;
    if (Array.isArray(p.line_items)) {
      replacedLineItems = true;
      await DB.prepare("DELETE FROM job_line_items WHERE job_id = ?").bind(id).run();
      for (let i = 0; i < p.line_items.length; i++) {
        const li = p.line_items[i] ?? {};
        await DB.prepare(`
          INSERT INTO job_line_items (id, job_id, part_id, part_number, description, quantity, dimensions, density, sort_order)
          VALUES (?,?,?,?,?,?,?,?,?)
        `).bind(
          crypto.randomUUID(), id,
          li.part_id ? s(li.part_id) : null,
          s(li.part_number), s(li.description),
          Number.isFinite(Number(li.quantity)) ? Number(li.quantity) : 0,
          s(li.dimensions), li.density ? s(li.density) : null, i,
        ).run();
      }
    }

    // Reconcile loading_assignments to the new load_count (skip customer pickup — mirrors
    // legacy jobs.js:820–861). Best-effort; a reconcile failure never fails the PUT.
    if ("load_count" in p) {
      try {
        const isPickup = (existing.method || "").toLowerCase() === "customer pickup";
        if (!isPickup) {
          const target = Math.max(Number(p.load_count) || 1, 1);
          const curRow = await DB.prepare(
            "SELECT COUNT(*) AS cnt FROM loading_assignments WHERE job_id = ?"
          ).bind(id).first<any>();
          const current = Number(curRow?.cnt || 0);
          if (target > current) {
            const nowR = now();
            for (let n = current + 1; n <= target; n++) {
              await DB.prepare(`
                INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
                VALUES (?, ?, NULL, '', 'awaiting', NULL, '', ?, ?, ?)
              `).bind(crypto.randomUUID(), id, n, nowR, nowR).run();
            }
          } else if (target < current) {
            const surplus = current - target;
            const safe = await DB.prepare(`
              SELECT la.id FROM loading_assignments la
               WHERE la.job_id = ?
                 AND la.loading_status = 'awaiting'
                 AND la.bay_id IS NULL
                 AND COALESCE(la.trailer_number, '') = ''
                 AND NOT EXISTS (SELECT 1 FROM loading_photos lp WHERE lp.assignment_id = la.id)
               ORDER BY la.load_number DESC, la.created_at DESC
               LIMIT ?
            `).bind(id, surplus).all<any>();
            for (const r of (safe?.results || [])) {
              await DB.prepare("DELETE FROM loading_assignments WHERE id = ?").bind(r.id).run();
            }
          }
        }
      } catch (e: any) {
        console.error("Load count reconcile failed:", String(e?.message || e));
      }
    }

    // Recompute HB chunks if line items were replaced (mirrors P438 + legacy). Best-effort.
    if (replacedLineItems) {
      try {
        await computeAndPersistHoleyChunks(DB, id);
      } catch (e: any) {
        console.error("computeAndPersistHoleyChunks failed:", String(e?.message || e));
      }
    }

    // Activity log — same live schema as the v2 board PUT (cutting-pilot/src/app/api/board/[id]/route.ts
    // lines 80–92). via: "board-edit" so the audit trail distinguishes modal saves from the
    // quick-edit board PUT.
    try {
      const ts = now();
      const fields = Object.keys(p).filter((k) => k !== "id");
      await DB.prepare(
        `INSERT INTO activity_log
           (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
         VALUES (?, ?, 'update', 'job', ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), ts, id,
        `Order updated via v2 board (${fields.join(", ")})`,
        JSON.stringify({ via: "board-edit", fields }),
        actorId, ts,
      ).run();
    } catch (e: any) { console.error("activity_log failed:", String(e?.message || e)); }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
