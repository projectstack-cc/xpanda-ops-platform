// src/lib/tasks/db.ts
// tasks-01: Daily Tasks — thin D1 helpers + request-body validation for /v2/api/tasks/*. Pure grouping lives in
// ./board.ts. Identity/date helpers come from lib/safety/records (imported, not copied).
import type { D1Database } from "@cloudflare/workers-types";
import { NextResponse } from "next/server";
import { isValidYmd } from "@/lib/safety/records";
import {
  checkSlot, formatSlot, normalizeShift, DETAILS_MAX, MAX_ASSIGNEES, MAX_JOBS, TITLE_MAX,
  type BoardPerson, type BoardTaskInput, type ShiftKey,
} from "./board";

type Headers = { get(name: string): string | null };

export const CREW_NAME_MAX = 40;

/** tasks.manage VIEW (middleware header) or Administrator. */
export function canManageTasks(headers: Headers): boolean {
  return headers.get("X-User-Can-Manage-Tasks") === "1" || headers.get("X-User-Is-Admin") === "1";
}

/** tasks.manage EDIT (middleware header) or Administrator. */
export function canEditTasks(headers: Headers): boolean {
  return headers.get("X-User-Can-Edit-Tasks") === "1" || headers.get("X-User-Is-Admin") === "1";
}

/** House error shape { ok: false, error, detail? } (+ extra fields such as ids). */
export function fail(status: number, error: string, detail?: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, error, ...(detail ? { detail } : {}), ...extra }, { status });
}

/** "YYYY-MM-DD HH:MM:SS" UTC, same as the safety routes. */
export const nowTs = () => new Date().toISOString().replace("T", " ").slice(0, 19);

const NAME_SQL = (u: string, fallback: string) => `COALESCE(NULLIF(${u}.display_name, ''), ${u}.username, ${fallback})`;

// ---------------------------------------------------------------------------------------------- people

export interface AssignablePerson { id: string; name: string; shift: ShiftKey | null }

/** Active users with task_assignable = 1, ordered by name. */
export async function loadAssignablePeople(DB: D1Database): Promise<AssignablePerson[]> {
  const r = await DB.prepare(
    `SELECT u.id, ${NAME_SQL("u", "u.id")} AS name, u.shift
       FROM users u
      WHERE u.is_active = 1 AND u.task_assignable = 1
      ORDER BY lower(${NAME_SQL("u", "u.id")}), u.id`
  ).all<{ id: string; name: string; shift: string | null }>();
  return (r.results ?? []).map((p) => ({ id: p.id, name: p.name, shift: normalizeShift(p.shift) }));
}

const placeholders = (n: number) => Array(n).fill("?").join(", ");

/** Every id must be an active, task-assignable user. ids ≤ MAX_ASSIGNEES (validated upstream). */
export async function checkAssignees(DB: D1Database, ids: string[]): Promise<{ error: "unknown_assignee"; ids: string[] } | null> {
  if (!ids.length) return null;
  const r = await DB.prepare(
    `SELECT id FROM users WHERE id IN (${placeholders(ids.length)}) AND is_active = 1 AND task_assignable = 1`
  ).bind(...ids).all<{ id: string }>();
  const ok = new Set((r.results ?? []).map((x) => x.id));
  const bad = ids.filter((i) => !ok.has(i));
  return bad.length ? { error: "unknown_assignee", ids: bad } : null;
}

/** Every id must exist in jobs (archived allowed). ids ≤ MAX_JOBS (validated upstream). */
export async function checkJobs(DB: D1Database, ids: string[]): Promise<{ error: "unknown_job"; ids: string[] } | null> {
  if (!ids.length) return null;
  const r = await DB.prepare(`SELECT id FROM jobs WHERE id IN (${placeholders(ids.length)})`).bind(...ids).all<{ id: string }>();
  const ok = new Set((r.results ?? []).map((x) => x.id));
  const bad = ids.filter((i) => !ok.has(i));
  return bad.length ? { error: "unknown_job", ids: bad } : null;
}

// ---------------------------------------------------------------------------------------------- tasks

export interface DayTaskJob { job_id: string; invoice_number: string | null; customer: string | null; ship_date: string | null }

export interface DayTask extends BoardTaskInput {
  task_date: string;
  details: string | null;
  slot_label: string | null;
  crew_id: string | null;
  created_by: string | null;
  updated_at: string | null;
  jobs: DayTaskJob[];
}

/** Manager-table order: slot_start (NULL last), sort_order, title. */
export function sortDayTasks<T extends { slot_start: string | null; sort_order: number; title: string }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    if (a.slot_start !== b.slot_start) {
      if (a.slot_start === null) return 1;
      if (b.slot_start === null) return -1;
      return a.slot_start < b.slot_start ? -1 : 1;
    }
    return a.sort_order - b.sort_order || a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  });
}

/**
 * Three reads (tasks + crew name; assignees ⨝ users; jobs ⨝ jobs) for every non-deleted task matching `where`
 * (a predicate on alias t). Assignees join users regardless of is_active / task_assignable, jobs regardless of
 * archived_at, crews regardless of is_active — a historical task always shows its names.
 */
async function loadTasksWhere(DB: D1Database, where: string, binds: unknown[]): Promise<DayTask[]> {
  const [tasksR, assR, jobsR] = await DB.batch([
    DB.prepare(
      `SELECT t.id, t.task_date, t.title, t.details, t.slot_start, t.slot_end, t.template_id, t.crew_id,
              c.name AS crew_name, t.sort_order, t.created_by, t.updated_at
         FROM daily_tasks t LEFT JOIN task_crews c ON c.id = t.crew_id
        WHERE t.deleted_at IS NULL AND (${where})`
    ).bind(...binds),
    DB.prepare(
      `SELECT a.task_id, a.user_id AS id, ${NAME_SQL("u", "a.user_id")} AS name, u.shift
         FROM daily_task_assignees a
         JOIN daily_tasks t ON t.id = a.task_id
         LEFT JOIN users u ON u.id = a.user_id
        WHERE t.deleted_at IS NULL AND (${where})`
    ).bind(...binds),
    DB.prepare(
      `SELECT dj.task_id, dj.job_id, j.invoice_number, j.customer, j.ship_date
         FROM daily_task_jobs dj
         JOIN daily_tasks t ON t.id = dj.task_id
         LEFT JOIN jobs j ON j.id = dj.job_id
        WHERE t.deleted_at IS NULL AND (${where})
        ORDER BY dj.rowid`
    ).bind(...binds),
  ]);

  const ass = new Map<string, BoardPerson[]>();
  for (const a of (assR.results ?? []) as any[]) {
    const list = ass.get(a.task_id) ?? [];
    list.push({ id: a.id, name: a.name, shift: normalizeShift(a.shift) });
    ass.set(a.task_id, list);
  }
  for (const list of Array.from(ass.values())) list.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));

  const jobs = new Map<string, DayTaskJob[]>();
  for (const j of (jobsR.results ?? []) as any[]) {
    const list = jobs.get(j.task_id) ?? [];
    list.push({ job_id: j.job_id, invoice_number: j.invoice_number ?? null, customer: j.customer ?? null, ship_date: j.ship_date ?? null });
    jobs.set(j.task_id, list);
  }

  const rows: DayTask[] = ((tasksR.results ?? []) as any[]).map((t) => ({
    id: t.id,
    task_date: t.task_date,
    title: t.title,
    details: t.details ?? null,
    slot_start: t.slot_start ?? null,
    slot_end: t.slot_end ?? null,
    slot_label: formatSlot(t.slot_start ?? null, t.slot_end ?? null),
    template_id: t.template_id ?? null,
    crew_id: t.crew_id ?? null,
    crew_name: t.crew_name ?? null,
    sort_order: Number(t.sort_order) || 0,
    created_by: t.created_by ?? null,
    updated_at: t.updated_at ?? null,
    assignees: ass.get(t.id) ?? [],
    jobs: jobs.get(t.id) ?? [],
  }));
  return sortDayTasks(rows);
}

/** Non-deleted tasks for one ET calendar date, ordered slot (NULL last), sort_order, title. */
export function loadDayTasks(DB: D1Database, date: string): Promise<DayTask[]> {
  return loadTasksWhere(DB, "t.task_date = ?", [date]);
}

/** Non-deleted tasks by id (≤ 20 ids — the from-templates cap). */
export function loadTasksByIds(DB: D1Database, ids: string[]): Promise<DayTask[]> {
  if (!ids.length) return Promise.resolve([]);
  return loadTasksWhere(DB, `t.id IN (${placeholders(ids.length)})`, ids);
}

/** Flat manager row (manage/day shape). */
export function toManageRow(t: DayTask) {
  return {
    id: t.id, task_date: t.task_date, title: t.title, details: t.details, slot_start: t.slot_start, slot_end: t.slot_end,
    slot_label: t.slot_label, template_id: t.template_id, crew_id: t.crew_id, crew_name: t.crew_name,
    sort_order: t.sort_order, created_by: t.created_by, updated_at: t.updated_at,
    assignees: t.assignees, jobs: t.jobs,
  };
}

/** INSERT for one task with sort_order = current max for that date + 1 (computed in-statement, so batch-safe). */
export function insertTaskStmt(
  DB: D1Database,
  row: { id: string; task_date: string; title: string; details: string | null; slot_start: string | null; slot_end: string | null;
         template_id: string | null; crew_id: string | null; created_by: string; created_at: string }
) {
  return DB.prepare(
    `INSERT INTO daily_tasks (id, task_date, title, details, slot_start, slot_end, template_id, crew_id, sort_order, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM daily_tasks WHERE task_date = ?), ?, ?)`
  ).bind(row.id, row.task_date, row.title, row.details, row.slot_start, row.slot_end, row.template_id, row.crew_id,
         row.task_date, row.created_by, row.created_at);
}

// ---------------------------------------------------------------------------------------------- validation

export interface TaskFields {
  task_date?: string;
  title?: string;
  details?: string | null;
  slot_start?: string | null;
  slot_end?: string | null;
  assignee_ids?: string[];
  job_ids?: string[];
  crew_id?: string | null;
}

export type Invalid = { ok: false; error: string; detail: string };
const bad = (error: string, detail: string): Invalid => ({ ok: false, error, detail });
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** 1..max distinct non-empty strings (min may be 0). */
export function idList(v: unknown, min: number, max: number, name: string): { ok: true; ids: string[] } | Invalid {
  if (!Array.isArray(v) || v.length < min || v.length > max || !v.every((x) => typeof x === "string" && x.trim() !== "")) {
    return bad(`invalid_${name}`, `${name} must be ${min}–${max} ids.`);
  }
  const ids = (v as string[]).map((x) => x.trim());
  if (new Set(ids).size !== ids.length) return bad(`duplicate_${name}`, `${name} has duplicates.`);
  return { ok: true, ids };
}

/** Trimmed title 1..TITLE_MAX. */
export function validTitle(v: unknown): { ok: true; value: string } | Invalid {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return bad("title_required", "Title is required.");
  if (s.length > TITLE_MAX) return bad("title_too_long", `Max ${TITLE_MAX} characters.`);
  return { ok: true, value: s };
}

/** Trimmed details ≤ DETAILS_MAX; empty/null → null. */
export function validDetails(v: unknown): { ok: true; value: string | null } | Invalid {
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "string") return bad("invalid_details", "details must be text.");
  const s = v.trim();
  if (s.length > DETAILS_MAX) return bad("details_too_long", `Max ${DETAILS_MAX} characters.`);
  return { ok: true, value: s || null };
}

/**
 * Normalize a task body. Full mode (create) requires task_date, title, assignee_ids. Partial mode (PATCH) only
 * validates keys that are present; a slot change merges with `current` so sending just slot_end works (send both
 * as null to clear).
 */
export function validateTaskBody(
  body: any,
  opts: { partial: boolean; current?: { slot_start: string | null; slot_end: string | null } }
): { ok: true; value: TaskFields } | Invalid {
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("invalid_body", "Body must be a JSON object.");
  const out: TaskFields = {};
  const want = (k: string) => !opts.partial || has(body, k);

  if (want("task_date")) {
    if (!isValidYmd(body.task_date)) return bad("invalid_date", "task_date must be YYYY-MM-DD.");
    out.task_date = body.task_date;
  }
  if (want("title")) {
    const t = validTitle(body.title);
    if (!t.ok) return t;
    out.title = t.value;
  }
  if (has(body, "details")) {
    const d = validDetails(body.details);
    if (!d.ok) return d;
    out.details = d.value;
  } else if (!opts.partial) out.details = null;

  if (!opts.partial || has(body, "slot_start") || has(body, "slot_end")) {
    const cur = opts.current ?? { slot_start: null, slot_end: null };
    const s = has(body, "slot_start") ? body.slot_start : opts.partial ? cur.slot_start : null;
    const e = has(body, "slot_end") ? body.slot_end : opts.partial ? cur.slot_end : null;
    const c = checkSlot(s, e);
    if (!c.ok) return bad(c.error, "Time slot needs both start and end as HH:MM (24h), end after start.");
    out.slot_start = c.start;
    out.slot_end = c.end;
  }
  if (want("assignee_ids")) {
    const a = idList(body.assignee_ids, 1, MAX_ASSIGNEES, "assignee_ids");
    if (!a.ok) return a;
    out.assignee_ids = a.ids;
  }
  if (has(body, "job_ids") && body.job_ids !== null) {
    const j = idList(body.job_ids, 0, MAX_JOBS, "job_ids");
    if (!j.ok) return j;
    out.job_ids = j.ids;
  } else if (has(body, "job_ids") || !opts.partial) out.job_ids = [];

  if (has(body, "crew_id")) {
    if (body.crew_id === null || body.crew_id === "") out.crew_id = null;
    else if (typeof body.crew_id === "string") out.crew_id = body.crew_id.trim();
    else return bad("invalid_crew_id", "crew_id must be a string or null.");
  } else if (!opts.partial) out.crew_id = null;

  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------------------------- templates & crews

export interface MemberRow { id: string; name: string; shift: ShiftKey | null; assignable: boolean }

async function membersOf(DB: D1Database, table: "task_template_assignees" | "task_crew_members", key: "template_id" | "crew_id", ids: string[] | null) {
  const where = ids ? `WHERE m.${key} IN (${placeholders(ids.length)})` : "";
  const r = await DB.prepare(
    `SELECT m.${key} AS owner, m.user_id AS id, ${NAME_SQL("u", "m.user_id")} AS name, u.shift,
            CASE WHEN u.is_active = 1 AND u.task_assignable = 1 THEN 1 ELSE 0 END AS assignable
       FROM ${table} m LEFT JOIN users u ON u.id = m.user_id ${where}`
  ).bind(...(ids ?? [])).all<any>();
  const out = new Map<string, MemberRow[]>();
  for (const m of r.results ?? []) {
    const list = out.get(m.owner) ?? [];
    list.push({ id: m.id, name: m.name, shift: normalizeShift(m.shift), assignable: m.assignable === 1 });
    out.set(m.owner, list);
  }
  for (const list of Array.from(out.values())) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return out;
}

export interface TemplateRow {
  id: string; title: string; details: string | null; slot_start: string | null; slot_end: string | null; slot_label: string | null;
  is_active: boolean; use_count: number; created_by: string | null; created_at: string; updated_at: string | null;
  assignees: MemberRow[];
}

export async function loadTemplates(DB: D1Database, opts: { includeInactive?: boolean; ids?: string[] } = {}): Promise<TemplateRow[]> {
  const conds: string[] = [];
  const binds: unknown[] = [];
  if (!opts.includeInactive) conds.push("is_active = 1");
  if (opts.ids) {
    if (!opts.ids.length) return [];
    conds.push(`id IN (${placeholders(opts.ids.length)})`);
    binds.push(...opts.ids);
  }
  const r = await DB.prepare(
    `SELECT id, title, details, slot_start, slot_end, is_active, use_count, created_by, created_at, updated_at
       FROM task_templates ${conds.length ? `WHERE ${conds.join(" AND ")}` : ""}
      ORDER BY use_count DESC, lower(title), id`
  ).bind(...binds).all<any>();
  const rows = r.results ?? [];
  const members = await membersOf(DB, "task_template_assignees", "template_id", opts.ids ?? null);
  return rows.map((t: any) => ({
    id: t.id, title: t.title, details: t.details ?? null, slot_start: t.slot_start ?? null, slot_end: t.slot_end ?? null,
    slot_label: formatSlot(t.slot_start ?? null, t.slot_end ?? null), is_active: t.is_active === 1,
    use_count: Number(t.use_count) || 0, created_by: t.created_by ?? null, created_at: t.created_at, updated_at: t.updated_at ?? null,
    assignees: members.get(t.id) ?? [],
  }));
}

export interface CrewRow {
  id: string; name: string; is_active: boolean; created_by: string | null; created_at: string; updated_at: string | null;
  members: MemberRow[];
}

export async function loadCrews(DB: D1Database, opts: { includeInactive?: boolean; ids?: string[] } = {}): Promise<CrewRow[]> {
  const conds: string[] = [];
  const binds: unknown[] = [];
  if (!opts.includeInactive) conds.push("is_active = 1");
  if (opts.ids) {
    if (!opts.ids.length) return [];
    conds.push(`id IN (${placeholders(opts.ids.length)})`);
    binds.push(...opts.ids);
  }
  const r = await DB.prepare(
    `SELECT id, name, is_active, created_by, created_at, updated_at
       FROM task_crews ${conds.length ? `WHERE ${conds.join(" AND ")}` : ""}
      ORDER BY lower(name), id`
  ).bind(...binds).all<any>();
  const members = await membersOf(DB, "task_crew_members", "crew_id", opts.ids ?? null);
  return (r.results ?? []).map((c: any) => ({
    id: c.id, name: c.name, is_active: c.is_active === 1, created_by: c.created_by ?? null, created_at: c.created_at,
    updated_at: c.updated_at ?? null, members: members.get(c.id) ?? [],
  }));
}

/** Another ACTIVE crew already uses this name (case-insensitive)? */
export async function crewNameTaken(DB: D1Database, name: string, exceptId: string | null): Promise<boolean> {
  const r = await DB.prepare(
    `SELECT 1 AS x FROM task_crews WHERE is_active = 1 AND name = ? COLLATE NOCASE AND id <> ? LIMIT 1`
  ).bind(name, exceptId ?? "").first<{ x: number }>();
  return !!r;
}

export const isUniqueViolation = (e: unknown) => /UNIQUE constraint failed/i.test(String((e as any)?.message || e));
