"use client";
// Manager silo correction (prod-b-03) → PATCH /v2/api/production/manage/silos/{no}. Label, active,
// and any state / lot (all lots incl. inactive); a state or lot change requires a note. Only the
// fields that actually changed are sent.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";
import type { BeadLotRow, SiloRow, SiloState } from "@/lib/productionSilos";
import { FIELD_CLASS, LABEL_CLASS, FormActions, FormError, type DescribeError } from "./ui";

interface Props {
  silo: SiloRow | null;
  onClose: () => void;
  onSaved: (silo: SiloRow) => void;
  describeError: DescribeError;
}

const STATES: { value: SiloState; key: string }[] = [
  { value: "empty", key: "production.silo.state.empty" },
  { value: "filling", key: "production.silo.state.filling" },
  { value: "full", key: "production.silo.state.full" },
  { value: "in_use", key: "production.silo.state.inUse" },
];

export default function SiloCorrectModal({ silo, onClose, onSaved, describeError }: Props) {
  const { t } = useLang();
  const [label, setLabel] = useState("");
  const [active, setActive] = useState(true);
  const [state, setState] = useState<SiloState>("empty");
  const [lotId, setLotId] = useState("");
  const [note, setNote] = useState("");
  const [lots, setLots] = useState<BeadLotRow[]>([]);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!silo) return;
    setLabel(silo.label);
    setActive(!!silo.active);
    setState(silo.state);
    setLotId(silo.lot_id ?? "");
    setNote("");
    setError(null);
    fetch("/v2/api/production/bead-lots?include_inactive=1")
      .then((r) => r.json())
      .then((d) => setLots(d.ok ? d.lots : []))
      .catch(() => setLots([]));
  }, [silo]);

  if (!silo) return null;

  const stateChanged = state !== silo.state || (state !== "empty" && lotId !== (silo.lot_id ?? ""));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!silo) return;
    const body: Record<string, unknown> = {};
    if (label.trim() !== silo.label) body.label = label.trim();
    if (active !== !!silo.active) body.active = active;
    if (stateChanged) {
      body.state = state;
      if (state !== "empty") body.lot_id = lotId || null;
      body.note = note.trim();
    }
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    setActing(true);
    setError(null);
    try {
      const res = await fetch(`/v2/api/production/manage/silos/${silo.silo_no}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok && data.silo) onSaved(data.silo);
      else setError(describeError(data.error, "production.silo.correctFailed"));
    } catch {
      setError(t("production.toast.networkError"));
    } finally {
      setActing(false);
    }
  }

  return (
    <Modal isOpen onClose={onClose} title={`${t("production.silo.correctTitle")} — ${silo.label}`}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block">
          <span className={LABEL_CLASS}>{t("production.silo.label")}</span>
          <input className={FIELD_CLASS} value={label} onChange={(e) => setLabel(e.target.value)} required />
        </label>
        <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
          <input
            type="checkbox"
            className="w-5 h-5 cursor-pointer"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <span className="text-sm text-text">{t("production.silo.active")}</span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={LABEL_CLASS}>{t("production.silo.stateLabel")}</span>
            <select
              className={FIELD_CLASS + " cursor-pointer"}
              value={state}
              onChange={(e) => setState(e.target.value as SiloState)}
            >
              {STATES.map((s) => (
                <option key={s.value} value={s.value}>
                  {t(s.key)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={LABEL_CLASS}>{t("production.field.lotNo")}</span>
            <select
              className={FIELD_CLASS + " cursor-pointer disabled:opacity-50"}
              value={state === "empty" ? "" : lotId}
              disabled={state === "empty"}
              onChange={(e) => setLotId(e.target.value)}
            >
              <option value="">{t("production.newSheet.selectPlaceholder")}</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.lot_no} · {l.bead_supplier} {l.bead_type}
                  {l.active ? "" : ` (${t("production.bead.inactive")})`}
                </option>
              ))}
            </select>
          </label>
        </div>
        {stateChanged && (
          <label className="block">
            <span className={LABEL_CLASS}>{t("production.silo.noteRequired")}</span>
            <textarea
              className={FIELD_CLASS + " py-2"}
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              required
            />
          </label>
        )}
        <FormError message={error} />
        <FormActions
          onCancel={onClose}
          acting={acting}
          submitKey="production.edit.save"
          actingKey="production.edit.saving"
          disabled={stateChanged && (!note.trim() || (state !== "empty" && !lotId))}
        />
      </form>
    </Modal>
  );
}
