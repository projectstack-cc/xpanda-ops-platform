// src/app/api/qb/pending/[id]/route.ts  →  GET /v2/api/qb/pending/:id
// qb-02: one review item + proposed order, diff, floorState, and the current job snapshot.
// Opening an open item refreshes its diff/base_hash against the job as it is now.
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { floorState, loadJobAsInput } from "@/lib/qb/jobState";
import { getPending, publicRow, refreshOpenItem } from "@/lib/qb/review";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { DB } = await getEnv();
    let row = await getPending(DB, id);
    if (!row) return NextResponse.json({ ok: false, error: "Review item not found." }, { status: 404 });
    row = await refreshOpenItem(DB, row);
    const job = row.job_id ? await loadJobAsInput(DB, row.job_id) : null;
    const floor = row.job_id ? await floorState(DB, row.job_id) : null;
    const item = publicRow(row);
    return NextResponse.json({ ok: true, item: { ...item, customer: item.proposed?.customer || job?.customer || "" }, job, floorState: floor });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "Server error.", detail: String(e?.message || e) }, { status: 500 });
  }
}
