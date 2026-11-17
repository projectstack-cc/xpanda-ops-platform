"use client";
// src/components/tasks/CrewsModal.tsx  (tasks-02)
// Saved crews. Lists active crews (members with shift tags; no-longer-assignable members struck through). canEdit:
// + New crew, Edit, Remove (deactivate — existing tasks keep their people). Form: name 1–40 + PersonPicker (2–10).
// 409 crew_name_taken → inline message. Read-only when !canEdit.
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import Modal from "@/components/Modal";
import { MAX_ASSIGNEES } from "@/lib/tasks/board";
import PersonPicker from "./PersonPicker";
import ShiftTag from "./ShiftTag";
import { api, BTN_ICON, BTN_OUTLINE, BTN_PRIMARY, INPUT, LABEL, resultError, sameSet, type CrewRow, type Person } from "./tasksUi";

const NAME_MAX = 40;

interface Props { canEdit: boolean; people: Person[]; crews: CrewRow[]; onClose: () => void; onChanged: () => Promise<void> | void }

export default function CrewsModal({ canEdit, people, crews, onClose, onChanged }: Props) {
  const [editing, setEditing] = useState<CrewRow | "new" | null>(null);
  const [confirm, setConfirm] = useState<CrewRow | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const active = crews.filter((c) => c.is_active);

  async function remove(c: CrewRow) {
    setErr("");
    const r = await api(`/manage/crews/${encodeURIComponent(c.id)}`, "DELETE");
    setConfirm(null);
    if (!r.ok) { setErr(resultError(r)); return; }
    setMsg(`Removed crew “${c.name}”`);
    await onChanged();
  }

  return (
    <Modal isOpen onClose={onClose} title="Crews" size="lg">
      {editing ? (
        <CrewForm crew={editing === "new" ? null : editing} people={people}
          onCancel={() => setEditing(null)}
          onSaved={async (m) => { setEditing(null); setMsg(m); await onChanged(); }} />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 text-sm text-muted flex-1 min-w-[200px]">Saved groups of people. Picking a crew on a task adds everyone in it.</p>
            {canEdit && (
              <button type="button" onClick={() => { setMsg(""); setEditing("new"); }} className={BTN_PRIMARY} data-testid="new-crew">
                <Plus size={16} aria-hidden="true" /> New crew
              </button>
            )}
          </div>
          {msg && <p role="status" className="m-0 text-sm text-success-ink">{msg}</p>}
          {err && <p role="alert" className="m-0 text-sm text-danger-ink">{err}</p>}
          {active.length === 0 ? (
            <p className="m-0 p-4 text-sm text-muted border border-dashed border-[var(--input-border)] rounded-lg">No crews yet.{canEdit ? " Add one for people who usually work together." : ""}</p>
          ) : (
            <ul className="m-0 p-0 list-none border border-[var(--line)] rounded-lg" data-testid="crew-list">
              {active.map((c) => (
                <li key={c.id} className="px-3 py-2 border-t border-[var(--line)] first:border-t-0">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0 text-sm">
                      <div className="font-semibold">{c.name}</div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                        {c.members.map((m) => (
                          <span key={m.id} className="inline-flex items-center gap-1">
                            <span className={m.assignable ? "" : "line-through text-muted"}>{m.name}</span>
                            {m.assignable ? <ShiftTag shift={m.shift} /> : <span className="text-[10px] text-muted">not assignable</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                    {canEdit && (
                      <>
                        <button type="button" onClick={() => { setMsg(""); setEditing(c); }} className={BTN_ICON} aria-label={`Edit ${c.name}`}><Pencil size={16} aria-hidden="true" /></button>
                        <button type="button" onClick={() => setConfirm(c)} className={BTN_ICON} aria-label={`Remove ${c.name}`}><Trash2 size={16} aria-hidden="true" /></button>
                      </>
                    )}
                  </div>
                  {confirm?.id === c.id && (
                    <div role="alertdialog" aria-label={`Remove ${c.name}?`} className="mt-2 p-3 rounded-lg border border-[var(--warn-border)] bg-[var(--warn-bg)] text-sm">
                      <p className="m-0 text-[var(--warn-text)] font-semibold">Remove “{c.name}”? Existing tasks keep their people.</p>
                      <div className="flex gap-2 mt-2">
                        <button type="button" onClick={() => setConfirm(null)} className={BTN_OUTLINE}>Cancel</button>
                        <button type="button" onClick={() => void remove(c)} className={BTN_PRIMARY} data-testid="confirm-remove-crew">Remove</button>
                      </div>
                    </div>
                  )}
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

function CrewForm({ crew, people, onCancel, onSaved }: { crew: CrewRow | null; people: Person[]; onCancel: () => void; onSaved: (m: string) => Promise<void> }) {
  const assignable = new Set(people.map((p) => p.id));
  const initIds = crew?.members.map((m) => m.id) ?? [];
  const extra = (crew?.members ?? []).filter((m) => !assignable.has(m.id));
  const [name, setName] = useState(crew?.name ?? "");
  const [ids, setIds] = useState<string[]>(initIds);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const canSave = !!name.trim() && name.trim().length <= NAME_MAX && ids.length >= 2 && !busy;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setErr("");
    const body: Record<string, unknown> = {};
    if (!crew || name.trim() !== crew.name) body.name = name.trim();
    if (!crew || !sameSet(ids, initIds)) body.member_ids = ids;
    const r = crew
      ? await api(`/manage/crews/${encodeURIComponent(crew.id)}`, "PATCH", body)
      : await api("/manage/crews", "POST", body);
    setBusy(false);
    if (!r.ok) {
      setErr(r.json?.error === "crew_name_taken" ? "Another crew already uses that name." : resultError(r));
      return;
    }
    await onSaved(crew ? `Saved crew “${name.trim()}”` : `Added crew “${name.trim()}”`);
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <h3 className="m-0 text-base font-semibold">{crew ? "Edit crew" : "New crew"}</h3>
      <div>
        <label htmlFor="crew-name" className={LABEL}>Crew name</label>
        <input id="crew-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} placeholder="Main Line · 1st" className={INPUT} autoComplete="off" />
      </div>
      <PersonPicker people={people} selected={ids} onChange={setIds} max={MAX_ASSIGNEES} min={2} extra={extra} label="People (2–10)" idPrefix="crew-pp" />
      {err && <p role="alert" className="m-0 text-sm text-danger-ink" data-testid="crew-error">{err}</p>}
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" onClick={onCancel} className={BTN_OUTLINE}>Cancel</button>
        <button type="submit" disabled={!canSave} className={BTN_PRIMARY} data-testid="save-crew">{busy ? "Saving…" : "Save crew"}</button>
      </div>
    </form>
  );
}
