// src/app/api/shipments/[id]/route.ts  ->  PUT /v2/api/shipments/:id (fenced, partial update)
// Backs the new Shipment Edit Modal (Task 3, xpanda-ops-agents.md §9a). Mirrors
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
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { V2_LOGISTICS_WRITES_ENABLED } from "@/lib/logistics/writeFence";
import { logActivity } from "@/lib/activityLog";

// Never job-synced in legacy -- always editable regardless of job-link status.
const ALWAYS_EDITABLE = [
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

  for (const key of ALLOWED_FIELDS) {
    if (!payloadKeys.includes(key)) continue;
    const result = validateField(key, payload[key]);
    if ("error" in result) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    }
    sets.push(`${result.column} = ?`);
    vals.push(result.value);
  }

  if (sets.length === 0) {
    return NextResponse.json({ ok: false, error: "No editable fields to update." }, { status: 400 });
  }

  sets.push("updated_at = datetime('now')");
  vals.push(shipmentId);

  try {
    await DB.prepare(`UPDATE shipments SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
    const row = await DB.prepare("SELECT * FROM shipments WHERE id = ?").bind(shipmentId).first();

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
