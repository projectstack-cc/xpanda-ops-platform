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
// Field rules (Opus review amendments, "Resolved with Steve" + B1-B6/H1-H6; lgx-editmodal-01):
//   - customer, carrier, ship_date, total_bdft, load_count (JOB_OWNED_FIELDS) are owned by the linked
//     job -- legacy copies them job -> shipment on every job PUT (jobs.js SYNC_FIELDS_JOB_TO_SHIPMENT).
//     lgx-editmodal-01: on a job-linked shipment they WRITE THROUGH to the job (source of truth) and
//     are mirrored onto this shipment row in the same atomic DB.batch -- exactly what a Job Board edit
//     does -- so the edit sticks everywhere. The ship-to address (JOB_ADDRESS_FIELDS) writes through
//     the same way (job-linked only; flips jobs.ship_to_verified to 'unverified'). On an unlinked
//     shipment the owned fields are written to the shipment row directly.
//   - method is no longer accepted (lgx-editmodal-01): retired from the logistics UI; 'customer
//     pickup' is set on the Orders form only. A `method` key in the payload is ignored like any
//     unknown key.
//   - trailer_number (UNLINKED shipments only since lgx-rows-01 -- job-linked trailer # lives on
//     loading_assignments and is ignored here) is gated behind X-User-Can-Manage-Loading specifically (not the general
//     logistics.dashboard edit permission) -- mirrors legacy's original intent and the existing
//     convention in loading-assignments/route.ts:313-319 (reject the whole request, don't drop
//     just the field).
//   - scrap_pickup is a behavior-bearing TEXT enum elsewhere in the codebase (branched on as the
//     literal 'YES' -- see BolGenerateModal.tsx:255, OrderRow.tsx's isScrapYes()) -- validated
//     strictly here, never accepted as free text.
//   - load_count / total_bdft get explicit empty/NaN guards -- legacy's own coercion
//     (Math.max(1, parseInt(raw ?? 1, 10)) / Number(raw ?? 0), jobs.js:1354-1357) silently
//     produces NaN / 0 on an empty string; this route rejects instead of binding a bad value.
//   - status is ALWAYS editable (never job-gated -- it flows shipment -> job, not job ->
//     shipment) but restricted to the 8-value set legacy's own manual edit form offers
//     (logistics/index.html:212), never "awaiting"/"scheduled" (board-driven-only). A validated
//     status change fires the same reverse write-through cascade legacy's PUT branch runs
//     (jobs.js:1372-1458): job status sync (forward-only, 'shipped'/'archived' protected),
//     loading_assignments mirror, and a ready_to_ship re-queue -- see the PUT handler body for
//     the full port. (cutting-decouple-01: the force-complete-cutting-lines backstop was removed
//     from both apps -- cutting completes only via the v2 cutting board's own signal.)
//
// DELETE mirrors jobs.js's handleApiShipments DELETE branch (~1470-1488) exactly: no
// LOCKED_STATUSES check (a locked shipment can still be deleted, deliberately not a dead end),
// no cascade, gated by the same canEditDashboard() as PUT/GET.
import { NextResponse, type NextRequest } from "next/server";
import type { D1PreparedStatement } from "@cloudflare/workers-types";
import { getEnv } from "@/lib/db";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { normalizeAddressKey } from "@/lib/logistics/freightInvoice";
import { resolveOrigin, resolveDestRoute } from "@/lib/logistics/routeCache";
import { singleLineAddress } from "@/lib/logistics/address";
import { V2_LOGISTICS_WRITES_ENABLED } from "@/lib/logistics/writeFence";
import { canEditDashboard } from "@/lib/logistics/dashboardPerms";
import { logActivity } from "@/lib/activityLog";
import { JOB_TO_SHIPMENT_SYNC, coerceJobSyncValue, reconcileLoadingAssignments, type JobSyncField } from "@/lib/logistics/jobSync";
import { propagateJobCarrierToBols } from "@/lib/logistics/bolCarrier";

// Never job-synced in legacy -- always editable regardless of job-link status. `status` flows the
// OPPOSITE direction of JOB_OWNED_FIELDS below (shipment -> job, not job -> shipment), so it's
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

// Owned by the linked job (legacy copies them job -> shipment, jobs.js SYNC_FIELDS_JOB_TO_SHIPMENT).
// lgx-editmodal-01: job-linked -> write through to the job + mirror here atomically; unlinked ->
// written to the shipment row directly.
const JOB_OWNED_FIELDS = [
  "customer",
  "carrier",
  "ship_date",
  "total_bdft",
  "load_count",
] as const;

// Ship-to lives only on the job (shipments has no address columns) -- accepted only when job-linked.
const JOB_ADDRESS_FIELDS = [
  "ship_to_company",
  "ship_to_attention",
  "ship_to_street",
  "ship_to_street2",
  "ship_to_city",
  "ship_to_state",
  "ship_to_zip",
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
              j.ship_to_city, j.ship_to_state, j.ship_to_zip, j.packing_slip_filename,
              (j.packing_slip_key IS NOT NULL OR j.packing_slip_pdf IS NOT NULL) AS has_packing_slip
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

    // carrier-03: per-load delivery state + the driver's QR "Additional info" from the newest BOL
    // for that load (same newest-per-load / null-load_number fallback rule as /v2/api/carrier).
    let loads: any[] = [];
    if (shipment.job_id) {
      const lr = await DB.prepare(
        `SELECT la.id AS assignment_id, la.trailer_number, la.load_number, la.loading_status, la.delivered_at, la.ship_date AS load_ship_date,
                (SELECT b.signed_bol_additional_info FROM bols b
                  WHERE b.job_id = la.job_id
                    AND (
                          b.load_number = la.load_number
                       OR (b.load_number IS NULL AND (SELECT COUNT(*) FROM bols b2 WHERE b2.job_id = la.job_id) = 1)
                        )
                  ORDER BY b.created_at DESC LIMIT 1) AS qr_additional_info
           FROM loading_assignments la
          WHERE la.job_id = ? AND la.loading_status <> 'archived'
          ORDER BY la.load_number ASC`
      ).bind(shipment.job_id).all();
      loads = lr.results ?? [];
      // lgx-photos-01: loading-dock photos per load (loading_photos.assignment_id -> loads[].assignment_id).
      try {
        const pr = await DB.prepare(
          "SELECT id, assignment_id, filename, uploaded_by, created_at FROM loading_photos WHERE job_id = ? ORDER BY created_at ASC"
        ).bind(shipment.job_id).all<any>();
        const byAssignment = new Map<string, any[]>();
        for (const p of pr.results ?? []) {
          const list = byAssignment.get(p.assignment_id) ?? [];
          list.push({ id: p.id, filename: p.filename, uploaded_by: p.uploaded_by, created_at: p.created_at });
          byAssignment.set(p.assignment_id, list);
        }
        loads = loads.map((ld: any) => ({ ...ld, photos: byAssignment.get(ld.assignment_id) ?? [] }));
      } catch {
        loads = loads.map((ld: any) => ({ ...ld, photos: [] }));
      }

      // carrier-04: carrier-entered fees/notes (append-only carrier_charges), newest first, matched
      // to a load by integer load_number; a null-load_number charge (legacy single-load BOL) goes
      // to the job's sole load.
      const cr = await DB.prepare(
        `SELECT load_number, fee_amount_cents, notes, created_by_name, created_at
           FROM carrier_charges WHERE job_id = ? ORDER BY created_at DESC`
      ).bind(shipment.job_id).all<any>();
      const charges = (cr.results ?? []) as any[];
      loads = loads.map((ld) => {
        const mine = charges.filter((c) =>
          c.load_number != null ? Number(c.load_number) === Number(ld.load_number) : loads.length === 1
        );
        return {
          ...ld,
          carrier_charges: mine.map((c) => ({
            fee_amount_cents: Number(c.fee_amount_cents) || 0,
            notes: c.notes ?? "",
            created_by_name: c.created_by_name ?? null,
            created_at: c.created_at,
          })),
          carrier_charges_total_cents: mine.reduce((sum, c) => sum + (Number(c.fee_amount_cents) || 0), 0),
        };
      });
    }

    // lgx-minimap-01: destination pin for the drill-down minimap. Same "job-linked + zip" rule as
    // attachDistanceEta (shipments/route.ts) and addressKeyOf (lib/carrier/rows.ts). geocode_cache first;
    // on a miss, one bounded resolveDestRoute (respects the negative-cache backoff), then re-read. Any
    // failure leaves dest null and never fails the GET.
    let dest: { lat: number; lng: number; address: string } | null = null;
    const zip = String(shipment.ship_to_zip ?? "").trim();
    if (shipment.job_id && zip) {
      try {
        const street = shipment.ship_to_street || "";
        const city = shipment.ship_to_city || "";
        const state = shipment.ship_to_state || "";
        const key = normalizeAddressKey(street, city, state, zip);
        const readGeo = () =>
          DB.prepare("SELECT lat, lng FROM geocode_cache WHERE address_key = ?")
            .bind(key)
            .first<{ lat: number | null; lng: number | null }>();
        let geo = await readGeo();
        if (!geo || geo.lat == null || geo.lng == null) {
          const { env } = await getCloudflareContext();
          const apiKey = (env as any).ORS_API_KEY ?? "";
          if (apiKey) {
            await resolveDestRoute(DB, await resolveOrigin(DB, apiKey), apiKey, street, city, state, zip);
            geo = await readGeo();
          }
        }
        const lat = Number(geo?.lat);
        const lng = Number(geo?.lng);
        const address = singleLineAddress(shipment) ?? "";
        if (geo && geo.lat != null && geo.lng != null && Number.isFinite(lat) && Number.isFinite(lng) && address) {
          dest = { lat, lng, address };
        }
      } catch (e) {
        console.error("Drill-down destination lookup failed:", e);
        dest = null;
      }
    }

    return NextResponse.json({ ok: true, data: { ...shipment, line_items: lineItems, loads, dest } });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
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
    case "ship_date": {
      // lgx-editmodal-01: now writes through to jobs.ship_date (drives the production schedule) --
      // same blank-or-YYYY-MM-DD rule as PUT /v2/api/orders/:id.
      const v = String(raw ?? "").trim();
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return { error: "ship_date must be YYYY-MM-DD." };
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
    // customer, carrier, notes, delivery_time, delivery_incident_notes, trailer_number
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

  const addressKeys = JOB_ADDRESS_FIELDS.filter((f) => payloadKeys.includes(f));
  if (addressKeys.length && !existing.job_id) {
    return NextResponse.json(
      { ok: false, error: "Ship-to can only be edited on a job-linked shipment." },
      { status: 400 }
    );
  }

  // lgx-rows-01: trailer # lives on loading_assignments (per load) -- the single source of truth, edited via
  // PUT /v2/api/loading-assignments. shipments.trailer_number is only written for UNLINKED shipments; on a
  // job-linked shipment a trailer_number key is ignored (never written, never gated).
  if (!existing.job_id && payloadKeys.includes(TRAILER_FIELD) && request.headers.get("X-User-Can-Manage-Loading") !== "1") {
    return NextResponse.json(
      { ok: false, error: "Manager access required to edit the trailer #." },
      { status: 403 }
    );
  }

  const ALLOWED_FIELDS: readonly string[] = existing.job_id
    ? [...ALWAYS_EDITABLE]
    : [...ALWAYS_EDITABLE, TRAILER_FIELD, ...JOB_OWNED_FIELDS];

  // Validate EVERYTHING before writing anything.
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

  // lgx-editmodal-01: job write-through values (job-linked only).
  const jobVals: Record<string, unknown> = {};
  if (existing.job_id) {
    for (const key of JOB_OWNED_FIELDS) {
      if (!payloadKeys.includes(key)) continue;
      const result = validateField(key, payload[key]);
      if ("error" in result) {
        return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
      }
      jobVals[key] = result.value;
    }
    for (const key of addressKeys) jobVals[key] = String(payload[key] ?? "").trim();
  }
  const jobKeys = Object.keys(jobVals);

  if (sets.length === 0 && jobKeys.length === 0) {
    return NextResponse.json({ ok: false, error: "No editable fields to update." }, { status: 400 });
  }

  let job: { id: string; method: string | null; archived_at: string | null; carrier: string | null } | null = null;
  if (jobKeys.length) {
    job = await DB.prepare("SELECT id, method, archived_at, carrier FROM jobs WHERE id = ?")
      .bind(existing.job_id).first<any>();
    if (!job) {
      return NextResponse.json({ ok: false, error: "The linked job was not found." }, { status: 404 });
    }
    if (job.archived_at) {
      return NextResponse.json({ ok: false, error: "The linked job is archived." }, { status: 409 });
    }
  }

  try {
    // One atomic batch: job UPDATE (write-through) + a single shipment UPDATE carrying both this
    // row's own fields and the job -> shipment mirror (JOB_TO_SHIPMENT_SYNC). If only job fields
    // changed, the mirror alone touches the shipment row.
    const statements: D1PreparedStatement[] = [];
    if (job) {
      const jobSets = jobKeys.map((k) => `${k} = ?`);
      const jobBinds = jobKeys.map((k) => jobVals[k]);
      if (addressKeys.length) jobSets.push("ship_to_verified = 'unverified'");
      jobSets.push("updated_at = datetime('now')");
      statements.push(DB.prepare(`UPDATE jobs SET ${jobSets.join(", ")} WHERE id = ?`).bind(...jobBinds, job.id));

      for (const [jobField, shipField] of Object.entries(JOB_TO_SHIPMENT_SYNC) as [JobSyncField, string][]) {
        if (!(jobField in jobVals)) continue;
        sets.push(`${shipField} = ?`);
        vals.push(coerceJobSyncValue(jobField, jobVals[jobField]));
      }
    }
    if (sets.length) {
      sets.push("updated_at = datetime('now')");
      statements.push(DB.prepare(`UPDATE shipments SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, shipmentId));
    }
    await DB.batch(statements);

    if (job) {
      // bolc-01: carry a job carrier change onto unsigned BOLs still showing the old carrier.
      if ("carrier" in jobVals) {
        await propagateJobCarrierToBols(DB, job.id, job.carrier, String(jobVals.carrier), actorId);
      }
      if ("load_count" in jobVals) {
        try {
          await reconcileLoadingAssignments(DB, job.id, Number(jobVals.load_count), job.method);
        } catch (e: any) {
          console.error("Load count reconcile failed:", String(e?.message || e));
        }
      }
      await logActivity(
        DB,
        "update",
        "job",
        job.id,
        `Edited from logistics dashboard: ${jobKeys.join(", ")}`,
        { fields: jobKeys },
        actorId
      );
    }

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

      // 2. Mirror active loading-stage + transit statuses onto loading_assignments.
      if (["loading", "loaded", "in_transit", "delivered"].includes(newStatus)) {
        try {
          await DB.prepare(
            "UPDATE loading_assignments SET loading_status = ?, updated_at = datetime('now') WHERE job_id = ? AND loading_status != 'archived'"
          ).bind(newStatus, row.job_id).run();
        } catch (e) {
          console.error("Shipment->LoadingAssignment status sync failed:", e);
        }
      }

      // 3. Re-queue: pulling back to ready_to_ship returns a non-pickup job's cards to awaiting.
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
