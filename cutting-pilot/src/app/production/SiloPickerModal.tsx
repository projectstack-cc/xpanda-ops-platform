"use client";
// Silo picker for the append row's silo cell (prod-b-03). Composes Modal + the shared SiloGrid;
// only tiles valid for this board (and, on Expansion, the row's lot) are clickable.
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";
import type { SiloRow } from "@/lib/productionSilos";
import SiloGrid from "./SiloGrid";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  mode: "expansion" | "molding";
  silos: SiloRow[] | null;
  rowLotId: string | null;
  selectedNo: number | null;
  onPick: (silo: SiloRow) => void;
}

export default function SiloPickerModal({ isOpen, onClose, mode, silos, rowLotId, selectedNo, onPick }: Props) {
  const { t } = useLang();
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("production.silo.pickTitle")} size="xl">
      <p className="text-sm text-muted">
        {t(mode === "expansion" ? "production.silo.pickHintExpansion" : "production.silo.pickHintMolding")}
      </p>
      {silos ? (
        <SiloGrid silos={silos} mode={mode} rowLotId={rowLotId} selectedNo={selectedNo} onPick={onPick} />
      ) : (
        <p className="text-sm text-muted">{t("production.silo.loading")}</p>
      )}
    </Modal>
  );
}
