// src/lib/marina/store.ts — marina-02 (+ marina-03 parts / pieces / measurements)
// Server-side helpers for the Marina Foam routes (/v2/api/qc/marina/*), so the routes stay thin.
// Marina is fully decoupled: no jobs / parts / orders / Drive linkage, never scrap_events.
// r2_key is read here and never leaves the server — publicFile() strips it from every file row.
import type { D1Database, D1PreparedStatement, D1Result, R2Bucket } from "@cloudflare/workers-types";
import { formatInches, parseInches } from "../inches";
import type { Disposition, MeasureInput } from "./pieces";
import type {
  MarinaDim, MarinaFile, MarinaFileKind, MarinaJob, MarinaJobDetail, MarinaJobStatus,
  MarinaJobSummary, MarinaMeasurement, MarinaPartDetail, MarinaPartSummary, MarinaPiece, MarinaPieceStatus,
  MarinaReworkItem, MarinaTallies,
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

// Part summaries (marina-03 refactor of marina-02's job-detail block, shared by job detail, part
// summary and part detail): parts, dims, piece tallies grouped by part_id, measured parts — four
// statements scoped to one job (`p.job_id = ?`) or one part (`p.id = ?`), for the caller's batch.
type PartScope = "job" | "part";

function partSummaryStmts(DB: D1Database, scope: PartScope, id: string): D1PreparedStatement[] {
  const w = scope === "job" ? "p.job_id = ?" : "p.id = ?";
  return [
    DB.prepare(
      `SELECT p.id, p.job_id, p.file_id, p.page_no, p.label, p.notes, p.sort_order FROM marina_parts p WHERE ${w}
        ORDER BY p.sort_order, p.page_no, p.label`
    ).bind(id),
    DB.prepare(
      `SELECT d.id, d.part_id, d.label, d.nominal_in, d.nominal_text, d.sort_order
         FROM marina_part_dims d JOIN marina_parts p ON p.id = d.part_id
        WHERE ${w} ORDER BY d.sort_order, d.rowid`
    ).bind(id),
    DB.prepare(
      `SELECT p.id AS part_id, ${TALLY_SELECT}
         FROM marina_parts p LEFT JOIN marina_pieces pc ON pc.part_id = p.id
        WHERE ${w} GROUP BY p.id`
    ).bind(id),
    DB.prepare(
      `SELECT DISTINCT pc.part_id
         FROM marina_pieces pc
         JOIN marina_parts p ON p.id = pc.part_id
         JOIN marina_measurements m ON m.piece_id = pc.id
        WHERE ${w}`
    ).bind(id),
  ];
}

function toDim(r: Record<string, any>): MarinaDim {
  return {
    id: r.id, part_id: r.part_id, label: r.label, nominal_in: Number(r.nominal_in),
    nominal_text: r.nominal_text ?? null, sort_order: Number(r.sort_order ?? 0),
  };
}

function groupDims(dims: D1Result): Map<string, MarinaDim[]> {
  const dimsBy = new Map<string, MarinaDim[]>();
  for (const r of (dims.results ?? []) as Record<string, any>[]) {
    const list = dimsBy.get(r.part_id) ?? [];
    list.push(toDim(r));
    dimsBy.set(r.part_id, list);
  }
  return dimsBy;
}

function assemblePartSummaries(parts: D1Result, dims: D1Result, tallies: D1Result, measured: D1Result): MarinaPartSummary[] {
  const dimsBy = groupDims(dims);
  const tallyBy = new Map<string, Record<string, any>>();
  for (const r of (tallies.results ?? []) as Record<string, any>[]) tallyBy.set(r.part_id, r);
  const locked = new Set(((measured.results ?? []) as Record<string, any>[]).map((r) => r.part_id as string));
  return ((parts.results ?? []) as Record<string, any>[]).map((r) => ({
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
}

// Job detail: one batch — files, then the job's part summaries.
export async function loadJobDetail(DB: D1Database, id: string): Promise<MarinaJobDetail | null> {
  const job = await loadJob(DB, id);
  if (!job) return null;
  const [files, parts, dims, tallies, measured] = await DB.batch([
    DB.prepare(
      `SELECT ${FILE_COLS} FROM marina_files WHERE job_id = ?
        ORDER BY (superseded_at IS NOT NULL), uploaded_at DESC`
    ).bind(id),
    ...partSummaryStmts(DB, "job", id),
  ]);
  return {
    job,
    files: ((files.results ?? []) as Record<string, any>[]).map(publicFile),
    parts: assemblePartSummaries(parts, dims, tallies, measured),
  };
}

// ── marina-03: parts / pieces / measurements ───────────────────────────────────────────────────

export const JOB_COMPLETE_ERROR = { ok: false, code: "job_complete", error: "Reopen the job to change it." } as const;

// D1 surfaces a UNIQUE index rejection as a thrown error carrying SQLite's message.
export function isUniqueViolation(e: unknown): boolean {
  return /UNIQUE constraint failed/i.test(String((e as any)?.message || e));
}

export async function loadPartSummary(DB: D1Database, partId: string): Promise<MarinaPartSummary | null> {
  const [parts, dims, tallies, measured] = await DB.batch(partSummaryStmts(DB, "part", partId));
  return assemblePartSummaries(parts, dims, tallies, measured)[0] ?? null;
}

// Pieces + all their measurements (attempt ASC, then dim sort_order), scoped by a WHERE over `pc`
// (marina_pieces), `p` (marina_parts) and `j` (marina_jobs). Two statements for the caller's batch.
const PIECE_FROM = "marina_pieces pc JOIN marina_parts p ON p.id = pc.part_id JOIN marina_jobs j ON j.id = p.job_id";

function pieceStmts(DB: D1Database, where: string, binds: unknown[], order: string): D1PreparedStatement[] {
  return [
    DB.prepare(
      `SELECT pc.id, pc.part_id, pc.piece_no, pc.status, pc.disposition_note, pc.created_by, pc.created_at, pc.updated_at,
              p.label AS part_label, j.id AS job_id, j.name AS job_name, j.customer AS job_customer
         FROM ${PIECE_FROM} WHERE ${where} ORDER BY ${order}`
    ).bind(...binds),
    DB.prepare(
      `SELECT m.id, m.piece_id, m.dim_id, m.attempt, m.nominal_in, m.measured_in, m.measured_text, m.in_tol,
              m.measured_by, m.measured_at
         FROM marina_measurements m
         JOIN marina_pieces pc ON pc.id = m.piece_id
         JOIN marina_parts p ON p.id = pc.part_id
         JOIN marina_jobs j ON j.id = p.job_id
         LEFT JOIN marina_part_dims d ON d.id = m.dim_id
        WHERE ${where} ORDER BY m.piece_id, m.attempt, COALESCE(d.sort_order, 0), d.rowid`
    ).bind(...binds),
  ];
}

type PieceWithRow = MarinaPiece & { _row: Record<string, any> };

function assemblePieces(pieces: D1Result, measurements: D1Result): PieceWithRow[] {
  const measBy = new Map<string, MarinaMeasurement[]>();
  for (const r of (measurements.results ?? []) as Record<string, any>[]) {
    const list = measBy.get(r.piece_id) ?? [];
    list.push({
      id: r.id, piece_id: r.piece_id, dim_id: r.dim_id, attempt: Number(r.attempt),
      nominal_in: Number(r.nominal_in), measured_in: Number(r.measured_in), measured_text: r.measured_text ?? null,
      in_tol: Number(r.in_tol) === 1, measured_by: r.measured_by ?? null, measured_at: r.measured_at,
    });
    measBy.set(r.piece_id, list);
  }
  return ((pieces.results ?? []) as Record<string, any>[]).map((r) => {
    const ms = measBy.get(r.id) ?? [];
    return {
      id: r.id,
      part_id: r.part_id,
      piece_no: Number(r.piece_no),
      status: r.status as MarinaPieceStatus,
      disposition_note: r.disposition_note ?? null,
      created_by: r.created_by ?? null,
      created_at: r.created_at,
      updated_at: r.updated_at ?? null,
      attempts: ms.reduce((max, m) => Math.max(max, m.attempt), 0),
      measurements: ms,
      _row: r,
    };
  });
}

function stripRow(p: PieceWithRow): MarinaPiece {
  const { _row, ...piece } = p;
  return piece;
}

export async function loadPiece(DB: D1Database, pieceId: string): Promise<MarinaPiece | null> {
  const [pieces, meas] = await DB.batch(pieceStmts(DB, "pc.id = ?", [pieceId], "pc.piece_no"));
  const p = assemblePieces(pieces, meas)[0];
  return p ? stripRow(p) : null;
}

const prefixed = (cols: string, alias: string) => cols.split(", ").map((c) => `${alias}.${c}`).join(", ");

// Part detail: one batch — the part-summary statements, job, file, pieces, measurements.
export async function loadPartDetail(DB: D1Database, partId: string): Promise<MarinaPartDetail | null> {
  const [parts, dims, tallies, measured, jobRes, fileRes, pieces, meas] = await DB.batch([
    ...partSummaryStmts(DB, "part", partId),
    DB.prepare(
      `SELECT j.id, j.name, j.customer, j.tolerance_in, j.status
         FROM marina_jobs j JOIN marina_parts p ON p.job_id = j.id WHERE p.id = ?`
    ).bind(partId),
    DB.prepare(
      `SELECT ${prefixed(FILE_COLS, "f")} FROM marina_files f JOIN marina_parts p ON p.file_id = f.id WHERE p.id = ?`
    ).bind(partId),
    ...pieceStmts(DB, "pc.part_id = ?", [partId], "pc.piece_no"),
  ]);
  const summary = assemblePartSummaries(parts, dims, tallies, measured)[0];
  const j = (jobRes.results ?? [])[0] as Record<string, any> | undefined;
  if (!summary || !j) return null;
  const f = (fileRes.results ?? [])[0] as Record<string, any> | undefined;
  return {
    ...summary,
    job: { id: j.id, name: j.name, customer: j.customer ?? null, tolerance_in: Number(j.tolerance_in), status: j.status as MarinaJobStatus },
    file: f ? publicFile(f) : null,
    pieces: assemblePieces(pieces, meas).map(stripRow),
  };
}

// Rework queue: every rework_pending piece on open jobs (or on the one job), oldest first. One batch.
export async function listRework(DB: D1Database, jobId: string | null): Promise<MarinaReworkItem[]> {
  const where = `pc.status = 'rework_pending' AND ${jobId ? "p.job_id = ?" : "j.status = 'open'"}`;
  const binds = jobId ? [jobId] : [];
  const [pieces, meas, dims] = await DB.batch([
    ...pieceStmts(DB, where, binds, "COALESCE(pc.updated_at, pc.created_at), pc.created_at, pc.piece_no"),
    DB.prepare(
      `SELECT d.id, d.part_id, d.label, d.nominal_in, d.nominal_text, d.sort_order
         FROM marina_part_dims d
        WHERE d.part_id IN (SELECT pc.part_id FROM ${PIECE_FROM} WHERE ${where})
        ORDER BY d.sort_order, d.rowid`
    ).bind(...binds),
  ]);
  const dimsBy = groupDims(dims);
  return assemblePieces(pieces, meas).map((p) => ({
    piece: stripRow(p),
    part: { id: p.part_id, label: p._row.part_label, dims: dimsBy.get(p.part_id) ?? [] },
    job: { id: p._row.job_id, name: p._row.job_name, customer: p._row.job_customer ?? null },
  }));
}

export interface MarinaPartRef { id: string; job_id: string; label: string; }
export interface MarinaPieceRef { id: string; part_id: string; piece_no: number; status: MarinaPieceStatus; disposition_note: string | null; }

// The owning job (job_complete guard, tolerance, log summaries) plus the part's identity.
export async function jobForPart(DB: D1Database, partId: string): Promise<{ job: MarinaJob; part: MarinaPartRef } | null> {
  const row = await DB.prepare(
    `SELECT ${prefixed(JOB_COLS, "j")}, p.id AS part_id, p.label AS part_label
       FROM marina_parts p JOIN marina_jobs j ON j.id = p.job_id WHERE p.id = ?`
  ).bind(partId).first<Record<string, any>>();
  if (!row) return null;
  return { job: toJob(row), part: { id: row.part_id, job_id: row.id, label: row.part_label } };
}

export async function jobForPiece(DB: D1Database, pieceId: string): Promise<{ job: MarinaJob; part: MarinaPartRef; piece: MarinaPieceRef } | null> {
  const row = await DB.prepare(
    `SELECT ${prefixed(JOB_COLS, "j")}, p.id AS part_id, p.label AS part_label,
            pc.id AS piece_id, pc.piece_no, pc.status AS piece_status, pc.disposition_note
       FROM marina_pieces pc JOIN marina_parts p ON p.id = pc.part_id JOIN marina_jobs j ON j.id = p.job_id
      WHERE pc.id = ?`
  ).bind(pieceId).first<Record<string, any>>();
  if (!row) return null;
  return {
    job: toJob(row),
    part: { id: row.part_id, job_id: row.id, label: row.part_label },
    piece: {
      id: row.piece_id, part_id: row.part_id, piece_no: Number(row.piece_no),
      status: row.piece_status as MarinaPieceStatus, disposition_note: row.disposition_note ?? null,
    },
  };
}

// Log summary: "<job name> · <part label>" or "<job name> · <part label> #<piece_no>".
export function partLogSummary(jobName: string, partLabel: string, pieceNo?: number): string {
  return pieceNo === undefined ? `${jobName} · ${partLabel}` : `${jobName} · ${partLabel} #${pieceNo}`;
}

export interface CleanDim { label: string; nominal_in: number; nominal_text: string; }

// Dims for bulk create and PUT /dims: 1–20; label 1–40; nominal from nominal_text (parseInches, stored
// trimmed) else nominal_in (finite > 0, stored text = formatInches). Errors name the part and the dim.
export function cleanDims(raw: unknown, partLabel: string): FieldResult<CleanDim[]> {
  if (!Array.isArray(raw) || raw.length < 1) return { ok: false, error: `Part "${partLabel}" needs at least one dimension.` };
  if (raw.length > 20) return { ok: false, error: `Part "${partLabel}" can have at most 20 dimensions.` };
  const out: CleanDim[] = [];
  for (let i = 0; i < raw.length; i++) {
    const d = (raw[i] && typeof raw[i] === "object" ? raw[i] : {}) as Record<string, unknown>;
    const name = typeof d.label === "string" ? d.label.trim() : "";
    const where = `Part "${partLabel}", dimension ${name ? `"${name}"` : `#${i + 1}`}`;
    if (!name || name.length > 40) return { ok: false, error: `${where}: label must be 1–40 characters.` };
    const text = typeof d.nominal_text === "string" ? d.nominal_text.trim() : "";
    let nominal: number | null = null;
    let nominalText = "";
    if (text) {
      nominal = parseInches(text);
      nominalText = text;
    } else if (typeof d.nominal_in === "number" && Number.isFinite(d.nominal_in) && d.nominal_in > 0) {
      nominal = d.nominal_in;
      nominalText = formatInches(nominal);
    }
    if (nominal === null || !(nominal > 0)) {
      return { ok: false, error: `${where}: needs a nominal size in inches${text ? ` (couldn't read "${text}")` : ""}.` };
    }
    out.push({ label: name, nominal_in: nominal, nominal_text: nominalText });
  }
  return { ok: true, value: out };
}

// MeasureBody shape check (values are evaluated by pieces.ts evaluateMeasurements).
export function cleanMeasureBody(body: Record<string, unknown>): FieldResult<{
  measurements: MeasureInput[]; disposition: Disposition | null; note: string | null; noteGiven: boolean;
}> {
  if (!Array.isArray(body.measurements)) return { ok: false, error: "measurements must be a list." };
  const measurements: MeasureInput[] = [];
  for (const m of body.measurements) {
    if (!m || typeof m !== "object") return { ok: false, error: "Each measurement needs dim_id and value." };
    const r = m as Record<string, unknown>;
    measurements.push({ dim_id: String(r.dim_id ?? ""), value: typeof r.value === "string" ? r.value : String(r.value ?? "") });
  }
  const d = body.disposition;
  if (d !== undefined && d !== null && d !== "rework" && d !== "scrap") {
    return { ok: false, error: "disposition must be rework or scrap." };
  }
  const note = cleanOptional(body.note, 2000, "Note");
  if (!note.ok) return note;
  return {
    ok: true,
    value: { measurements, disposition: (d as Disposition | null | undefined) ?? null, note: note.value, noteGiven: "note" in body },
  };
}

// Dims in order, for evaluateMeasurements.
export async function partDimNominals(DB: D1Database, partId: string): Promise<{ id: string; nominal_in: number }[]> {
  const res = await DB.prepare(
    "SELECT id, nominal_in FROM marina_part_dims WHERE part_id = ? ORDER BY sort_order, rowid"
  ).bind(partId).all<Record<string, any>>();
  return (res.results ?? []).map((r) => ({ id: r.id, nominal_in: Number(r.nominal_in) }));
}

// Shared JSON-body reader for the marina-03 routes: null on a missing / non-object body.
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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
