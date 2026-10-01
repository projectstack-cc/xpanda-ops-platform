// src/components/board/LinePills.tsx
// board-lines-01: read-only abbreviation pills for a job's required cutting lines (Job Board rows).
// Main/Blue Line (the /v2/cutting queue lines) are info-tinted; completed lines show ✓ + strike.
// An empty list renders a "No lines" warn badge so unassigned (e.g. QB-intake) jobs stand out.
import { PROCESSES, type JobProcess } from "@/lib/processes";

const pillBase = "text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded whitespace-nowrap";

export default function LinePills({ processes }: { processes: JobProcess[] }) {
  const present = PROCESSES.map((p) => ({ ...p, entry: processes.find((e) => e.name === p.name) })).filter(
    (p) => p.entry
  );

  if (!present.length) {
    return (
      <span className={`${pillBase} bg-[var(--warn-bg)] text-[var(--warn-text)] border border-[var(--warn-border)]`}>
        No lines
      </span>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {present.map((p) => {
        const tone =
          p.name === "Main Line" || p.name === "Blue Line"
            ? "bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)]"
            : "border border-[var(--border)] text-[var(--text-hint)]";
        const done = p.entry?.completed;
        return (
          <span key={p.name} title={p.name} className={`${pillBase} ${tone} ${done ? "line-through opacity-70" : ""}`}>
            {done ? `✓ ${p.abbr}` : p.abbr}
          </span>
        );
      })}
    </div>
  );
}
