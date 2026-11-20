"use client";
// Complete modal for the chunk board. cc: asks "Chunks cut this run" (required, whole number ≥ 0,
// no max — block yield can beat target_chunks). hc: plain confirm, counts stay.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import type { Board } from "./ChunkBoard";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  variant: Board;
  label: string;
  qtyDone?: number;
  targetChunks?: number;
  onSubmit: (values: { qty_done_delta?: number }) => void;
  acting: boolean;
}

export default function ChunkCompleteModal({
  isOpen,
  onClose,
  variant,
  label,
  qtyDone,
  targetChunks,
  onSubmit,
  acting,
}: Props) {
  const [cut, setCut] = useState("");

  useEffect(() => {
    if (isOpen) setCut("");
  }, [isOpen]);

  const done = qtyDone ?? 0;
  const target = targetChunks ?? 0;
  const trimmed = cut.trim();
  const valid = /^\d+$/.test(trimmed);
  const entered = valid ? parseInt(trimmed, 10) : 0;
  const over = valid && target > 0 ? done + entered - target : 0;
  const disabled = acting || (variant === "cc" && !valid);

  function handleSubmit() {
    if (variant === "cc") {
      if (!valid) return;
      onSubmit({ qty_done_delta: entered });
    } else {
      onSubmit({});
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={variant === "hc" ? "Complete run" : `Complete — ${label}`}>
      <div className="space-y-4">
        {variant === "cc" ? (
          <div>
            <label htmlFor="complete-qty-done" className="block text-sm font-medium text-text mb-1">
              Chunks cut this run
            </label>
            <input
              id="complete-qty-done"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              required
              value={cut}
              onChange={(e) => setCut(e.target.value)}
              className="w-28 min-h-[44px] rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
            <p className="mt-1.5 text-xs text-muted tabular-nums">
              {target > 0 ? `So far: ${done} of ${target}` : `So far: ${done}`}
            </p>
            {over > 0 && (
              <p
                role="status"
                className="mt-2 rounded border border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info-text)] px-3 py-2 text-xs tabular-nums"
              >
                That&apos;s {over} over the {target} assigned — it&apos;ll be recorded as cut.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-text">
            Complete just ends your run on <span className="font-semibold">{label}</span> —
            counts stay.
          </p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={disabled}
            title={variant === "cc" && !valid ? "Enter how many chunks you cut this run." : undefined}
            onClick={handleSubmit}
            className="min-h-[44px] px-4 py-2 bg-[var(--success-bg)] text-[var(--success-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {acting ? "Saving…" : "Complete"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
