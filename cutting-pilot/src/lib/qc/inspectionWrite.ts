// src/lib/qc/inspectionWrite.ts — qc-06 (server-only)
// The persistence half of a Final Inspection, moved out of POST /v2/api/qc/inspections so the admin
// bulk route (POST /v2/api/qc/inspections/bulk) writes exactly the same rows. Callers validate first;
// nothing here checks the input. One inspection = supersede the line's current row (superseded_at
// set, kept for audit) + the inspection INSERT + one INSERT per sample. inspectionStatements returns
// the statements so a caller can put several inspections in one DB.batch; saveInspection runs one
// batch and logs it. entry_method ('manual' | 'bulk') is an internal audit marker — never rendered,
// never sent to the Apps Script (driveForward selects its columns explicitly).
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { logActivity } from "@/lib/activityLog";
import { inspectionResult, sampleSizeFor, type QcLineInspection } from "./board";

export interface LineRow {
  id: string;
  job_id: string;
  description: string | null;
  dimensions: string | null;
  quantity: number | null;
  category: string | null;
  invoice_number: string | null;
  customer: string | null;
}

export type EntryMethod = "manual" | "bulk";

export interface InspectionArgs {
  line: LineRow;
  lot: number;
  tolerance: number;
  nominal: any;
  samples: any[];
  actorId: string;
  actorName: string;
  now: string; // "YYYY-MM-DD HH:MM:SS" UTC
  entryMethod: EntryMethod;
}

export interface InspectionActivity {
  summary: string;
  detail: Record<string, unknown>;
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function inspectionNow(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

// stmts[0] is always the supersede UPDATE — its meta.changes is the `superseded` count.
export function inspectionStatements(DB: D1Database, args: InspectionArgs) {
  const { line, lot, tolerance, nominal, samples, actorId, actorName, now, entryMethod } = args;
  const sampleSize = sampleSizeFor(lot) as number;
  const result = inspectionResult(samples);
  const id = crypto.randomUUID();

  const stmts: D1PreparedStatement[] = [
    DB.prepare(`UPDATE qc_inspections SET superseded_at = ? WHERE line_item_id = ? AND superseded_at IS NULL`).bind(
      now,
      line.id
    ),
    DB.prepare(
      `INSERT INTO qc_inspections
         (id, job_id, line_item_id, invoice_number, customer, part_description, dimensions_text, line_quantity,
          lot_size, sample_size, tolerance_in, nominal_length, nominal_width, nominal_height, nominal_taper,
          result, inspector_id, inspector_name, inspected_at, drive_status, entry_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).bind(
      id,
      line.job_id,
      line.id,
      line.invoice_number ?? "",
      line.customer ?? "",
      line.description ?? "",
      line.dimensions ?? "",
      Number(line.quantity) || 0,
      lot,
      sampleSize,
      tolerance,
      num(nominal?.length),
      num(nominal?.width),
      num(nominal?.height),
      str(nominal?.taper, 50),
      result,
      actorId,
      actorName,
      now,
      entryMethod
    ),
    ...samples.map((s, i) =>
      DB.prepare(
        `INSERT INTO qc_inspection_samples
           (inspection_id, sample_no, length, width, height, taper, visual_pass, result, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, i + 1, s.length, s.width, s.height, str(s.taper, 50), s.visual_pass === false ? 0 : 1, s.result, str(s.notes, 500))
    ),
  ];

  const inspection: QcLineInspection = {
    id,
    result,
    inspector_name: actorName,
    inspected_at: now,
    drive_status: "pending",
    drive_file_id: null,
    drive_error: null,
    drive_attempted_at: null,
    stale: false,
  };

  // superseded is only known after the batch runs: activityFor(superseded).
  const activityFor = (superseded: number): InspectionActivity => ({
    summary: `Inspected INV ${line.invoice_number || "—"} — ${line.description || "line"} (${result})`,
    detail: {
      job_id: line.job_id,
      line_item_id: line.id,
      lot_size: lot,
      sample_size: sampleSize,
      result,
      superseded,
      // Manual's detail stays exactly as before qc-06; only bulk rows carry the marker.
      ...(entryMethod === "bulk" ? { entry_method: "bulk" } : {}),
    },
  });

  return { id, stmts, result, sampleSize, inspection, activityFor };
}

export async function logInspection(DB: D1Database, id: string, activity: InspectionActivity, actorId: string) {
  await logActivity(DB, "create", "qc_inspection", id, activity.summary, activity.detail, actorId);
}

/** One inspection, one batch, one activity row. Throws if the batch fails. */
export async function saveInspection(DB: D1Database, args: InspectionArgs) {
  const built = inspectionStatements(DB, args);
  const res = await DB.batch(built.stmts);
  const superseded = Number(res[0]?.meta?.changes ?? 0);
  await logInspection(DB, built.id, built.activityFor(superseded), args.actorId);
  return { id: built.id, result: built.result, sampleSize: built.sampleSize, inspection: built.inspection, superseded };
}
