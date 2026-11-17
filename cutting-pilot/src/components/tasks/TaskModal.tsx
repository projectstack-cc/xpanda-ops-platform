"use client";
// src/components/tasks/TaskModal.tsx  (tasks-02)
// Create: tabs "New task" · "From repeatable list". Edit: the form only (PATCH with only the changed fields).
// Crew chips add a crew's ASSIGNABLE members (skip duplicates, respect the 10 cap) and set the crew label; crew_id is
// sent only while the final people set equals that crew's assignable members exactly, else null.
// Shift is derived (earliest person shift) — no per-task override; slot presets follow it (1st when none).
// Closes only via × / Cancel / Save (Modal primitive rule).
import { useMemo, useState } from "react";
import { Repeat } from "lucide-react";
import Modal from "@/components/Modal";
import { DETAILS_MAX, MAX_ASSIGNEES, TITLE_MAX, joinNames } from "@/lib/tasks/board";
import InvPicker from "./InvPicker";
import PersonPicker from "./PersonPicker";
import SlotInput, { slotError } from "./SlotInput";
import {
  api, BTN_OUTLINE, BTN_PRIMARY, CHIP_MUTED, CHIP_NEUTRAL, FOCUS, INPUT, LABEL, longDate, plural, resultError, sameSet,
  shiftShort, taskShift, type CrewRow, type JobRef, type ManageRow, type Person, type TemplateRow,
} from "./tasksUi";

interface Props {
  mode: "create" | "edit";
  date: string;
  task?: ManageRow;
  people: Person[];
  templates: TemplateRow[];
  crews: CrewRow[];
  onClose: () => void;
  onSaved: (msg: string, opts?: { listsChanged?: boolean }) => void;
}

export default function TaskModal(props: Props) {
  const { mode } = props;
  const [tab, setTab] = useState<"new" | "list">("new");
  return (
    <Modal isOpen onClose={props.onClose} title={mode === "edit" ? "Edit task" : "New task"} size="lg">
      {mode === "create" && (
        <div role="tablist" aria-label="How to add" className="flex gap-1 border-b border-[var(--line)]">
          {([["new", "New task"], ["list", "From repeatable list"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`min-h-[44px] px-3 -mb-px text-sm font-semibold border-b-2 cursor-pointer ${tab === k ? "border-[var(--brand)] text-text" : "border-transparent text-muted hover:text-text"} ${FOCUS}`}>
              {l}
            </button>
          ))}
        </div>
      )}
      {mode === "create" && tab === "list" ? <FromList {...props} /> : <TaskForm {...props} />}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------- form

function TaskForm({ mode, date, task, people, crews, onClose, onSaved }: Props) {
  const assignable = useMemo(() => new Set(people.map((p) => p.id)), [people]);
  const initIds = task?.assignees.map((a) => a.id) ?? [];
  const extra = (task?.assignees ?? []).filter((a) => !assignable.has(a.id));

  const [title, setTitle] = useState(task?.title ?? "");
  const [details, setDetails] = useState(task?.details ?? "");
  const [jobs, setJobs] = useState<JobRef[]>(task?.jobs ?? []);
  const [ids, setIds] = useState<string[]>(initIds);
  const [crewLabel, setCrewLabel] = useState<string | null>(task?.crew_id ?? null);
  const [taskDate, setTaskDate] = useState(task?.task_date ?? date);
  const [slotStart, setSlotStart] = useState(task?.slot_start ?? "");
  const [slotEnd, setSlotEnd] = useState(task?.slot_end ?? "");
  const [saveTpl, setSaveTpl] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const byId = useMemo(() => new Map([...extra, ...people].map((p) => [p.id, p])), [people, extra]);
  const chosen = ids.map((i) => byId.get(i)).filter(Boolean) as Person[];
  const shift = taskShift({ assignees: chosen });
  const activeCrews = crews.filter((c) => c.is_active);
  const crewMembers = (c: CrewRow) => c.members.filter((m) => m.assignable).map((m) => m.id);
  const labelCrew = crewLabel ? crews.find((c) => c.id === crewLabel) ?? null : null;
  // Edit mode: a task's stored crew might be inactive (not in `crews`) — keep it only while the set is unchanged.
  const crewApplies = labelCrew ? sameSet(ids, crewMembers(labelCrew)) : !!(crewLabel && task?.crew_id === crewLabel && sameSet(ids, initIds));
  const crewName = labelCrew?.name ?? (crewApplies ? task?.crew_name : null);

  const sErr = slotError(slotStart, slotEnd);
  const titleTrim = title.trim();
  const canSave = !!titleTrim && titleTrim.length <= TITLE_MAX && details.length <= DETAILS_MAX && ids.length >= 1 && !sErr && !!taskDate && !busy;

  const addCrew = (c: CrewRow) => {
    const next = [...ids];
    for (const m of crewMembers(c)) if (!next.includes(m) && next.length < MAX_ASSIGNEES) next.push(m);
    setIds(next);
    setCrewLabel(c.id);
  };

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setErr("");
    const crew_id = crewApplies ? crewLabel : null;
    const slot = { slot_start: slotStart || null, slot_end: slotEnd || null };
    const jobIds = jobs.map((j) => j.job_id);
    let r;
    if (mode === "create") {
      r = await api("/manage/tasks", "POST", {
        task_date: taskDate, title: titleTrim, details: details.trim() || null, ...slot,
        assignee_ids: ids, job_ids: jobIds, crew_id, save_as_template: saveTpl,
      });
    } else {
      const t = task!;
      const body: Record<string, unknown> = {};
      if (titleTrim !== t.title) body.title = titleTrim;
      if ((details.trim() || null) !== (t.details ?? null)) body.details = details.trim() || null;
      if (taskDate !== t.task_date) body.task_date = taskDate;
      if (slot.slot_start !== t.slot_start || slot.slot_end !== t.slot_end) Object.assign(body, slot);
      if (!sameSet(ids, initIds)) body.assignee_ids = ids;
      if (!sameSet(jobIds, t.jobs.map((j) => j.job_id))) body.job_ids = jobIds;
      if ((crew_id ?? null) !== (t.crew_id ?? null)) body.crew_id = crew_id;
      if (Object.keys(body).length === 0) { setBusy(false); onSaved("No changes"); return; }
      r = await api(`/manage/tasks/${encodeURIComponent(t.id)}`, "PATCH", body);
    }
    setBusy(false);
    if (!r.ok) { setErr(resultError(r)); return; }
    if (mode === "create") {
      const where = taskDate !== date ? ` for ${longDate(taskDate)}` : "";
      onSaved(`Added 1 task${where}${saveTpl ? " · saved to the repeatable list" : ""}`, { listsChanged: saveTpl });
    } else {
      onSaved(taskDate !== task!.task_date ? `Saved · moved to ${longDate(taskDate)}` : "Saved");
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div>
        <label htmlFor="task-title" className={LABEL}>Task</label>
        <input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX}
          placeholder="e.g. Pull cores for INV 4601" className={INPUT} autoComplete="off" />
        <p className={`m-0 mt-0.5 text-xs text-right font-mono tabular-nums ${title.length >= TITLE_MAX ? "text-[var(--warn-text)]" : "text-muted"}`}>{title.length}/{TITLE_MAX}</p>
      </div>
      <div>
        <label htmlFor="task-details" className={LABEL}>Details <span className="normal-case font-normal">(optional — not shown on TV)</span></label>
        <textarea id="task-details" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={DETAILS_MAX} rows={2}
          className={`${INPUT} py-2 min-h-[64px]`} />
        {details.length >= 400 && <p className="m-0 mt-0.5 text-xs text-right font-mono tabular-nums text-[var(--warn-text)]">{details.length}/{DETAILS_MAX}</p>}
      </div>

      <InvPicker value={jobs} onChange={setJobs} />

      <div>
        <PersonPicker people={people} selected={ids} onChange={setIds} max={MAX_ASSIGNEES} min={1} extra={extra} idPrefix="task-pp" />
        {activeCrews.length > 0 && (
          <div className="mt-2">
            <span className="block text-xs text-muted mb-1">Saved crews (adds everyone)</span>
            <div className="flex flex-wrap gap-1.5">
              {activeCrews.map((c) => (
                <button key={c.id} type="button" onClick={() => addCrew(c)} data-testid={`crew-chip-${c.id}`}
                  className={`${CHIP_NEUTRAL} min-h-[36px] px-3 cursor-pointer hover:bg-[var(--surface)] ${FOCUS}`}
                  title={joinNames(c.members.map((m) => m.name))}>
                  {c.name} <span className="text-muted font-mono">· {crewMembers(c).length}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {crewApplies && crewName && <p className="m-0 mt-1.5 text-sm text-muted" data-testid="crew-label">Crew: <span className="font-semibold text-text">{crewName}</span></p>}
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="w-[180px]">
          <label htmlFor="task-date" className={LABEL}>Date</label>
          <input id="task-date" type="date" value={taskDate} onChange={(e) => setTaskDate(e.target.value)} className={`${INPUT} font-mono tabular-nums`} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <span className={LABEL}>Shift</span>
          <p className="m-0 min-h-[44px] flex items-center text-sm text-muted">Uses each person&apos;s shift ({shiftShort(shift)})</p>
        </div>
      </div>

      <SlotInput start={slotStart} end={slotEnd} onChange={(s, e) => { setSlotStart(s); setSlotEnd(e); }} shift={shift ?? "1st"} idPrefix="task-slot" />

      {mode === "create" && (
        <label className="flex items-start gap-3 min-h-[44px] cursor-pointer">
          <input type="checkbox" checked={saveTpl} onChange={(e) => setSaveTpl(e.target.checked)} className="mt-1 w-5 h-5 accent-[var(--brand)]" />
          <span className="text-sm">
            <span className="font-semibold">Save to repeatable list</span>
            <span className="block text-muted">Keeps the task, details, time slot and default people so it can be picked next time. INV links are not saved — they change per order.</span>
          </span>
        </label>
      )}

      {err && <p role="alert" className="m-0 text-sm text-danger-ink" data-testid="task-error">{err}</p>}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className={BTN_OUTLINE}>Cancel</button>
        <button type="submit" disabled={!canSave} className={BTN_PRIMARY} data-testid="save-task">{busy ? "Saving…" : "Save task"}</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------- from list

function FromList({ date, templates, onClose, onSaved }: Props) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const active = templates.filter((t) => t.is_active);
  const shown = q.trim() ? active.filter((t) => t.title.toLowerCase().includes(q.trim().toLowerCase())) : active;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 20 ? [...p, id] : p));

  async function add() {
    if (!picked.length || busy) return;
    setBusy(true);
    setErr("");
    const r = await api<{ created: unknown[]; skipped: { template_id: string; reason: string }[] }>("/manage/tasks/from-templates", "POST", { task_date: date, template_ids: picked });
    setBusy(false);
    if (!r.ok) { setErr(resultError(r)); return; }
    let msg = `Added ${plural(r.json.created?.length ?? 0, "task")}`;
    const skipped = r.json.skipped ?? [];
    if (skipped.length) {
      const names = skipped.map((s) => templates.find((t) => t.id === s.template_id)?.title ?? s.template_id);
      msg += ` · Skipped ${names.join(", ")}: no assignable people`;
    }
    onSaved(msg, { listsChanged: true });
  }

  return (
    <div className="space-y-3">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the repeatable list…" aria-label="Search the repeatable list" className={INPUT} />
      {active.length === 0 ? (
        <p className="m-0 p-4 text-sm text-muted border border-dashed border-[var(--input-border)] rounded-lg">
          The repeatable list is empty. Tick <span className="font-semibold">Save to repeatable list</span> when you add a task, or add one from <span className="font-semibold">Repeatable list</span>.
        </p>
      ) : (
        <div className="max-h-[340px] overflow-y-auto border border-[var(--line)] rounded-lg" data-testid="tpl-pick-list">
          {shown.length === 0 && <p className="m-0 p-3 text-sm text-muted">Nothing matches “{q}”.</p>}
          {shown.map((t) => (
            <label key={t.id} className="flex items-start gap-3 px-3 py-2 min-h-[44px] border-t border-[var(--line)] first:border-t-0 cursor-pointer hover:bg-[var(--ghost-bg)]">
              <input type="checkbox" checked={picked.includes(t.id)} onChange={() => toggle(t.id)} className="mt-0.5 w-5 h-5 accent-[var(--brand)]" />
              <span className="flex-1 min-w-0 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{t.title}</span>
                  {t.slot_label && <span className="font-mono tabular-nums text-muted">{t.slot_label}</span>}
                  <span className={`${CHIP_MUTED} ml-auto`}><Repeat size={11} aria-hidden="true" /> used ×{t.use_count}</span>
                </span>
                <span className="block text-muted">
                  Default:{" "}
                  {t.assignees.length === 0 ? "nobody" : t.assignees.map((a, i) => (
                    <span key={a.id}>{i > 0 && ", "}<span className={a.assignable ? "" : "line-through"}>{a.name}</span></span>
                  ))}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
      <p className="m-0 text-xs text-muted">Each is added for {longDate(date)} with its default people. Edit a task afterwards to change people or link an INV.</p>
      {err && <p role="alert" className="m-0 text-sm text-danger-ink">{err}</p>}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onClose} className={BTN_OUTLINE}>Cancel</button>
        <button type="button" onClick={() => void add()} disabled={!picked.length || busy} className={BTN_PRIMARY} data-testid="add-from-list">
          {busy ? "Adding…" : `Add ${plural(picked.length, "task")}`}
        </button>
      </div>
    </div>
  );
}
