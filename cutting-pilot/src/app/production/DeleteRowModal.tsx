"use client";
// Confirmation gate for deleting a production row — mirrors KickModal's confirm-then-mutate
// pattern (cutting/KickModal.tsx). No window.confirm, no hand-rolled overlay.
import Modal from "@/components/Modal";

interface Props {
  isOpen: boolean;
  rowLabel?: string;
  acting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteRowModal({ isOpen, rowLabel, acting, onConfirm, onCancel }: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Delete row?" size="md">
      <div className="space-y-4">
        <div>
          <p className="text-sm text-text">This will permanently remove the row. This can&apos;t be undone.</p>
          {rowLabel && <p className="mt-1 text-sm text-muted truncate">{rowLabel}</p>}
        </div>

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            disabled={acting}
            onClick={onConfirm}
            className="touch-manipulation flex-1 min-h-[44px] bg-[var(--danger-bg)] text-[var(--danger-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
          >
            {acting ? "Deleting…" : "Delete"}
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
