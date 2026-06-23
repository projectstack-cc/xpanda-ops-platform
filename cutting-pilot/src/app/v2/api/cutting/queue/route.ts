// src/app/v2/api/cutting/queue/route.ts  →  GET /v2/api/cutting/queue
// Reads jobs whose processes[] include checked cutting lines and returns the clock-into-able queue.
// BOM is STUBBED (qty_target null) — the block-calculator fills it later against THIS shape.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";

const PROCESS_ORDER = ["Cross Cutter", "Hole Cutter", "Main Line", "Blue Line", "Laminate"];

export async function GET() {
  const { DB } = await getEnv();
  try {
    const rows = await DB.prepare(
      `SELECT j.id, j.customer, j.invoice_number, j.po_number, j.ship_date,
              j.status, j.priority, j.processes
       FROM jobs j
       WHERE j.status NOT IN ('archived','shipped')
       ORDER BY j.ship_date ASC, j.invoice_number ASC`
    ).all<any>();

    const queue = (rows.results || [])
      .map((j: any) => {
        let procs: any[] = [];
        try { procs = JSON.parse(j.processes || "[]"); } catch {}
        const requiredLines = procs
          .filter((p: any) => PROCESS_ORDER.includes(p.name))
          .map((p: any) => p.name)
          .sort((a: string, b: string) => PROCESS_ORDER.indexOf(a) - PROCESS_ORDER.indexOf(b));
        return { ...j, processes: undefined, requiredLines };
      })
      .filter((j: any) => j.requiredLines.length > 0);

    return NextResponse.json({ ok: true, queue });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
