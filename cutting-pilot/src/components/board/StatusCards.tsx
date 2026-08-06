"use client";
// src/components/board/StatusCards.tsx
// Three clickable status cards (Open / Cutting / Loading) at the top of the production board.

export type StatusBucket = "open" | "cutting" | "loading";

interface StatusCardsProps {
  counts: { open: number; cutting: number; loading: number };
  onSelect: (bucket: StatusBucket) => void;
}

const CARDS: Array<{ bucket: StatusBucket; label: string }> = [
  { bucket: "open", label: "Open jobs" },
  { bucket: "cutting", label: "Cutting" },
  { bucket: "loading", label: "Loading" },
];

export default function StatusCards({ counts, onSelect }: StatusCardsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {CARDS.map((c) => (
        <button
          key={c.bucket}
          type="button"
          onClick={() => onSelect(c.bucket)}
          className="min-h-[72px] rounded-xl border border-[var(--card-border)] bg-surface px-4 py-3 text-left cursor-pointer hover:border-[var(--brand)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          <div className="text-2xl font-semibold text-text tabular-nums">{counts[c.bucket]}</div>
          <div className="text-xs font-medium text-muted">{c.label}</div>
        </button>
      ))}
    </div>
  );
}
