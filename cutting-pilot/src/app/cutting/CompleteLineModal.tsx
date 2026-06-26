"use client";
import { useState, useEffect } from "react";
import { Lock } from "lucide-react";
import Modal from "@/components/Modal";

interface Props {
  lineLabel: string;
  customer: string;
  invoice: string;
  isLaminate: boolean;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
  acting: boolean;
}

export default function CompleteLineModal({
  lineLabel,
  customer,
  invoice,
  isLaminate,
  isOpen,
  onClose,
  onSubmit,
  acting,
}: Props) {
  const [note, setNote] = useState("");

  useEffect(() => {
    if (isOpen) setNote("");
  }, [isOpen]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Mark Complete — ${lineLabel}`}>
      <div className="space-y-4">
        {/* Confirmation context */}
        <p className="text-sm text-muted">
          Completing <span className="font-medium text-text">{lineLabel}</span> for{" "}
          <span className="font-medium text-text">{customer}</span>
          <span className="font-mono tabular-nums"> · {invoice}</span>. This marks the line done; when
          every required line is complete the job is marked done. This cannot be undone.
        </p>

        {/* Optional completion note (stored as the closing session's handoff note) */}
        <div>
          <label htmlFor="complete-note" className="block text-sm font-medium text-text mb-1">
            Completion note
            <span className="ml-1 text-xs text-muted font-normal">(optional)</span>
          </label>
          <textarea
            id="complete-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Anything the next step should know about this finished line."
            className="w-full rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
          />
        </div>

        {/* Scrap — DISABLED PLACEHOLDER. Not wired; hidden on Laminate. */}
        {!isLaminate && (
          <div className="rounded border border-dashed border-border px-3 py-3 space-y-3 opacity-70">
            <div className="flex items-center gap-2">
              <Lock size={13} className="text-muted shrink-0" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                Scrap — coming soon
              </span>
            </div>
            <p className="text-xs text-muted">
              Waste logging moves here once the native scrap database ships. Not yet active.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <select
                disabled
                aria-hidden="true"
                tabIndex={-1}
                className="min-h-[44px] rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-muted px-2 text-sm cursor-not-allowed"
              >
                <option>Reason…</option>
              </select>
              <input
                disabled
                aria-hidden="true"
                tabIndex={-1}
                placeholder="Scrap (cubic in)"
                className="min-h-[44px] rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-muted px-2 text-sm cursor-not-allowed"
              />
              <select
                disabled
                aria-hidden="true"
                tabIndex={-1}
                className="min-h-[44px] rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-muted px-2 text-sm cursor-not-allowed"
              >
                <option>Shift…</option>
              </select>
              <input
                disabled
                aria-hidden="true"
                tabIndex={-1}
                placeholder="Material / density"
                className="min-h-[44px] rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-muted px-2 text-sm cursor-not-allowed"
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            disabled={acting}
            onClick={() => onSubmit(note)}
            className="flex-1 min-h-[44px] bg-[var(--success-bg)] text-[var(--success-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
          >
            {acting ? "Saving…" : "Mark Complete"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
