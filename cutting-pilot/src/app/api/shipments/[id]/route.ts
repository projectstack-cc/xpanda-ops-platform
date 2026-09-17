// src/app/api/shipments/[id]/route.ts  ->  GET /v2/api/shipments/:id (row + shipping address +
// line items), PUT /v2/api/shipments/:id (fenced, partial update), DELETE /v2/api/shipments/:id
// (fenced)
//
// GET backs ShipmentDetailPanel's inline row drill-down on the /v2/logistics dashboard (replaces
// the old "View job →" link that navigated away to /jobs/ with nothing shipment-specific to show
// for it). Deliberately joins `jobs` for the ship-to address and reads `job_line_items` for parts
// itself, rather than delegating to GET /v2/api/jobs/:id or /v2/api/board/:id -- both of those are
// gated on the "jobs" permission key (middleware.ts), which a "logistics.dashboard"-only viewer
// of this dashboard may not hold. Living under the /v2/api/shipments prefix keeps this drill-down
// on the exact permission the dashboard itself already requires.
//
// PUT backs the new Shipment Edit Modal (Task 3, xpanda-ops-agents.md §9a). Mirrors
// bols/[id]/route.ts's fencing/auth-guard shape, but this is a partial-column UPDATE (allowlist
// of editable fields) rather than a full-row replace -- there's no client that ever sends the
// whole shipment row here, only the fields the modal actually renders as inputs.
//
// Field rules (Opus review amendments, "Resolved with Steve" + B1-B6/H1-H6):
//   - customer, carrier, method, ship_date, total_bdft, load_count are one-way synced from the
//     linked job in legacy (_worker.js/routes/jobs.js), so they're editable here ONLY when the
//     shipment has no job_id -- otherwise a v2 edit could be silently clobbered by a later legacy
//     job edit. Editing a job-linked shipment's job-synced fields is rejected outright (400), not
//     silently dropped, so the UI gets a clear signal.
//   - trailer_number is gated behind X-User-Can-Manage-Loading specifically (not the general
//     logistics.dashboard edit permission) -- mirrors legacy's original intent and the existing
//     convention in loading-assignments/route.ts:313-319 (reject the whole request, don't drop
//     just the field).
//   - method / scrap_pickup are behavior-bearing TEXT enums elsewhere in the codebase (branched on
//     as the literal strings 'customer pickup' and 'YES' -- see _worker.js/routes/jobs.js:1448,
//     orders/route.ts:143, BolGenerateModal.tsx:255, OrderRow.tsx's isScrapYes()) -- validated
//     strictly here, never accepted as free text.
//   - load_count / total_bdft get explicit empty/NaN guards -- legacy's own coercion
//     (Math.max(1, parseInt(raw ?? 1, 10)) / Number(raw ?? 0), jobs.js:1354-1357) silently
//     produces NaN / 0 on an empty string; this route rejects instead of binding a bad value.
//   - status is ALWAYS editable (never job-gated -- it flows shipment -> job, not job ->
//     shipment) but restricted to the 8-value set legacy's own manual edit form offers
//     (logistics/index.html:212), never "awaiting"/"scheduled" (board-driven-only). A validated
//     status change fires the same reverse write-through cascade legacy's PUT branch runs
//     (jobs.js:1372-1458): job status sync (forward-only, 'shipped'/'archived' protected),
//     loading_assignments mirror, completeCuttingLinesForJob backstop, and a ready_to_ship
//     re-queue -- see the PUT handler body for the full port.
//
// DELETE mirrors jobs.js's handleApiShipments DELETE branch (~1470-1488) exactly: no
// LOCKED_STATUSES check (a locked shipment can still be deleted, deliberately not a dead end),
// no cascade, gated by the same canEditDashboard() as PUT/GET.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { V2_LOGISTICS_WRITES_ENABLED } from "@/lib/logistics/writeFence";
import { logActivity } from "@/lib/activityLog";
import { completeCuttingLinesForJob } from "@/lib/cuttingLines";

// Never job-synced in legacy -- always editable regardless of job-link status. `status` flows the
// OPPOSITE direction of JOB_GATED_FIELDS below (shipment -> job, not job -> shipment), so it's
// always editable here too, cascading onto jobs/loading_assignments/cutting_lines below instead of
// ever being blocked by a job link.
const ALWAYS_EDITABLE = [
  "status",
  "notes",
  "delivery_time",
  "scrap_pickup",
  "delivery_incident",
  "delivery_incident_notes",
] as const;

// One-way synced from the linked job in legacy (_worker.js/routes/jobs.js) -- editable here only
// when shipments.job_id IS NULL, to avoid a v2 edit being silently overwritten by a later legacy
// job edit (or vice versa: this route silently diverging from the job of record).
const JOB_GATED_FIELDS = [
  "customer",
  "carrier",
  "method",
  "ship_date",
  "total_bdft",
  "load_count",
] as const;

const TRAILER_FIELD = "trailer_number";

const LOCKED_STATUSES = ["in_transit", "delivered", "archived", "cancelled"];

// The exact 8-option set from legacy's own manual edit-shipment form (logistics/index.html:212's
// <select id="f-status">) -- deliberately NOT "awaiting"/"scheduled", which are board-driven-only
// states never offered on that form and never meant to be hand-set here either.
const EDITABLE_STATUS_VALUES = [
  "not_started",
  "in_production",
  "ready_to_ship",
  "loading",
  "loaded",
  "in_transit",
  "delivered",
  "cancelled",
] as const;

// Reverse write-through: shipment.status -> jobs.status. Ported verbatim from
// _worker.js/routes/jobs.js's handleApiShipments PUT branch (SHIPMENT_TO_JOB_STATUS /
// JOB_STATUS_RANK, lines ~1374-1421).
const SHIPMENT_TO_JOB_STATUS: Record<string, string> = {
  not_started: "not_started",
  in_production: "in_production",
  ready_to_ship: "done",
  awaiting: "loading",
  loading: "loading",
  loaded: "loading",
  in_transit: "shipped",
  delivered: "shipped",
};

// Single source of truth for jobs.status lifecycle rank (forward-only guard below) -- mirrors
// jobs.js's own JOB_STATUS_RANK exactly.
const JOB_STATUS_RANK: Record<string, number> = {
  not_started: 0,
  in_production: 1,
  done: 2,
  loading: 3,
  shipped: 4,
};

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: shipmentId } = await ctx.params;
  const { DB } = await getEnv();

  try {
    const shipment = await DB.prepare(
      `SELECT shipments.*,
              j.ship_to_company, j.ship_to_attention, j.ship_to_street, j.ship_to_street2,
              j.ship_to_city, j.ship_to_state, j.ship_to_zip
         FROM shipments
         LEFT JOIN jobs j ON j.id = shipments.job_id
        WHERE shipments.id = ?`
    ).bind(shipmentId).first<any>();

    if (!shipment) {
      return NextResponse.json({ ok: false, error: "Shipment not found." }, { status: 404 });
    }

    let lineItems: any[] = [];
    if (shipment.job_id) {
      const li = await DB.prepare(
        "SELECT part_number, description, quantity, dimensions FROM job_line_items WHERE job_id = ? ORDER BY sort_order ASC"
      ).bind(shipment.job_id).all();
      lineItems = li.results ?? [];
    }

    return NextResponse.json({ ok: true, data: { ...shipment, line_items: lineItems } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

function canEditDashboard(request: NextRequest): boolean {
  if (request.headers.get("X-User-Is-Admin") === "1") return true;
  let perms: any = {};
  try {
    perms = JSON.parse(request.headers.get("X-User-Permissions") || "{}");
  } catch {
    // fall through to false
  }
  return !!perms["logistics.dashboard"]?.edit;
}

type FieldResult = { column: string; value: unknown } | { error: string };

function validateField(key: string, raw: unknown): FieldResult {
  switch (key) {
    case "status": {
      const v = String(raw ?? "").trim();
      if (!(EDITABLE_STATUS_VALUES as readonly string[]).includes(v)) {
        return { error: `status must be one of: ${EDITABLE_STATUS_VALUES.join(", ")}.` };
      }
      return { column: key, value: v };
    }
    case "method": {
      const v = String(raw ?? "").trim();
      if (v !== "" && v !== "customer pickup") {
        return { error: "method must be blank or \"customer pickup\"." };
      }
      return { column: key, value: v };
    }
    case "scrap_pickup": {
      const v = String(raw ?? "").trim();
      if (v !== "YES" && v !== "NO") {
        return { error: "scrap_pickup must be \"YES\" or \"NO\"." };
      }
      return { column: key, value: v };
    }
    case "delivery_incident": {
      return { column: key, value: raw ? 1 : 0 };
    }
    case "load_count": {
      if (raw === null || raw === undefined || String(raw).trim() === "") {
        return { error: "load_count is required and must be a whole number." };
      }
      const n = parseInt(String(raw), 10);
      if (!Number.isFinite(n) || Number.isNaN(n)) {
        return { error: "load_count must be a whole number." };
      }
      return { column: key, value: Math.max(1, n) };
    }
    case "total_bdft": {
      if (raw === null || raw === undefined || String(raw).trim() === "") {
        return { error: "total_bdft is required and must be a number." };
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || Number.isNaN(n)) {
        return { error: "total_bdft must be a number." };
      }
      return { column: key, value: n };
    }
    // customer, carrier, ship_date, notes, delivery_time, delivery_incident_notes, trailer_number
    default:
      return { column: key, value: String(raw ?? "").trim() };
  }
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Fence check FIRST -- before any D1 read/write.
  if (!V2_LOGISTICS_WRITES_ENABLED) {
    return NextResponse.json(
      { ok: false, error: "v2 logistics writes disabled (read-only migration phase)" },
      { status: 501 }
    );
  }

  const { id: shipmentId } = await ctx.params;
  const { DB } = await getEnv();

  const actorId = request.headers.get("X-User-Id") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // Admin bypass FIRST, then fall back to the granular permission. /v2/logistics is currently
  // dark-launched admin-only (middleware.ts:55-59, gated on logistics.v2 which no role holds) --
  // a perms-only check with no bypass would 403 every real user who can reach this route today.
  if (!canEditDashboard(request)) {
    return NextResponse.json(
      { ok: false, error: "You do not have permission to edit shipments." },
      { status: 403 }
    );
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const existing = await DB.prepare(
    "SELECT id, job_id, status FROM shipments WHERE id = ?"
  ).bind(shipmentId).first<any>();
  if (!existing) return NextResponse.json({ ok: false, error: "Shipment not found." }, { status: 404 });

  if (LOCKED_STATUSES.includes(String(existing.status))) {
    return NextResponse.json(
      {
        ok: false,
        error: "Shipment locked",
        detail: "This load has shipped; the shipment can no longer be edited.",
        locked: true,
      },
      { status: 409 }
    );
  }

  const payloadKeys = Object.keys(payload ?? {});

  if (existing.job_id) {
    const blocked = JOB_GATED_FIELDS.filter((f) => payloadKeys.includes(f));
    if (blocked.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "Job-linked fields cannot be edited here.",
          detail: `${blocked.join(", ")} ${blocked.length > 1 ? "are" : "is"} synced from the linked job -- edit on the job in Job Board instead.`,
        },
        { status: 400 }
      );
    }
  }

  if (payloadKeys.includes(TRAILER_FIELD) && request.headers.get("X-User-Can-Manage-Loading") !== "1") {
    return NextResponse.json(
      { ok: false, error: "Manager access required to edit the trailer #." },
      { status: 403 }
    );
  }

  const ALLOWED_FIELDS: readonly string[] = existing.job_id
    ? [...ALWAYS_EDITABLE, TRAILER_FIELD]
    : [...ALWAYS_EDITABLE, TRAILER_FIELD, ...JOB_GATED_FIELDS];

  const sets: string[] = [];
  const vals: unknown[] = [];
  let newStatus: string | undefined;

  for (const key of ALLOWED_FIELDS) {
    if (!payloadKeys.includes(key)) continue;
    const result = validateField(key, payload[key]);
    if ("error" in result) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    sets.push(`${result.column} = ?`);
    vals.push(result.value);
    if (key === "status") newStatus = result.value as string;
  }

  if (sets.length === 0) {
    return NextResponse.json({ ok: false, error: "No editable fields to update." }, { status: 400 });
  }

  sets.push("updated_at = datetime('now')");
  vals.push(shipmentId);

  try {
    await DB.prepare(`UPDATE shipments SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
    const row = await DB.prepare("SELECT * FROM shipments WHERE id = ?").bind(shipmentId).first<any>();

    // Reverse write-through: logistics dashboard status change -> job + loading_assignments +
    // cutting_lines. Ported verbatim from _worker.js/routes/jobs.js's handleApiShipments PUT
    // branch (lines ~1372-1458). Each block is independently try/caught and logged -- a sync
    // failure never blocks the shipment row's own commit above, which has already succeeded.
    if (newStatus && row?.job_id) {
      let jobRow: { status: string; method: string } | null = null;
      try {
        jobRow = await DB.prepare("SELECT status, method FROM jobs WHERE id = ?").bind(row.job_id).first<any>();
      } catch (e) {
        console.error("Shipment->Job lookup failed:", e);
      }

      // 1. Job status sync -- forward-only, 'shipped'/'archived' absolutely protected.
      const mappedJobStatus = SHIPMENT_TO_JOB_STATUS[newStatus];
      if (mappedJobStatus && jobRow && jobRow.status !== mappedJobStatus) {
        const mappedRank = JOB_STATUS_RANK[mappedJobStatus] ?? -1;
        const rankCase = `CASE status ${Object.entries(JOB_STATUS_RANK)
          .map(([s, r]) => `WHEN '${s}' THEN ${r}`)
          .join(" ")} ELSE -1 END`;
        try {
          await DB.prepare(
            `UPDATE jobs SET status = ?, updated_at = datetime('now')
             WHERE id = ? AND status NOT IN ('shipped', 'archived') AND (${rankCase}) < ?`
          ).bind(mappedJobStatus, row.job_id, mappedRank).run();
        } catch (e) {
          console.error("Shipment->Job status sync failed:", e);
        }
      }

      // 2. Mirror active loading-stage + transit statuses onto loading_assignments. MUST run
      // before block 3 -- completeCuttingLinesForJob's own gate query depends on this write.
      if (["loading", "loaded", "in_transit", "delivered"].includes(newStatus)) {
        try {
          await DB.prepare(
            "UPDATE loading_assignments SET loading_status = ?, updated_at = datetime('now') WHERE job_id = ? AND loading_status != 'archived'"
          ).bind(newStatus, row.job_id).run();
        } catch (e) {
          console.error("Shipment->LoadingAssignment status sync failed:", e);
        }
      }

      // 3. Data-integrity backstop: once the shipment is provably past cutting, force any missed
      // cutting lines complete.
      if (["loaded", "in_transit", "delivered"].includes(newStatus)) {
        try {
          await completeCuttingLinesForJob(DB, row.job_id, newStatus);
        } catch (e) {
          console.error("Cutting-lines backfill failed (shipment flow):", e);
        }
      }

      // 4. Re-queue: pulling back to ready_to_ship returns a non-pickup job's cards to awaiting.
      if (newStatus === "ready_to_ship" && jobRow && (jobRow.method || "").toLowerCase() !== "customer pickup") {
        try {
          await DB.prepare(
            "UPDATE loading_assignments SET loading_status = 'awaiting', bay_id = NULL, updated_at = datetime('now') WHERE job_id = ? AND loading_status != 'archived'"
          ).bind(row.job_id).run();
        } catch (e) {
          console.error("Shipment->LoadingAssignment re-queue failed:", e);
        }
      }
    }

    await logActivity(
      DB,
      "update",
      "shipment",
      shipmentId,
      `Updated shipment ${shipmentId}`,
      { fields_updated: payloadKeys.filter((k) => k !== "id") },
      actorId
    );

    return NextResponse.json({ ok: true, message: "Shipment updated.", data: row });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

// Mirrors _worker.js/routes/jobs.js's handleApiShipments DELETE branch (lines ~1470-1488)
// verbatim: deletes the row + logs activity, no LOCKED_STATUSES check (legacy has none either --
// a locked shipment can still be deleted and re-entered, deliberately not a dead end), no
// job/loading_assignments cascade (legacy's DELETE branch has none). Gated by the SAME
// canEditDashboard() as PUT/GET -- no extra manager check, matching legacy's route-level-only gate
// (/api/shipments -> logistics.dashboard, no per-action override).
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!V2_LOGISTICS_WRITES_ENABLED) {
    return NextResponse.json(
      { ok: false, error: "v2 logistics writes disabled (read-only migration phase)" },
      { status: 501 }
    );
  }

  const { id: shipmentId } = await ctx.params;
  const { DB } = await getEnv();

  const actorId = request.headers.get("X-User-Id") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  if (!canEditDashboard(request)) {
    return NextResponse.json(
      { ok: false, error: "You do not have permission to delete shipments." },
      { status: 403 }
    );
  }

  const existing = await DB.prepare("SELECT id FROM shipments WHERE id = ?").bind(shipmentId).first();
  if (!existing) return NextResponse.json({ ok: false, error: "Shipment not found." }, { status: 404 });

  try {
    await DB.prepare("DELETE FROM shipments WHERE id = ?").bind(shipmentId).run();
    await logActivity(DB, "delete", "shipment", shipmentId, `Deleted shipment ${shipmentId}`, { id: shipmentId }, actorId);
    return NextResponse.json({ ok: true, message: "Shipment deleted." });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
