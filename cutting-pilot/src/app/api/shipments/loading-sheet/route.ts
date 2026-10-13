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
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
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

function toLoad(a: AssignmentRow | null, loadNumber: number | null, bols: BolRow[]): LoadingSheetLoad {
  const bol = bolForLoad(bols, loadNumber);
  return {
    load_number: loadNumber,
    trailer_number: a?.trailer_number ?? null,
    bay_number: a?.bay_number ?? null,
    bol_number: bol?.bol_number ?? null,
    manifest: parseLoadManifest(bol?.load_manifest ?? null),
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
              j.invoice_number, j.customer, j.carrier AS j_carrier, j.delivery_time AS j_delivery_time,
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
      const loads: LoadingSheetLoad[] = loadNumbers.length
        ? loadNumbers.map((n) => toLoad(assignments.find((a) => Number(a.load_number) === n) ?? null, n, bols))
        : assignments.map((a) => toLoad(a, null, bols));

      orders.push({
        job_id: r.job_id,
        invoice_number: r.invoice_number ?? null,
        ship_date: r.ship_date ?? null,
        customer: r.customer ?? null,
        carrier: r.s_carrier || r.j_carrier || null,
        delivery_time: r.s_delivery_time || r.j_delivery_time || null,
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
