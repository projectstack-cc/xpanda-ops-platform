"use client";
import { useState, useEffect } from "react";
import Modal from "@/components/Modal";

interface Props {
  lineLabel: string;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (note: string, qty?: number, photo?: File | null) => void;
  acting: boolean;
}

export default function HandoffModal({
  lineLabel,
  isOpen,
  onClose,
  onSubmit,
  acting,
}: Props) {
  const [note, setNote] = useState("");
  const [qty, setQty] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);

  useEffect(() => {
    if (isOpen) {
      setNote("");
      setQty("");
      setPhoto(null);
    }
  }, [isOpen]);

  function handleSubmit() {
    const qtyNum = parseInt(qty, 10);
    onSubmit(note, !isNaN(qtyNum) && qtyNum > 0 ? qtyNum : undefined, photo);
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Clock Out — ${lineLabel}`}>
      <div className="space-y-4">
        <div>
          <label htmlFor="handoff-note" className="block text-sm font-medium text-text mb-1">
            Handoff note
            <span className="ml-1 text-xs text-muted font-normal">
              (where you stopped, what to watch)
            </span>
          </label>
          <textarea
            id="handoff-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="e.g. Stopped at 3rd stack — glue needs to cure. Watch blade tension."
            className="w-full rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
          />
        </div>
        <div>
          <label htmlFor="handoff-qty" className="block text-sm font-medium text-text mb-1">
            Pieces completed this session
            <span className="ml-1 text-xs text-muted font-normal">(optional)</span>
          </label>
          <input
            id="handoff-qty"
            type="number"
            min="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            placeholder="0"
            className="w-28 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-text mb-1">
            Cut-list photo
            <span className="ml-1 text-xs text-muted font-normal">(optional)</span>
          </label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted file:mr-3 file:py-2 file:px-3 file:rounded file:border file:border-border file:bg-[var(--ghost-bg)] file:text-text file:text-sm file:font-semibold file:cursor-pointer"
          />
          {photo && (
            <p className="mt-1 text-xs text-muted truncate">Selected: {photo.name}</p>
          )}
        </div>
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            disabled={acting}
            onClick={handleSubmit}
            className="flex-1 min-h-[44px] bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
          >
            {acting ? "Saving…" : "Clock Out"}
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
