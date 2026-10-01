// src/app/api/qb/pending/route.ts  →  GET /v2/api/qb/pending?status=open
// qb-02: QuickBooks review queue list (session-gated: /v2/api/qb → `jobs` view). Newest first,
// with live floorState for rows tied to a job.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { floorState } from "@/lib/qb/jobState";
import { publicRow } from "@/lib/qb/review";
import type { PendingRow } from "@/lib/qb/process";

const STATUSES = ["open", "applied", "dismissed", "resolved_manual", "all"];

export async function GET(request: NextRequest) {
  try {
    const { DB } = await getEnv();
    const status = request.nextUrl.searchParams.get("status") || "open";
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ ok: false, error: "Invalid status." }, { status: 400 });
    }
    const rows = status === "all"
      ? await DB.prepare(`SELECT * FROM qb_pending_changes ORDER BY last_event_at DESC LIMIT 200`).all<PendingRow>()
      : await DB.prepare(`SELECT * FROM qb_pending_changes WHERE status = ? ORDER BY last_event_at DESC LIMIT 200`).bind(status).all<PendingRow>();
    const items = [];
    for (const row of rows.results ?? []) {
      const pub = publicRow(row);
      let customer = pub.proposed?.customer ?? "";
      if (!customer && row.job_id) {
        const j = await DB.prepare(`SELECT customer FROM jobs WHERE id = ?`).bind(row.job_id).first<{ customer: string }>();
        customer = j?.customer ?? "";
      }
      const floor = row.job_id ? await floorState(DB, row.job_id) : null;
      const { proposed: _omit, ...rest } = pub;
      items.push({ ...rest, customer, floorState: floor });
    }
    return NextResponse.json({ ok: true, items });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
