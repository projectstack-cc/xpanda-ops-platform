"use client";

type Props = {
  invoice: string | null;
  customer: string | null;
  line: string;
  startedAt: string;
  orphaned: boolean;
  onClockOut: () => void;
  disabled?: boolean;
};

// Elapsed-time readout deferred: the UTC-parsing helper backing formatDuration() is a
// module-private fn in @/lib/time.ts, and that file is out of scope for this prompt — see
// BACKLOG.md rather than duplicating the parser here.
// P309: layout-neutral by design — an operator may hold several open sessions at once, so the
// parent (CuttingBoard.tsx) owns the fixed/bottom-anchored stacking container and this component
// just renders one row's content.
export default function ClockedInBar({
  invoice,
  customer,
  line,
  orphaned,
  onClockOut,
  disabled,
}: Props) {
  return (
    <div className="bg-[var(--card-bg)] border-t border-border">
      {orphaned && (
        <div className="px-4 py-1.5 text-xs bg-[var(--warn-bg)] border-b border-[var(--warn-border)] text-[var(--warn-text)]">
          This job is no longer on the board — clocking out will close the session only.
        </div>
      )}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text truncate">
            Running — {invoice ? `#${invoice}` : "Job"}
          </p>
          <p className="text-xs text-muted truncate">
            {customer ? `${customer} · ` : ""}
            {line}
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={onClockOut}
          className="shrink-0 min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Stop
        </button>
      </div>
    </div>
  );
}
