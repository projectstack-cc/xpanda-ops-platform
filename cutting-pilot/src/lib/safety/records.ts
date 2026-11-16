// src/lib/safety/records.ts
// saf-01: shared server lib for the v2 safety training record (table safety_training_completions).
// Pure functions (selfchecked in records.selfcheck.ts) + thin D1 helpers. Every completion row is kept;
// "latest per person × block" is computed at read time. Rows are voided, never deleted.
import type { D1Database } from "@cloudflare/workers-types";
import { etNowWallClock } from "@/lib/etDateTime";
import { getBlock } from "./trainingBlocks";

export interface CompletionRow {
  id: string;
  user_id: string;
  user_name: string;
  block_id: string;
  completed_on: string; // YYYY-MM-DD (ET calendar date)
  source: "self" | "group";
  recorded_by_id: string;
  recorded_by_name: string;
  note: string | null;
  attested: number;
  voided_at: string | null;
  voided_by_name: string | null;
  void_reason: string | null;
  created_at: string;
}

export interface Trainee {
  user_id: string;
  name: string;
  username: string;
  roles: string;
}

export interface LatestEntry {
  completed_on: string;
  source: "self" | "group";
  id: string;
}

export type LatestMap = Map<string, Map<string, LatestEntry>>;

export interface TrainingSummary {
  people: number;
  allDone: number;
  noneYet: number;
  thisMonth: { completions: number; group: number };
}

// ---------------------------------------------------------------------------------------------- pure

/** Today's America/New_York calendar date, "YYYY-MM-DD". */
export function etToday(nowMs: number = Date.now()): string {
  return etNowWallClock(nowMs).date;
}

/** Strict "YYYY-MM-DD" that is a real calendar date. */
export function isValidYmd(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Manage capability: safety.manage (middleware header) or Administrator. Defense in depth on top of middleware. */
export function canManageSafety(headers: { get(name: string): string | null }): boolean {
  return headers.get("X-User-Can-Manage-Safety") === "1" || headers.get("X-User-Is-Admin") === "1";
}

/**
 * Latest non-voided completion per user × block. Newest completed_on wins; a tie goes to the newest created_at.
 * Voided rows are skipped even if passed in.
 */
export function latestByUserBlock(
  rows: Array<Pick<CompletionRow, "id" | "user_id" | "block_id" | "completed_on" | "source" | "created_at" | "voided_at">>
): LatestMap {
  const out: LatestMap = new Map();
  const createdOf = new Map<string, string>();
  for (const r of rows) {
    if (r.voided_at) continue;
    let byBlock = out.get(r.user_id);
    if (!byBlock) { byBlock = new Map(); out.set(r.user_id, byBlock); }
    const cur = byBlock.get(r.block_id);
    const curCreated = cur ? createdOf.get(cur.id) ?? "" : "";
    if (
      !cur ||
      r.completed_on > cur.completed_on ||
      (r.completed_on === cur.completed_on && (r.created_at || "") > curCreated)
    ) {
      byBlock.set(r.block_id, { completed_on: r.completed_on, source: r.source, id: r.id });
      createdOf.set(r.id, r.created_at || "");
    }
  }
  return out;
}

/**
 * Records-view summary for the trainee population.
 * - allDone: people holding every ready block; noneYet: people holding no ready block.
 * - thisMonth: non-voided completions (all rows, not just latest) by people in the population whose
 *   completed_on falls in monthYm ("YYYY-MM"), and how many of those were group sign-offs.
 */
export function summarize(
  people: Array<Pick<Trainee, "user_id">>,
  latest: LatestMap,
  readyIds: string[],
  monthYm: string,
  rows: Array<Pick<CompletionRow, "user_id" | "block_id" | "completed_on" | "source" | "voided_at">> = []
): TrainingSummary {
  let allDone = 0, noneYet = 0;
  const ids = new Set<string>();
  for (const p of people) {
    ids.add(p.user_id);
    const mine = latest.get(p.user_id);
    const have = readyIds.filter((b) => mine?.has(b)).length;
    if (readyIds.length > 0 && have === readyIds.length) allDone++;
    if (have === 0) noneYet++;
  }
  const ready = new Set(readyIds);
  let completions = 0, group = 0;
  for (const r of rows) {
    if (r.voided_at || !ids.has(r.user_id) || !ready.has(r.block_id)) continue;
    if (r.completed_on.slice(0, 7) !== monthYm) continue;
    completions++;
    if (r.source === "group") group++;
  }
  return { people: people.length, allDone, noneYet, thisMonth: { completions, group } };
}

export const CSV_HEADER = [
  "completion_id", "completed_on", "person", "username", "roles", "block_id", "block_title", "source",
  "recorded_by", "note", "recorded_at_utc", "voided_at", "void_reason",
] as const;

export interface CsvRow extends CompletionRow {
  username: string | null;
  roles: string | null;
}

/** One CSV cell: CSV-injection guard (leading ' on = + - @), then RFC-4180 quoting. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: CsvRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const r of rows) {
    const block = getBlock(r.block_id);
    lines.push(
      [
        r.id, r.completed_on, r.user_name, r.username ?? "", r.roles ?? "", r.block_id,
        block ? `Block ${block.n} — ${block.titleEn}` : r.block_id, r.source, r.recorded_by_name,
        r.note ?? "", r.created_at, r.voided_at ?? "", r.void_reason ?? "",
      ].map(csvCell).join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------------------------- D1

/**
 * Trainee population: active users who hold `safety` VIEW through any of their roles, plus administrators.
 * Mirrors lib/session.ts validateSession(): multi-role merge (any role granting view → view), admin =
 * role-administrator in user_roles OR legacy users.role = 'admin', and the users.role_id fallback only when the
 * user has no user_roles rows. (validateSession is per-session, so its rule is restated here as one query.)
 * Excludes e.g. TV Display and the external Seal Express account (no safety view).
 */
const SAFETY_VIEW = (alias: string) =>
  `(CASE WHEN json_valid(${alias}.permissions) THEN json_extract(${alias}.permissions, '$.safety.view') END) = 1`;

export const TRAINEE_SQL = `
SELECT u.id AS user_id,
       COALESCE(NULLIF(u.display_name, ''), u.username) AS name,
       COALESCE(u.username, '') AS username,
       COALESCE(
         (SELECT group_concat(name, ', ') FROM (
            SELECT r2.name FROM user_roles ur2 JOIN roles r2 ON r2.id = ur2.role_id
             WHERE ur2.user_id = u.id ORDER BY r2.name)),
         (SELECT r3.name FROM roles r3 WHERE r3.id = u.role_id),
         '') AS roles
  FROM users u
 WHERE u.is_active = 1
   AND (
     u.role = 'admin'
     OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id AND (r.id = 'role-administrator' OR ${SAFETY_VIEW("r")}))
     OR (NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)
         AND EXISTS (SELECT 1 FROM roles r WHERE r.id = u.role_id AND ${SAFETY_VIEW("r")}))
   )
 ORDER BY lower(COALESCE(NULLIF(u.display_name, ''), u.username)), u.id`;

export async function listTrainees(db: D1Database): Promise<Trainee[]> {
  const r = await db.prepare(TRAINEE_SQL).all<Trainee>();
  return (r.results ?? []) as Trainee[];
}

const COLS = `id, user_id, user_name, block_id, completed_on, source, recorded_by_id, recorded_by_name, note,
              attested, voided_at, voided_by_name, void_reason, created_at`;

export async function listActiveCompletions(db: D1Database): Promise<CompletionRow[]> {
  const r = await db
    .prepare(`SELECT ${COLS} FROM safety_training_completions WHERE voided_at IS NULL`)
    .all<CompletionRow>();
  return (r.results ?? []) as CompletionRow[];
}

export async function listUserCompletions(db: D1Database, userId: string): Promise<CompletionRow[]> {
  const r = await db
    .prepare(
      `SELECT ${COLS} FROM safety_training_completions
        WHERE user_id = ? AND voided_at IS NULL
        ORDER BY completed_on DESC, created_at DESC`
    )
    .bind(userId)
    .all<CompletionRow>();
  return (r.results ?? []) as CompletionRow[];
}

/**
 * saf-03: every completion for one person, voided included (the client filters), newest completed_on then newest
 * created_at first (id breaks a full tie so the order is stable).
 */
export const PERSON_COMPLETIONS_SQL = `SELECT ${COLS} FROM safety_training_completions
  WHERE user_id = ?
  ORDER BY completed_on DESC, created_at DESC, id DESC`;

export async function listPersonCompletions(db: D1Database, userId: string): Promise<CompletionRow[]> {
  const r = await db.prepare(PERSON_COMPLETIONS_SQL).bind(userId).all<CompletionRow>();
  return (r.results ?? []) as CompletionRow[];
}

/** Full history for CSV, newest first, with the person's current username and role names. */
export async function listCsvRows(db: D1Database, includeVoided: boolean): Promise<CsvRow[]> {
  const r = await db
    .prepare(
      `SELECT c.id, c.user_id, c.user_name, c.block_id, c.completed_on, c.source, c.recorded_by_id,
              c.recorded_by_name, c.note, c.attested, c.voided_at, c.voided_by_name, c.void_reason, c.created_at,
              u.username AS username,
              (SELECT group_concat(name, ', ') FROM (
                 SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                  WHERE ur.user_id = c.user_id ORDER BY r.name)) AS roles
         FROM safety_training_completions c
         LEFT JOIN users u ON u.id = c.user_id
        ${includeVoided ? "" : "WHERE c.voided_at IS NULL"}
        ORDER BY c.completed_on DESC, c.created_at DESC, c.id`
    )
    .all<CsvRow>();
  return (r.results ?? []) as CsvRow[];
}

/** Insert statement for one completion row (caller binds via .bind / batches it). */
export function insertCompletionStmt(
  db: D1Database,
  row: Pick<CompletionRow, "id" | "user_id" | "user_name" | "block_id" | "completed_on" | "source" | "recorded_by_id" | "recorded_by_name" | "note">
) {
  return db
    .prepare(
      `INSERT INTO safety_training_completions
         (id, user_id, user_name, block_id, completed_on, source, recorded_by_id, recorded_by_name, note, attested)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .bind(row.id, row.user_id, row.user_name, row.block_id, row.completed_on, row.source,
          row.recorded_by_id, row.recorded_by_name, row.note);
}

/**
 * saf-02: self completion, inserted only if the caller has no non-voided `self` row for that block on that date.
 * ONE statement (INSERT … SELECT … WHERE NOT EXISTS), so two simultaneous taps can't both insert — SQLite/D1 run a
 * single statement atomically. `meta.changes === 0` → already recorded (the route answers 409 already_today).
 */
export function insertSelfIfAbsentStmt(
  db: D1Database,
  row: Pick<CompletionRow, "id" | "user_id" | "user_name" | "block_id" | "completed_on" | "recorded_by_id" | "recorded_by_name">
) {
  return db
    .prepare(
      `INSERT INTO safety_training_completions
         (id, user_id, user_name, block_id, completed_on, source, recorded_by_id, recorded_by_name, note, attested)
       SELECT ?, ?, ?, ?, ?, 'self', ?, ?, NULL, 1
        WHERE NOT EXISTS (
          SELECT 1 FROM safety_training_completions
           WHERE user_id = ? AND block_id = ? AND completed_on = ? AND source = 'self' AND voided_at IS NULL)`
    )
    .bind(row.id, row.user_id, row.user_name, row.block_id, row.completed_on, row.recorded_by_id, row.recorded_by_name,
          row.user_id, row.block_id, row.completed_on);
}

export async function getCompletion(db: D1Database, id: string): Promise<CompletionRow | null> {
  return (await db.prepare(`SELECT ${COLS} FROM safety_training_completions WHERE id = ?`).bind(id).first<CompletionRow>()) ?? null;
}

/** Caller identity from the middleware's X-User-* headers (never the body). null → 401. */
export function actorOf(headers: { get(name: string): string | null }): { id: string; name: string } | null {
  const id = (headers.get("X-User-Id") || "").trim();
  const name = (headers.get("X-User-Name") || "").trim();
  return id && name ? { id, name } : null;
}
