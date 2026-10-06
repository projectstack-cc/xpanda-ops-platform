// src/app/api/shipments/[id]/load-days/route.ts  ->  PUT /v2/api/shipments/:id/load-days
// split-days-01: per-load ship-day assignment for a split shipment (v2 port of legacy P318's
// /api/loading-assignments/load-days). Writes loading_assignments.ship_date only -- jobs.ship_date and
// shipments.ship_date stay the order's default day for loads without their own.
// Gated on logistics.dashboard by middleware (the /v2/api/shipments prefix); the write itself requires
// X-User-Can-Manage-Loading (logistics.loading.manage), same key as legacy.
//
// Unlike legacy (which silently succeeds on 0 matched rows), a requested load with no loading_assignments
// row is a 409 and nothing is written. Rows are never INSERTed here: customer pickups deliberately have
// none, and a fresh awaiting row would feed the dock queue.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { V2_LOGISTICS_WRITES_ENABLED } from "@/lib/logistics/writeFence";
import { logActivity } from "@/lib/activityLog";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Fence check FIRST -- before any D1 read/write.
  if (!V2_LOGISTICS_WRITES_ENABLED) {
    return NextResponse.json(
      { ok: false, error: "v2 logistics writes disabled (read-only migration phase)" },
      { status: 501 }
    );
  }
  if (request.headers.get("X-User-Can-Manage-Loading") !== "1") {
    return NextResponse.json({ ok: false, error: "Manager access required to assign ship days." }, { status: 403 });
  }

  const { id: shipmentId } = await ctx.params;

  try {
    const { DB } = await getEnv();

    let payload: any;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const shipment = await DB.prepare("SELECT id, job_id FROM shipments WHERE id = ?")
      .bind(shipmentId)
      .first<{ id: string; job_id: string | null }>();
    if (!shipment) return NextResponse.json({ ok: false, error: "Shipment not found." }, { status: 404 });
    const jobId = shipment.job_id;
    if (!jobId) return NextResponse.json({ ok: false, error: "Shipment is not linked to an order." }, { status: 400 });

    const job = await DB.prepare("SELECT id, method, load_count, archived_at FROM jobs WHERE id = ?")
      .bind(jobId)
      .first<{ id: string; method: string | null; load_count: number | null; archived_at: string | null }>();
    if (!job) return NextResponse.json({ ok: false, error: "Order not found." }, { status: 404 });
    if (job.archived_at) return NextResponse.json({ ok: false, error: "Order is archived." }, { status: 409 });
    if (String(job.method ?? "").trim().toLowerCase() === "customer pickup") {
      return NextResponse.json(
        { ok: false, error: "Customer pickups don't have loads to split.", code: "pickup_no_loads" },
        { status: 409 }
      );
    }

    const days = payload?.days;
    if (!Array.isArray(days) || days.length === 0) {
      return NextResponse.json({ ok: false, error: "days[] is required." }, { status: 400 });
    }
    const maxLoad = Math.max(Number(job.load_count) || 0, 1);
    const applied: Array<{ load_number: number; ship_date: string | null }> = [];
    const seen = new Set<number>();
    for (const d of days) {
      const ln = Number(d?.load_number);
      if (!Number.isInteger(ln) || ln < 1 || ln > maxLoad) {
        return NextResponse.json(
          { ok: false, error: `Invalid load number ${d?.load_number ?? "(missing)"} — must be 1–${maxLoad}.` },
          { status: 400 }
        );
      }
      if (seen.has(ln)) {
        return NextResponse.json({ ok: false, error: `Load ${ln} is listed more than once.` }, { status: 400 });
      }
      seen.add(ln);
      let sd: string | null = d?.ship_date == null ? null : String(d.ship_date).trim();
      if (sd === "") sd = null;
      if (sd !== null && !DAY_RE.test(sd)) {
        return NextResponse.json(
          { ok: false, error: `Invalid ship date for load ${ln}. Use YYYY-MM-DD.` },
          { status: 400 }
        );
      }
      applied.push({ load_number: ln, ship_date: sd });
    }

    const rowsRes = await DB.prepare(
      "SELECT id, load_number FROM loading_assignments WHERE job_id = ? AND loading_status <> 'archived'"
    )
      .bind(jobId)
      .all<{ id: string; load_number: number | null }>();
    const present = new Set((rowsRes.results ?? []).map((r) => Number(r.load_number)));
    const missing = applied.map((a) => a.load_number).filter((n) => !present.has(n));
    if (missing.length) {
      return NextResponse.json(
        {
          ok: false,
          error: `Loads ${missing.join(", ")} have no loading record — re-save the order's load count to rebuild them.`,
          code: "missing_load_rows",
          missing,
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    await DB.batch(
      applied.map((a) =>
        DB.prepare(
          "UPDATE loading_assignments SET ship_date = ?, updated_at = ? WHERE job_id = ? AND load_number = ? AND loading_status <> 'archived'"
        ).bind(a.ship_date, now, jobId, a.load_number)
      )
    );

    await logActivity(
      DB,
      "update",
      "loading_assignment",
      jobId,
      "Set per-load ship days (split shipment)",
      { job_id: jobId, shipment_id: shipmentId, days: applied },
      request.headers.get("X-User-Id")
    );

    return NextResponse.json({ ok: true, applied });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
