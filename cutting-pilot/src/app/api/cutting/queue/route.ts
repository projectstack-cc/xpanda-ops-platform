// src/app/v2/api/cutting/queue/route.ts  →  GET /v2/api/cutting/queue
// Returns the clock-into-able queue: active jobs with per-line state.
// Lazily reconciles cutting_lines from each job's processes (INSERT OR IGNORE)
// so the board reflects the job board without requiring a separate migration step.
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/db";

const PROCESS_ORDER = ["Cross Cutter", "Hole Cutter", "Main Line", "Blue Line", "Laminate"];
// Lines whose work unit is a CHUNK (block→chunk). Their target needs the step-2 block-calc
// engine + a per-job block-dimension source, so P225 leaves their qty_target NULL.
// Every other required line is a PART line: target = total ordered units (no math needed).
const CHUNK_LINES = new Set(["Cross Cutter", "Hole Cutter"]);

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
      `SELECT id, job_id, line, operator_name, started_at
       FROM cutting_sessions
       WHERE status = 'open' AND job_id IN (${placeholders})`
    ).bind(...jobIds).all<any>();

    // One query for the most-recent closed session per (job_id, line) — the resume hint
    const lastHandoffRows = await DB.prepare(
      `SELECT cs.id, cs.job_id, cs.line, cs.handoff_note, cs.photo_key
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

    const openByKey = new Map<
      string,
      { session_id: string; operator_name: string; started_at: string }
    >();
    for (const row of (openSessionRows.results || [])) {
      openByKey.set(`${row.job_id}:${row.line}`, {
        session_id: row.id,
        operator_name: row.operator_name,
        started_at: row.started_at,
      });
    }

    const handoffByKey = new Map<string, string>();
    for (const row of (lastHandoffRows.results || [])) {
      handoffByKey.set(`${row.job_id}:${row.line}`, row.handoff_note || "");
    }

    // Cut-list photos: latest closed session per line that carries a photo, grouped per job.
    // Assigned onto each job object so the existing `{ ...job, ... }` return spreads it through.
    const photosByJob = new Map<string, { session_id: string; line: string }[]>();
    for (const row of (lastHandoffRows.results || [])) {
      if (!row.photo_key) continue;
      if (!photosByJob.has(row.job_id)) photosByJob.set(row.job_id, []);
      photosByJob.get(row.job_id)!.push({ session_id: row.id, line: row.line });
    }
    for (const job of jobs) {
      (job as any).photos = photosByJob.get(job.id) || [];
    }

    // Line items (parts + qty) for each job — for the Parts slide-over.
    // jobIds + placeholders are already in scope from the lines/sessions queries above.
    const lineItemRows = await DB.prepare(
      `SELECT id, job_id, part_number, description, quantity, dimensions
       FROM job_line_items
       WHERE job_id IN (${placeholders})
       ORDER BY job_id, sort_order ASC`
    ).bind(...jobIds).all<any>();

    const lineItemsByJob = new Map<string, any[]>();
    for (const row of (lineItemRows.results || [])) {
      if (!lineItemsByJob.has(row.job_id)) lineItemsByJob.set(row.job_id, []);
      lineItemsByJob.get(row.job_id)!.push({
        id: row.id,
        part_number: row.part_number || "",
        description: row.description || "",
        quantity: row.quantity ?? null,
        dimensions: row.dimensions || "",
      });
    }

    // ── Cut-plan persistence (P225) ────────────────────────────────────────────────
    // Instance cut plan per job + one cut_plan_lines row per required line.
    // Part lines (Main/Blue/Laminate): qty_target = SUM of ordered units (from line items,
    //   already in memory as lineItemsByJob). Chunk lines: qty_target NULL until step-2.
    // Lazy INSERT OR IGNORE mirrors the cutting_lines reconcile above (idempotent per GET;
    // does not overwrite an existing row, so staleness is a step-2 regenerate concern).
    const planIdByJob = new Map<string, string>();
    const partUnitsByJob = new Map<string, number>();
    for (const job of jobs) {
      const items = lineItemsByJob.get(job.id) || [];
      const total = items.reduce(
        (sum: number, it: any) => sum + (Number(it.quantity) > 0 ? Number(it.quantity) : 0),
        0
      );
      partUnitsByJob.set(job.id, total);
      planIdByJob.set(job.id, crypto.randomUUID());
    }

    const planStmts: ReturnType<typeof DB.prepare>[] = [];
    for (const job of jobs) {
      planStmts.push(
        DB.prepare(
          `INSERT OR IGNORE INTO cut_plans (id, job_id, source, created_at, updated_at)
           VALUES (?, ?, 'auto', ?, ?)`
        ).bind(planIdByJob.get(job.id), job.id, now, now)
      );
    }
    for (const job of jobs) {
      const planId = planIdByJob.get(job.id)!;
      const partUnits = partUnitsByJob.get(job.id) ?? 0;
      for (const line of job.requiredLines) {
        const isChunk = CHUNK_LINES.has(line);
        planStmts.push(
          DB.prepare(
            `INSERT OR IGNORE INTO cut_plan_lines
               (id, cut_plan_id, job_id, line, unit, qty_target, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            crypto.randomUUID(),
            planId,
            job.id,
            line,
            isChunk ? "chunk" : "part",
            isChunk ? null : partUnits,
            now,
            now
          )
        );
      }
    }
    // Same D1 batch-size guard (50) used for the cutting_lines reconcile above.
    for (let i = 0; i < planStmts.length; i += 50) {
      await DB.batch(planStmts.slice(i, i + 50));
    }

    // Read back the authoritative per-line plan values (covers pre-existing rows, not just
    // the ones just inserted) for the payload.
    const planLineRows = await DB.prepare(
      `SELECT job_id, line, unit, qty_target
       FROM cut_plan_lines
       WHERE job_id IN (${placeholders})`
    ).bind(...jobIds).all<any>();

    const planByKey = new Map<string, { unit: "chunk" | "part"; qty_target: number | null }>();
    for (const row of (planLineRows.results || [])) {
      planByKey.set(`${row.job_id}:${row.line}`, {
        unit: (row.unit === "chunk" ? "chunk" : "part"),
        qty_target: row.qty_target ?? null,
      });
    }

    // Mirror part-line targets into cutting_lines.qty_target where still NULL, so the existing
    // column becomes meaningful for downstream throughput/yield without a schema change.
    const mirrorStmts: ReturnType<typeof DB.prepare>[] = [];
    for (const job of jobs) {
      for (const line of job.requiredLines) {
        if (CHUNK_LINES.has(line)) continue;
        const plan = planByKey.get(`${job.id}:${line}`);
        if (!plan || plan.qty_target == null) continue;
        mirrorStmts.push(
          DB.prepare(
            `UPDATE cutting_lines SET qty_target = ?, updated_at = ?
             WHERE job_id = ? AND line = ? AND qty_target IS NULL`
          ).bind(plan.qty_target, now, job.id, line)
        );
      }
    }
    for (let i = 0; i < mirrorStmts.length; i += 50) {
      if (mirrorStmts.length) await DB.batch(mirrorStmts.slice(i, i + 50));
    }

    // ── Taper chunk targets (P227) ─────────────────────────────────────────────────
    // Taper orders flow Cross Cutter (block→chunks) → Main Line (diagonal wire finishes parts).
    // Main Line target = ordered parts (already set as a part line above). Here Cross Cutter's
    // chunk target = ceil(taper parts ÷ yield-per-chunk). Taper line items are detected by the
    // "A\">B\"" thickness-ramp pattern; yield is per-job (cut_plans.taper_yield) or the default.
    const TAPER_RE = /(\d+(?:\.\d+)?)\s*"?\s*(?:->|→|>)\s*(\d+(?:\.\d+)?)\s*"?/;
    const DEFAULT_TAPER_YIELD = 12;

    const taperYieldRows = await DB.prepare(
      `SELECT job_id, taper_yield, blocks_needed FROM cut_plans WHERE job_id IN (${placeholders})`
    ).bind(...jobIds).all<any>();
    const taperYieldByJob = new Map<string, number | null>();
    const blocksNeededByJob = new Map<string, number | null>();
    for (const row of (taperYieldRows.results || [])) {
      taperYieldByJob.set(row.job_id, row.taper_yield ?? null);
      blocksNeededByJob.set(row.job_id, row.blocks_needed ?? null);
    }

    const taperInfoByJob = new Map<string, { is_taper: boolean; yield: number | null }>();
    const taperUpdateStmts: ReturnType<typeof DB.prepare>[] = [];
    for (const job of jobs) {
      const items = lineItemsByJob.get(job.id) || [];
      const taperParts = items.reduce(
        (sum: number, it: any) =>
          sum +
          (TAPER_RE.test(it.dimensions || "") && Number(it.quantity) > 0
            ? Number(it.quantity)
            : 0),
        0
      );
      const isTaper = taperParts > 0;
      const storedYield = taperYieldByJob.get(job.id) ?? null;
      taperInfoByJob.set(job.id, { is_taper: isTaper, yield: storedYield });
      if (!isTaper) continue;
      if (!job.requiredLines.includes("Cross Cutter")) continue;
      const yieldUsed = storedYield && storedYield > 0 ? storedYield : DEFAULT_TAPER_YIELD;
      const chunks = Math.ceil(taperParts / yieldUsed);
      // Cross Cutter chunk target — overwrite (parts/yield may change). Not NULL-guarded.
      taperUpdateStmts.push(
        DB.prepare(
          `UPDATE cut_plan_lines SET qty_target = ?, updated_at = ?
           WHERE job_id = ? AND line = 'Cross Cutter'`
        ).bind(chunks, now, job.id)
      );
      taperUpdateStmts.push(
        DB.prepare(
          `UPDATE cutting_lines SET qty_target = ?, updated_at = ?
           WHERE job_id = ? AND line = 'Cross Cutter'`
        ).bind(chunks, now, job.id)
      );
      // Reflect immediately in the payload map built above.
      planByKey.set(`${job.id}:Cross Cutter`, { unit: "chunk", qty_target: chunks });
    }
    for (let i = 0; i < taperUpdateStmts.length; i += 50) {
      if (taperUpdateStmts.length) await DB.batch(taperUpdateStmts.slice(i, i + 50));
    }

    // Per-line tracked time (closed sessions only) — true time tracking.
    // jobIds + placeholders already in scope from the queries above.
    const durationRows = await DB.prepare(
      `SELECT job_id, line,
              COALESCE(SUM((julianday(ended_at) - julianday(started_at)) * 86400), 0) AS tracked_seconds
       FROM cutting_sessions
       WHERE status = 'closed' AND job_id IN (${placeholders})
       GROUP BY job_id, line`
    ).bind(...jobIds).all<any>();

    const durByKey = new Map<string, number>();
    for (const row of (durationRows.results || [])) {
      durByKey.set(`${row.job_id}:${row.line}`, Math.round(Number(row.tracked_seconds) || 0));
    }

    // Per-line checklist progress: (job, line, line_item) → completed (+ qty, reserved).
    const progressRows = await DB.prepare(
      `SELECT job_id, line, line_item_id, completed, completed_qty
       FROM cutting_line_progress
       WHERE job_id IN (${placeholders})`
    ).bind(...jobIds).all<any>();

    const progressByJob = new Map<
      string,
      Record<string, Record<string, { completed: boolean; completed_qty: number | null }>>
    >();
    for (const row of (progressRows.results || [])) {
      if (!progressByJob.has(row.job_id)) progressByJob.set(row.job_id, {});
      const byLine = progressByJob.get(row.job_id)!;
      if (!byLine[row.line]) byLine[row.line] = {};
      byLine[row.line][row.line_item_id] = {
        completed: !!row.completed,
        completed_qty: row.completed_qty ?? null,
      };
    }
    for (const job of jobs) {
      (job as any).progress = progressByJob.get(job.id) || {};
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
          tracked_seconds: durByKey.get(key) || 0,
          open_started_at: open?.started_at ?? null,
          unit: (planByKey.get(key)?.unit ?? "part") as "chunk" | "part",
          qty_target: planByKey.get(key)?.qty_target ?? null,
        };
      });
      return {
        ...job,
        lines,
        line_items: lineItemsByJob.get(job.id) || [],
        is_taper: taperInfoByJob.get(job.id)?.is_taper ?? false,
        taper_yield: taperInfoByJob.get(job.id)?.yield ?? null,
        blocks_needed: blocksNeededByJob.get(job.id) ?? null,
      };
    });

    return NextResponse.json({ ok: true, queue });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
