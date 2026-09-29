// src/app/api/carrier/charges/route.ts  →  POST /v2/api/carrier/charges
// Carrier adds an additional fee and/or note to a load (carrier-04). Append-only: every submit is
// a new carrier_charges row, never an in-place edit. Independent of the QR sign flow's
// bols.signed_bol_additional_info, which stays untouched.
//
// Gated on logistics.carrier_view EDIT by the /v2/api/carrier middleware prefix (POST → edit).
// Token → BOL via resolveCarrierBol (other carriers' BOLs 404), then isWithinCarrierWindow
// (today/tomorrow ship day, or delivered in the last 7 days ET) — outside → 403 outside_window.
// Actor comes from the middleware's X-User-* headers only, never the body. Notifies logistics via
// the role-subscription push system (type carrier.fees_added); a notification failure never fails
// the request (dispatchNotification swallows + logs, like legacy).
import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { dispatchNotification } from "@/lib/push";
import { formatUsdCents } from "@/lib/money";
import { isWithinCarrierWindow, resolveCarrierBol } from "@/lib/carrier/scope";

const MAX_FEE_CENTS = 10_000 * 100;
const MAX_NOTES = 2000;
const FEE_RE = /^(\d+(\.\d{0,2})?|\.\d{1,2})$/;

function bad(error: string, message: string, status = 400) {
  return NextResponse.json({ ok: false, error, detail: message }, { status });
}

export async function POST(request: NextRequest) {
  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || null;
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return bad("invalid_json", "Invalid JSON.");
  }

  // fee_amount: optional dollars → integer cents.
  const rawFee = payload?.fee_amount;
  let feeCents = 0;
  if (rawFee !== undefined && rawFee !== null && String(rawFee).trim() !== "") {
    const cleaned = String(rawFee).replace(/[$,\s]/g, "");
    if (!FEE_RE.test(cleaned)) return bad("invalid_fee", "Fee must be a dollar amount like 125 or 125.50.");
    feeCents = Math.round(parseFloat(cleaned) * 100);
    if (!Number.isFinite(feeCents) || feeCents < 0) return bad("invalid_fee", "Fee can't be negative.");
    if (feeCents > MAX_FEE_CENTS) return bad("invalid_fee", "Fee can't be more than $10,000.");
  }

  const notes = String(payload?.notes ?? "").trim();
  if (notes.length > MAX_NOTES) return bad("notes_too_long", `Notes can be at most ${MAX_NOTES} characters.`);
  if (feeCents > 0 && !notes) return bad("notes_required", "Explain the fee in Additional Notes.");
  if (!notes) return bad("notes_required", "Additional Notes is required.");

  try {
    const { DB } = await getEnv();
    const bol = await resolveCarrierBol(DB, payload?.token);
    if (!bol) return NextResponse.json({ ok: false, error: "BOL not found." }, { status: 404 });
    if (!(await isWithinCarrierWindow(DB, bol))) {
      return bad("outside_window", "This load is no longer on your board — fees can be added up to 7 days after delivery.", 403);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await DB.prepare(
      `INSERT INTO carrier_charges (id, bol_id, job_id, load_number, fee_amount_cents, notes, created_by, created_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, bol.id, bol.job_id, bol.load_number ?? null, feeCents, notes, actorId, actorName, now)
      .run();

    const job = await DB.prepare("SELECT customer, invoice_number FROM jobs WHERE id = ?")
      .bind(bol.job_id)
      .first<{ customer: string | null; invoice_number: string | null }>();
    const shipment = await DB.prepare("SELECT id FROM shipments WHERE job_id = ? ORDER BY created_at DESC LIMIT 1")
      .bind(bol.job_id)
      .first<{ id: string }>();

    // Suffix from the integer load_number (never the bol_number string), multi-load only.
    const count = Number(bol.load_count) || 0;
    const n = Number(bol.load_number) || 0;
    const suffix = count > 1 && n > 0 ? `-${String(n).padStart(2, "0")}` : "";

    await logActivity(
      DB,
      "carrier_charge_added",
      shipment ? "shipment" : "job",
      shipment?.id ?? bol.job_id,
      `Carrier added ${feeCents > 0 ? `fee ${formatUsdCents(feeCents)}` : "a note"} — BOL #${bol.bol_number ?? ""}`,
      { charge_id: id, bol_id: bol.id, bol_number: bol.bol_number ?? null, load_number: bol.load_number ?? null, fee_amount_cents: feeCents },
      actorId
    );

    const { env } = await getCloudflareContext();
    const title = `Carrier fee added — ${job?.customer || "shipment"} (INV# ${job?.invoice_number || "—"}${suffix})`;
    const noteSnippet = notes.length > 120 ? `${notes.slice(0, 119)}…` : notes;
    await dispatchNotification(
      DB,
      env as any,
      "carrier.fees_added",
      title,
      `${formatUsdCents(feeCents)} — ${noteSnippet}`,
      "shipment",
      shipment?.id ?? bol.job_id
    );

    return NextResponse.json({ ok: true, id, fee_amount_cents: feeCents });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
