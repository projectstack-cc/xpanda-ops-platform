// src/lib/tasks/board.ts
// tasks-01: Daily Tasks — pure helpers + the Schedule TV grouping (buildBoard). No D1, no fetch, so every view
// (TV, manager page) groups identically. Selfchecked in board.selfcheck.ts.
//
// Grouping rules (Steve, 2026-11-17):
// - 2+ assignees → a TEAM task. Team blocks are keyed by the exact assignee set; one block per set.
// - 1 assignee → that person's INDIVIDUAL block. A person can appear in a team block AND their own block.
// - A team's shift = the earliest member shift (1st before 2nd); mixed-shift teams sit under 1st shift.
// - Only two shifts exist ("1st", "2nd"); any other users.shift value (incl. "3rd") or NULL → no shift.

export type ShiftKey = "1st" | "2nd";

export const SHIFTS: Record<ShiftKey, { label: string; start: string; end: string }> = {
  "1st": { label: "1st shift", start: "06:00", end: "14:30" },
  "2nd": { label: "2nd shift", start: "14:00", end: "22:30" },
};
export const SHIFT_ORDER: ShiftKey[] = ["1st", "2nd"];
export const TITLE_MAX = 80; // TV space
export const DETAILS_MAX = 500;
export const MAX_ASSIGNEES = 10;
export const MAX_JOBS = 5;

export interface BoardPerson { id: string; name: string; shift: ShiftKey | null }

export interface BoardTaskInput {
  id: string;
  title: string;
  slot_start: string | null;
  slot_end: string | null;
  sort_order: number;
  template_id: string | null;
  crew_name: string | null;
  assignees: BoardPerson[]; // already normalized shifts
  jobs: { job_id: string; invoice_number: string | null; customer: string | null }[];
}

export interface TaskLine {
  id: string;
  title: string;
  slot_start: string | null;
  slot_end: string | null;
  slot_label: string | null;
  invoices: string[]; // invoice_number values, non-null, in input order
  repeatable: boolean; // template_id != null
}

export interface TeamBlock {
  key: string; // sorted member ids joined with "|"
  members: BoardPerson[]; // ordered: shift (1st, 2nd, none) then name
  names: string; // joinNames(members.map(m => m.name))
  shifts: (ShiftKey | null)[]; // each member's shift, same order as members
  crew_name: string | null; // only if EVERY task in the block has the same non-null crew_name
  tasks: TaskLine[];
}

export interface PersonBlock { user_id: string; name: string; shift: ShiftKey | null; tasks: TaskLine[] }

export interface ShiftGroup {
  shift: ShiftKey | null;
  label: string; // null group label: "No shift set"
  hours: string | null; // "6:00a – 2:30p" for real shifts
  status: "upcoming" | "on" | "done" | null; // only when isToday, else null; null group → null
  teams: TeamBlock[];
  individuals: PersonBlock[];
}

export interface BoardResponse { date: string; groups: ShiftGroup[]; task_count: number; people_count: number }

// ---------------------------------------------------------------------------------------------- helpers

/** "1st" / "2nd" (trimmed, case-insensitive), else null. "3rd" (being eliminated) and anything else → null. */
export function normalizeShift(s: unknown): ShiftKey | null {
  if (typeof s !== "string") return null;
  const v = s.trim().toLowerCase();
  return v === "1st" || v === "2nd" ? v : null;
}

/** Strict "HH:MM" 24h. */
export function isValidHm(s: unknown): s is string {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Both or neither; end > start. */
export function checkSlot(
  start: unknown,
  end: unknown
): { ok: true; start: string | null; end: string | null } | { ok: false; error: "slot_incomplete" | "slot_invalid" | "slot_order" } {
  const sb = blank(start), eb = blank(end);
  if (sb && eb) return { ok: true, start: null, end: null };
  if (sb || eb) return { ok: false, error: "slot_incomplete" };
  const s = typeof start === "string" ? start.trim() : start;
  const e = typeof end === "string" ? end.trim() : end;
  if (!isValidHm(s) || !isValidHm(e)) return { ok: false, error: "slot_invalid" };
  if (e <= s) return { ok: false, error: "slot_order" };
  return { ok: true, start: s, end: e };
}

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const toHm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** "06:00"→"6:00a", "14:30"→"2:30p", "12:00"→"12:00p", "00:15"→"12:15a". */
export function formatHm(hm: string): string {
  const h = Number(hm.slice(0, 2));
  const m = hm.slice(3, 5);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m}${h < 12 ? "a" : "p"}`;
}

/** "6:00a–11:00a" (en dash) or null. */
export function formatSlot(start: string | null, end: string | null): string | null {
  if (!start || !end) return null;
  return `${formatHm(start)}–${formatHm(end)}`;
}

/** [start, end) is "on". */
export function shiftStatus(shift: ShiftKey, nowMinutes: number): "upcoming" | "on" | "done" {
  const { start, end } = SHIFTS[shift];
  if (nowMinutes < toMin(start)) return "upcoming";
  if (nowMinutes < toMin(end)) return "on";
  return "done";
}

/**
 * Time-slot presets for the Add-task modal. Midpoint is rounded down to :00/:15/:30/:45.
 * 1st: start 06:00–07:00, first half 06:00–10:15, second half 10:15–14:30, whole 06:00–14:30, end 13:30–14:30.
 */
export function shiftPresets(shift: ShiftKey): { key: string; label: string; start: string; end: string }[] {
  const s = toMin(SHIFTS[shift].start);
  const e = toMin(SHIFTS[shift].end);
  const mid = Math.floor((s + (e - s) / 2) / 15) * 15;
  return [
    { key: "start_of_shift", label: "Start of shift", start: toHm(s), end: toHm(s + 60) },
    { key: "first_half", label: "First half", start: toHm(s), end: toHm(mid) },
    { key: "second_half", label: "Second half", start: toHm(mid), end: toHm(e) },
    { key: "whole_shift", label: "Whole shift", start: toHm(s), end: toHm(e) },
    { key: "end_of_shift", label: "End of shift", start: toHm(e - 60), end: toHm(e) },
  ];
}

/** ["A"]→"A", ["A","B"]→"A & B", ["A","B","C"]→"A, B & C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------------------------- buildBoard

const nameCmp = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });
const shiftRank = (s: ShiftKey | null) => (s === null ? SHIFT_ORDER.length : SHIFT_ORDER.indexOf(s));

/** slot_start ascending (NULL last), then sort_order, then title. */
function lineCmp(a: TaskLine & { sort_order: number }, b: TaskLine & { sort_order: number }): number {
  if (a.slot_start !== b.slot_start) {
    if (a.slot_start === null) return 1;
    if (b.slot_start === null) return -1;
    return a.slot_start < b.slot_start ? -1 : 1;
  }
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return nameCmp(a.title, b.title);
}

function toLine(t: BoardTaskInput): TaskLine & { sort_order: number } {
  return {
    id: t.id,
    title: t.title,
    slot_start: t.slot_start,
    slot_end: t.slot_end,
    slot_label: formatSlot(t.slot_start, t.slot_end),
    invoices: t.jobs.map((j) => j.invoice_number).filter((v): v is string => typeof v === "string" && v !== ""),
    repeatable: t.template_id != null,
    sort_order: t.sort_order,
  };
}

const stripSort = (l: TaskLine & { sort_order: number }): TaskLine => {
  const { sort_order: _ignored, ...rest } = l;
  return rest;
};

export function buildBoard(date: string, tasks: BoardTaskInput[], nowMinutes: number, isToday: boolean): BoardResponse {
  type GroupKey = ShiftKey | "none";
  const teams = new Map<GroupKey, Map<string, { members: BoardPerson[]; crews: (string | null)[]; lines: (TaskLine & { sort_order: number })[] }>>();
  const people = new Map<GroupKey, Map<string, { person: BoardPerson; lines: (TaskLine & { sort_order: number })[] }>>();
  for (const k of [...SHIFT_ORDER, "none"] as GroupKey[]) { teams.set(k, new Map()); people.set(k, new Map()); }

  let taskCount = 0;
  const peopleSeen = new Set<string>();

  for (const t of tasks) {
    // Dedupe assignees by id defensively; skip a task with none (shouldn't happen — never crash).
    const byId = new Map<string, BoardPerson>();
    for (const a of t.assignees ?? []) if (a && a.id && !byId.has(a.id)) byId.set(a.id, a);
    const assignees = Array.from(byId.values());
    if (assignees.length === 0) continue;

    taskCount++;
    for (const a of assignees) peopleSeen.add(a.id);
    const line = toLine(t);

    if (assignees.length === 1) {
      const p = assignees[0];
      const g: GroupKey = p.shift ?? "none";
      const m = people.get(g)!;
      let blk = m.get(p.id);
      if (!blk) { blk = { person: p, lines: [] }; m.set(p.id, blk); }
      blk.lines.push(line);
    } else {
      const members = assignees.slice().sort((a, b) => shiftRank(a.shift) - shiftRank(b.shift) || nameCmp(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const key = members.map((m) => m.id).sort().join("|");
      const g: GroupKey = members[0].shift ?? "none"; // earliest member shift (members sorted by shift rank)
      const m = teams.get(g)!;
      let blk = m.get(key);
      if (!blk) { blk = { members, crews: [], lines: [] }; m.set(key, blk); }
      blk.crews.push(t.crew_name ?? null);
      blk.lines.push(line);
    }
  }

  const groupOf = (k: GroupKey): ShiftGroup => {
    const shift: ShiftKey | null = k === "none" ? null : k;
    const teamBlocks: TeamBlock[] = Array.from(teams.get(k)!.entries()).map(([key, b]) => {
      const lines = b.lines.slice().sort(lineCmp);
      const first = b.crews[0];
      const crew = first != null && first !== "" && b.crews.every((c) => c === first) ? first : null;
      return {
        key,
        members: b.members,
        names: joinNames(b.members.map((m) => m.name)),
        shifts: b.members.map((m) => m.shift),
        crew_name: crew,
        tasks: lines.map(stripSort),
      };
    });
    teamBlocks.sort((a, b) => {
      const as = a.tasks[0]?.slot_start ?? null, bs = b.tasks[0]?.slot_start ?? null; // tasks sorted: [0] is earliest
      if (as !== bs) {
        if (as === null) return 1;
        if (bs === null) return -1;
        return as < bs ? -1 : 1;
      }
      return nameCmp(a.names, b.names);
    });
    const individuals: PersonBlock[] = Array.from(people.get(k)!.values())
      .map((b) => ({ user_id: b.person.id, name: b.person.name, shift: b.person.shift, tasks: b.lines.slice().sort(lineCmp).map(stripSort) }))
      .sort((a, b) => nameCmp(a.name, b.name) || (a.user_id < b.user_id ? -1 : 1));
    return {
      shift,
      label: shift ? SHIFTS[shift].label : "No shift set",
      hours: shift ? `${formatHm(SHIFTS[shift].start)} – ${formatHm(SHIFTS[shift].end)}` : null,
      status: shift && isToday ? shiftStatus(shift, nowMinutes) : null,
      teams: teamBlocks,
      individuals,
    };
  };

  const groups = SHIFT_ORDER.map((s) => groupOf(s));
  const none = groupOf("none");
  if (none.teams.length || none.individuals.length) groups.push(none);

  return { date, groups, task_count: taskCount, people_count: peopleSeen.size };
}
