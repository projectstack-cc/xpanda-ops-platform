"use client";

// cutlist-01: opt-in "Include chunk breakdown" checkbox for the cut list PDF. Shared by
// OrderDetailModal, OrderEditModal and OrderEntryForm — callers own the state and decide whether
// to render it (only when the job has a non-empty hb_chunk_breakdown). Unchecked by default.

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
};

export default function CutListChunkToggle({ checked, onChange, disabled = false }: Props) {
  return (
    <label
      className={`inline-flex items-center gap-2 min-h-[44px] text-sm text-text select-none ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        className="h-5 w-5 shrink-0 cursor-[inherit]"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      Include chunk breakdown
    </label>
  );
}
