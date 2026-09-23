"use client";
// Confirmation gate for hiding/purging a production sheet — mirrors DeleteRowModal's
// confirm-then-mutate pattern. Soft delete (hide) is the default action; a second, visually
// separated danger button for a hard purge only renders for admins.
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";

interface Props {
  isOpen: boolean;
  sheetLabel?: string;
  isAdmin: boolean;
  acting: boolean;
  onHide: () => void;
  onPurge: () => void;
  onCancel: () => void;
}

export default function DeleteSheetModal({
  isOpen,
  sheetLabel,
  isAdmin,
  acting,
  onHide,
  onPurge,
  onCancel,
}: Props) {
  const { t } = useLang();
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={t("production.deleteSheet.title")}>
      <div className="space-y-4">
        <div>
          <p className="text-sm text-text">{t("production.deleteSheet.body")}</p>
          {sheetLabel && <p className="mt-1 text-sm text-muted truncate">{sheetLabel}</p>}
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            disabled={acting}
            onClick={onHide}
            className="touch-manipulation min-h-[44px] px-4 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] disabled:opacity-50"
          >
            {acting ? t("production.deleteSheet.hiding") : t("production.deleteSheet.hide")}
          </button>

          {isAdmin && (
            <button
              type="button"
              disabled={acting}
              onClick={onPurge}
              className="touch-manipulation min-h-[44px] px-4 bg-[var(--danger-bg)] text-[var(--danger-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 border-2 border-[var(--danger-bg)]"
            >
              {acting ? t("production.deleteSheet.purging") : t("production.deleteSheet.purge")}
            </button>
          )}

          <button
            type="button"
            onClick={onCancel}
            className="touch-manipulation min-h-[44px] px-4 bg-transparent text-muted text-sm font-semibold cursor-pointer hover:text-text"
          >
            {t("production.common.cancel")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
