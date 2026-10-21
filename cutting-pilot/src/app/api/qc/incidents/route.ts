// src/app/api/qc/incidents/route.ts  ->  GET /v2/api/qc/incidents?days=30, POST /v2/api/qc/incidents
// qc-08: native QC incident reports (qc_incidents) — the /v2/qc Incident report popup. Create-only,
// like legacy: the incident Doc the Apps Script makes is the document of record, and editing the
// native row wouldn't update it.
//   GET  — incidents filed or dated in the last `days` (1–365, default 30), newest filed first, with
//          the Drive fields (the popup's Recent tab).
//   POST — validated by validateIncident; a given job_id must exist (job_ref stays as entered). Saved
//          drive_status 'pending', then forwarded off the response path (ctx.waitUntil → forwardIncident:
//          the incident Doc into the customer's incident folder + a row on the incident tracker Sheet,
//          which legacy Reports reads via gviz). No ctx / next dev → the */5 cron sweep picks it up.
// Gated on `qc` by middleware (GET → view, POST → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { etNowWallClock } from "@/lib/etDateTime";
import { forwardIncident, POST_SAVE_CUSTOMERS_TIMEOUT_MS } from "@/lib/qc/driveForward";
import { INCIDENT_COLUMNS, validateIncident, type IncidentRow } from "@/lib/qc/incident";
import { addDaysYmd } from "@/lib/qc/scrap";

function bad(error: string, detail = "", extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, detail, ...extra }, { status: 400 });
}

export async function GET(request: NextRequest) {
  const raw = Number(request.nextUrl.searchParams.get("days") ?? 30);
  const days = Number.isFinite(raw) ? Math.min(365, Math.max(1, Math.floor(raw))) : 30;
  const sinceDate = addDaysYmd(etNowWallClock().date, -days);
  const sinceTs = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace("T", " ");
  try {
    const { DB } = await getEnv();
    const res = await DB.prepare(
      `SELECT ${INCIDENT_COLUMNS} FROM qc_incidents
        WHERE incident_date >= ? OR created_at >= ?
        ORDER BY created_at DESC, incident_date DESC`
    )
      .bind(sinceDate, sinceTs)
      .all<IncidentRow>();
    return NextResponse.json({ ok: true, days, incidents: res.results ?? [] });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't load incident reports.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const actorId = request.headers.get("X-User-Id");
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const actorName = request.headers.get("X-User-Name") || "";

  let body: any;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const v = validateIncident(body ?? {});
  if (!v.ok) return bad(v.errors[0], v.errors.join(" "), { errors: v.errors });
  const val = v.value;

  try {
    const { DB } = await getEnv();
    if (val.job_id) {
      const job = await DB.prepare(`SELECT id FROM jobs WHERE id = ?`).bind(val.job_id).first<{ id: string }>();
      if (!job) return bad("That order isn't on file — clear the INV # link and try again.", `job_id=${val.job_id}`);
    }

    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");
    await DB.prepare(
      `INSERT INTO qc_incidents
         (id, incident_date, person_completing, reporting_individual, customer, job_id, job_ref, product_delivered,
          delivery_date, incident_category, risk_level, incident_details, root_cause, implicated_departments,
          corrective_actions, created_by_id, created_by_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        val.incident_date,
        val.person_completing,
        val.reporting_individual,
        val.customer,
        val.job_id,
        val.job_ref,
        val.product_delivered,
        val.delivery_date,
        val.incident_category,
        val.risk_level,
        val.incident_details,
        val.root_cause,
        JSON.stringify(val.implicated_departments),
        val.corrective_actions,
        actorId,
        actorName || null,
        createdAt
      )
      .run();

    await logActivity(
      DB,
      "create",
      "qc_incident",
      id,
      `Incident: ${val.customer} — ${val.incident_category} (${val.risk_level})`,
      {
        incident_date: val.incident_date,
        customer: val.customer,
        job_ref: val.job_ref,
        product_delivered: val.product_delivered,
        incident_category: val.incident_category,
        risk_level: val.risk_level,
      },
      actorId
    );

    // Forward to Drive off the response path; forwardIncident never throws. Production builds only:
    // under next dev, getPlatformProxy hands back a ctx AND the real QC_GAS_URL from wrangler.toml, so
    // a local test save would file a real Doc and add a row to the live incident tracker (qc-03 rule).
    if (process.env.NODE_ENV === "production") {
      try {
        const { env, ctx } = await getCloudflareContext();
        ctx?.waitUntil?.(forwardIncident(DB, (env as any).QC_GAS_URL, id, { manual: false, customersTimeoutMs: POST_SAVE_CUSTOMERS_TIMEOUT_MS }));
      } catch {
        // No Cloudflare context — the */5 cron sweep forwards it.
      }
    }

    const incident = await DB.prepare(`SELECT ${INCIDENT_COLUMNS} FROM qc_incidents WHERE id = ?`).bind(id).first<IncidentRow>();
    return NextResponse.json({ ok: true, incident }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't save the incident report.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
