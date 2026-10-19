// src/app/api/qc/scrap/route.ts  ->  GET /v2/api/qc/scrap?week=YYYY-MM-DD, POST /v2/api/qc/scrap
// qc-04: the native scrap database (scrap_events). One table, two entry points: the /v2/qc Scrap log
// popup (here, source='qc') and the cutting board's Mark Complete (qc-05, source='cutting'). The 11
// legacy form rows carried over as source='legacy'. scrap_log is now a compatibility VIEW over the
// non-voided rows for the legacy scrap reports — never INSERT into it.
//   GET  — that Monday..Sunday's rows by event_date, newest first, voided rows included (flagged);
//          totals cover non-voided rows only.
//   POST — { entries: Entry[] } (1–20), all-or-nothing: every entry is validated first and one bad
//          entry rejects the batch with per-entry errors. Volume (pieces × T × W × L, bdft = in³ ÷ 144),
//          week_number and month_name are computed here; job_id re-reads the job for customer + INV.
// Gated on `qc` by middleware (GET → view, POST → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import {
  MAX_ENTRIES,
  addDaysYmd,
  isValidYmd,
  monthName,
  validateScrapEntry,
  weekNumberMondayStart,
  type ScrapEntryValue,
  type ScrapRow,
} from "@/lib/qc/scrap";

const COLUMNS = `id, event_date, week_number, month_name, shift, source, job_id, line_item_id, cutting_line_id,
  inv_number, customer, line_machine, operator_id, operator_name, part_product, material_density, pieces,
  thickness_in, width_in, length_in, scrap_cubic_in, scrap_board_ft, scrap_reason, notes, created_by_id,
  created_by_name, created_at, voided_at, voided_by_name, void_reason`;

function bad(error: string, detail = "", extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, detail, ...extra }, { status: 400 });
}

export async function GET(request: NextRequest) {
  const week = request.nextUrl.searchParams.get("week") ?? "";
  if (!isValidYmd(week)) {
    return bad("week is required (YYYY-MM-DD Monday).", `week=${week}`);
  }
  try {
    const { DB } = await getEnv();
    const res = await DB.prepare(
      `SELECT ${COLUMNS} FROM scrap_events
        WHERE event_date >= ? AND event_date <= ?
        ORDER BY event_date DESC, created_at DESC`
    )
      .bind(week, addDaysYmd(week, 6))
      .all<ScrapRow>();
    const rows = res.results ?? [];
    let entries = 0;
    let boardFt = 0;
    for (const r of rows) {
      if (r.voided_at) continue;
      entries++;
      boardFt += Number(r.scrap_board_ft) || 0;
    }
    return NextResponse.json({
      ok: true,
      rows,
      totals: { entries, boardFt: Math.round(boardFt * 1000) / 1000 },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't load the scrap log.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const actorId = request.headers.get("X-User-Id");
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const actorName = request.headers.get("X-User-Name") || "";

  let body: any;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON body.");
  }
  const raw: unknown[] = Array.isArray(body?.entries) ? body.entries : [];
  if (raw.length < 1 || raw.length > MAX_ENTRIES) {
    return bad(`Send between 1 and ${MAX_ENTRIES} entries.`, `entries=${raw.length}`);
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
    const { DB } = await getEnv();

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
      return bad(`Entry ${first.index + 1}: ${first.messages[0]}`, `${errors.length} entr${errors.length === 1 ? "y" : "ies"} invalid`, {
        errors,
      });
    }

    const createdAt = new Date().toISOString().slice(0, 19).replace("T", " ");
    const rows: ScrapRow[] = values.map((v, index) => ({
      id: crypto.randomUUID(),
      event_date: v.event_date,
      week_number: weekNumberMondayStart(v.event_date),
      month_name: monthName(v.event_date),
      shift: v.shift,
      source: "qc",
      job_id: v.job_id,
      line_item_id: v.job_id ? v.line_item_id : null,
      cutting_line_id: null,
      inv_number: resolved[index].inv_number,
      customer: resolved[index].customer,
      line_machine: v.line_machine,
      operator_id: null,
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
      created_by_id: actorId,
      created_by_name: actorName || null,
      created_at: createdAt,
      voided_at: null,
      voided_by_name: null,
      void_reason: null,
    }));

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
        actorId
      );
    }

    return NextResponse.json({ ok: true, entries: rows }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't save the scrap entries.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
