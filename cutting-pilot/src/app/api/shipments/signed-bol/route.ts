// src/app/api/shipments/signed-bol/route.ts  ->  GET /v2/api/shipments/signed-bol?job_id=<id>
// lgx-signed-01. Read-only index of the signed artifacts already captured by legacy flows, grouped per
// load the way legacy's dashboard modal does (logistics/index.html loadBolDocuments): load_number,
// NULL -> 0. Docs are collected from EVERY BOL row in a load (a regenerate can leave the signature on an
// older row). Precedence within a load: signed = newest original_signed, else newest
// driver_signed/customer_signed; carrier = newest carrier_upload; photo = newest BOL row with
// signed_bol_photo_key. Never returns r2_key — bytes go through signed-bol/file, which resolves keys
// server-side. Static segment beats the sibling [id]; gate inherited from middleware's
// /v2/api/shipments -> logistics.dashboard rule. carrier-09: the per-load selection lives in
// lib/logistics/signedBolDocs.ts (shared with the Carrier View); output shape unchanged.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { loadBolDocsForJob, pickLoadDocs } from "@/lib/logistics/signedBolDocs";

export async function GET(request: NextRequest) {
  const jobId = (new URL(request.url).searchParams.get("job_id") || "").trim();
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "job_id is required.", detail: "Missing job_id" }, { status: 400 });
  }

  const { DB } = await getEnv();

  try {
    const { bols, docs } = await loadBolDocsForJob(DB, jobId);

    const loads = [];
    for (const { load_number: loadNumber, rows, signed: signedDoc, carrier: carrierDoc, photo: photoRow } of pickLoadDocs(bols, docs)) {
      if (!signedDoc && !carrierDoc && !photoRow) continue;

      loads.push({
        load_number: loadNumber,
        load_count: rows[0]?.load_count ?? null,
        bol_number: rows[0]?.bol_number ?? null,
        signed: signedDoc ? { doc_id: signedDoc.id, doc_type: signedDoc.doc_type, created_at: signedDoc.created_at } : null,
        carrier: carrierDoc ? { doc_id: carrierDoc.id, created_at: carrierDoc.created_at } : null,
        photo: photoRow ? { bol_id: photoRow.id } : null,
      });
    }

    return NextResponse.json({ ok: true, loads });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
