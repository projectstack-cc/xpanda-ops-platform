"use client";
// Manager-only "+ Add new…" flow for a managed dropdown value (block type, block size, bead
// type). One component parameterized by `kind` (+ `supplier` context for bead_type) — do not
// build three near-identical modals. POST manage/options; a 409 option_exists is treated as
// success (the value already exists — just select it), matching the API's own contract.
import { useState } from "react";
import Modal from "@/components/Modal";
import { useLang } from "@/components/lang";

export type OptionKind = "block_type" | "block_size" | "bead_type";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  kind: OptionKind;
  supplier?: string;
  onAdded: (value: string) => void;
}

const TITLE_KEY: Record<OptionKind, string> = {
  block_type: "production.addOption.titleBlockType",
  block_size: "production.addOption.titleBlockSize",
  bead_type: "production.addOption.titleBeadType",
};

const FIELD_CLASS =
  "w-full min-h-[44px] px-3 rounded border border-border bg-bg text-text text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
const LABEL_CLASS = "block text-xs font-semibold text-muted mb-1";

export default function AddOptionModal({ isOpen, onClose, kind, supplier, onAdded }: Props) {
  const { t } = useLang();
  const [value, setValue] = useState("");
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleClose() {
    setValue("");
    setError(null);
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setActing(true);
    setError(null);
    try {
      const res = await fetch("/v2/api/production/manage/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, value, grp: kind === "bead_type" ? supplier : undefined }),
      });
      const data = await res.json();
      if (data.ok) {
        onAdded(data.value ?? value);
        setValue("");
        onClose();
      } else if (res.status === 409 && data.error === "option_exists") {
        onAdded(data.value ?? value);
        setValue("");
        onClose();
      } else {
        setError(t("production.toast.addOptionFailed"));
      }
    } catch {
      setError(t("production.toast.networkError"));
    } finally {
      setActing(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t(TITLE_KEY[kind])}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {kind === "bead_type" && supplier && (
          <p className="text-sm text-muted">
            {t("production.newSheet.supplier")}: <span className="text-text font-medium">{supplier}</span>
          </p>
        )}
        <label className="block">
          <span className={LABEL_CLASS}>{t("production.addOption.value")}</span>
          <input
            type="text"
            autoFocus
            required
            className={FIELD_CLASS}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        {error && <p className="text-sm text-[var(--danger-bg)]">{error}</p>}
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
            disabled={acting || !value.trim()}
            className="min-h-[44px] px-4 py-2 bg-[var(--brand)] text-white rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {acting ? t("production.addOption.submitting") : t("production.addOption.submit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
