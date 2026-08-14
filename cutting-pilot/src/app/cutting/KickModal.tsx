"use client";
import Modal from "@/components/Modal";

interface Props {
  isOpen: boolean;
  operatorName?: string;
  line?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Confirm gate for freeing a line held by another operator's open session (they forgot to
// Stop). Closes the session only — no effect on cut progress or quantities.
export default function KickModal({ isOpen, operatorName, line, busy, onConfirm, onCancel }: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title="Kick operator off line" size="md">
      <div className="space-y-4">
        <p className="text-sm text-text">
          Remove {operatorName} from {line}? This frees the line so someone else can Start. It
          does not change any cut progress or quantities.
        </p>

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="touch-manipulation flex-1 min-h-[44px] bg-[var(--danger-bg)] text-[var(--danger-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Kicking…" : "Kick"}
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
