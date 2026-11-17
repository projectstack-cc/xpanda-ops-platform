// src/components/tasks/tasksUi.ts  (tasks-02)
// Shared class strings, API types (mirroring /v2/api/tasks/manage/* from tasks-01), fetch helper, error copy and
// YMD date helpers for the /v2/tasks manager page. Client-safe: imports only the pure lib/tasks/board.
import { normalizeShift, SHIFT_ORDER, type ShiftKey } from "@/lib/tasks/board";

// Class strings — same pattern as components/safety/safetyUi.ts (copied, not imported).
export const CARD = "bg-[var(--surface)] border border-[var(--card-border)] rounded-xl";
export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
export const BTN_PRIMARY =
  `min-h-[44px] inline-flex items-center justify-center gap-2 px-4 rounded-lg bg-[var(--brand)] text-white font-semibold text-sm no-underline cursor-pointer hover:bg-[var(--brand-hover)] disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS}`;
export const BTN_OUTLINE =
  `min-h-[44px] inline-flex items-center justify-center gap-2 px-4 rounded-lg border border-[var(--input-border)] bg-[var(--surface)] text-text font-semibold text-sm no-underline cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS}`;
export const BTN_ICON =
  `min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-muted hover:text-text hover:bg-[var(--ghost-bg)] cursor-pointer ${FOCUS}`;
export const CHIP = "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap border";
export const CHIP_NEUTRAL = `${CHIP} bg-[var(--ghost-bg)] border-[var(--input-border)] text-text`;
export const CHIP_MUTED = `${CHIP} bg-[var(--surface)] border-[var(--input-border)] text-muted`;
export const CHIP_WARN = `${CHIP} bg-[var(--warn-bg)] border-[var(--warn-border)] text-[var(--warn-text)]`;
export const CHIP_INFO = `${CHIP} bg-[var(--info-bg)] border-[var(--info-border)] text-[var(--info-text)]`;
export const INPUT =
  `w-full min-h-[44px] px-3 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm ${FOCUS}`;
export const LABEL = "block text-xs font-semibold uppercase tracking-wide text-muted mb-1";

// ---------------------------------------------------------------------------------------------- API types

export interface Person { id: string; name: string; shift: ShiftKey | null }
export interface PersonRow extends Person { task_count?: number }
export interface MemberRow extends Person { assignable: boolean }
export interface JobRef { job_id: string; invoice_number: string | null; customer: string | null; ship_date: string | null; archived?: boolean }
export interface JobHit extends JobRef { status: string | null; archived: boolean }

export interface ManageRow {
  id: string;
  task_date: string;
  title: string;
  details: string | null;
  slot_start: string | null;
  slot_end: string | null;
  slot_label: string | null;
  template_id: string | null;
  crew_id: string | null;
  crew_name: string | null;
  sort_order: number;
  created_by: string | null;
  updated_at: string | null;
  assignees: Person[];
  jobs: JobRef[];
}

export interface DayData { ok: true; date: string; tasks: ManageRow[]; people: PersonRow[] }

export interface TemplateRow {
  id: string; title: string; details: string | null; slot_start: string | null; slot_end: string | null;
  slot_label: string | null; is_active: boolean; use_count: number; assignees: MemberRow[];
}

export interface CrewRow { id: string; name: string; is_active: boolean; members: MemberRow[] }

// ---------------------------------------------------------------------------------------------- helpers

/** Earliest shift among the task's people (1st before 2nd), else null — the TV's rule. */
export function taskShift(row: { assignees: { shift: ShiftKey | null | string }[] }): ShiftKey | null {
  let best: ShiftKey | null = null;
  for (const a of row.assignees) {
    const s = normalizeShift(a.shift);
    if (s && (best === null || SHIFT_ORDER.indexOf(s) < SHIFT_ORDER.indexOf(best))) best = s;
  }
  return best;
}

export const shiftShort = (s: ShiftKey | null) => (s ? s : "No shift");

const ERRORS: Record<string, string> = {
  title_required: "Give the task a name.",
  title_too_long: "Task name is too long (80 characters max).",
  details_too_long: "Details are too long (500 characters max).",
  slot_incomplete: "Time slot needs both a From and a To time.",
  slot_invalid: "Time slot times aren't valid.",
  slot_order: "Time slot must end after it starts.",
  invalid_assignee_ids: "Pick between 1 and 10 people.",
  unknown_assignee: "Someone picked can't be assigned tasks any more — remove them and try again.",
  unknown_job: "One of the linked orders no longer exists — remove it and try again.",
  unknown_crew: "That crew no longer exists.",
  unknown_template: "That repeatable task no longer exists.",
  inactive_template: "That repeatable task was removed from the list.",
  template_conflict: "A task picked from the repeatable list can't be saved as a new one.",
  crew_name_taken: "Another crew already uses that name.",
  invalid_date: "Pick a valid date.",
};

/** Plain message for an API error code. */
export function errorText(code: string | undefined | null, detail?: string | null, status?: number): string {
  if (status === 403) return "You can view tasks but not change them.";
  if (code && ERRORS[code]) return ERRORS[code];
  return `Couldn't save — ${detail || code || `error ${status ?? ""}`.trim()}`;
}

export interface ApiResult<T = any> { ok: boolean; status: number; json: T & { ok?: boolean; error?: string; detail?: string } }

/** JSON fetch, no-store. Never throws: a network failure comes back as status 0. */
export async function api<T = any>(path: string, method = "GET", body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/v2/api/tasks${path}`, {
      method,
      cache: "no-store",
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as any;
    return { ok: res.ok && json?.ok !== false, status: res.status, json };
  } catch (e: any) {
    return { ok: false, status: 0, json: { ok: false, error: "network", detail: "Network error — check the connection." } as any };
  }
}

/** Error text for a failed ApiResult. */
export const resultError = (r: ApiResult) => errorText(r.json?.error, r.json?.detail, r.status);

// ---------------------------------------------------------------------------------------------- dates (YMD, UTC math)

const ymdToUtc = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const utcToYmd = (dt: Date) => dt.toISOString().slice(0, 10);

export const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(ymdToUtc(s).getTime());

export function addDays(ymd: string, n: number): string {
  const dt = ymdToUtc(ymd);
  dt.setUTCDate(dt.getUTCDate() + n);
  return utcToYmd(dt);
}

/** "Tuesday, Nov 17". */
export function longDate(ymd: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" }).format(ymdToUtc(ymd));
}

/** "Wed 11/18". */
export function shortDate(ymd: string): string {
  const dt = ymdToUtc(ymd);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(dt);
  return `${wd} ${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
}

export function isWeekend(ymd: string): boolean {
  const d = ymdToUtc(ymd).getUTCDay();
  return d === 0 || d === 6;
}

export const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
