// src/app/api/qc/inspections/bulk/route.ts  ->  POST /v2/api/qc/inspections/bulk
// qc-06: admin bulk inspect. For each selected order, every inspectable (non-Holey) line with no
// current inspection is recorded as Passed at nominal: lot = line quantity, sampleSizeFor(lot)
// identical samples at nominal L/W/H (+ taper), visual pass. The plan is rebuilt here from the DB
// (planBulkInspection) — the client only sends job ids. Already-inspected lines and lines that can't
// be auto-filled (no whole quantity, unreadable dimensions) are skipped and listed back.
// Rows are the same as a manual save (lib/qc/inspectionWrite.ts) except entry_method = 'bulk', an
// internal audit marker that's never rendered or sent to Drive. One DB.batch per order, so an order
// is all-or-nothing; a failed order is reported and the rest still go through. No waitUntil — a
// batch of forwards would blow the ~30 s budget; every row stays drive_status 'pending' and the */5
// cron sweep files them, 10 per run.
// Administrators only: X-User-Is-Admin is "0" while an admin is testing as a role, so this 403s then.
// Middleware gates /v2/api/qc on `qc` (POST → edit).
import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db";
import { logActivity } from "@/lib/activityLog";
import {
  TOLERANCES,
  bulkSamples,
  planBulkInspection,
  toLineInspection,
  type BulkSkipReason,
  type QcInspectionRow,
  type QcLine,
  type QcLineInspection,
  type QcOrder,
} from "@/lib/qc/board";
import { inspectionNow, inspectionStatements, logInspection, type LineRow } from "@/lib/qc/inspectionWrite";

const MAX_JOBS = 60;
const CHUNK = 90; // stay under D1's bind-parameter limit
const SWEEP_PER_RUN = 10;
const SWEEP_EVERY_MIN = 5;

interface JobRow {
  id: string;
  invoice_number: string | null;
  customer: string | null;
  ship_date: string | null;
  status: string | null;
}

interface BulkLineRow {
  id: string;
  job_id: string;
  description: string | null;
  dimensions: string | null;
  quantity: number | null;
  sort_order: number | null;
}

interface InspectionRow extends QcInspectionRow {
  line_item_id: string;
}

function bad(error: string, detail = "") {
  return NextResponse.json({ ok: false, error, detail }, { status: 400 });
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

export async function POST(request: NextRequest) {
  const actorId = request.headers.get("X-User-Id");
  if (!actorId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (request.headers.get("X-User-Is-Admin") !== "1") {
    return NextResponse.json({ ok: false, error: "Administrators only." }, { status: 403 });
  }
  const actorName = request.headers.get("X-User-Name") || "";

  let body: any;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid JSON body.");
  }

  const rawIds = body?.job_ids;
  if (!Array.isArray(rawIds) || rawIds.length < 1 || rawIds.length > MAX_JOBS) {
    return bad(`Pick between 1 and ${MAX_JOBS} orders.`, `job_ids length=${Array.isArray(rawIds) ? rawIds.length : "n/a"}`);
  }
  if (!rawIds.every((v: unknown) => typeof v === "string" && v.trim() !== "" && v.length <= 100)) {
    return bad("job_ids must be order ids.");
  }
  const jobIds = Array.from(new Set(rawIds.map((v: string) => v.trim())));
  const tolerance = body?.tolerance_in === undefined ? 0.125 : body.tolerance_in;
  if (!TOLERANCES.some((t) => t.value === tolerance)) {
    return bad("Tolerance must be one of 1/16, 1/8, 3/16 or 1/4 in.", `tolerance_in=${JSON.stringify(body?.tolerance_in)}`);
  }

  try {
    const { DB } = await getEnv();

    // 1. Jobs, their non-Holey lines (same rule as the board route) and each line's current inspection.
    const jobs = (
      await DB.prepare(
        `SELECT id, invoice_number, customer, ship_date, status FROM jobs WHERE id IN (${placeholders(jobIds.length)})`
      )
        .bind(...jobIds)
        .all<JobRow>()
    ).results ?? [];
    const jobById = new Map(jobs.map((j) => [j.id, j]));

    const lineRows: BulkLineRow[] = (
      await DB.prepare(
        `SELECT li.id, li.job_id, li.description, li.dimensions, li.quantity, li.sort_order
           FROM job_line_items li
           LEFT JOIN parts p ON p.id = li.part_id
          WHERE li.job_id IN (${placeholders(jobIds.length)})
            AND (p.category IS NULL OR p.category <> 'Holey Board')
          ORDER BY li.sort_order, li.id`
      )
        .bind(...jobIds)
        .all<BulkLineRow>()
    ).results ?? [];

    const inspByLine = new Map<string, InspectionRow>();
    const lineIds = lineRows.map((r) => r.id);
    for (let i = 0; i < lineIds.length; i += CHUNK) {
      const chunk = lineIds.slice(i, i + CHUNK);
      const res = await DB.prepare(
        `SELECT id, line_item_id, result, inspector_name, inspected_at, drive_status, line_quantity, dimensions_text, drive_file_id, drive_error, drive_attempted_at
           FROM qc_inspections WHERE superseded_at IS NULL AND line_item_id IN (${placeholders(chunk.length)})`
      )
        .bind(...chunk)
        .all<InspectionRow>();
      for (const r of res.results ?? []) inspByLine.set(r.line_item_id, r);
    }

    // 2. Rebuild each QcOrder exactly as the board does, then plan it.
    const linesByJob = new Map<string, QcLine[]>();
    const rowById = new Map(lineRows.map((r) => [r.id, r]));
    for (const r of lineRows) {
      const quantity = Number(r.quantity) || 0;
      const dimensions = r.dimensions ?? "";
      const insp = inspByLine.get(r.id);
      const list = linesByJob.get(r.job_id) ?? [];
      list.push({
        id: r.id,
        description: r.description ?? "",
        dimensions,
        quantity,
        sort_order: Number(r.sort_order) || 0,
        inspection: insp ? toLineInspection(insp, quantity, dimensions) : null,
      });
      linesByJob.set(r.job_id, list);
    }

    const now = inspectionNow();
    const orders: {
      job_id: string;
      invoice_number: string;
      created: number;
      skipped: { line_item_id: string; description: string; reason: BulkSkipReason }[];
      inspections: { line_item_id: string; inspection: QcLineInspection }[];
    }[] = [];
    const failed: { job_id: string; invoice_number: string; error: string }[] = [];
    let created = 0;
    let skippedTotal = 0;

    for (const jobId of jobIds) {
      const job = jobById.get(jobId);
      if (!job) {
        failed.push({ job_id: jobId, invoice_number: "", error: "Order not found." });
        continue;
      }
      const order: QcOrder = {
        job_id: job.id,
        invoice_number: job.invoice_number ?? "",
        customer: job.customer ?? "",
        ship_date: job.ship_date ?? "",
        status: job.status ?? "",
        lines: linesByJob.get(job.id) ?? [],
      };
      const plan = planBulkInspection(order);
      const skipped = plan
        .filter((p) => p.action === "skip")
        .map((p) => ({ line_item_id: p.line_item_id, description: p.description, reason: p.reason as BulkSkipReason }));
      skippedTotal += skipped.length;

      // 3. Every record line's statements, one batch per order.
      const built = plan
        .filter((p) => p.action === "record")
        .map((p) => {
          const r = rowById.get(p.line_item_id)!;
          const line: LineRow = {
            id: r.id,
            job_id: r.job_id,
            description: r.description,
            dimensions: r.dimensions,
            quantity: r.quantity,
            category: null,
            invoice_number: job.invoice_number,
            customer: job.customer,
          };
          return inspectionStatements(DB, {
            line,
            lot: p.lot!,
            tolerance,
            nominal: p.nominal!,
            samples: bulkSamples(p.nominal!, p.sampleSize!),
            actorId,
            actorName,
            now,
            entryMethod: "bulk",
          });
        });

      if (!built.length) {
        orders.push({ job_id: job.id, invoice_number: order.invoice_number, created: 0, skipped, inspections: [] });
        continue;
      }

      let res;
      try {
        res = await DB.batch(built.flatMap((b) => b.stmts));
      } catch (e: any) {
        failed.push({ job_id: job.id, invoice_number: order.invoice_number, error: String(e?.message || e) });
        continue;
      }

      // 4. One activity row per inspection — the supersede UPDATE is each inspection's first statement.
      let offset = 0;
      for (const b of built) {
        const superseded = Number(res[offset]?.meta?.changes ?? 0);
        offset += b.stmts.length;
        await logInspection(DB, b.id, b.activityFor(superseded), actorId);
      }
      created += built.length;
      orders.push({
        job_id: job.id,
        invoice_number: order.invoice_number,
        created: built.length,
        skipped,
        inspections: built.map((b, i) => ({
          line_item_id: plan.filter((p) => p.action === "record")[i].line_item_id,
          inspection: b.inspection,
        })),
      });
    }

    await logActivity(
      DB,
      "create",
      "qc_bulk_inspection",
      crypto.randomUUID(),
      `Recorded ${created} inspections across ${orders.filter((o) => o.created > 0).length} orders`,
      { job_ids: jobIds, created, skipped: skippedTotal, failed: failed.map((f) => f.job_id) },
      actorId
    );

    return NextResponse.json({
      ok: true,
      created,
      orders,
      failed,
      drive_eta_minutes: Math.ceil(created / SWEEP_PER_RUN) * SWEEP_EVERY_MIN,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Couldn't record the inspections.", detail: String(e?.message || e) },
      { status: 500 }
    );
  }
}
