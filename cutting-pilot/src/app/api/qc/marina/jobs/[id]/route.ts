// src/app/api/qc/marina/jobs/[id]/route.ts  →  GET/PATCH/DELETE /v2/api/qc/marina/jobs/:id
// marina-02. GET = job detail (files, parts + dims + tallies + locked). PATCH edits name / customer /
// notes / status: "complete" stamps completed_at, "open" clears it; complete / reopen are logged as
// their own actions. DELETE cascades every child row in one D1 batch, then removes the job's R2
// objects best-effort (lib/marina/store.ts cascadeDeleteJob).
// Gated on `qc.marina` by middleware (GET → view, PATCH/DELETE → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { actor, cascadeDeleteJob, cleanName, cleanOptional, loadJob, loadJobDetail } from "@/lib/marina/store";

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ ok: false, error: "Marina job not found." }, { status: 404 });

export async function GET(_request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { DB } = await getEnv();
    const detail = await loadJobDetail(DB, id);
    if (!detail) return notFound();
    return NextResponse.json({ ok: true, detail });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
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

    const sets: string[] = [];
    const binds: unknown[] = [];
    const changed: Record<string, unknown> = {};
    if ("name" in body) {
      const r = cleanName(body.name);
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
      sets.push("name = ?"); binds.push(r.value); changed.name = r.value;
    }
    if ("customer" in body) {
      const r = cleanOptional(body.customer, 80, "Customer");
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
      sets.push("customer = ?"); binds.push(r.value); changed.customer = r.value;
    }
    if ("notes" in body) {
      const r = cleanOptional(body.notes, 2000, "Notes");
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 400 });
      sets.push("notes = ?"); binds.push(r.value); changed.notes = r.value;
    }
    let status: "open" | "complete" | null = null;
    if ("status" in body) {
      if (body.status !== "open" && body.status !== "complete") {
        return NextResponse.json({ ok: false, error: "status must be open or complete." }, { status: 400 });
      }
      status = body.status;
    }
    if (!sets.length && !status) {
      return NextResponse.json({ ok: false, error: "Nothing to update." }, { status: 400 });
    }

    const before = await loadJob(DB, id);
    if (!before) return notFound();
    // Only a real transition stamps / clears completed_at (re-sending "complete" keeps the original time).
    const transition = status && status !== before.status ? status : null;
    if (transition === "complete") sets.push("status = 'complete'", "completed_at = datetime('now')");
    if (transition === "open") sets.push("status = 'open'", "completed_at = NULL");

    if (sets.length) {
      await DB.prepare(`UPDATE marina_jobs SET ${sets.join(", ")} WHERE id = ?`).bind(...binds, id).run();
    }
    const job = await loadJob(DB, id);
    const label = job?.name ?? before.name;
    if (Object.keys(changed).length) {
      await logActivity(DB, "update", "marina_job", id, label, changed, who.id);
    }
    if (transition) {
      await logActivity(DB, transition === "complete" ? "complete" : "reopen", "marina_job", id, label,
        { status: transition }, who.id);
    }
    return NextResponse.json({ ok: true, job });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  try {
    const { DB, BOL_PHOTOS } = await getEnv();
    const who = actor(request);
    const job = await loadJob(DB, id);
    if (!job) return notFound();
    const deleted = await cascadeDeleteJob(DB, BOL_PHOTOS, id);
    await logActivity(DB, "delete", "marina_job", id, job.name, { name: job.name, ...deleted }, who.id);
    return NextResponse.json({ ok: true, deleted });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
