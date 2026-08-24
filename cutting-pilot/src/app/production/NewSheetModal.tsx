"use client";
// Create-session form for both boards. One component, variant prop — composes the shared
// Modal primitive rather than a hand-rolled overlay.
import { useState } from "react";
import Modal from "@/components/Modal";

export type SheetVariant = "molding" | "expansion";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  variant: SheetVariant;
  onSubmit: (fields: Record<string, string>) => void;
  acting: boolean;
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

export default function NewSheetModal({ isOpen, onClose, variant, onSubmit, acting }: Props) {
  const [fields, setFields] = useState<Record<string, string>>({});

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

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={variant === "molding" ? "New Molding sheet" : "New Expansion sheet"}
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Silo">
            <input
              type="number"
              className={FIELD_CLASS}
              value={fields.silo ?? ""}
              onChange={(e) => set("silo", e.target.value)}
            />
          </Field>
          <Field label="Control #">
            <input
              type="text"
              className={FIELD_CLASS}
              value={fields.control_no ?? ""}
              onChange={(e) => set("control_no", e.target.value)}
            />
          </Field>
        </div>

        {variant === "expansion" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start time">
                <input
                  type="text"
                  placeholder="9:30 AM"
                  className={FIELD_CLASS}
                  value={fields.start_time ?? ""}
                  onChange={(e) => set("start_time", e.target.value)}
                />
              </Field>
              <Field label="Finish time">
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
              <Field label="Density">
                <input
                  type="number"
                  step="any"
                  className={FIELD_CLASS}
                  value={fields.density ?? ""}
                  onChange={(e) => set("density", e.target.value)}
                />
              </Field>
              <Field label="Weight (g)">
                <input
                  type="number"
                  step="any"
                  className={FIELD_CLASS}
                  value={fields.target_weight_g ?? ""}
                  onChange={(e) => set("target_weight_g", e.target.value)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bead type">
                <input
                  type="text"
                  className={FIELD_CLASS}
                  value={fields.bead_type ?? ""}
                  onChange={(e) => set("bead_type", e.target.value)}
                />
              </Field>
              <Field label="Lot">
                <input
                  type="text"
                  className={FIELD_CLASS}
                  value={fields.lot ?? ""}
                  onChange={(e) => set("lot", e.target.value)}
                />
              </Field>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Operator 1">
            <input
              type="text"
              className={FIELD_CLASS}
              value={fields.operator_1 ?? ""}
              onChange={(e) => set("operator_1", e.target.value)}
            />
          </Field>
          <Field label="Operator 2">
            <input
              type="text"
              className={FIELD_CLASS}
              value={fields.operator_2 ?? ""}
              onChange={(e) => set("operator_2", e.target.value)}
            />
          </Field>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={acting}
            className="min-h-[44px] px-4 py-2 bg-[var(--brand)] text-white rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {acting ? "Starting…" : "Start sheet"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
