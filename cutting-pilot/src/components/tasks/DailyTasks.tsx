"use client";
// src/components/tasks/DailyTasks.tsx  (tasks-02) — /v2/tasks manager page client.
// Day view synced to ?date= (default ET today). People panel (by shift, task counts, tap to filter) + Tasks panel
// (shift filter All/1st/2nd/No shift via taskShift; table ≥ sm, cards below). Toolbar: Repeatable list (n), Crews (n),
// + New task (canEdit). One modal at a time: TaskModal | RepeatableListModal | CrewsModal | remove confirm.
// After a save: close, success banner, quiet refetch (old render stays up).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, Pencil, Plus, Repeat, Trash2, Users, X } from "lucide-react";
import Modal from "@/components/Modal";
import { etNowWallClock } from "@/lib/etDateTime";
import { SHIFTS, SHIFT_ORDER, formatHm, type ShiftKey } from "@/lib/tasks/board";
import CrewsModal from "./CrewsModal";
import RepeatableListModal from "./RepeatableListModal";
import ShiftTag from "./ShiftTag";
import TaskModal from "./TaskModal";
import {
  addDays, api, BTN_ICON, BTN_OUTLINE, BTN_PRIMARY, CARD, CHIP, CHIP_INFO, CHIP_MUTED, CHIP_NEUTRAL, CHIP_WARN, FOCUS,
  isWeekend, isYmd, longDate, plural, resultError, taskShift,
  type CrewRow, type DayData, type ManageRow, type PersonRow, type TemplateRow,
} from "./tasksUi";

type ShiftFilter = "all" | ShiftKey | "none";
type Open =
  | { kind: "task"; mode: "create" | "edit"; task?: ManageRow }
  | { kind: "list" }
  | { kind: "crews" }
  | { kind: "remove"; task: ManageRow }
  | null;

const hours = (s: ShiftKey) => `${formatHm(SHIFTS[s].start)} – ${formatHm(SHIFTS[s].end)}`;

export default function DailyTasks({ canEdit, initialDate }: { canEdit: boolean; initialDate: string }) {
  const router = useRouter();
  const today = etNowWallClock().date;
  const [date, setDateState] = useState(initialDate);
  const [day, setDay] = useState<DayData | null>(null);
  const [dayErr, setDayErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [crews, setCrews] = useState<CrewRow[]>([]);
  const [open, setOpen] = useState<Open>(null);
  const [banner, setBanner] = useState("");
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>("all");
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeErr, setRemoveErr] = useState("");

  const setDate = (d: string) => {
    if (!isYmd(d)) return;
    setDateState(d);
    setPersonFilter(null);
    router.replace(`/tasks?date=${d}`, { scroll: false }); // basePath "/v2" is added by Next

  };

  const loadDay = useCallback(async (d: string, quiet = false) => {
    if (!quiet) setLoading(true);
    const r = await api<DayData>(`/manage/day?date=${d}`);
    setLoading(false);
    if (!r.ok) { setDayErr(resultError(r)); return; }
    setDayErr("");
    setDay(r.json as DayData);
  }, []);
  const loadLists = useCallback(async () => {
    const [t, c] = await Promise.all([
      api<{ templates: TemplateRow[] }>("/manage/templates"),
      api<{ crews: CrewRow[] }>("/manage/crews"),
    ]);
    if (t.ok) setTemplates(t.json.templates ?? []);
    if (c.ok) setCrews(c.json.crews ?? []);
  }, []);

  useEffect(() => { void loadDay(date); }, [date, loadDay]);
  useEffect(() => { void loadLists(); }, [loadLists]);

  // Only show the day's data for the selected date (a stale response from the previous day is hidden).
  const data = day && day.date === date ? day : null;
  const people = useMemo(() => (data?.people ?? []).map(({ id, name, shift }) => ({ id, name, shift })), [data]);
  const noShift = (data?.people ?? []).filter((p) => p.shift === null);
  const peopleOnDay = new Set((data?.tasks ?? []).flatMap((t) => t.assignees.map((a) => a.id))).size;

  const rows = useMemo(() => (data?.tasks ?? []).filter((t) => {
    if (personFilter && !t.assignees.some((a) => a.id === personFilter)) return false;
    if (shiftFilter === "all") return true;
    const s = taskShift(t);
    return shiftFilter === "none" ? s === null : s === shiftFilter;
  }), [data, personFilter, shiftFilter]);
  const filterName = personFilter ? data?.people.find((p) => p.id === personFilter)?.name ?? "" : "";

  function saved(msg: string, opts?: { listsChanged?: boolean }) {
    setOpen(null);
    setBanner(msg);
    void loadDay(date, true);
    if (opts?.listsChanged) void loadLists();
  }

  async function doRemove(t: ManageRow) {
    setRemoveBusy(true);
    setRemoveErr("");
    const r = await api(`/manage/tasks/${encodeURIComponent(t.id)}`, "DELETE");
    setRemoveBusy(false);
    if (!r.ok) { setRemoveErr(resultError(r)); return; }
    saved("Removed");
  }

  const activeTemplates = templates.filter((t) => t.is_active).length;
  const activeCrews = crews.filter((c) => c.is_active).length;

  return (
    <main className="w-full max-w-[1320px] mx-auto px-4 pt-6 pb-12 flex flex-col gap-4">
      {/* ── Date + toolbar ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-bold tracking-tight">Daily Tasks</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <div className="flex items-center gap-1">
            <button type="button" onClick={() => setDate(addDays(date, -1))} className={`${BTN_OUTLINE} px-0 w-[44px]`} aria-label="Previous day"><ChevronLeft size={18} aria-hidden="true" /></button>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date"
              className={`min-h-[44px] w-[168px] px-3 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm font-mono tabular-nums ${FOCUS}`} data-testid="date-input" />
            <button type="button" onClick={() => setDate(addDays(date, 1))} className={`${BTN_OUTLINE} px-0 w-[44px]`} aria-label="Next day"><ChevronRight size={18} aria-hidden="true" /></button>
            </div>
            <span className="text-lg font-semibold" data-testid="long-date">{longDate(date)}</span>
            {date === today ? <span className={CHIP_INFO}>Today</span> : (
              <button type="button" onClick={() => setDate(today)} className={`${CHIP_MUTED} min-h-[32px] px-3 cursor-pointer ${FOCUS}`}>Go to today</button>
            )}
            {isWeekend(date) && <span className={CHIP_WARN} data-testid="weekend-chip">Weekend</span>}
          </div>
          <p className="m-0 mt-1 text-sm text-muted font-mono tabular-nums" data-testid="day-counts">
            {data ? `${plural(data.tasks.length, "task")} · ${plural(peopleOnDay, "person", "people")}` : " "}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 w-full sm:w-auto">
          <button type="button" onClick={() => setOpen({ kind: "list" })} className={BTN_OUTLINE} data-testid="open-list">
            <Repeat size={16} aria-hidden="true" /> Repeatable list <span className="font-mono tabular-nums">({activeTemplates})</span>
          </button>
          <button type="button" onClick={() => setOpen({ kind: "crews" })} className={BTN_OUTLINE} data-testid="open-crews">
            <Users size={16} aria-hidden="true" /> Crews <span className="font-mono tabular-nums">({activeCrews})</span>
          </button>
          {canEdit && (
            <button type="button" onClick={() => setOpen({ kind: "task", mode: "create" })} disabled={!data} className={BTN_PRIMARY} data-testid="new-task">
              <Plus size={16} aria-hidden="true" /> New task
            </button>
          )}
        </div>
      </div>

      {banner && (
        <div role="status" data-testid="banner" className="flex items-center justify-between gap-2 pl-4 rounded-xl border border-[var(--success-ink)] text-success-ink text-sm bg-[var(--surface)]">
          <span>{banner}</span>
          <button type="button" onClick={() => setBanner("")} aria-label="Dismiss" className={BTN_ICON}><X size={16} aria-hidden="true" /></button>
        </div>
      )}

      {noShift.length > 0 && (
        <div role="note" data-testid="no-shift-warning" className="flex flex-wrap items-start gap-3 px-4 py-3 rounded-xl border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] text-sm">
          <AlertTriangle size={18} aria-hidden="true" className="shrink-0 mt-0.5" />
          <div className="flex-1 min-w-[220px]">
            <span className="font-semibold">{plural(noShift.length, "person", "people")} {noShift.length === 1 ? "has" : "have"} no shift set</span>
            {" — they can be assigned, but show under 'No shift set' on the TV until one is set in Admin → Users."}
            <div className="mt-1">{noShift.map((p) => p.name).join(", ")}</div>
          </div>
          <a href="/v2/admin" className={`min-h-[44px] inline-flex items-center font-semibold underline text-[var(--warn-text)] ${FOCUS}`}>Open Admin</a>
        </div>
      )}

      {dayErr && (
        <div role="alert" className={`${CARD} p-4 flex flex-wrap items-center justify-between gap-3`}>
          <span className="text-sm text-danger-ink">Couldn&apos;t load tasks — {dayErr}</span>
          <button type="button" onClick={() => void loadDay(date)} className={BTN_OUTLINE}>Retry</button>
        </div>
      )}

      {!data && loading && !dayErr && (
        <div aria-busy="true" aria-label="Loading tasks" className="flex flex-wrap gap-4">
          <div className={`${CARD} h-[320px] w-full md:w-[280px] animate-pulse motion-reduce:animate-none`} />
          <div className={`${CARD} h-[320px] flex-1 min-w-[280px] animate-pulse motion-reduce:animate-none`} />
        </div>
      )}

      {data && (
        <div className="flex flex-wrap items-start gap-4">
          {/* ── People ── */}
          <section aria-labelledby="people-h" className={`${CARD} w-full md:w-[280px] shrink-0 overflow-hidden`} data-testid="people-panel">
            <h2 id="people-h" className="m-0 px-4 py-3 text-sm font-semibold border-b border-[var(--line)]">People</h2>
            {([...SHIFT_ORDER, null] as (ShiftKey | null)[]).map((s) => {
              const list = data.people.filter((p) => p.shift === s);
              if (!list.length) return null;
              return (
                <div key={s ?? "none"}>
                  <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted bg-[var(--ghost-bg)]">
                    {s ? <>{SHIFTS[s].label} · <span className="font-mono tabular-nums normal-case">{hours(s)}</span></> : "No shift set"}
                  </div>
                  {list.map((p) => <PersonLine key={p.id} p={p} on={personFilter === p.id} onClick={() => setPersonFilter(personFilter === p.id ? null : p.id)} />)}
                </div>
              );
            })}
          </section>

          {/* ── Tasks ── */}
          <section aria-labelledby="tasks-h" className={`${CARD} flex-1 min-w-0 basis-[320px] overflow-hidden`}>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-[var(--line)]">
              <h2 id="tasks-h" className="m-0 text-sm font-semibold mr-auto">Tasks</h2>
              <div role="group" aria-label="Filter by shift" className="flex flex-wrap gap-1">
                {([["all", "All"], ["1st", "1st"], ["2nd", "2nd"], ["none", "No shift"]] as [ShiftFilter, string][]).map(([k, l]) => (
                  <button key={k} type="button" aria-pressed={shiftFilter === k} onClick={() => setShiftFilter(k)} data-testid={`shift-${k}`}
                    className={`${CHIP} min-h-[36px] px-3 cursor-pointer ${shiftFilter === k ? "bg-[var(--ghost-bg)] border-[var(--accent)] text-text ring-1 ring-[var(--accent)]" : "bg-[var(--surface)] border-[var(--input-border)] text-muted hover:text-text"} ${FOCUS}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {personFilter && (
              <div className="px-4 pt-3">
                <button type="button" onClick={() => setPersonFilter(null)} className={`${CHIP_NEUTRAL} min-h-[32px] cursor-pointer ${FOCUS}`} data-testid="person-filter-chip" aria-label={`Clear filter: ${filterName}`}>
                  Showing: {filterName} <X size={12} aria-hidden="true" />
                </button>
              </div>
            )}
            {data.tasks.length === 0 ? (
              <div className="p-8 flex flex-col items-start gap-3 text-sm text-muted" data-testid="empty-day">
                <span>No tasks for {longDate(date)}.</span>
                {canEdit && <button type="button" onClick={() => setOpen({ kind: "task", mode: "create" })} className={BTN_PRIMARY}><Plus size={16} aria-hidden="true" /> New task</button>}
              </div>
            ) : rows.length === 0 ? (
              <div className="p-6 flex flex-col items-start gap-3 text-sm text-muted" data-testid="no-match">
                <span>No tasks match these filters.</span>
                <button type="button" onClick={() => { setPersonFilter(null); setShiftFilter("all"); }} className={BTN_OUTLINE}>Clear filters</button>
              </div>
            ) : (
              <>
                <div className="hidden sm:block overflow-x-auto" data-testid="task-table">
                  <table className="w-full border-collapse text-[13px] min-w-[760px]">
                    <thead>
                      <tr className="bg-[var(--ghost-bg)] text-left text-muted text-xs uppercase tracking-wide">
                        <th scope="col" className="px-4 py-2 font-semibold w-[120px]">Time slot</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Task</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Linked INV</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Assigned to</th>
                        {canEdit && <th scope="col" className="px-2 py-2 font-semibold w-[100px]"><span className="sr-only">Actions</span></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => (
                        <tr key={t.id} className="border-t border-[var(--line)] align-top" data-testid="task-row">
                          <td className="px-4 py-2.5 font-mono tabular-nums whitespace-nowrap">{t.slot_label ?? <span className="text-muted">—</span>}</td>
                          <td className="px-3 py-2.5"><TaskTitle t={t} /></td>
                          <td className="px-3 py-2.5"><InvList t={t} /></td>
                          <td className="px-3 py-2.5"><Assignees t={t} /></td>
                          {canEdit && (
                            <td className="px-2 py-1 whitespace-nowrap text-right">
                              <RowActions t={t} onEdit={() => setOpen({ kind: "task", mode: "edit", task: t })} onRemove={() => { setRemoveErr(""); setOpen({ kind: "remove", task: t }); }} />
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="sm:hidden m-0 p-0 list-none" data-testid="task-cards">
                  {rows.map((t) => (
                    <li key={t.id} className="px-4 py-3 text-[13px] border-t border-[var(--line)] first:border-t-0 flex flex-col gap-2">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-mono tabular-nums text-xs text-muted">{t.slot_label ?? "No time slot"}</div>
                          <TaskTitle t={t} />
                        </div>
                        {canEdit && <RowActions t={t} onEdit={() => setOpen({ kind: "task", mode: "edit", task: t })} onRemove={() => { setRemoveErr(""); setOpen({ kind: "remove", task: t }); }} />}
                      </div>
                      {t.jobs.length > 0 && <InvList t={t} />}
                      <Assignees t={t} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      )}

      {/* ── Modals: one at a time ── */}
      {open?.kind === "task" && data && (
        <TaskModal mode={open.mode} task={open.task} date={date} people={people} templates={templates} crews={crews}
          onClose={() => setOpen(null)} onSaved={saved} />
      )}
      {open?.kind === "list" && (
        <RepeatableListModal canEdit={canEdit} people={people} onClose={() => setOpen(null)} onChanged={() => void loadLists()} />
      )}
      {open?.kind === "crews" && (
        <CrewsModal canEdit={canEdit} people={people} crews={crews} onClose={() => setOpen(null)} onChanged={loadLists} />
      )}
      {open?.kind === "remove" && (
        <Modal isOpen onClose={() => setOpen(null)} title="Remove task">
          <p className="m-0 text-sm">Remove “{open.task.title}” from {longDate(open.task.task_date)}?</p>
          {removeErr && <p role="alert" className="m-0 text-sm text-danger-ink">{removeErr}</p>}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button type="button" onClick={() => setOpen(null)} className={BTN_OUTLINE}>Cancel</button>
            <button type="button" onClick={() => void doRemove(open.task)} disabled={removeBusy} className={BTN_PRIMARY} data-testid="confirm-remove">
              {removeBusy ? "Removing…" : "Remove"}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

function PersonLine({ p, on, onClick }: { p: PersonRow; on: boolean; onClick: () => void }) {
  const n = p.task_count ?? 0;
  return (
    <button type="button" onClick={onClick} aria-pressed={on} data-testid="person-line"
      className={`w-full flex items-center gap-2 px-4 min-h-[44px] border-t border-[var(--line)] text-left text-sm cursor-pointer ${on ? "bg-[var(--ghost-bg)] font-semibold" : "hover:bg-[var(--ghost-bg)]"} ${FOCUS}`}>
      <span className="flex-1 truncate">{p.name}</span>
      <span className={`${n === 0 ? CHIP_WARN : CHIP_NEUTRAL} font-mono tabular-nums`} aria-label={plural(n, "task")}>{n}</span>
    </button>
  );
}

function TaskTitle({ t }: { t: ManageRow }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-sm">{t.title}</span>
        {t.template_id && <span className={CHIP_MUTED}><Repeat size={11} aria-hidden="true" /> Repeatable</span>}
        {t.crew_name && <span className={CHIP_INFO} data-testid="crew-chip"><Users size={11} aria-hidden="true" /> {t.crew_name}</span>}
      </div>
      {t.details && <div className="text-muted text-xs truncate max-w-[420px]" title={t.details}>{t.details}</div>}
    </div>
  );
}

function InvList({ t }: { t: ManageRow }) {
  if (!t.jobs.length) return <span className="text-muted">—</span>;
  return (
    <div className="flex flex-col gap-0.5">
      {t.jobs.map((j) => (
        <div key={j.job_id} className="whitespace-nowrap">
          <span className="font-mono tabular-nums font-semibold">INV {j.invoice_number ?? "?"}</span>
          {j.customer && <span className="text-muted"> {j.customer}</span>}
        </div>
      ))}
    </div>
  );
}

function Assignees({ t }: { t: ManageRow }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {t.assignees.length > 1 && <Users size={14} aria-label="Team" className="text-muted" />}
      {t.assignees.map((a) => (
        <span key={a.id} className={CHIP_NEUTRAL}>{a.name} <ShiftTag shift={a.shift} /></span>
      ))}
    </div>
  );
}

function RowActions({ t, onEdit, onRemove }: { t: ManageRow; onEdit: () => void; onRemove: () => void }) {
  return (
    <span className="inline-flex">
      <button type="button" onClick={onEdit} className={BTN_ICON} aria-label={`Edit ${t.title}`} data-testid="edit-task"><Pencil size={16} aria-hidden="true" /></button>
      <button type="button" onClick={onRemove} className={BTN_ICON} aria-label={`Remove ${t.title}`} data-testid="remove-task"><Trash2 size={16} aria-hidden="true" /></button>
    </span>
  );
}
