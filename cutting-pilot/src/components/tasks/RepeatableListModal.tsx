"use client";
// src/components/tasks/RepeatableListModal.tsx  (tasks-02)
// The repeatable list (task_templates). Search + "Show removed" (include_inactive=1). canEdit: + New repeatable task,
// Edit, Remove (deactivate), Restore. The form is inline in the same modal (title, details, slot with 1st-shift
// presets, default people 0–10). Templates never carry INV links. Read-only when !canEdit.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import Modal from "@/components/Modal";
import { DETAILS_MAX, MAX_ASSIGNEES, TITLE_MAX } from "@/lib/tasks/board";
import PersonPicker from "./PersonPicker";
import ShiftTag from "./ShiftTag";
import SlotInput, { slotError } from "./SlotInput";
import {
  api, BTN_ICON, BTN_OUTLINE, BTN_PRIMARY, CHIP_MUTED, FOCUS, INPUT, LABEL, resultError, sameSet,
  type Person, type TemplateRow,
} from "./tasksUi";

interface Props { canEdit: boolean; people: Person[]; onClose: () => void; onChanged: () => void }

export default function RepeatableListModal({ canEdit, people, onClose, onChanged }: Props) {
  const [showRemoved, setShowRemoved] = useState(false);
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<TemplateRow | "new" | null>(null);
  const [msg, setMsg] = useState("");
  const [rowErr, setRowErr] = useState("");

  const load = useCallback(async () => {
    const r = await api<{ templates: TemplateRow[] }>(`/manage/templates${showRemoved ? "?include_inactive=1" : ""}`);
    if (!r.ok) { setLoadErr(resultError(r)); return; }
    setLoadErr("");
    setRows(r.json.templates);
  }, [showRemoved]);
  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (rows ?? []).filter((t) => !n || t.title.toLowerCase().includes(n));
  }, [rows, q]);

  async function setActive(t: TemplateRow, active: boolean) {
    setRowErr("");
    const r = active
      ? await api(`/manage/templates/${encodeURIComponent(t.id)}`, "PATCH", { is_active: true })
      : await api(`/manage/templates/${encodeURIComponent(t.id)}`, "DELETE");
    if (!r.ok) { setRowErr(resultError(r)); return; }
    setMsg(active ? `Restored “${t.title}”` : `Removed “${t.title}” from the list`);
    onChanged();
    void load();
  }

  return (
    <Modal isOpen onClose={onClose} title="Repeatable list" size="lg">
      {editing ? (
        <TemplateForm
          template={editing === "new" ? null : editing}
          people={people}
          onCancel={() => setEditing(null)}
          onSaved={(m) => { setEditing(null); setMsg(m); onChanged(); void load(); }}
        />
      ) : (
        <div className="space-y-3">
          <p className="m-0 text-sm text-muted">Saved tasks you can pick when adding the day&apos;s work. Nothing repeats on its own. INV links are never saved here.</p>
          <div className="flex flex-wrap items-center gap-2">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search the repeatable list" className={`${INPUT} flex-1 min-w-[180px]`} />
            <label className="flex items-center gap-2 min-h-[44px] text-sm cursor-pointer">
              <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} className="w-5 h-5 accent-[var(--brand)]" />
              Show removed
            </label>
            {canEdit && (
              <button type="button" onClick={() => { setMsg(""); setEditing("new"); }} className={BTN_PRIMARY} data-testid="new-template">
                <Plus size={16} aria-hidden="true" /> New repeatable task
              </button>
            )}
          </div>
          {msg && <p role="status" className="m-0 text-sm text-success-ink">{msg}</p>}
          {rowErr && <p role="alert" className="m-0 text-sm text-danger-ink">{rowErr}</p>}
          {loadErr && <p role="alert" className="m-0 text-sm text-danger-ink">{loadErr}</p>}
          {!rows && !loadErr && <div className="h-24 rounded-lg bg-[var(--ghost-bg)] animate-pulse motion-reduce:animate-none" aria-busy="true" />}
          {rows && shown.length === 0 && (
            <p className="m-0 p-4 text-sm text-muted border border-dashed border-[var(--input-border)] rounded-lg">
              {rows.length === 0 ? "The repeatable list is empty." : `Nothing matches “${q}”.`}
            </p>
          )}
          {shown.length > 0 && (
            <ul className="m-0 p-0 list-none border border-[var(--line)] rounded-lg" data-testid="tpl-list">
              {shown.map((t) => (
                <li key={t.id} className={`flex items-start gap-2 px-3 py-2 border-t border-[var(--line)] first:border-t-0 ${t.is_active ? "" : "opacity-60"}`}>
                  <div className="flex-1 min-w-0 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{t.title}</span>
                      {t.slot_label && <span className="font-mono tabular-nums text-muted">{t.slot_label}</span>}
                      {!t.is_active && <span className={CHIP_MUTED}>removed</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1 text-muted">
                      {t.assignees.length === 0 ? <span>No default people</span> : t.assignees.map((a) => (
                        <span key={a.id} className="inline-flex items-center gap-1">
                          <span className={a.assignable ? "text-text" : "line-through"}>{a.name}</span>
                          {a.assignable ? <ShiftTag shift={a.shift} /> : <span className="text-[10px]">not assignable</span>}
                        </span>
                      ))}
                      <span className="font-mono tabular-nums text-xs ml-auto">used ×{t.use_count}</span>
                    </div>
                  </div>
                  {canEdit && (t.is_active ? (
                    <>
                      <button type="button" onClick={() => { setMsg(""); setEditing(t); }} className={BTN_ICON} aria-label={`Edit ${t.title}`}><Pencil size={16} aria-hidden="true" /></button>
                      <button type="button" onClick={() => void setActive(t, false)} className={BTN_ICON} aria-label={`Remove ${t.title}`}><Trash2 size={16} aria-hidden="true" /></button>
                    </>
                  ) : (
                    <button type="button" onClick={() => void setActive(t, true)} className={`${BTN_OUTLINE} px-3`} aria-label={`Restore ${t.title}`}>
                      <RotateCcw size={14} aria-hidden="true" /> Restore
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className={BTN_OUTLINE}>Close</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function TemplateForm({ template, people, onCancel, onSaved }: { template: TemplateRow | null; people: Person[]; onCancel: () => void; onSaved: (m: string) => void }) {
  const assignable = new Set(people.map((p) => p.id));
  const initIds = template?.assignees.map((a) => a.id) ?? [];
  const extra = (template?.assignees ?? []).filter((a) => !assignable.has(a.id));
  const [title, setTitle] = useState(template?.title ?? "");
  const [details, setDetails] = useState(template?.details ?? "");
  const [start, setStart] = useState(template?.slot_start ?? "");
  const [end, setEnd] = useState(template?.slot_end ?? "");
  const [ids, setIds] = useState<string[]>(initIds);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sErr = slotError(start, end);
  const canSave = !!title.trim() && !sErr && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setErr("");
    const body: Record<string, unknown> = { title: title.trim(), details: details.trim() || null, slot_start: start || null, slot_end: end || null };
    if (!template || !sameSet(ids, initIds)) body.assignee_ids = ids;
    const r = template
      ? await api(`/manage/templates/${encodeURIComponent(template.id)}`, "PATCH", body)
      : await api("/manage/templates", "POST", { ...body, assignee_ids: ids });
    setBusy(false);
    if (!r.ok) { setErr(resultError(r)); return; }
    onSaved(template ? `Saved “${title.trim()}”` : `Added “${title.trim()}” to the list`);
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h3 className="m-0 text-base font-semibold">{template ? "Edit repeatable task" : "New repeatable task"}</h3>
      <div>
        <label htmlFor="tpl-title" className={LABEL}>Task</label>
        <input id="tpl-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TITLE_MAX} className={INPUT} autoComplete="off" />
        <p className="m-0 mt-0.5 text-xs text-right font-mono tabular-nums text-muted">{title.length}/{TITLE_MAX}</p>
      </div>
      <div>
        <label htmlFor="tpl-details" className={LABEL}>Details <span className="normal-case font-normal">(optional — not shown on TV)</span></label>
        <textarea id="tpl-details" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={DETAILS_MAX} rows={2} className={`${INPUT} py-2 min-h-[64px]`} />
      </div>
      <SlotInput start={start} end={end} onChange={(s, e) => { setStart(s); setEnd(e); }} shift="1st" idPrefix="tpl-slot" />
      <PersonPicker people={people} selected={ids} onChange={setIds} max={MAX_ASSIGNEES} extra={extra} label="Default people (optional)" idPrefix="tpl-pp" />
      {err && <p role="alert" className="m-0 text-sm text-danger-ink">{err}</p>}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onCancel} className={`${BTN_OUTLINE} ${FOCUS}`}>Cancel</button>
        <button type="submit" disabled={!canSave} className={BTN_PRIMARY}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}
