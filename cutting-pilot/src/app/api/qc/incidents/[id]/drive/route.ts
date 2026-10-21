// src/app/api/qc/incidents/[id]/drive/route.ts  ->  POST /v2/api/qc/incidents/:id/drive
// qc-08: manual "Retry Drive" from the Incident report popup's Recent tab. Forwards the incident to the
// Inspection Tool Apps Script now (awaited — bounded by the forwarder's 25 s POST timeout), ignoring
// the 3-attempt cap the cron sweep honours. Same atomic claim as every other path, so a row already
// sent or mid-send returns 409 (as inspections do). Gated on `qc` by middleware (POST → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getEnv } from "@/lib/db";
import { forwardIncident } from "@/lib/qc/driveForward";
import { INCIDENT_COLUMNS, type IncidentRow } from "@/lib/qc/incident";

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const actorId = request.headers.get("X-User-Id");
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const id = String(params?.id ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "Incident id is required.", detail: "" }, { status: 400 });

  try {
    const { DB } = await getEnv();
    const { env } = await getCloudflareContext();

    const outcome = await forwardIncident(DB, (env as any).QC_GAS_URL, id, { manual: true, actorId });
    if (outcome === "skipped") {
      return NextResponse.json(
        { ok: false, error: "Already sent or being sent — refresh in a minute.", detail: id },
        { status: 409 }
      );
    }

    const incident = await DB.prepare(`SELECT ${INCIDENT_COLUMNS} FROM qc_incidents WHERE id = ?`).bind(id).first<IncidentRow>();
    if (!incident) return NextResponse.json({ ok: false, error: "Incident not found.", detail: id }, { status: 404 });
    return NextResponse.json({ ok: true, incident });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't retry the Drive upload.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
