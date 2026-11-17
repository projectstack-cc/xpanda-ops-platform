// src/app/api/tasks/manage/jobs/route.ts  →  GET /v2/api/tasks/manage/jobs?q=   (tasks-01)
// INV picker search. q trimmed 1–40 chars (else { ok, jobs: [] }). invoice_number LIKE q% OR customer LIKE %q%
// (LIKE wildcards escaped). Archived jobs included. ≤ 15 rows: exact invoice match first, then nearest ship_date to
// today (ET), NULL ship_date last. Middleware: tasks.manage view; canManageTasks re-checks.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { actorOf, etToday } from "@/lib/safety/records";
import { canManageTasks, fail } from "@/lib/tasks/db";

export const dynamic = "force-dynamic";

const MAX_Q = 40;
const LIMIT = 15;

export async function GET(request: NextRequest) {
  if (!actorOf(request.headers)) return fail(401, "Unauthorized");
  if (!canManageTasks(request.headers)) return fail(403, "Access denied.");
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 1 || q.length > MAX_Q) return NextResponse.json({ ok: true, jobs: [] });

  try {
    const { DB } = await getEnv();
    const esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const r = await DB.prepare(
      `SELECT id AS job_id, invoice_number, customer, ship_date, status,
              CASE WHEN archived_at IS NULL THEN 0 ELSE 1 END AS archived
         FROM jobs
        WHERE invoice_number LIKE ? ESCAPE '\\' OR customer LIKE ? ESCAPE '\\'
        ORDER BY CASE WHEN invoice_number = ? THEN 0 ELSE 1 END,
                 CASE WHEN julianday(ship_date) IS NULL THEN 1 ELSE 0 END,
                 ABS(julianday(ship_date) - julianday(?)),
                 invoice_number
        LIMIT ${LIMIT}`
    ).bind(`${esc}%`, `%${esc}%`, q, etToday()).all<any>();
    const jobs = (r.results ?? []).map((j: any) => ({
      job_id: j.job_id, invoice_number: j.invoice_number ?? null, customer: j.customer ?? null,
      ship_date: j.ship_date ?? null, status: j.status ?? null, archived: j.archived === 1,
    }));
    return NextResponse.json({ ok: true, jobs }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return fail(500, "Server error.", String(e?.message || e));
  }
}
