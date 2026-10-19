// src/app/api/shipments/loading-sheet/route.ts  ->  GET /v2/api/shipments/loading-sheet?job_id=<id>
//                                                   | GET /v2/api/shipments/loading-sheet?date=YYYY-MM-DD
// lgx-loadsheet-01. Read-only data feed for the printable loading sheet (lib/logistics/loadingSheet.ts,
// built client-side by components/logistics/LoadingSheetButton.tsx). One entry per JOB (never per
// shipment row), sorted by invoice number ascending. The static `loading-sheet` segment takes
// precedence over the sibling `[id]` dynamic segment (same as `distances/`). Gate is inherited from
// middleware's `/v2/api/shipments` -> `logistics.dashboard` rule.
//
// lgx-loadsheet-02: loads per job are the union of the job's non-archived loading_assignments load
// numbers and its BOLs' load numbers, each carrying that load's bay/trailer (assignment) and its
// newest BOL's number + load_manifest (the load builder's per-trailer item list). The split into one
// sheet per load happens in loadingSheet.ts's pure expandLoadingSheets.
//
// mlc-04: each load also carries its effective carrier (job_load_carriers override, else the
// order-level carrier); the sheet prints it only when it differs (loadingSheet.ts sheetCarrierText).
//
// dlv-04: each load also carries its own delivery display from job_load_times (one chunked query for
// every requested job); the order-level delivery_time stays the fallback. An order with no loads gets
// load 1's time only when load_count = 1 — otherwise its single page keeps the order summary.
//
// lgx-printed-01: POST /v2/api/shipments/loading-sheet  { job_ids: string[] } marks those jobs' loading
// sheets printed (jobs.loading_sheet_printed_at/_by), fired by LoadingSheetButton when the user clicks
// Print or Download in the PdfViewer. Inherits the same gate (POST = logistics.dashboard edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import { V2_LOGISTICS_WRITES_ENABLED } from "@/lib/logistics/writeFence";
import type { LoadingSheetLineItem, LoadingSheetLoad, LoadingSheetOrder } from "@/lib/logistics/loadingSheet";
import { parseLoadManifest } from "@/lib/logistics/loadManifest";

interface AssignmentRow {
  load_number: number | null;
  trailer_number: string | null;
  bay_number: string | number | null;
}
interface BolRow {
  bol_number: string | number | null;
  load_number: number | null;
  load_manifest: string | null;
}

/** Same newest-per-load / null-load_number fallback rule as api/shipments/[id]/route.ts (carrier-03):
 * the newest BOL for this load number, or — when the job has exactly one BOL and it has no load
 * number — that BOL. `bols` is newest first. */
function bolForLoad(bols: BolRow[], loadNumber: number | null): BolRow | null {
  const exact = loadNumber != null ? bols.find((b) => b.load_number === loadNumber) : undefined;
  if (exact) return exact;
  return bols.length === 1 && bols[0].load_number == null ? bols[0] : null;
}

const IN_CHUNK = 90; // D1 100-bound-param ceiling

function toLoad(
  a: AssignmentRow | null,
  loadNumber: number | null,
  bols: BolRow[],
  times: Map<number, string> | undefined,
  carriers: Map<number, string> | undefined,
  orderCarrier: string | null
): LoadingSheetLoad {
  const bol = bolForLoad(bols, loadNumber);
  return {
    load_number: loadNumber,
    trailer_number: a?.trailer_number ?? null,
    bay_number: a?.bay_number ?? null,
    bol_number: bol?.bol_number ?? null,
    manifest: parseLoadManifest(bol?.load_manifest ?? null),
    delivery_time: loadNumber != null ? times?.get(loadNumber) || null : null,
    carrier: (loadNumber != null ? carriers?.get(loadNumber) : undefined) || orderCarrier,
  };
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const jobId = (url.searchParams.get("job_id") || "").trim();
  const date = (url.searchParams.get("date") || "").trim();

  if ((jobId && date) || (!jobId && !date)) {
    return NextResponse.json(
      { ok: false, error: "Provide exactly one of job_id or date.", detail: "Bad query parameters" },
      { status: 400 }
    );
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { ok: false, error: "date must be YYYY-MM-DD.", detail: `Got "${date}"` },
      { status: 400 }
    );
  }

  const { DB } = await getEnv();

  try {
    const res = await DB.prepare(
      `SELECT s.job_id, s.ship_date, s.carrier AS s_carrier, s.notes AS s_notes, s.delivery_time AS s_delivery_time,
              j.invoice_number, j.customer, j.carrier AS j_carrier, j.delivery_time AS j_delivery_time, j.load_count AS j_load_count,
              j.ship_to_company, j.ship_to_attention, j.ship_to_street, j.ship_to_street2,
              j.ship_to_city, j.ship_to_state, j.ship_to_zip
         FROM shipments s JOIN jobs j ON j.id = s.job_id
        WHERE s.direction = 'outbound' AND s.status <> 'cancelled'
          AND ${jobId ? "s.job_id = ?" : "s.ship_date = ?"}
        ORDER BY CAST(j.invoice_number AS INTEGER) ASC, j.invoice_number ASC`
    )
      .bind(jobId || date)
      .all<any>();

    // Keep the first row per job_id.
    const seen = new Set<string>();
    const rows = (res.results ?? []).filter((r: any) => {
      if (!r.job_id || seen.has(r.job_id)) return false;
      seen.add(r.job_id);
      return true;
    });

    // dlv-04: per-load delivery displays for every requested job, one chunked query.
    const timesByJob = new Map<string, Map<number, string>>();
    const jobIds = rows.map((r: any) => r.job_id as string);
    for (let i = 0; i < jobIds.length; i += IN_CHUNK) {
      const chunk = jobIds.slice(i, i + IN_CHUNK);
      const tr = await DB.prepare(
        `SELECT job_id, load_number, display FROM job_load_times
          WHERE job_id IN (${chunk.map(() => "?").join(",")}) AND display <> ''`
      )
        .bind(...chunk)
        .all<{ job_id: string; load_number: number; display: string }>();
      for (const t of tr.results ?? []) {
        const m = timesByJob.get(t.job_id) ?? new Map<number, string>();
        m.set(Number(t.load_number), t.display);
        timesByJob.set(t.job_id, m);
      }
    }

    // mlc-04: per-load carrier overrides, same chunking. Rows past the job's load_count are ignored.
    const loadCountByJob = new Map(rows.map((r: any) => [r.job_id as string, Math.max(Number(r.j_load_count) || 1, 1)]));
    const carriersByJob = new Map<string, Map<number, string>>();
    for (let i = 0; i < jobIds.length; i += IN_CHUNK) {
      const chunk = jobIds.slice(i, i + IN_CHUNK);
      const cr = await DB.prepare(
        `SELECT job_id, load_number, carrier FROM job_load_carriers
          WHERE job_id IN (${chunk.map(() => "?").join(",")}) AND TRIM(carrier) <> ''`
      )
        .bind(...chunk)
        .all<{ job_id: string; load_number: number; carrier: string }>();
      for (const c of cr.results ?? []) {
        if (Number(c.load_number) > (loadCountByJob.get(c.job_id) ?? 1)) continue;
        const m = carriersByJob.get(c.job_id) ?? new Map<number, string>();
        m.set(Number(c.load_number), c.carrier);
        carriersByJob.set(c.job_id, m);
      }
    }

    const orders: LoadingSheetOrder[] = [];
    for (const r of rows) {
      const li = await DB.prepare(
        "SELECT part_number, description, quantity, dimensions FROM job_line_items WHERE job_id = ? ORDER BY sort_order ASC"
      )
        .bind(r.job_id)
        .all<LoadingSheetLineItem>();

      const ar = await DB.prepare(
        `SELECT la.load_number, la.trailer_number, lb.bay_number
           FROM loading_assignments la
           LEFT JOIN loading_bays lb ON lb.id = la.bay_id
          WHERE la.job_id = ? AND la.loading_status <> 'archived'
          ORDER BY la.load_number ASC`
      )
        .bind(r.job_id)
        .all<AssignmentRow>();
      const br = await DB.prepare(
        "SELECT bol_number, load_number, load_manifest FROM bols WHERE job_id = ? ORDER BY created_at DESC"
      )
        .bind(r.job_id)
        .all<BolRow>();
      const assignments = ar.results ?? [];
      const bols = br.results ?? [];
      const loadNumbers = Array.from(
        new Set([...assignments.map((a) => a.load_number), ...bols.map((b) => b.load_number)].filter((n): n is number => n != null).map(Number))
      ).sort((a, b) => a - b);
      // No numbered load anywhere: today's behavior — the job's (unnumbered) assignments, if any,
      // with the single-BOL fallback; none at all prints "No trailer assigned".
      const orderCarrier: string | null = r.s_carrier || r.j_carrier || null;
      const jobCarriers = carriersByJob.get(r.job_id);
      const loads: LoadingSheetLoad[] = loadNumbers.length
        ? loadNumbers.map((n) =>
            toLoad(assignments.find((a) => Number(a.load_number) === n) ?? null, n, bols, timesByJob.get(r.job_id), jobCarriers, orderCarrier)
          )
        : assignments.map((a) => toLoad(a, null, bols, timesByJob.get(r.job_id), jobCarriers, orderCarrier));
      // dlv-04: no numbered load → one synthetic page; load 1's time applies only to a one-load order.
      const orderDelivery = r.s_delivery_time || r.j_delivery_time || null;
      const syntheticTime =
        !loadNumbers.length && (Number(r.j_load_count) || 1) === 1 ? timesByJob.get(r.job_id)?.get(1) || null : null;

      orders.push({
        job_id: r.job_id,
        invoice_number: r.invoice_number ?? null,
        ship_date: r.ship_date ?? null,
        customer: r.customer ?? null,
        carrier: r.s_carrier || r.j_carrier || null,
        delivery_time: syntheticTime || orderDelivery,
        notes: r.s_notes ?? null,
        ship_to_company: r.ship_to_company ?? null,
        ship_to_attention: r.ship_to_attention ?? null,
        ship_to_street: r.ship_to_street ?? null,
        ship_to_street2: r.ship_to_street2 ?? null,
        ship_to_city: r.ship_to_city ?? null,
        ship_to_state: r.ship_to_state ?? null,
        ship_to_zip: r.ship_to_zip ?? null,
        line_items: li.results ?? [],
        loads,
      });
    }

    return NextResponse.json({ ok: true, orders });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}

const MAX_PRINT_IDS = 200;

export async function POST(request: NextRequest) {
  if (!V2_LOGISTICS_WRITES_ENABLED) {
    return NextResponse.json(
      { ok: false, error: "v2 logistics writes disabled (read-only migration phase)" },
      { status: 501 }
    );
  }

  const body = (await request.json().catch(() => null)) as { job_ids?: unknown } | null;
  const raw = body?.job_ids;
  if (
    !Array.isArray(raw) ||
    !raw.length ||
    raw.length > MAX_PRINT_IDS ||
    !raw.every((id) => typeof id === "string" && id.trim() !== "")
  ) {
    return NextResponse.json(
      { ok: false, error: "job_ids must be a non-empty list of job ids.", detail: `Expected 1-${MAX_PRINT_IDS} non-empty strings` },
      { status: 400 }
    );
  }
  const jobIds = Array.from(new Set((raw as string[]).map((id) => id.trim())));

  const actorId = request.headers.get("X-User-Id") || "";
  const actorName = request.headers.get("X-User-Name") || null;
  // UTC 'YYYY-MM-DD HH:MM:SS' (same format as SQLite datetime('now')), computed once so the response matches the rows.
  const printedAt = new Date().toISOString().slice(0, 19).replace("T", " ");

  const { DB } = await getEnv();

  try {
    for (let i = 0; i < jobIds.length; i += IN_CHUNK) {
      const chunk = jobIds.slice(i, i + IN_CHUNK);
      await DB.prepare(
        `UPDATE jobs SET loading_sheet_printed_at = ?, loading_sheet_printed_by = ?
          WHERE id IN (${chunk.map(() => "?").join(",")})`
      )
        .bind(printedAt, actorName, ...chunk)
        .run();
    }

    await logActivity(
      DB,
      "print",
      "job",
      jobIds.length === 1 ? jobIds[0] : "multiple",
      `Loading sheet printed (${jobIds.length} order${jobIds.length === 1 ? "" : "s"})`,
      { job_ids: jobIds },
      actorId
    );

    return NextResponse.json({ ok: true, printed_at: printedAt, printed_by: actorName });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Server error.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
