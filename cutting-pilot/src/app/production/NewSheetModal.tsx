"use client";
// Create-session form for both boards. One component, variant prop — composes the shared
// Modal primitive rather than a hand-rolled overlay. Molding: single required Block type.
// Expansion: Supplier -> Bead type (filtered to that supplier), density, target weight, times.
// No silo, control #, or operators here — those moved onto the row (prod-a-02).
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";
import type { OptionsData } from "./fields";
import type { OptionKind } from "./AddOptionModal";

export type SheetVariant = "molding" | "expansion";

const ADD_NEW = "__add_new__";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  variant: SheetVariant;
  onSubmit: (fields: Record<string, string>) => void;
  acting: boolean;
  options: OptionsData;
  canManage: boolean;
  onRequestAddOption: (kind: OptionKind, supplier?: string) => void;
  injectedValue: { field: "block_type" | "bead_type"; value: string } | null;
  onInjectedApplied: () => void;
}

const FIELD_CLASS =
  "w-full min-h-[44px] px-3 rounded border border-border bg-bg text-text text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const LABEL_CLASS = "block text-xs font-semibold text-muted mb-1";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className={LABEL_CLASS}>{label}</span>
      {children}
    </label>
  );
}

export default function NewSheetModal({
  isOpen,
  onClose,
  variant,
  onSubmit,
  acting,
  options,
  canManage,
  onRequestAddOption,
  injectedValue,
  onInjectedApplied,
}: Props) {
  const { t } = useLang();
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!injectedValue) return;
    setFields((f) => ({ ...f, [injectedValue.field]: injectedValue.value }));
    onInjectedApplied();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injectedValue]);

  function set(key: string, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
  }

  function handleClose() {
    setFields({});
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(fields);
  }

  const beadTypeOptions = fields.bead_supplier ? options.bead_types[fields.bead_supplier] ?? [] : [];
  const canSubmit =
    variant === "molding" ? !!fields.block_type : !!fields.bead_supplier && !!fields.bead_type;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={variant === "molding" ? t("production.newSheet.titleMolding") : t("production.newSheet.titleExpansion")}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        {variant === "molding" ? (
          <Field label={t("production.newSheet.blockType")}>
            <select
              required
              className={FIELD_CLASS + " cursor-pointer"}
              value={fields.block_type ?? ""}
              onChange={(e) => {
                if (e.target.value === ADD_NEW) {
                  onRequestAddOption("block_type");
                  return;
                }
                set("block_type", e.target.value);
              }}
            >
              <option value="">{t("production.newSheet.selectPlaceholder")}</option>
              {options.block_types.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
              {canManage && <option value={ADD_NEW}>{t("production.options.addNew")}</option>}
            </select>
            {options.block_types.length === 0 && !canManage && (
              <p className="mt-1 text-xs text-muted">{t("production.options.emptyHint")}</p>
            )}
          </Field>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("production.newSheet.supplier")}>
                <select
                  required
                  className={FIELD_CLASS + " cursor-pointer"}
                  value={fields.bead_supplier ?? ""}
                  onChange={(e) => setFields((f) => ({ ...f, bead_supplier: e.target.value, bead_type: "" }))}
                >
                  <option value="">{t("production.newSheet.selectPlaceholder")}</option>
                  {options.suppliers.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("production.newSheet.beadType")}>
                <select
                  required
                  disabled={!fields.bead_supplier}
                  className={FIELD_CLASS + " cursor-pointer disabled:opacity-50"}
                  value={fields.bead_type ?? ""}
                  onChange={(e) => {
                    if (e.target.value === ADD_NEW) {
                      onRequestAddOption("bead_type", fields.bead_supplier);
                      return;
                    }
                    set("bead_type", e.target.value);
                  }}
                >
                  <option value="">{t("production.newSheet.selectPlaceholder")}</option>
                  {beadTypeOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                  {canManage && fields.bead_supplier && (
                    <option value={ADD_NEW}>{t("production.options.addNew")}</option>
                  )}
                </select>
                {beadTypeOptions.length === 0 && !canManage && fields.bead_supplier && (
                  <p className="mt-1 text-xs text-muted">{t("production.options.emptyHint")}</p>
                )}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("production.newSheet.startTime")}>
                <input
                  type="text"
                  placeholder="9:30 AM"
                  className={FIELD_CLASS}
                  value={fields.start_time ?? ""}
                  onChange={(e) => set("start_time", e.target.value)}
                />
              </Field>
              <Field label={t("production.newSheet.finishTime")}>
                <input
                  type="text"
                  placeholder="11:00 AM"
                  className={FIELD_CLASS}
                  value={fields.finish_time ?? ""}
                  onChange={(e) => set("finish_time", e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("production.newSheet.density")}>
                <input
                  type="number"
                  step="any"
                  className={FIELD_CLASS}
                  value={fields.density ?? ""}
                  onChange={(e) => set("density", e.target.value)}
                />
              </Field>
              <Field label={t("production.newSheet.targetWeightG")}>
                <input
                  type="number"
                  step="any"
                  className={FIELD_CLASS}
                  value={fields.target_weight_g ?? ""}
                  onChange={(e) => set("target_weight_g", e.target.value)}
                />
              </Field>
            </div>
          </>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {t("production.common.cancel")}
          </button>
          <button
            type="submit"
            disabled={acting || !canSubmit}
            className="min-h-[44px] px-4 py-2 bg-[var(--brand)] text-white rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {acting ? t("production.newSheet.starting") : t("production.newSheet.start")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
