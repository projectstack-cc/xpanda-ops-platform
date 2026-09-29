// src/app/api/carrier/bol/route.ts  →  GET /v2/api/carrier/bol?token=…
// Returns the unsigned BOL record for the carrier's View BOL modal, which renders it live via
// bolShared (there is no stored unsigned PDF by design). Carrier-scoped via resolveCarrierBol —
// a token for any other carrier's job 404s. trailer_no is live-enriched from the dock's
// loading_assignments row, the SAME rule BolViewerModal.tsx uses: exact load_number match, else
// (null load_number) the job's sole non-archived assignment. access_token is never echoed back.
// Gated on logistics.carrier_view (GET = view) by the /v2/api/carrier middleware prefix.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";
import { resolveCarrierBol } from "@/lib/carrier/scope";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  try {
    const { DB } = await getEnv();
    const bol = await resolveCarrierBol(DB, token);
    if (!bol) {
      return NextResponse.json({ ok: false, error: "BOL not found." }, { status: 404 });
    }

    const assignments = ((
      await DB.prepare(
        "SELECT load_number, trailer_number FROM loading_assignments WHERE job_id = ? AND loading_status <> 'archived'"
      )
        .bind(bol.job_id)
        .all()
    ).results ?? []) as Array<{ load_number: number | null; trailer_number: string | null }>;

    let liveTrailer: string | null = null;
    if (bol.load_number != null) {
      const exact = assignments.find(
        (a) => a.load_number != null && Number(a.load_number) === Number(bol.load_number)
      );
      liveTrailer = exact?.trailer_number || null;
    } else if (assignments.length === 1) {
      liveTrailer = assignments[0].trailer_number || null;
    }

    const { access_token: _omit, ...rest } = bol;
    const out = liveTrailer ? { ...rest, trailer_no: liveTrailer } : rest;
    return NextResponse.json({ ok: true, bol: out });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
