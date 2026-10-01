"use client";
// src/components/board/ProcessPicker.tsx
// board-lines-01: checkbox grid for the cutting lines a job requires. Markup + classes lifted
// verbatim from OrderEntryForm's "Production processes" section; shared by order entry and the
// board's OrderEditModal. Value is the list of selected process names (PROCESSES order).
import { PROCESSES } from "@/lib/processes";

interface ProcessPickerProps {
  value: string[];
  onChange: (names: string[]) => void;
  disabled?: boolean;
  hint?: string;
}

export default function ProcessPicker({
  value,
  onChange,
  disabled = false,
  hint = "Select which lines this job requires.",
}: ProcessPickerProps) {
  function toggle(name: string, checked: boolean) {
    const next = new Set(value);
    if (checked) next.add(name);
    else next.delete(name);
    onChange(PROCESSES.filter((p) => next.has(p.name)).map((p) => p.name));
  }

  return (
    <>
      <p className="text-xs text-muted">{hint}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {PROCESSES.map((proc) => (
          <label
            key={proc.name}
            className="inline-flex items-center gap-2 min-h-[44px] px-3 rounded-md border border-[var(--input-border)] cursor-pointer select-none hover:bg-[var(--ghost-bg)]"
          >
            <input
              type="checkbox"
              checked={value.includes(proc.name)}
              onChange={(e) => toggle(proc.name, e.target.checked)}
              disabled={disabled}
              className="h-5 w-5 accent-[var(--brand)]"
            />
            <span className="text-sm font-medium text-text">{proc.name}</span>
          </label>
        ))}
      </div>
    </>
  );
}
