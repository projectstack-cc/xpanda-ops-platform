"use client";
// src/components/tasks/PersonPicker.tsx  (tasks-02)
// Pick people for a task, a repeatable task or a crew. `people` = assignable only. `extra` = people already on the
// record who are no longer assignable: shown struck through with a remove ×, never re-addable from the list.
// Selected chips first, then a search box over a list grouped 1st / 2nd / No shift (44px checkbox rows).
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { SHIFTS, SHIFT_ORDER, type ShiftKey } from "@/lib/tasks/board";
import ShiftTag from "./ShiftTag";
import { CHIP_NEUTRAL, FOCUS, INPUT, type Person } from "./tasksUi";

interface Props {
  people: Person[];
  selected: string[];
  onChange: (ids: string[]) => void;
  max: number;
  min?: number;
  extra?: Person[];
  label?: string;
  idPrefix?: string;
}

export default function PersonPicker({ people, selected, onChange, max, min = 0, extra = [], label = "Assign to", idPrefix = "pp" }: Props) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => {
    const m = new Map<string, Person & { gone?: boolean }>();
    for (const p of extra) m.set(p.id, { ...p, gone: true });
    for (const p of people) m.set(p.id, p);
    return m;
  }, [people, extra]);
  const atMax = selected.length >= max;

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? people.filter((p) => p.name.toLowerCase().includes(needle)) : people;
    const keys: (ShiftKey | null)[] = [...SHIFT_ORDER, null];
    return keys
      .map((k) => ({ key: k, label: k ? SHIFTS[k].label : "No shift", people: list.filter((p) => p.shift === k) }))
      .filter((g) => g.people.length);
  }, [people, q]);

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id));
    else if (!atMax) onChange([...selected, id]);
  };

  return (
    <div className="min-w-0">
      <span className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1" id={`${idPrefix}-label`}>{label}</span>
      <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]" aria-label="Selected people" data-testid={`${idPrefix}-selected`}>
        {selected.length === 0 && <span className="text-sm text-muted">Nobody picked yet{min > 0 ? ` — pick at least ${min}` : ""}.</span>}
        {selected.map((id) => {
          const p = byId.get(id);
          const gone = !p || (p as any).gone;
          return (
            <span key={id} className={`${CHIP_NEUTRAL} pr-0.5`}>
              <span className={gone ? "line-through text-muted" : ""}>{p?.name ?? id}</span>
              {gone ? <span className="text-[10px] text-muted">not assignable</span> : <ShiftTag shift={p!.shift} />}
              <button type="button" onClick={() => onChange(selected.filter((x) => x !== id))} aria-label={`Remove ${p?.name ?? id}`}
                className={`min-w-[28px] min-h-[28px] inline-flex items-center justify-center rounded-full hover:bg-[var(--surface)] cursor-pointer ${FOCUS}`}>
                <X size={14} aria-hidden="true" />
              </button>
            </span>
          );
        })}
      </div>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…"
        aria-label="Search people" className={INPUT} />
      {atMax && <p className="mt-1 mb-0 text-xs text-[var(--warn-text)]">Max {max} people.</p>}
      <div className="mt-2 max-h-[240px] overflow-y-auto border border-[var(--line)] rounded-lg" role="group" aria-labelledby={`${idPrefix}-label`}>
        {groups.length === 0 && <p className="m-0 p-3 text-sm text-muted">No one matches “{q}”.</p>}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted bg-[var(--ghost-bg)] sticky top-0">{g.label}</div>
            {g.people.map((p) => {
              const on = selected.includes(p.id);
              const disabled = !on && atMax;
              return (
                <label key={p.id} className={`flex items-center gap-3 px-3 min-h-[44px] border-t border-[var(--line)] ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-[var(--ghost-bg)]"}`}>
                  <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(p.id)} className="w-5 h-5 accent-[var(--brand)]" />
                  <span className="flex-1 text-sm">{p.name}</span>
                  <ShiftTag shift={p.shift} />
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
