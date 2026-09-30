// src/app/api/shipments/signed-bol/route.ts  ->  GET /v2/api/shipments/signed-bol?job_id=<id>
// lgx-signed-01. Read-only index of the signed artifacts already captured by legacy flows, grouped per
// load the way legacy's dashboard modal does (logistics/index.html loadBolDocuments): load_number,
// NULL -> 0. Docs are collected from EVERY BOL row in a load (a regenerate can leave the signature on an
// older row). Precedence within a load: signed = newest original_signed, else newest
// driver_signed/customer_signed; carrier = newest carrier_upload; photo = newest BOL row with
// signed_bol_photo_key. Never returns r2_key — bytes go through signed-bol/file, which resolves keys
// server-side. Static segment beats the sibling [id]; gate inherited from middleware's
// /v2/api/shipments -> logistics.dashboard rule.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

type BolRow = {
  id: string;
  bol_number: string | null;
  load_number: number | null;
  load_count: number | null;
  signed_bol_photo_key: string | null;
  created_at: string | null;
};
type DocRow = { id: string; bol_id: string; doc_type: string; created_at: string };

const CHUNK = 50;

export async function GET(request: NextRequest) {
  const jobId = (new URL(request.url).searchParams.get("job_id") || "").trim();
  if (!jobId) {
    return NextResponse.json({ ok: false, error: "job_id is required.", detail: "Missing job_id" }, { status: 400 });
  }

  const { DB } = await getEnv();

  try {
    const bolsRes = await DB.prepare(
      "SELECT id, bol_number, load_number, load_count, signed_bol_photo_key, created_at FROM bols WHERE job_id = ?"
    ).bind(jobId).all<BolRow>();
    const bols = bolsRes.results ?? [];

    const docs: DocRow[] = [];
    const ids = bols.map((b) => b.id);
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const r = await DB.prepare(
        `SELECT id, bol_id, doc_type, created_at FROM bol_documents WHERE bol_id IN (${chunk.map(() => "?").join(",")}) ORDER BY created_at DESC`
      ).bind(...chunk).all<DocRow>();
      docs.push(...(r.results ?? []));
    }
    // Newest-first across chunks too.
    docs.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

    const byLoad = new Map<number, BolRow[]>();
    for (const b of bols) {
      const n = Number(b.load_number ?? 0) || 0;
      if (!byLoad.has(n)) byLoad.set(n, []);
      byLoad.get(n)!.push(b);
    }

    const loads = [];
    for (const [loadNumber, rows] of Array.from(byLoad.entries()).sort((a, b) => a[0] - b[0])) {
      rows.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
      const bolIds = new Set(rows.map((r) => r.id));
      const loadDocs = docs.filter((d) => bolIds.has(d.bol_id));

      const signedDoc =
        loadDocs.find((d) => d.doc_type === "original_signed") ||
        loadDocs.find((d) => d.doc_type === "driver_signed" || d.doc_type === "customer_signed") ||
        null;
      const carrierDoc = loadDocs.find((d) => d.doc_type === "carrier_upload") || null;
      const photoRow = rows.find((r) => r.signed_bol_photo_key) || null;

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
