"use client";
import Modal from "@/components/Modal";

interface Props {
  isOpen: boolean;
  itemLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// Confirmation gate for checking a cut-list item complete — a mis-tap must not silently mark a
// part done. Unchecking is a correction and is NOT gated by this modal (writes immediately).
export default function ConfirmCompleteModal({ isOpen, itemLabel, onConfirm, onCancel }: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Confirm Completed" size="md">
      <div className="space-y-4">
        <div>
          <p className="text-sm text-text">Mark this part as completed?</p>
          {itemLabel && <p className="mt-1 text-sm text-muted truncate">{itemLabel}</p>}
        </div>

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onConfirm}
            className="touch-manipulation flex-1 min-h-[44px] bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90"
          >
            OK
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="touch-manipulation min-h-[44px] px-4 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
