"use client";
// Receive bead (prod-b-03) → POST /v2/api/production/manage/bead-lots. Opened from the Bead view
// and from the Expansion lot select's "+ Receive new lot…" (prefilled with the sheet's supplier +
// bead type). `created:false` = the lot already existed and the bags were added to it; a 409
// `lot_conflict` means NOTHING was received (that lot # exists under another bead type).
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";
import { etDateParts } from "@/lib/productionNumbering";
import type { BeadLotRow } from "@/lib/productionSilos";
import type { OptionsData } from "./fields";
import { FIELD_CLASS, LABEL_CLASS, FormActions, FormError, type DescribeError } from "./ui";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  options: OptionsData;
  prefill?: { supplier?: string | null; beadType?: string | null };
  onReceived: (lot: BeadLotRow, created: boolean) => void;
  describeError: DescribeError;
}

export default function ReceiveLotModal({ isOpen, onClose, options, prefill, onReceived, describeError }: Props) {
  const { t } = useLang();
  const [supplier, setSupplier] = useState("");
  const [beadType, setBeadType] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [bags, setBags] = useState("");
  const [labelWeight, setLabelWeight] = useState("");
  const [labelUnit, setLabelUnit] = useState<"kg" | "lb">("kg");
  const [poNo, setPoNo] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSupplier(prefill?.supplier ?? "");
    setBeadType(prefill?.beadType ?? "");
    setLotNo("");
    setBags("");
    setLabelWeight("");
    setLabelUnit("kg");
    setPoNo("");
    setDate(etDateParts().ymd);
    setNotes("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const typesForSupplier = options.bead_types[supplier] ?? [];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActing(true);
    setError(null);
    try {
      const res = await fetch("/v2/api/production/manage/bead-lots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bead_supplier: supplier,
          bead_type: beadType,
          lot_no: lotNo,
          bags: Number(bags),
          label_weight: Number(labelWeight),
          label_unit: labelUnit,
          po_no: poNo,
          received_date: date,
          notes,
        }),
      });
      const data = await res.json();
      if (data.ok && data.lot) onReceived(data.lot, !!data.created);
      else setError(describeError(data.error, "production.bead.receiveFailed"));
    } catch {
      setError(t("production.toast.networkError"));
    } finally {
      setActing(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("production.bead.receiveTitle")} size="lg">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={LABEL_CLASS}>{t("production.newSheet.supplier")}</span>
            <select
              required
              className={FIELD_CLASS + " cursor-pointer"}
              value={supplier}
              onChange={(e) => {
                setSupplier(e.target.value);
                setBeadType("");
              }}
            >
              <option value="">{t("production.newSheet.selectPlaceholder")}</option>
              {options.suppliers.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={LABEL_CLASS}>{t("production.newSheet.beadType")}</span>
            <select
              required
              className={FIELD_CLASS + " cursor-pointer"}
              value={beadType}
              onChange={(e) => setBeadType(e.target.value)}
            >
              <option value="">{t("production.newSheet.selectPlaceholder")}</option>
              {typesForSupplier.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={LABEL_CLASS}>{t("production.bead.lotNo")}</span>
            <input required className={FIELD_CLASS + " font-mono"} value={lotNo} onChange={(e) => setLotNo(e.target.value)} />
          </label>
          <label className="block">
            <span className={LABEL_CLASS}>{t("production.bead.bags")}</span>
            <input
              required
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              className={FIELD_CLASS + " font-mono tabular-nums"}
              value={bags}
              onChange={(e) => setBags(e.target.value)}
            />
          </label>
          <label className="block">
            <span className={LABEL_CLASS}>{t("production.bead.labelWeight")}</span>
            <div className="flex gap-2">
              <input
                required
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                className={FIELD_CLASS + " font-mono tabular-nums"}
                value={labelWeight}
                onChange={(e) => setLabelWeight(e.target.value)}
              />
              <select
                aria-label={t("production.bead.labelUnit")}
                className={FIELD_CLASS + " w-24 cursor-pointer"}
                value={labelUnit}
                onChange={(e) => setLabelUnit(e.target.value as "kg" | "lb")}
              >
                <option value="kg">kg</option>
                <option value="lb">lb</option>
              </select>
            </div>
          </label>
          <label className="block">
            <span className={LABEL_CLASS}>{t("production.bead.poNo")}</span>
            <input className={FIELD_CLASS} value={poNo} onChange={(e) => setPoNo(e.target.value)} />
          </label>
          <label className="block">
            <span className={LABEL_CLASS}>{t("production.bead.receivedDate")}</span>
            <input type="date" required className={FIELD_CLASS} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="block">
            <span className={LABEL_CLASS}>{t("production.bead.notes")}</span>
            <input className={FIELD_CLASS} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <FormError message={error} />
        <FormActions
          onCancel={onClose}
          acting={acting}
          submitKey="production.bead.receive"
          actingKey="production.bead.receiving"
        />
      </form>
    </Modal>
  );
}
