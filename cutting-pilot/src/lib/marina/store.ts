// src/lib/marina/store.ts — marina-02
// Server-side helpers for the Marina Foam routes (/v2/api/qc/marina/*), so the routes stay thin.
// Marina is fully decoupled: no jobs / parts / orders / Drive linkage, never scrap_events.
// r2_key is read here and never leaves the server — publicFile() strips it from every file row.
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type {
  MarinaDim, MarinaFile, MarinaFileKind, MarinaJob, MarinaJobDetail, MarinaJobStatus,
  MarinaJobSummary, MarinaPartSummary, MarinaTallies,
} from "./types";

export const MARINA_MAX_FILE_BYTES = 25 * 1024 * 1024;
export const FILE_KINDS: MarinaFileKind[] = ["cut_sheet", "customer_drawing"];

const JOB_COLS = "id, name, customer, tolerance_in, status, notes, created_by, created_at, completed_at";
const FILE_COLS = "id, job_id, kind, filename, size_bytes, page_count, superseded_at, uploaded_by, uploaded_at";

// Identity from the middleware-set headers. created_by / uploaded_by store the DISPLAY NAME (the
// marina tables are read without joins); activity_log carries the user id.
export function actor(request: Request): { id: string | null; name: string | null } {
  return {
    id: request.headers.get("X-User-Id") || null,
    name: request.headers.get("X-User-Name") || null,
  };
}

// Local copy of the board prints rule: strip any path, control characters and double quotes (it
// lands in Content-Disposition); cap at 150.
export function sanitizeFilename(raw: string, ext: string): string {
  let name = String(raw || "").split(/[\\/]/).pop() || "";
  name = name.replace(/[\x00-\x1f\x7f"]/g, "").trim().slice(0, 150).trim();
  return name || `marina.${ext}`;
}

// Header-safe filename for Content-Disposition: printable ASCII only, no quotes/backslashes.
export function headerSafeFilename(name: string): string {
  return name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
}

export function publicFile(row: Record<string, any>): MarinaFile {
  return {
    id: row.id,
    job_id: row.job_id ?? null,
    kind: row.kind,
    filename: row.filename ?? null,
    size_bytes: row.size_bytes ?? null,
    page_count: row.page_count ?? null,
    superseded_at: row.superseded_at ?? null,
    uploaded_by: row.uploaded_by ?? null,
    uploaded_at: row.uploaded_at,
  };
}

function toJob(row: Record<string, any>): MarinaJob {
  return {
    id: row.id,
    name: row.name,
    customer: row.customer ?? null,
    tolerance_in: Number(row.tolerance_in),
    status: row.status as MarinaJobStatus,
    notes: row.notes ?? null,
    created_by: row.created_by ?? null,
    created_at: row.created_at,
    completed_at: row.completed_at ?? null,
  };
}

export async function loadJob(DB: D1Database, id: string): Promise<MarinaJob | null> {
  const row = await DB.prepare(`SELECT ${JOB_COLS} FROM marina_jobs WHERE id = ?`).bind(id).first<Record<string, any>>();
  return row ? toJob(row) : null;
}

export async function loadFile(DB: D1Database, id: string): Promise<MarinaFile | null> {
  const row = await DB.prepare(`SELECT ${FILE_COLS} FROM marina_files WHERE id = ?`).bind(id).first<Record<string, any>>();
  return row ? publicFile(row) : null;
}

// Server-only: the R2 key for a file row. Never put the result in a response.
export async function fileR2Key(DB: D1Database, id: string): Promise<{ r2_key: string; filename: string | null } | null> {
  return DB.prepare("SELECT r2_key, filename FROM marina_files WHERE id = ?").bind(id)
    .first<{ r2_key: string; filename: string | null }>();
}

// Piece-status tallies as SQL fragments; `pc` = marina_pieces.
const TALLY_SELECT = `
  COUNT(pc.id) AS pieces,
  COALESCE(SUM(pc.status = 'pass'), 0) AS pass,
  COALESCE(SUM(pc.status = 'accepted'), 0) AS accepted,
  COALESCE(SUM(pc.status = 'rework_pending'), 0) AS rework_pending,
  COALESCE(SUM(pc.status = 'scrapped'), 0) AS scrapped`;

function emptyTallies(): MarinaTallies {
  return { parts: 0, pieces: 0, pass: 0, accepted: 0, rework_pending: 0, scrapped: 0 };
}

function tallyFrom(row: Record<string, any> | undefined): Omit<MarinaTallies, "parts"> {
  return {
    pieces: Number(row?.pieces ?? 0),
    pass: Number(row?.pass ?? 0),
    accepted: Number(row?.accepted ?? 0),
    rework_pending: Number(row?.rework_pending ?? 0),
    scrapped: Number(row?.scrapped ?? 0),
  };
}

// Job list: one batch — jobs, piece tallies grouped by job_id, live cut-sheet counts grouped by job_id.
export async function listJobs(DB: D1Database, status: "open" | "complete" | "all"): Promise<MarinaJobSummary[]> {
  const where = status === "all" ? "" : "WHERE status = ?";
  const order =
    status === "open" ? "created_at DESC"
    : status === "complete" ? "completed_at DESC, created_at DESC"
    : "CASE status WHEN 'open' THEN 0 ELSE 1 END, CASE status WHEN 'open' THEN created_at ELSE completed_at END DESC, created_at DESC";
  const jobsStmt = DB.prepare(`SELECT ${JOB_COLS} FROM marina_jobs ${where} ORDER BY ${order}`);
  const jobFilter = status === "all" ? "" : "WHERE j.status = ?";
  const talliesStmt = DB.prepare(
    `SELECT p.job_id, COUNT(DISTINCT p.id) AS parts, ${TALLY_SELECT}
       FROM marina_parts p
       JOIN marina_jobs j ON j.id = p.job_id
       LEFT JOIN marina_pieces pc ON pc.part_id = p.id
       ${jobFilter}
      GROUP BY p.job_id`
  );
  const sheetsStmt = DB.prepare(
    `SELECT f.job_id, COUNT(*) AS n
       FROM marina_files f
       JOIN marina_jobs j ON j.id = f.job_id
      WHERE f.kind = 'cut_sheet' AND f.superseded_at IS NULL ${status === "all" ? "" : "AND j.status = ?"}
      GROUP BY f.job_id`
  );
  const [jobs, tallies, sheets] = await DB.batch(
    status === "all"
      ? [jobsStmt, talliesStmt, sheetsStmt]
      : [jobsStmt.bind(status), talliesStmt.bind(status), sheetsStmt.bind(status)]
  );
  const tallyBy = new Map<string, MarinaTallies>();
  for (const r of (tallies.results ?? []) as Record<string, any>[]) {
    tallyBy.set(r.job_id, { parts: Number(r.parts ?? 0), ...tallyFrom(r) });
  }
  const sheetsBy = new Map<string, number>();
  for (const r of (sheets.results ?? []) as Record<string, any>[]) sheetsBy.set(r.job_id, Number(r.n ?? 0));
  return ((jobs.results ?? []) as Record<string, any>[]).map((r) => ({
    ...toJob(r),
    tallies: tallyBy.get(r.id) ?? emptyTallies(),
    cut_sheets: sheetsBy.get(r.id) ?? 0,
  }));
}

// Job detail: one batch — files, parts, dims, piece tallies grouped by part_id, measured parts.
export async function loadJobDetail(DB: D1Database, id: string): Promise<MarinaJobDetail | null> {
  const job = await loadJob(DB, id);
  if (!job) return null;
  const [files, parts, dims, tallies, measured] = await DB.batch([
    DB.prepare(
      `SELECT ${FILE_COLS} FROM marina_files WHERE job_id = ?
        ORDER BY (superseded_at IS NOT NULL), uploaded_at DESC`
    ).bind(id),
    DB.prepare(
      `SELECT id, job_id, file_id, page_no, label, notes, sort_order FROM marina_parts WHERE job_id = ?
        ORDER BY sort_order, page_no, label`
    ).bind(id),
    DB.prepare(
      `SELECT d.id, d.part_id, d.label, d.nominal_in, d.nominal_text, d.sort_order
         FROM marina_part_dims d JOIN marina_parts p ON p.id = d.part_id
        WHERE p.job_id = ? ORDER BY d.sort_order, d.rowid`
    ).bind(id),
    DB.prepare(
      `SELECT p.id AS part_id, ${TALLY_SELECT}
         FROM marina_parts p LEFT JOIN marina_pieces pc ON pc.part_id = p.id
        WHERE p.job_id = ? GROUP BY p.id`
    ).bind(id),
    DB.prepare(
      `SELECT DISTINCT pc.part_id
         FROM marina_pieces pc
         JOIN marina_parts p ON p.id = pc.part_id
         JOIN marina_measurements m ON m.piece_id = pc.id
        WHERE p.job_id = ?`
    ).bind(id),
  ]);
  const dimsBy = new Map<string, MarinaDim[]>();
  for (const r of (dims.results ?? []) as Record<string, any>[]) {
    const list = dimsBy.get(r.part_id) ?? [];
    list.push({
      id: r.id, part_id: r.part_id, label: r.label, nominal_in: Number(r.nominal_in),
      nominal_text: r.nominal_text ?? null, sort_order: Number(r.sort_order ?? 0),
    });
    dimsBy.set(r.part_id, list);
  }
  const tallyBy = new Map<string, Record<string, any>>();
  for (const r of (tallies.results ?? []) as Record<string, any>[]) tallyBy.set(r.part_id, r);
  const locked = new Set(((measured.results ?? []) as Record<string, any>[]).map((r) => r.part_id as string));
  const partList: MarinaPartSummary[] = ((parts.results ?? []) as Record<string, any>[]).map((r) => ({
    id: r.id,
    job_id: r.job_id,
    file_id: r.file_id ?? null,
    page_no: r.page_no ?? null,
    label: r.label,
    notes: r.notes ?? null,
    sort_order: Number(r.sort_order ?? 0),
    dims: dimsBy.get(r.id) ?? [],
    tallies: tallyFrom(tallyBy.get(r.id)),
    locked: locked.has(r.id),
  }));
  return { job, files: ((files.results ?? []) as Record<string, any>[]).map(publicFile), parts: partList };
}

export interface MarinaDeleteCounts { parts: number; pieces: number; measurements: number; files: number; }

// 3e: count → collect r2 keys → one D1 batch (children first) → best-effort R2 deletes after commit.
export async function cascadeDeleteJob(DB: D1Database, R2: R2Bucket, id: string): Promise<MarinaDeleteCounts> {
  const PARTS = "SELECT id FROM marina_parts WHERE job_id = ?";
  const PIECES = `SELECT id FROM marina_pieces WHERE part_id IN (${PARTS})`;
  const counts = await DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM marina_parts WHERE job_id = ?1) AS parts,
       (SELECT COUNT(*) FROM marina_pieces WHERE part_id IN (SELECT id FROM marina_parts WHERE job_id = ?1)) AS pieces,
       (SELECT COUNT(*) FROM marina_measurements WHERE piece_id IN
          (SELECT id FROM marina_pieces WHERE part_id IN (SELECT id FROM marina_parts WHERE job_id = ?1))) AS measurements,
       (SELECT COUNT(*) FROM marina_files WHERE job_id = ?1) AS files`
  ).bind(id).first<Record<string, number>>();
  const keys = await DB.prepare("SELECT r2_key FROM marina_files WHERE job_id = ?").bind(id).all<{ r2_key: string }>();

  await DB.batch([
    DB.prepare(`DELETE FROM marina_measurements WHERE piece_id IN (${PIECES})`).bind(id),
    DB.prepare(`DELETE FROM marina_pieces WHERE part_id IN (${PARTS})`).bind(id),
    DB.prepare(`DELETE FROM marina_part_dims WHERE part_id IN (${PARTS})`).bind(id),
    DB.prepare("DELETE FROM marina_parts WHERE job_id = ?").bind(id),
    DB.prepare("DELETE FROM marina_files WHERE job_id = ?").bind(id),
    DB.prepare("DELETE FROM marina_jobs WHERE id = ?").bind(id),
  ]);

  for (const { r2_key } of keys.results ?? []) {
    try {
      await R2.delete(r2_key);
    } catch (e) {
      console.error("marina: R2 delete failed (orphan left):", r2_key, String((e as any)?.message || e));
    }
  }
  return {
    parts: Number(counts?.parts ?? 0),
    pieces: Number(counts?.pieces ?? 0),
    measurements: Number(counts?.measurements ?? 0),
    files: Number(counts?.files ?? 0),
  };
}

// ── Body validation shared by POST /jobs and PATCH /jobs/{id} ──────────────────────────────────

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function cleanName(v: unknown): FieldResult<string> {
  if (typeof v !== "string") return { ok: false, error: "Job name is required." };
  const s = v.trim();
  if (!s) return { ok: false, error: "Job name is required." };
  if (s.length > 120) return { ok: false, error: "Job name must be 120 characters or fewer." };
  return { ok: true, value: s };
}

// Optional text: trimmed, empty → null, null/undefined → null, non-string → error.
export function cleanOptional(v: unknown, max: number, label: string): FieldResult<string | null> {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: `${label} must be text.` };
  const s = v.trim();
  if (s.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer.` };
  return { ok: true, value: s || null };
}
