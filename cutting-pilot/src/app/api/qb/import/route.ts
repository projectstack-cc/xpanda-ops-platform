// src/app/api/qb/import/route.ts  →  /v2/api/qb/import
// qb-01: admin-only, human-initiated QBO invoice → job import through the shared createJob()
// (same path as v2 order entry). Creates directly — the review queue is for webhook-originated
// changes (qb-02+). A duplicate invoice # returns 409 and writes no link row (linking
// pre-existing jobs is qb-02's baseline logic).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { getQbEnv, getValidToken, fetchInvoice, fetchInvoiceByDocNumber } from "@/lib/qb/client";
import { loadPartsServer } from "@/lib/qb/parts";
import { mapInvoiceToJobInput, relevantHash, type MapResult } from "@/lib/qb/mapper";
import { createJob } from "@/lib/jobCreate";
import { logActivity } from "@/lib/activityLog";

export async function POST(request: NextRequest) {
  if (request.headers.get("X-User-Is-Admin") !== "1") {
    return NextResponse.json({ ok: false, error: "Admin only." }, { status: 403 });
  }
  const actorId = request.headers.get("X-User-Id") || null;
  const actorName = request.headers.get("X-User-Name") || "";

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 }); }
  const invoiceId = String(body?.invoiceId ?? "").trim();
  const docNumber = String(body?.docNumber ?? "").trim();
  if (!invoiceId && !docNumber) {
    return NextResponse.json({ ok: false, error: "invoiceId or docNumber is required." }, { status: 400 });
  }

  const { DB, BOL_PHOTOS } = await getEnv();
  const qb = await getQbEnv();

  // 1. Fetch + map.
  let invoice: any;
  let mapped: MapResult;
  let hash: string;
  try {
    const token = await getValidToken(DB, qb);
    invoice = invoiceId ? await fetchInvoice(token, qb, invoiceId) : await fetchInvoiceByDocNumber(token, qb, docNumber);
    mapped = mapInvoiceToJobInput(invoice, await loadPartsServer(DB));
    hash = await relevantHash(mapped.input);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 502 });
  }

  const { input, warnings, unmatched } = mapped;
  try {
    // 2. Shared create path.
    const result = await createJob(
      { DB, BOL_PHOTOS }, input, { id: actorId, name: actorName },
      { source: "quickbooks", via: "qb-import" },
    );
    if (!result.ok) {
      if (result.code === "duplicate_invoice") {
        return NextResponse.json(
          { ok: false, code: "duplicate_invoice", error: `A job with invoice # ${input.invoice_number} already exists.`, job_id: result.job_id },
          { status: 409 },
        );
      }
      return NextResponse.json({ ok: false, error: result.error, warnings, unmatched }, { status: 400 });
    }

    // 3. Link row.
    const ts = new Date().toISOString();
    const qboInvoiceId = String(invoice.Id ?? "");
    const syncToken = invoice.SyncToken != null ? String(invoice.SyncToken) : null;
    await DB.prepare(`
      INSERT INTO qb_invoice_links
        (id, realm_id, qbo_invoice_id, doc_number, job_id, sync_token, last_applied_hash, last_synced_at, created_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).bind(crypto.randomUUID(), qb.QB_REALM_ID, qboInvoiceId, input.invoice_number, result.id, syncToken, hash, ts, ts).run();

    // 4. QB-specific activity entry (in addition to createJob's own).
    await logActivity(
      DB, "create", "job", result.id,
      `QB import: ${input.customer} invoice ${input.invoice_number} (${input.line_items.length} lines, ${unmatched.length} unmatched)`,
      { qbo_invoice_id: qboInvoiceId, sync_token: syncToken, warnings, unmatched },
      actorId,
    );

    return NextResponse.json({ ok: true, id: result.id, warnings, unmatched }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
