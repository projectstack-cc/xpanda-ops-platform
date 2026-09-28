"use client";
// Manager bag-count correction (prod-b-03) → POST /v2/api/production/manage/bead-lots/{id}/adjust.
// Signed non-zero bags + a required reason.
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

export default function AdjustLotModal({ lot, onClose, onSaved, describeError }: Props) {
  const { t } = useLang();
  const [bags, setBags] = useState("");
  const [note, setNote] = useState("");
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBags("");
    setNote("");
    setError(null);
  }, [lot]);

  if (!lot) return null;
  const n = Number(bags);
  const valid = Number.isInteger(n) && n !== 0 && !!note.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!lot) return;
    setActing(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/production/manage/bead-lots/${lot.id}/adjust`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bags: n, note: note.trim() }),
      });
      const data = await res.json();
      if (data.ok && data.lot) onSaved(data.lot);
      else setError(describeError(data.error, "production.bead.adjustFailed"));
    } catch {
      setError(t("production.toast.networkError"));
    } finally {
      setActing(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`${t("production.bead.adjustTitle")} — ${lot.lot_no}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-sm text-muted">
          {t("production.bead.onHand")}:{" "}
          <span className="font-mono tabular-nums text-text font-semibold">{lot.on_hand}</span>
        </p>
        <label className="block">
          <span className={LABEL_CLASS}>{t("production.bead.adjustBags")}</span>
          <input
            required
            type="number"
            step={1}
            inputMode="numeric"
            placeholder="-2"
            className={FIELD_CLASS + " font-mono tabular-nums"}
            value={bags}
            onChange={(e) => setBags(e.target.value)}
          />
        </label>
        <label className="block">
          <span className={LABEL_CLASS}>{t("production.bead.adjustReason")}</span>
          <textarea
            required
            rows={2}
            className={FIELD_CLASS + " py-2"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <FormError message={error} />
        <FormActions
          onCancel={onClose}
          acting={acting}
          submitKey="production.edit.save"
          actingKey="production.edit.saving"
          disabled={!valid}
        />
      </form>
    </Modal>
  );
}
