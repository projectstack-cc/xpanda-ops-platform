// src/app/api/loading-board/route.ts  →  GET /v2/api/loading-board
// Read-only: all active loading bays, each with its currently-active load(s) (statuses
// not_started/loading/loaded — matches logistics/loading.html's bay-card logic). One JOIN query,
// no per-bay round-trips. Never writes.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";

const ACTIVE_STATUSES = ["not_started", "loading", "loaded"];

interface LoadingBoardRowDb {
  bay_id: string;
  bay_number: number;
  label: string;
  assignment_id: string | null;
  customer: string | null;
  invoice_number: string | null;
  trailer_number: string | null;
  loading_status: string | null;
  load_number: number | null;
  load_count: number | null;
}

interface LoadingBoardLoad {
  customer: string | null;
  invoice_number: string | null;
  trailer_number: string | null;
  loading_status: string;
  load_number: number;
  load_count: number | null;
}

interface LoadingBoardBay {
  bay_id: string;
  bay_number: number;
  label: string;
  loads: LoadingBoardLoad[];
}

export async function GET() {
  const { DB } = await getEnv();
  try {
    const { results } = await DB.prepare(
      `SELECT lb.id AS bay_id, lb.bay_number, lb.label,
              la.id AS assignment_id, j.customer, j.invoice_number, la.trailer_number,
              la.loading_status, la.load_number, j.load_count
       FROM loading_bays lb
       LEFT JOIN loading_assignments la
         ON la.bay_id = lb.id AND la.loading_status IN (${ACTIVE_STATUSES.map(() => "?").join(",")})
       LEFT JOIN jobs j ON la.job_id = j.id
       WHERE lb.is_active = 1
       ORDER BY lb.bay_number ASC, la.load_number ASC`
    )
      .bind(...ACTIVE_STATUSES)
      .all<LoadingBoardRowDb>();

    const bays = new Map<string, LoadingBoardBay>();
    for (const row of results ?? []) {
      if (!bays.has(row.bay_id)) {
        bays.set(row.bay_id, {
          bay_id: row.bay_id,
          bay_number: row.bay_number,
          label: row.label,
          loads: [],
        });
      }
      if (row.assignment_id) {
        bays.get(row.bay_id)!.loads.push({
          customer: row.customer,
          invoice_number: row.invoice_number,
          trailer_number: row.trailer_number,
          loading_status: row.loading_status ?? "awaiting",
          load_number: row.load_number ?? 1,
          load_count: row.load_count,
        });
      }
    }

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      bays: Array.from(bays.values()),
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
