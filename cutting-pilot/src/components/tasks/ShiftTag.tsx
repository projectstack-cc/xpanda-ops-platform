// src/components/tasks/ShiftTag.tsx  (tasks-02) — tiny "1st" / "2nd" / "—" tag next to a person's name.
import type { ShiftKey } from "@/lib/tasks/board";

export default function ShiftTag({ shift }: { shift: ShiftKey | null }) {
  return (
    <span
      className={`inline-flex items-center px-1.5 rounded text-[10px] font-mono font-semibold uppercase leading-4 border ${
        shift ? "border-[var(--input-border)] text-muted" : "border-[var(--warn-border)] text-[var(--warn-text)] bg-[var(--warn-bg)]"
      }`}
      title={shift ? `${shift} shift` : "No shift set"}
    >
      {shift ?? "—"}
    </span>
  );
}
