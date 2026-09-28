"use client";
// The floor's only fill-state report (prod-b-03): switching the append row away from a carried
// silo asks "Is silo N full?" (Expansion, silo filling) or "Is silo N empty?" (Molding, silo in
// use). Yes / No both continue the switch; closing the modal (Cancel) aborts it entirely.
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";

interface Props {
  isOpen: boolean;
  variant: "expansion" | "molding";
  siloLabel: string;
  acting: boolean;
  onYes: () => void;
  onNo: () => void;
  onCancel: () => void;
}

const BIG =
  "flex-1 min-h-[56px] px-6 rounded text-lg font-semibold cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

export default function SiloSwitchModal({ isOpen, variant, siloLabel, acting, onYes, onNo, onCancel }: Props) {
  const { t } = useLang();
  const question = t(
    variant === "expansion" ? "production.silo.switch.isFull" : "production.silo.switch.isEmpty"
  ).replace("{silo}", siloLabel);
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={t("production.silo.switch.title")}>
      <p className="text-2xl font-semibold text-text">{question}</p>
      <p className="text-sm text-muted">
        {t(variant === "expansion" ? "production.silo.switch.noHintExpansion" : "production.silo.switch.noHintMolding")}
      </p>
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          disabled={acting}
          onClick={onYes}
          className={`${BIG} bg-[var(--brand)] text-white hover:opacity-90`}
        >
          {t("production.silo.switch.yes")}
        </button>
        <button
          type="button"
          disabled={acting}
          onClick={onNo}
          className={`${BIG} bg-[var(--ghost-bg)] text-text border border-border hover:bg-[var(--border-light)]`}
        >
          {t("production.silo.switch.no")}
        </button>
      </div>
    </Modal>
  );
}
