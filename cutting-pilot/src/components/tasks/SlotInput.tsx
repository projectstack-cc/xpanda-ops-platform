"use client";
// src/components/tasks/SlotInput.tsx  (tasks-02)
// Optional time slot: From / To native time inputs, duration readout, Clear, and preset chips for a shift
// (lib/tasks/board shiftPresets). Inline error mirrors the server rule (both or neither, To after From); the server
// stays the authority. slotError() is exported so the parent can block Save.
import { shiftPresets, type ShiftKey } from "@/lib/tasks/board";
import { CHIP_NEUTRAL, FOCUS, INPUT, LABEL } from "./tasksUi";

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** null when OK (empty pair or a valid ordered pair). */
export function slotError(start: string, end: string): string | null {
  if (!start && !end) return null;
  if (!start || !end) return "Set both From and To, or clear the time slot.";
  if (!HM.test(start) || !HM.test(end)) return "Enter times as HH:MM.";
  if (toMin(end) <= toMin(start)) return "To must be after From.";
  return null;
}

function duration(start: string, end: string): string | null {
  if (slotError(start, end) || !start) return null;
  const m = toMin(end) - toMin(start);
  const h = Math.floor(m / 60), r = m % 60;
  return h && r ? `${h}h ${r}m` : h ? `${h}h` : `${r}m`;
}

interface Props {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  shift: ShiftKey;
  idPrefix?: string;
}

export default function SlotInput({ start, end, onChange, shift, idPrefix = "slot" }: Props) {
  const err = slotError(start, end);
  const dur = duration(start, end);
  const presets = shiftPresets(shift);
  return (
    <fieldset className="m-0 p-0 border-0 min-w-0">
      <legend className={LABEL}>Time slot <span className="normal-case font-normal">(optional)</span></legend>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col w-[120px]" htmlFor={`${idPrefix}-from`}>
          <span className="text-xs text-muted mb-0.5">From</span>
          <input id={`${idPrefix}-from`} type="time" step={900} value={start} onChange={(e) => onChange(e.target.value, end)}
            className={`${INPUT} font-mono tabular-nums`} aria-invalid={!!err} />
        </label>
        <label className="flex flex-col w-[120px]" htmlFor={`${idPrefix}-to`}>
          <span className="text-xs text-muted mb-0.5">To</span>
          <input id={`${idPrefix}-to`} type="time" step={900} value={end} onChange={(e) => onChange(start, e.target.value)}
            className={`${INPUT} font-mono tabular-nums`} aria-invalid={!!err} />
        </label>
        <span className="min-h-[44px] inline-flex items-center text-sm font-mono tabular-nums text-muted" aria-live="polite">
          {dur ? `= ${dur}` : ""}
        </span>
        {(start || end) && (
          <button type="button" onClick={() => onChange("", "")}
            className={`min-h-[44px] px-2 text-sm font-semibold text-[var(--link)] hover:underline cursor-pointer rounded ${FOCUS}`}>
            Clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2" aria-label={`${shift} shift presets`}>
        {presets.map((p) => {
          const on = p.start === start && p.end === end;
          return (
            <button key={p.key} type="button" onClick={() => onChange(p.start, p.end)} aria-pressed={on}
              className={`${CHIP_NEUTRAL} min-h-[36px] px-3 cursor-pointer ${on ? "ring-2 ring-[var(--accent)]" : ""} ${FOCUS}`}
              title={`${p.start}–${p.end}`}>
              {p.label}
            </button>
          );
        })}
      </div>
      {err && <p role="alert" className="mt-1.5 mb-0 text-sm text-danger-ink">{err}</p>}
    </fieldset>
  );
}
