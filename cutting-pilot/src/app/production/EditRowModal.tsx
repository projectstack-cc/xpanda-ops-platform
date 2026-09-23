"use client";
// Edit form for one Molding block / Expansion batch row. One component, variant prop — same
// field definitions (fields.ts) the append row uses, composing the shared Modal primitive.
// Only `editable` fields render (operator is display-only, never editable here).
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";
import { type RowFieldDef } from "./fields";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  size?: "md" | "lg" | "xl";
  fields: RowFieldDef[];
  optionValues: Record<string, string[]>;
  initialValues: Record<string, string>;
  onSubmit: (values: Record<string, string>) => void;
  acting: boolean;
}

const FIELD_CLASS =
  "w-full min-h-[44px] px-3 rounded border border-border bg-bg text-text text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const LABEL_CLASS = "block text-xs font-semibold text-muted mb-1";

export default function EditRowModal({
  isOpen,
  onClose,
  title,
  size = "md",
  fields,
  optionValues,
  initialValues,
  onSubmit,
  acting,
}: Props) {
  const { t } = useLang();
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  const editableFields = fields.filter((f) => f.editable);

  useEffect(() => {
    if (isOpen) setValues(initialValues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function set(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(values);
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size={size}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {editableFields.map((f) => (
            <label key={f.key} className="block">
              <span className={LABEL_CLASS}>{t(f.labelKey)}</span>
              {f.input === "select" ? (
                <select
                  className={FIELD_CLASS + " cursor-pointer"}
                  value={values[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                >
                  <option value="">{t("production.newSheet.selectPlaceholder")}</option>
                  {(optionValues[f.optionsKey ?? ""] ?? []).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={f.input}
                  step={f.input === "number" ? "any" : undefined}
                  placeholder={f.placeholder}
                  className={FIELD_CLASS}
                  value={values[f.key] ?? ""}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
            </label>
          ))}
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {t("production.common.cancel")}
          </button>
          <button
            type="submit"
            disabled={acting}
            className="min-h-[44px] px-4 py-2 bg-[var(--brand)] text-white rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {acting ? t("production.edit.saving") : t("production.edit.save")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
