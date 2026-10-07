"use client";
// src/components/board/PrioritySelect.tsx
// jb-11 — the single "Priority" control (Normal / Elevated / High / Critical / Rush) used by the
// edit modal and the board row dropdown. Callers map the choice onto priority + priority_level via
// lib/priority.ts. Styled by the caller's input class.
import { PRIORITY_CHOICES, type PriorityChoice } from "@/lib/priority";

interface PrioritySelectProps {
  value: PriorityChoice;
  onChange: (choice: PriorityChoice) => void;
  className?: string;
  labelClassName?: string;
  disabled?: boolean;
}

export default function PrioritySelect({ value, onChange, className, labelClassName, disabled }: PrioritySelectProps) {
  return (
    <label className="block">
      <span className={labelClassName}>Priority</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PriorityChoice)}
        disabled={disabled}
        className={className}
      >
        {PRIORITY_CHOICES.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
