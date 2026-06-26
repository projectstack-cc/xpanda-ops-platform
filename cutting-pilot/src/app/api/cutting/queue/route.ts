// src/app/v2/api/cutting/queue/route.ts  →  GET /v2/api/cutting/queue
// Returns the clock-into-able queue: active jobs with per-line state.
// Lazily reconciles cutting_lines from each job's processes (INSERT OR IGNORE)
// so the board reflects the job board without requiring a separate migration step.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";

const PROCESS_ORDER = ["Cross Cutter", "Hole Cutter", "Main Line", "Blue Line", "Laminate"];

export async function GET() {
  const { DB } = await getEnv();
  try {
    const jobRows = await DB.prepare(
      `SELECT j.id, j.customer, j.invoice_number, j.po_number, j.ship_date,
              j.status, j.priority, j.processes
       FROM jobs j
       WHERE j.status NOT IN ('archived','shipped')
       ORDER BY j.ship_date ASC, j.invoice_number ASC`
    ).all<any>();

    const jobs = (jobRows.results || [])
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

    if (jobs.length === 0) return NextResponse.json({ ok: true, queue: [] });

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const jobIds = jobs.map((j: any) => j.id);

    // Lazy reconcile: ensure a cutting_lines row exists for every required (job, line).
    // INSERT OR IGNORE is idempotent — safe to run on every GET.
    const insertStmts: ReturnType<typeof DB.prepare>[] = [];
    for (const job of jobs) {
      for (const line of job.requiredLines) {
        insertStmts.push(
          DB.prepare(
            `INSERT OR IGNORE INTO cutting_lines
               (id, job_id, line, line_status, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, 'not_started', ?, ?, ?)`
          ).bind(crypto.randomUUID(), job.id, line, PROCESS_ORDER.indexOf(line), now, now)
        );
      }
    }
    // D1 batch limit is 100; a cutting floor with >20 active jobs and 5 lines each hits it.
    // Chunk conservatively at 50 to stay well clear.
    for (let i = 0; i < insertStmts.length; i += 50) {
      await DB.batch(insertStmts.slice(i, i + 50));
    }

    const placeholders = jobIds.map(() => "?").join(",");

    // One query for all cutting_lines of these jobs
    const linesRows = await DB.prepare(
      `SELECT id, job_id, line, line_status, sort_order
       FROM cutting_lines
       WHERE job_id IN (${placeholders})
       ORDER BY sort_order ASC`
    ).bind(...jobIds).all<any>();

    // One query for all currently open sessions on these jobs
    const openSessionRows = await DB.prepare(
      `SELECT id, job_id, line, operator_name
       FROM cutting_sessions
       WHERE status = 'open' AND job_id IN (${placeholders})`
    ).bind(...jobIds).all<any>();

    // One query for the most-recent closed session per (job_id, line) — the resume hint
    const lastHandoffRows = await DB.prepare(
      `SELECT cs.job_id, cs.line, cs.handoff_note
       FROM cutting_sessions cs
       INNER JOIN (
         SELECT job_id, line, MAX(ended_at) AS max_ended
         FROM cutting_sessions
         WHERE status = 'closed' AND job_id IN (${placeholders})
         GROUP BY job_id, line
       ) latest
         ON cs.job_id = latest.job_id
        AND cs.line = latest.line
        AND cs.ended_at = latest.max_ended
       WHERE cs.status = 'closed'`
    ).bind(...jobIds).all<any>();

    // Build lookup maps for O(1) assembly
    const linesByJob = new Map<string, Map<string, any>>();
    for (const row of (linesRows.results || [])) {
      if (!linesByJob.has(row.job_id)) linesByJob.set(row.job_id, new Map());
      linesByJob.get(row.job_id)!.set(row.line, row);
    }

    const openByKey = new Map<string, { session_id: string; operator_name: string }>();
    for (const row of (openSessionRows.results || [])) {
      openByKey.set(`${row.job_id}:${row.line}`, {
        session_id: row.id,
        operator_name: row.operator_name,
      });
    }

    const handoffByKey = new Map<string, string>();
    for (const row of (lastHandoffRows.results || [])) {
      handoffByKey.set(`${row.job_id}:${row.line}`, row.handoff_note || "");
    }

    // Line items (parts + qty) for each job — for the Parts slide-over.
    // jobIds + placeholders are already in scope from the lines/sessions queries above.
    const lineItemRows = await DB.prepare(
      `SELECT job_id, part_number, description, quantity, dimensions
       FROM job_line_items
       WHERE job_id IN (${placeholders})
       ORDER BY job_id, sort_order ASC`
    ).bind(...jobIds).all<any>();

    const lineItemsByJob = new Map<string, any[]>();
    for (const row of (lineItemRows.results || [])) {
      if (!lineItemsByJob.has(row.job_id)) lineItemsByJob.set(row.job_id, []);
      lineItemsByJob.get(row.job_id)!.push({
        part_number: row.part_number || "",
        description: row.description || "",
        quantity: row.quantity ?? null,
        dimensions: row.dimensions || "",
      });
    }

    const queue = jobs.map((job: any) => {
      const jobLineMap = linesByJob.get(job.id) || new Map();
      const lines = job.requiredLines.map((lineName: string) => {
        const lineRow = jobLineMap.get(lineName);
        const key = `${job.id}:${lineName}`;
        const open = openByKey.get(key) ?? null;
        return {
          line: lineName,
          line_status: (lineRow?.line_status || "not_started") as
            "not_started" | "in_progress" | "complete",
          sort_order: PROCESS_ORDER.indexOf(lineName),
          open_session_id: open?.session_id ?? null,
          open_operator_name: open?.operator_name ?? null,
          last_handoff_note: handoffByKey.get(key) || "",
        };
      });
      return { ...job, lines, line_items: lineItemsByJob.get(job.id) || [] };
    });

    return NextResponse.json({ ok: true, queue });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
