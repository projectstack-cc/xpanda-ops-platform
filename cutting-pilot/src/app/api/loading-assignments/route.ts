// src/app/api/loading-assignments/route.ts  ->  /v2/api/loading-assignments
//
// GET  ?job_id=    -> minimal per-job shape for BOL viewer/generate enrichment (unit 2;
//                     bol-lock-01 adds loading_status for the per-load BOL edit lock).
//                     Deliberately skips the backfill side effect below (unit 2's
//                     original note: a read-only utility shouldn't gain a new write path).
// GET  (no job_id) -> board-level list for the dock dashboard (unit 3b). Mirrors legacy's
//                     handleApiLoadingAssignments GET branch (_worker.js/routes/loading.js)
//                     exactly, INCLUDING its backfill-on-read side effect (auto-creates
//                     'awaiting' rows for done/loading jobs missing them) -- this is the direct
//                     successor of legacy's dashboard load, which runs that backfill.
// POST             -> pull a job onto the board (adopt-first + load_count-gated create).
//                     Manager-only (logistics.loading.manage edit).
// PUT              -> field-by-field partial update -- only fields present in the payload are
//                     touched, matching legacy's contract exactly. Manager-only sub-actions
//                     (bay assignment, yard, in-transit, revert, trailer-# edit) enforced
//                     server-side via X-User-Can-Manage-Loading (checked directly here,
//                     defense-in-depth -- same pattern as X-User-Can-Manage-Cutting elsewhere
//                     in v2; middleware already gates the whole prefix on logistics.loading).
//
// Push notification dispatch IS ported (dock-01): POST new-assignment -> loading.assigned, PUT
// status transitions -> loading.started/loaded/in_transit/delivered, via src/lib/push.ts, same
// strings as legacy; a dispatch failure never fails the write.
// Deliberately NOT ported: the `load-days` per-load-ship-date sub-route (used by the Job Board's split-shipment UI, not by
// logistics/loading.html's dock dashboard -- confirmed zero call sites here across all 13 legacy
// PUT sites), and DELETE (no call site in the dock dashboard either -- archive uses PUT
// loading_status='archived').
//
// Writes are LIVE. Unit 3a's preview bindings make `wrangler dev` land on scratch D1, never prod.
import { NextResponse, type NextRequest } from "next/server";
import type { D1Database } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { dispatchNotification } from "@/lib/push";

const LOADING_FLOW = ["awaiting", "not_started", "loading", "loaded", "in_transit", "delivered"];

// Legacy's PUT status -> notification type map (_worker.js/routes/loading.js).
const LOADING_NOTIF_TYPES: Record<string, string> = {
  loading: "loading.started",
  loaded: "loading.loaded",
  in_transit: "loading.in_transit",
  delivered: "loading.delivered",
};

async function notifyLoading(
  db: D1Database,
  type: string,
  title: string,
  message: string,
  assignmentId: string
): Promise<void> {
  try {
    const { env } = await getCloudflareContext();
    await dispatchNotification(db, env as any, type, title, message, "loading_assignment", assignmentId);
  } catch (e) {
    console.error("Loading notification dispatch failed (non-fatal):", String((e as any)?.message || e));
  }
}

async function syncShipmentStatus(db: D1Database, jobId: string, status: string): Promise<void> {
  try {
    const shipment = await db
      .prepare("SELECT id FROM shipments WHERE job_id = ? AND direction = 'outbound' LIMIT 1")
      .bind(jobId)
      .first<{ id: string }>();
    if (shipment) {
      await db
        .prepare("UPDATE shipments SET status = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(status, shipment.id)
        .run();
    }
  } catch (e) {
    console.error("Shipment status sync failed:", e);
  }
}

export async function GET(request: NextRequest) {
  const { DB } = await getEnv();
  const url = new URL(request.url);
  const jobId = url.searchParams.get("job_id");

  if (jobId) {
    try {
      const rows = await DB.prepare(
        `SELECT id, job_id, load_number, trailer_number, ship_date AS load_ship_date, loading_status
           FROM loading_assignments
          WHERE job_id = ?
          ORDER BY load_number ASC`
      )
        .bind(jobId)
        .all();
      return NextResponse.json({ ok: true, assignments: rows.results ?? [] });
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: "Server error.", detail: String(e?.message || e) },
        { status: 500 }
      );
    }
  }

  try {
    const backfillJobs = await DB.prepare(
      `SELECT j.id, j.load_count,
         (SELECT COUNT(*) FROM loading_assignments la WHERE la.job_id = j.id) AS existing_count
       FROM jobs j
       WHERE j.status IN ('done', 'loading')
         AND COALESCE(j.method, '') != 'customer pickup'
         AND (SELECT COUNT(*) FROM loading_assignments la WHERE la.job_id = j.id) < CASE WHEN j.load_count > 1 THEN j.load_count ELSE 1 END`
    ).all<{ id: string; load_count: number | null; existing_count: number }>();
    const backfill = backfillJobs.results ?? [];
    if (backfill.length > 0) {
      const now = new Date().toISOString();
      for (const bj of backfill) {
        const targetCount = Math.max(bj.load_count || 1, 1);
        for (let n = bj.existing_count + 1; n <= targetCount; n++) {
          await DB.prepare(
            `INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
             VALUES (?, ?, NULL, '', 'awaiting', NULL, '', ?, ?, ?)`
          )
            .bind(crypto.randomUUID(), bj.id, n, now, now)
            .run();
        }
      }
    }
  } catch (e) {
    console.error("Loading assignment backfill failed:", e);
  }

  try {
    const includeArchived = url.searchParams.get("include_archived") === "1";
    const bayId = url.searchParams.get("bay_id") || "";

    let query = `
      SELECT la.*, la.ship_date AS load_ship_date, j.customer, j.invoice_number, j.po_number, j.ship_date, j.ship_to_company,
             j.ship_to_city, j.ship_to_state, j.carrier, j.method, j.load_count,
             lb.bay_number, lb.label as bay_label,
             (SELECT COUNT(*) FROM loading_photos lp WHERE lp.job_id = la.job_id) AS photo_count,
             (SELECT COUNT(*) FROM bols b WHERE b.job_id = la.job_id
               AND (b.load_number = la.load_number
                    OR (b.load_number IS NULL AND (SELECT COUNT(*) FROM bols b2 WHERE b2.job_id = la.job_id) = 1))
             ) AS bol_count
      FROM loading_assignments la
      JOIN jobs j ON la.job_id = j.id
      LEFT JOIN loading_bays lb ON la.bay_id = lb.id
    `;
    const conditions = ["COALESCE(j.method, '') != 'customer pickup'"];
    const binds: unknown[] = [];
    if (!includeArchived) conditions.push("la.loading_status != 'archived'");
    // archived-hide-01: a job archived before departure (QB void, cancelled order) drops off the
    // board; shipped-then-archived loads stay so delivered history is intact.
    if (!includeArchived) conditions.push("(j.archived_at IS NULL OR la.loading_status IN ('in_transit','delivered'))");
    if (bayId) {
      conditions.push("la.bay_id = ?");
      binds.push(bayId);
    }
    query += " WHERE " + conditions.join(" AND ") + " ORDER BY la.created_at ASC";

    const rows = await DB.prepare(query)
      .bind(...binds)
      .all();
    return NextResponse.json({ ok: true, assignments: rows.results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { DB } = await getEnv();
  const canManage = request.headers.get("X-User-Can-Manage-Loading") === "1";
  const actorId = request.headers.get("X-User-Id") || null;

  if (!canManage) {
    return NextResponse.json(
      { ok: false, error: "Manager access required to assign jobs to loading." },
      { status: 403 }
    );
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  if (!payload.job_id) {
    return NextResponse.json({ ok: false, error: "job_id is required." }, { status: 400 });
  }

  const job = await DB.prepare("SELECT load_count FROM jobs WHERE id = ?")
    .bind(payload.job_id)
    .first<{ load_count: number | null }>();
  if (!job) return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });

  const now = new Date().toISOString();

  if (payload.bay_id) {
    const adoptFirst = await DB.prepare(
      "SELECT id FROM loading_assignments WHERE job_id = ? AND loading_status = 'awaiting' AND (bay_id IS NULL OR bay_id = '') ORDER BY load_number ASC LIMIT 1"
    )
      .bind(payload.job_id)
      .first<{ id: string }>();
    if (adoptFirst) {
      await DB.prepare(
        "UPDATE loading_assignments SET bay_id = ?, loading_status = 'not_started', updated_at = ? WHERE id = ?"
      )
        .bind(payload.bay_id, now, adoptFirst.id)
        .run();
      await syncShipmentStatus(DB, payload.job_id, "not_started");
      await logActivity(
        DB, "update", "loading_assignment", adoptFirst.id,
        "Pulled job to loading bay (adopt-first)",
        { job_id: payload.job_id, bay_id: payload.bay_id }, actorId
      );
      return NextResponse.json({ ok: true, id: adoptFirst.id, adopted: true });
    }
  }

  const maxLoads = Math.max(job.load_count || 1, 1);
  const existingCountRow = await DB.prepare(
    "SELECT COUNT(*) as cnt FROM loading_assignments WHERE job_id = ?"
  )
    .bind(payload.job_id)
    .first<{ cnt: number }>();
  const currentCount = existingCountRow?.cnt || 0;

  if (currentCount >= maxLoads) {
    if (payload.bay_id) {
      const adoptable = await DB.prepare(
        "SELECT id FROM loading_assignments WHERE job_id = ? AND loading_status = 'awaiting' AND (bay_id IS NULL OR bay_id = '') ORDER BY load_number ASC LIMIT 1"
      )
        .bind(payload.job_id)
        .first<{ id: string }>();
      if (adoptable) {
        await DB.prepare(
          "UPDATE loading_assignments SET bay_id = ?, loading_status = 'not_started', updated_at = ? WHERE id = ?"
        )
          .bind(payload.bay_id, now, adoptable.id)
          .run();
        await syncShipmentStatus(DB, payload.job_id, "not_started");
        await logActivity(
          DB, "update", "loading_assignment", adoptable.id,
          "Pulled job to loading bay (adopted awaiting card)",
          { job_id: payload.job_id, bay_id: payload.bay_id }, actorId
        );
        return NextResponse.json({ ok: true, id: adoptable.id, adopted: true });
      }
      return NextResponse.json(
        { ok: false, error: "All loads for this job already have bays assigned." },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { ok: false, error: `This job already has ${currentCount} of ${maxLoads} load assignment(s).` },
      { status: 400 }
    );
  }

  const loadNumber = currentCount + 1;
  const id = crypto.randomUUID();
  const loadingStatus = payload.bay_id ? "not_started" : "awaiting";

  try {
    await DB.prepare(
      `INSERT INTO loading_assignments (id, job_id, bay_id, trailer_number, loading_status, assigned_by, notes, load_number, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id, payload.job_id, payload.bay_id || null, payload.trailer_number || "", loadingStatus,
        actorId, payload.notes || "", loadNumber, now, now
      )
      .run();

    await syncShipmentStatus(DB, payload.job_id, loadingStatus);

    try {
      const jobInfo = await DB.prepare("SELECT customer, invoice_number FROM jobs WHERE id = ?")
        .bind(payload.job_id)
        .first<{ customer: string | null; invoice_number: string | null }>();
      const customerName = jobInfo?.customer || "Unknown";
      const invNum = jobInfo?.invoice_number || "";
      await notifyLoading(
        DB,
        "loading.assigned",
        "Job Assigned to Loading",
        `${customerName}${invNum ? " (INV# " + invNum + ")" : ""} assigned to ${payload.bay_id ? "Bay" : "awaiting queue"}`,
        id
      );
    } catch (e) {
      console.error("Loading notification dispatch failed (non-fatal):", String((e as any)?.message || e));
    }

    await logActivity(
      DB, "create", "loading_assignment", id,
      `Assigned job to loading — ${loadingStatus}`,
      { job_id: payload.job_id, bay_id: payload.bay_id }, actorId
    );
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  const { DB } = await getEnv();
  const canManage = request.headers.get("X-User-Can-Manage-Loading") === "1";
  const actorId = request.headers.get("X-User-Id") || null;

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const id = payload.id;
  if (!id) return NextResponse.json({ ok: false, error: "id is required." }, { status: 400 });

  const existing = await DB.prepare("SELECT * FROM loading_assignments WHERE id = ?")
    .bind(id)
    .first<any>();
  if (!existing) return NextResponse.json({ ok: false, error: "Assignment not found." }, { status: 404 });

  const now = new Date().toISOString();
  const updates: string[] = [];
  const binds: unknown[] = [];
  let pendingShipmentStatus: string | null = null;

  if (payload.location !== undefined) {
    if (payload.location === "yard" && !canManage) {
      return NextResponse.json(
        { ok: false, error: "Manager access required to move a trailer to the yard." },
        { status: 403 }
      );
    }
    if (payload.location === "bay" && existing.location === "yard" && !canManage) {
      return NextResponse.json(
        { ok: false, error: "Manager access required to move a trailer back to a bay." },
        { status: 403 }
      );
    }
    updates.push("location = ?");
    binds.push(payload.location === "yard" ? "yard" : "bay");
  }

  if (payload.bay_id !== undefined) {
    updates.push("bay_id = ?");
    binds.push(payload.bay_id || null);
  }

  if (payload.trailer_number !== undefined) {
    if (!canManage) {
      return NextResponse.json(
        { ok: false, error: "Manager access required to edit the trailer #." },
        { status: 403 }
      );
    }
    const trailerLockedStatuses = ["in_transit", "delivered", "archived"];
    if (
      trailerLockedStatuses.includes(existing.loading_status) &&
      String(payload.trailer_number) !== String(existing.trailer_number || "")
    ) {
      return NextResponse.json(
        { ok: false, error: "Trailer # is locked once the load is in transit." },
        { status: 409 }
      );
    }
    updates.push("trailer_number = ?");
    binds.push(String(payload.trailer_number));
  }

  if (payload.notes !== undefined) {
    updates.push("notes = ?");
    binds.push(String(payload.notes));
  }

  if (payload.ready_checklist !== undefined) {
    updates.push("ready_checklist = ?");
    binds.push(
      typeof payload.ready_checklist === "string"
        ? payload.ready_checklist
        : JSON.stringify(payload.ready_checklist)
    );
  }

  // loading-awaiting-01: a load with no bay can't be 'not_started' (it would render in no section).
  // No bay means the awaiting queue — same rule as the job-level POST.
  {
    const finalBayId = Object.prototype.hasOwnProperty.call(payload, "bay_id") ? payload.bay_id : existing.bay_id;
    if (payload.loading_status === "not_started" && !finalBayId) payload.loading_status = "awaiting";
  }

  if (payload.loading_status) {
    if (
      (existing.loading_status === "awaiting" && payload.loading_status === "not_started") ||
      (payload.loading_status === "awaiting" && existing.loading_status !== "awaiting") ||
      (payload.bay_id && payload.bay_id !== existing.bay_id)
    ) {
      if (!canManage) {
        return NextResponse.json(
          { ok: false, error: "Manager access required for bay assignment." },
          { status: 403 }
        );
      }
    }

    if (
      payload.loading_status === "in_transit" &&
      existing.loading_status !== "in_transit" &&
      !canManage
    ) {
      return NextResponse.json(
        { ok: false, error: "Manager access required to mark a trailer In Transit." },
        { status: 403 }
      );
    }

    {
      const fromIdx = LOADING_FLOW.indexOf(existing.loading_status);
      const toIdx = LOADING_FLOW.indexOf(payload.loading_status);
      if (
        existing.loading_status === "in_transit" &&
        toIdx > -1 &&
        fromIdx > -1 &&
        toIdx < fromIdx &&
        !canManage
      ) {
        return NextResponse.json(
          { ok: false, error: "Manager access required to move a trailer out of In Transit." },
          { status: 403 }
        );
      }
    }

    updates.push("loading_status = ?");
    binds.push(payload.loading_status);

    if (payload.loading_status === "loading" && !existing.started_at) {
      updates.push("started_at = ?");
      binds.push(now);
    }
    if (payload.loading_status === "loaded" && !existing.loaded_at) {
      updates.push("loaded_at = ?");
      binds.push(now);
    }
    if (payload.loading_status === "in_transit" && !existing.in_transit_at) {
      updates.push("in_transit_at = ?");
      binds.push(now);
    }
    if (payload.loading_status === "delivered" && !existing.delivered_at) {
      updates.push("delivered_at = ?");
      binds.push(now);
    }
    if (existing.loading_status === "in_transit" && payload.loading_status !== "in_transit") {
      updates.push("in_transit_at = ?");
      binds.push(null);
    }
    if (payload.loading_status === "awaiting" && existing.loading_status !== "awaiting") {
      updates.push("started_at = ?", "loaded_at = ?", "in_transit_at = ?", "delivered_at = ?");
      binds.push(null, null, null, null);
    }

    if (payload.loading_status !== existing.loading_status) {
      pendingShipmentStatus = payload.loading_status;
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
  }

  updates.push("updated_at = ?");
  binds.push(now, id);

  try {
    await DB.prepare(`UPDATE loading_assignments SET ${updates.join(", ")} WHERE id = ?`)
      .bind(...binds)
      .run();

    const notifType = pendingShipmentStatus ? LOADING_NOTIF_TYPES[pendingShipmentStatus] : undefined;
    if (notifType) {
      try {
        const jobInfo = await DB.prepare("SELECT customer, invoice_number FROM jobs WHERE id = ?")
          .bind(existing.job_id)
          .first<{ customer: string | null; invoice_number: string | null }>();
        const customerName = jobInfo?.customer || "Unknown";
        const invNum = jobInfo?.invoice_number || "";
        const trailerNum = payload.trailer_number || existing.trailer_number || "";
        const messages: Record<string, string> = {
          "loading.started": `Trailer${trailerNum ? " " + trailerNum : ""} has begun loading — ${customerName}`,
          "loading.loaded": `Trailer${trailerNum ? " " + trailerNum : ""} is loaded — ${customerName}`,
          "loading.in_transit": `Trailer${trailerNum ? " " + trailerNum : ""} has departed — ${customerName}`,
          "loading.delivered": `Delivery confirmed — ${customerName}${invNum ? " (INV# " + invNum + ")" : ""}`,
        };
        const seg = notifType.split(".")[1];
        const notifTitle = seg.charAt(0).toUpperCase() + seg.slice(1).replace("_", " ");
        await notifyLoading(DB, notifType, notifTitle, messages[notifType], id);
      } catch (e) {
        console.error("Loading notification dispatch failed (non-fatal):", String((e as any)?.message || e));
      }
    }

    if (pendingShipmentStatus) {
      await syncShipmentStatus(DB, existing.job_id, pendingShipmentStatus);
      await logActivity(
        DB, "update", "loading_assignment", id,
        `Loading status: ${existing.loading_status} → ${payload.loading_status}`,
        { job_id: existing.job_id, bay_id: payload.bay_id || existing.bay_id }, actorId
      );
    }
    if (payload.location === "yard") {
      await logActivity(
        DB, "update", "loading_assignment", id, "Moved to yard",
        { job_id: existing.job_id }, actorId
      );
    }
    if (payload.location === "bay" && existing.location === "yard") {
      await logActivity(
        DB, "update", "loading_assignment", id, "Moved back to bay (returned to awaiting queue)",
        { job_id: existing.job_id }, actorId
      );
    }

    // Trailer -> BOL back-write, mirroring legacy. BolViewerModal already live-enriches on open
    // (unit 2), so this is belt-and-suspenders for any other reader of bols.trailer_no.
    if (
      payload.trailer_number !== undefined &&
      String(payload.trailer_number) !== String(existing.trailer_number || "")
    ) {
      try {
        let propagated = false;
        if (existing.load_number != null) {
          const r = await DB.prepare("UPDATE bols SET trailer_no = ? WHERE job_id = ? AND load_number = ?")
            .bind(String(payload.trailer_number), existing.job_id, existing.load_number)
            .run();
          propagated = Number((r as any)?.meta?.changes || 0) > 0;
        }
        if (!propagated) {
          const bolCount = await DB.prepare("SELECT COUNT(*) AS cnt FROM bols WHERE job_id = ?")
            .bind(existing.job_id)
            .first<{ cnt: number }>();
          if (Number(bolCount?.cnt || 0) === 1) {
            await DB.prepare("UPDATE bols SET trailer_no = ? WHERE job_id = ?")
              .bind(String(payload.trailer_number), existing.job_id)
              .run();
            propagated = true;
          }
        }
        if (propagated) {
          await logActivity(
            DB, "update", "bol", existing.job_id,
            `Trailer # propagated to BOL: ${String(payload.trailer_number)}`,
            { job_id: existing.job_id, load_number: existing.load_number ?? null }, actorId
          );
        }
      } catch (e) {
        console.error("Trailer→BOL back-write failed:", String((e as any)?.message || e));
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
