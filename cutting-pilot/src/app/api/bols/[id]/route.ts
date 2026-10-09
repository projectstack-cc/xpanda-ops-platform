// src/app/api/bols/[id]/route.ts  ->  PUT /v2/api/bols/:id (fenced, full-row replace),
// DELETE /v2/api/bols/:id (fenced, single-BOL delete)
// AUTHORED but FENCED behind V2_LOGISTICS_WRITES_ENABLED (see ../route.ts and the prompt's
// §Read/write fence) -- the BOL Editor's Apply action calls this. Mirrors legacy's
// PUT /api/bols/:id (_worker.js/routes/bols.js) column-for-column, INCLUDING its omissions:
// bol_number, load_number, load_count, bol_group_id, siplast, and shipper_name are
// deliberately NOT in the UPDATE set below (matching legacy exactly) so those fields survive a
// full-row replace even though the client sends the whole row. access_token is read-modify-
// write -- an existing token is never overwritten (printed-QR invariant); only a legacy row
// with no token yet gets one minted here.
//
// DELETE mirrors legacy's single-BOL DELETE (bols.js:597-616): gated on
// X-User-Is-Admin/logistics.loading.manage (a STRICTER gate than PUT's bare auth check above --
// matches legacy's own route, which applies this check only to the delete branch), 404 if
// missing, deletes the row + logs activity. lgx-boldel-01 adds the shipped guard (409, same
// bol-lock-01 rule as PUT) and cascades to bol_documents + their R2 objects (signed copies) via
// lib/logistics/bolDelete.ts. The bulk per-job delete (legacy bols.js:567-595) now lives in
// ../route.ts (DELETE /v2/api/bols?job_id=).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { V2_LOGISTICS_WRITES_ENABLED } from "@/lib/logistics/writeFence";
import { promoteCarrierOverride } from "@/lib/logistics/bolCarrier";
import { logActivity } from "@/lib/activityLog";
import { isBolLocked } from "@/lib/logistics/bolLock";
import { isBolRowLocked, deleteBolCascade } from "@/lib/logistics/bolDelete";

function generateAccessToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function PUT(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // Fence check FIRST -- before the existing-row read below.
  if (!V2_LOGISTICS_WRITES_ENABLED) {
    return NextResponse.json(
      { ok: false, error: "v2 logistics writes disabled (read-only migration phase)" },
      { status: 501 }
    );
  }

  const { id: bolId } = await ctx.params;
  const { DB } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const existing = await DB.prepare(
    "SELECT id, job_id, load_number, render_overrides, access_token FROM bols WHERE id = ?"
  ).bind(bolId).first<any>();
  if (!existing) return NextResponse.json({ ok: false, error: "BOL not found." }, { status: 404 });

  if (existing.job_id) {
    const ship = await DB.prepare(
      "SELECT status FROM shipments WHERE job_id = ? AND direction = 'outbound' ORDER BY updated_at DESC LIMIT 1"
    ).bind(existing.job_id).first<any>();
    // bol-lock-01: per-load lock (see src/lib/logistics/bolLock.ts).
    let assignmentStatus: string | null = null;
    if (existing.load_number != null && existing.load_number !== "") {
      const la = await DB.prepare(
        "SELECT loading_status FROM loading_assignments WHERE job_id = ? AND load_number = ? AND loading_status != 'archived' ORDER BY updated_at DESC LIMIT 1"
      ).bind(existing.job_id, existing.load_number).first<any>();
      if (la) assignmentStatus = la.loading_status ?? null;
    }
    if (isBolLocked({ loadNumber: existing.load_number, assignmentStatus, shipmentStatus: ship?.status ?? null })) {
      return NextResponse.json(
        { ok: false, error: "BOL locked", detail: "This load has shipped; its BOL can no longer be edited.", locked: true },
        { status: 409 }
      );
    }
  }

  const s = (f: string) => String(payload[f] || "").trim();
  const validTerms = ["prepaid", "collect", "3rd_party"];
  const freight_terms = validTerms.includes(s("freight_terms")) ? s("freight_terms") : "prepaid";
  const is_scrap_pickup = payload.is_scrap_pickup ? 1 : 0;

  const hasOverridesField = Object.prototype.hasOwnProperty.call(payload, "render_overrides");
  let render_overrides: string | null = null;
  if (hasOverridesField) {
    if (payload.render_overrides != null) {
      if (typeof payload.render_overrides === "object") {
        render_overrides = JSON.stringify(payload.render_overrides);
      } else if (typeof payload.render_overrides === "string" && payload.render_overrides.trim()) {
        try {
          JSON.parse(payload.render_overrides);
          render_overrides = payload.render_overrides;
        } catch {
          render_overrides = null;
        }
      }
    }
  } else {
    render_overrides = existing.render_overrides ?? null;
  }

  // bolc-02: a non-empty carrierName override the client just sent becomes the real carrier_name,
  // so carrier filters (BOL Email queue) see what the PDF prints. Blank "" overrides stay.
  let carrier_name = s("carrier_name");
  if (hasOverridesField) {
    ({ carrier_name, render_overrides } = promoteCarrierOverride(render_overrides, carrier_name));
  }

  // Legacy BOLs without a token get one on next edit. Token is permanent -- never overwritten
  // once set, so printed QR codes remain valid.
  let access_token = existing.access_token;
  if (!access_token) access_token = generateAccessToken();

  try {
    await DB.prepare(
      `UPDATE bols SET
         date = ?, customer_id = ?,
         ship_to_company = ?, ship_to_attention = ?, ship_to_street = ?, ship_to_street2 = ?,
         ship_to_city = ?, ship_to_state = ?, ship_to_zip = ?, location_no = ?,
         carrier_id = ?, carrier_name = ?, trailer_no = ?, seal_number = ?, scac = ?, pro_no = ?,
         freight_terms = ?, is_scrap_pickup = ?, third_party_bill_to = ?, special_instructions = ?, contact_info = ?,
         is_master_bol = ?, commodity_description = ?, handling_unit_qty = ?, handling_unit_type = ?,
         package_qty = ?, package_type = ?, weight = ?, delivery_time = ?, job_id = ?, notes = ?, po_number = ?, render_overrides = ?,
         access_token = ?
       WHERE id = ?`
    ).bind(
      s("date"),
      payload.customer_id ? String(payload.customer_id).trim() : null,
      s("ship_to_company"), s("ship_to_attention"), s("ship_to_street"), s("ship_to_street2"),
      s("ship_to_city"), s("ship_to_state"), s("ship_to_zip"), s("location_no"),
      payload.carrier_id ? String(payload.carrier_id).trim() : null,
      carrier_name, s("trailer_no"), s("seal_number"), s("scac"), s("pro_no"),
      freight_terms, is_scrap_pickup, s("third_party_bill_to"), s("special_instructions"), s("contact_info"),
      payload.is_master_bol ? 1 : 0,
      s("commodity_description"), s("handling_unit_qty"), s("handling_unit_type"),
      s("package_qty"), s("package_type"), s("weight"), s("delivery_time"),
      payload.job_id ? String(payload.job_id).trim() : null,
      s("notes"), s("po_number"), render_overrides, access_token,
      bolId
    ).run();

    const row = await DB.prepare("SELECT * FROM bols WHERE id = ?").bind(bolId).first();

    const now = new Date().toISOString();
    try {
      await DB.prepare(
        `INSERT INTO activity_log
           (id, timestamp, action, entity_type, entity_id, summary, detail, user_id, created_at)
         VALUES (?, ?, 'update', 'bol', ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), now, bolId,
        `Updated BOL #${payload.bol_number || bolId}`,
        JSON.stringify({ fields_updated: Object.keys(payload).filter((k) => k !== "id") }),
        actorId, now
      ).run();
    } catch (e) {
      console.error("activity_log failed:", String((e as any)?.message || e));
    }

    return NextResponse.json({ ok: true, message: "BOL updated.", bol: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!V2_LOGISTICS_WRITES_ENABLED) {
    return NextResponse.json(
      { ok: false, error: "v2 logistics writes disabled (read-only migration phase)" },
      { status: 501 }
    );
  }

  const { id: bolId } = await ctx.params;
  const { DB, BOL_PHOTOS } = await getEnv();
  const actorId = request.headers.get("X-User-Id") || "";
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // X-User-Can-Manage-Loading is already exactly "admin OR logistics.loading.manage edit"
  // (middleware.ts), matching legacy's own stricter gate on the delete branches.
  if (request.headers.get("X-User-Can-Manage-Loading") !== "1") {
    return NextResponse.json({ ok: false, error: "Manager access required to delete BOLs." }, { status: 403 });
  }

  const existing = await DB.prepare("SELECT id, bol_number, job_id, load_number FROM bols WHERE id = ?")
    .bind(bolId)
    .first<any>();
  if (!existing) return NextResponse.json({ ok: false, error: "BOL not found." }, { status: 404 });

  // lgx-boldel-01: shipped guard (same rule as PUT's bol-lock-01).
  if (await isBolRowLocked(DB, existing)) {
    return NextResponse.json(
      { ok: false, error: "BOL locked", detail: "This load has shipped; its BOL can't be deleted.", locked: true },
      { status: 409 }
    );
  }

  try {
    // lgx-boldel-01: also removes signed copies (bol_documents + R2) -- no orphans.
    await deleteBolCascade(DB, BOL_PHOTOS, bolId);
    await logActivity(DB, "delete", "bol", bolId, `Deleted BOL #${existing.bol_number || bolId}`, { id: bolId }, actorId);
    return NextResponse.json({ ok: true, message: "BOL deleted." });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
