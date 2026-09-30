// src/app/api/shipments/[id]/packing-slip/route.ts  ->  GET /v2/api/shipments/:id/packing-slip
// lgx-slip-01: the linked job's packing slip PDF, served under the /v2/api/shipments prefix so it
// inherits the `logistics.dashboard` gate (middleware.ts). Legacy's /api/jobs/:id/packing-slip is
// gated on `jobs`, which a logistics-only user may not hold. Body mirrors legacy
// _worker.js/routes/jobs.js GET /api/jobs/:id/packing-slip exactly: R2 key first (BOL_PHOTOS), then
// the base64 packing_slip_pdf fallback for un-backfilled rows. Keys resolve from the DB row only.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";

const NO_SLIP = "No packing slip attached.";

export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: shipmentId } = await ctx.params;
  try {
    const { DB, BOL_PHOTOS } = await getEnv();

    const shipment = await DB.prepare("SELECT job_id FROM shipments WHERE id = ?")
      .bind(shipmentId)
      .first<{ job_id: string | null }>();
    if (!shipment?.job_id) {
      return NextResponse.json({ ok: false, error: NO_SLIP }, { status: 404 });
    }

    const row = await DB.prepare(
      "SELECT packing_slip_key, packing_slip_pdf, packing_slip_filename FROM jobs WHERE id = ?"
    )
      .bind(shipment.job_id)
      .first<{ packing_slip_key: string | null; packing_slip_pdf: string | null; packing_slip_filename: string | null }>();
    if (!row) return NextResponse.json({ ok: false, error: NO_SLIP }, { status: 404 });

    const filename = row.packing_slip_filename || "packing-slip.pdf";
    const headers = {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    };

    // Prefer R2 key; fall back to legacy base64 for un-backfilled rows
    if (row.packing_slip_key) {
      const obj = await BOL_PHOTOS.get(row.packing_slip_key);
      if (!obj) {
        return NextResponse.json({ ok: false, error: "Packing slip not found in storage." }, { status: 404 });
      }
      return new Response(obj.body as unknown as ReadableStream, { status: 200, headers });
    }
    if (row.packing_slip_pdf) {
      const binary = Uint8Array.from(atob(row.packing_slip_pdf), (c) => c.charCodeAt(0));
      return new Response(binary, { status: 200, headers });
    }
    return NextResponse.json({ ok: false, error: NO_SLIP }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
