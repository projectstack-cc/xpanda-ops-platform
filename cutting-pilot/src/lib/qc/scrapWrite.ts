// src/lib/qc/scrapWrite.ts — qc-05 (server-only)
// The one write path into scrap_events, shared by POST /v2/api/qc/scrap (source='qc') and
// POST /v2/api/cutting/scrap (source='cutting'). Moved verbatim from the qc-04 route: 1–20 entries,
// all-or-nothing — pass 1 validates every entry's shape, pass 2 re-reads each job (customer + INV come
// from the job, never the client) and checks line-item ownership; one bad entry rejects the batch with
// per-entry errors. One DB.batch insert, then a create/scrap_event activity row per entry.
import type { D1Database } from "@cloudflare/workers-types";
import { logActivity } from "@/lib/activityLog";
import {
  MAX_ENTRIES,
  monthName,
  validateScrapEntry,
  weekNumberMondayStart,
  type ScrapEntryValue,
  type ScrapRow,
} from "@/lib/qc/scrap";

export interface ScrapWriteContext {
  source: "qc" | "cutting";
  actorId: string;
  actorName: string;
  operatorId?: string | null; // cutting: = actorId
  cuttingLineIdByJob?: (jobId: string) => Promise<string | null>; // cutting only
}

export type ScrapWriteResult =
  | { ok: true; rows: ScrapRow[] }
  | { ok: false; status: number; error: string; detail?: string; errors?: { index: number; messages: string[] }[] };

export async function saveScrapEntries(DB: D1Database, raw: unknown[], ctx: ScrapWriteContext): Promise<ScrapWriteResult> {
  if (raw.length < 1 || raw.length > MAX_ENTRIES) {
    return { ok: false, status: 400, error: `Send between 1 and ${MAX_ENTRIES} entries.`, detail: `entries=${raw.length}` };
  }

  // Pass 1 — shape validation for every entry before anything touches the DB.
  const values: ScrapEntryValue[] = [];
  const errors: { index: number; messages: string[] }[] = [];
  raw.forEach((e, index) => {
    const r = validateScrapEntry((e ?? {}) as any);
    if (r.ok) {
      values[index] = r.value;
      if (r.value.line_item_id && !r.value.job_id) {
        errors.push({ index, messages: ["A part from an order needs the order's job_id."] });
      }
    } else {
      errors.push({ index, messages: r.errors });
    }
  });

  try {
    // Pass 2 — order links: job_id is re-read (customer + INV come from the job, never the client),
    // and a line_item_id must belong to that job.
    const jobCache = new Map<string, { invoice_number: string | null; customer: string | null } | null>();
    const resolved: { customer: string | null; inv_number: string }[] = [];
    for (let index = 0; index < raw.length; index++) {
      const v = values[index];
      if (!v) continue;
      resolved[index] = { customer: null, inv_number: v.inv_number };
      if (!v.job_id) continue;
      if (!jobCache.has(v.job_id)) {
        const job = await DB.prepare(`SELECT invoice_number, customer FROM jobs WHERE id = ?`)
          .bind(v.job_id)
          .first<{ invoice_number: string | null; customer: string | null }>();
        jobCache.set(v.job_id, job ?? null);
      }
      const job = jobCache.get(v.job_id);
      if (!job) {
        errors.push({ index, messages: ["That order no longer exists — look the INV # up again."] });
        continue;
      }
      resolved[index] = { customer: job.customer ?? null, inv_number: (job.invoice_number ?? "").trim() || v.inv_number };
      if (v.line_item_id) {
        const li = await DB.prepare(`SELECT id FROM job_line_items WHERE id = ? AND job_id = ?`)
          .bind(v.line_item_id, v.job_id)
          .first<{ id: string }>();
        if (!li) errors.push({ index, messages: ["That part isn't on this order."] });
      }
    }

    if (errors.length) {
      errors.sort((a, b) => a.index - b.index);
      const first = errors[0];
      return {
        ok: false,
        status: 400,
        error: `Entry ${first.index + 1}: ${first.messages[0]}`,
        detail: `${errors.length} entr${errors.length === 1 ? "y" : "ies"} invalid`,
        errors,
      };
    }

    // cutting: every entry shares one job + line, so the lookup is cached per job.
    const cuttingLineIds = new Map<string, string | null>();
    const cuttingLineIdFor = async (jobId: string | null): Promise<string | null> => {
      if (!jobId || !ctx.cuttingLineIdByJob) return null;
      if (!cuttingLineIds.has(jobId)) cuttingLineIds.set(jobId, await ctx.cuttingLineIdByJob(jobId));
      return cuttingLineIds.get(jobId) ?? null;
    };

    const createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");
    const rows: ScrapRow[] = [];
    for (let index = 0; index < values.length; index++) {
      const v = values[index];
      rows.push({
        id: crypto.randomUUID(),
        event_date: v.event_date,
        week_number: weekNumberMondayStart(v.event_date),
        month_name: monthName(v.event_date),
        shift: v.shift,
        source: ctx.source,
        job_id: v.job_id,
        line_item_id: v.job_id ? v.line_item_id : null,
        cutting_line_id: await cuttingLineIdFor(v.job_id),
        inv_number: resolved[index].inv_number,
        customer: resolved[index].customer,
        line_machine: v.line_machine,
        operator_id: ctx.operatorId ?? null,
        operator_name: v.operator_name,
        part_product: v.part_product,
        material_density: v.material_density,
        pieces: v.pieces,
        thickness_in: v.thickness_in,
        width_in: v.width_in,
        length_in: v.length_in,
        scrap_cubic_in: v.scrap_cubic_in,
        scrap_board_ft: v.scrap_board_ft,
        scrap_reason: v.scrap_reason,
        notes: v.notes,
        created_by_id: ctx.actorId,
        created_by_name: ctx.actorName || null,
        created_at: createdAt,
        voided_at: null,
        voided_by_name: null,
        void_reason: null,
      });
    }

    await DB.batch(
      rows.map((r) =>
        DB.prepare(
          `INSERT INTO scrap_events
             (id, event_date, week_number, month_name, shift, source, job_id, line_item_id, cutting_line_id,
              inv_number, customer, line_machine, operator_id, operator_name, part_product, material_density,
              pieces, thickness_in, width_in, length_in, scrap_cubic_in, scrap_board_ft, scrap_reason, notes,
              created_by_id, created_by_name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          r.id, r.event_date, r.week_number, r.month_name, r.shift, r.source, r.job_id, r.line_item_id, r.cutting_line_id,
          r.inv_number, r.customer, r.line_machine, r.operator_id, r.operator_name, r.part_product, r.material_density,
          r.pieces, r.thickness_in, r.width_in, r.length_in, r.scrap_cubic_in, r.scrap_board_ft, r.scrap_reason, r.notes,
          r.created_by_id, r.created_by_name, r.created_at
        )
      )
    );

    for (const r of rows) {
      await logActivity(
        DB,
        "create",
        "scrap_event",
        r.id,
        `Logged scrap: INV ${r.inv_number} — ${r.part_product} (${r.scrap_reason}, ${r.scrap_board_ft.toFixed(2)} bd ft)`,
        {
          source: r.source,
          event_date: r.event_date,
          shift: r.shift,
          line_machine: r.line_machine,
          job_id: r.job_id,
          line_item_id: r.line_item_id,
          pieces: r.pieces,
          scrap_cubic_in: r.scrap_cubic_in,
          scrap_reason: r.scrap_reason,
        },
        ctx.actorId
      );
    }

    return { ok: true, rows };
  } catch (e: any) {
    return { ok: false, status: 500, error: "Couldn't save the scrap entries.", detail: String(e?.message || e) };
  }
}
