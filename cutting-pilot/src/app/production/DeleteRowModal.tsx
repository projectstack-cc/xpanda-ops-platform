"use client";
// Confirmation gate for deleting a production row — mirrors KickModal's confirm-then-mutate
// pattern (cutting/KickModal.tsx). No window.confirm, no hand-rolled overlay.
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";

interface Props {
  isOpen: boolean;
  rowLabel?: string;
  acting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteRowModal({ isOpen, rowLabel, acting, onConfirm, onCancel }: Props) {
  const { t } = useLang();
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={t("production.deleteRow.title")} size="md">
      <div className="space-y-4">
        <div>
          <p className="text-sm text-text">{t("production.deleteRow.body")}</p>
          {rowLabel && <p className="mt-1 text-sm text-muted truncate">{rowLabel}</p>}
        </div>

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            disabled={acting}
            onClick={onConfirm}
            className="touch-manipulation flex-1 min-h-[44px] bg-[var(--danger-bg)] text-[var(--danger-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
          >
            {acting ? t("production.deleteRow.confirming") : t("production.deleteRow.confirm")}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="touch-manipulation min-h-[44px] px-4 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)]"
          >
            {t("production.common.cancel")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
