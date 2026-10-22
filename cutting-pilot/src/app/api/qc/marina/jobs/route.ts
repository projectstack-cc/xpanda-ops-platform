// src/app/api/qc/marina/jobs/route.ts  →  GET/POST /v2/api/qc/marina/jobs
// marina-02. Marina Foam inspection jobs (one cut-sheet release each). GET lists with piece tallies
// (?status=open|complete|all, default open); POST creates. tolerance_in is always the ±3/16 default
// in v1 — a client-sent value is ignored. created_by = the session display name (X-User-Name).
// Gated on `qc.marina` by middleware (GET → view, POST → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { actor, cleanName, cleanOptional, listJobs, loadJob } from "@/lib/marina/store";

const STATUSES = ["open", "complete", "all"] as const;

export async function GET(request: NextRequest) {
  try {
    const raw = request.nextUrl.searchParams.get("status") || "open";
    if (!(STATUSES as readonly string[]).includes(raw)) {
      return NextResponse.json({ ok: false, error: "status must be open, complete or all.", detail: `status: ${raw}` }, { status: 400 });
    }
    const { DB } = await getEnv();
    const jobs = await listJobs(DB, raw as (typeof STATUSES)[number]);
    return NextResponse.json({ ok: true, jobs });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { DB } = await getEnv();
    const who = actor(request);
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return NextResponse.json({ ok: false, error: "Expected a JSON body." }, { status: 400 });
    }
    const name = cleanName(body.name);
    if (!name.ok) return NextResponse.json({ ok: false, error: name.error }, { status: 400 });
    const customer = cleanOptional(body.customer, 80, "Customer");
    if (!customer.ok) return NextResponse.json({ ok: false, error: customer.error }, { status: 400 });
    const notes = cleanOptional(body.notes, 2000, "Notes");
    if (!notes.ok) return NextResponse.json({ ok: false, error: notes.error }, { status: 400 });

    const id = crypto.randomUUID();
    await DB.prepare(
      "INSERT INTO marina_jobs (id, name, customer, notes, created_by) VALUES (?, ?, ?, ?, ?)"
    ).bind(id, name.value, customer.value, notes.value, who.name).run();
    const job = await loadJob(DB, id);

    await logActivity(DB, "create", "marina_job", id, name.value,
      { name: name.value, customer: customer.value }, who.id);
    return NextResponse.json({ ok: true, job }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
