"use client";
// Manager lot edit (prod-b-03) → PATCH /v2/api/production/manage/bead-lots/{id}. Supplier, bead
// type and lot # are shown read-only (immutable server-side); only changed fields are sent.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";
import type { BeadLotRow } from "@/lib/productionSilos";
import { FIELD_CLASS, LABEL_CLASS, FormActions, FormError, type DescribeError } from "./ui";

interface Props {
  lot: BeadLotRow | null;
  onClose: () => void;
  onSaved: (lot: BeadLotRow) => void;
  describeError: DescribeError;
}

export default function EditLotModal({ lot, onClose, onSaved, describeError }: Props) {
  const { t } = useLang();
  const [labelWeight, setLabelWeight] = useState("");
  const [labelUnit, setLabelUnit] = useState<"kg" | "lb">("kg");
  const [poNo, setPoNo] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState("");
  const [active, setActive] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lot) return;
    setLabelWeight(String(lot.label_weight));
    setLabelUnit(lot.label_unit);
    setPoNo(lot.po_no ?? "");
    setNotes(lot.notes ?? "");
    setDate(lot.received_date);
    setActive(!!lot.active);
    setError(null);
  }, [lot]);

  if (!lot) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lot) return;
    const body: Record<string, unknown> = {};
    if (Number(labelWeight) !== lot.label_weight) body.label_weight = Number(labelWeight);
    if (labelUnit !== lot.label_unit) body.label_unit = labelUnit;
    if (poNo.trim() !== (lot.po_no ?? "")) body.po_no = poNo;
    if (notes.trim() !== (lot.notes ?? "")) body.notes = notes;
    if (date !== lot.received_date) body.received_date = date;
    if (active !== !!lot.active) body.active = active;
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    setActing(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/production/manage/bead-lots/${lot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok && data.lot) onSaved(data.lot);
      else setError(describeError(data.error, "production.bead.editFailed"));
    } catch {
      setError(t("production.toast.networkError"));
    } finally {
      setActing(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`${t("production.bead.editTitle")} — ${lot.lot_no}`} size="lg">
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-sm text-muted">
          {lot.bead_supplier} · {lot.bead_type} · {t("production.field.lotNo")}{" "}
          <span className="font-mono tabular-nums text-text font-semibold">{lot.lot_no}</span>
          <span className="block text-xs">{t("production.bead.immutableHint")}</span>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className={LABEL_CLASS}>{t("production.bead.labelWeight")}</span>
            <div className="flex gap-2">
              <input
                required
                type="number"
                min={0}
                step="any"
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
        <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
          <input
            type="checkbox"
            className="w-5 h-5 cursor-pointer"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <span className="text-sm text-text">{t("production.bead.activeHint")}</span>
        </label>
        <FormError message={error} />
        <FormActions onCancel={onClose} acting={acting} submitKey="production.edit.save" actingKey="production.edit.saving" />
      </form>
    </Modal>
  );
}
