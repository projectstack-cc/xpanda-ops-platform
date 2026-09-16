"use client";
// src/components/logistics/SaveLoadModal.tsx
// lb-ui-04 Part C (react-component-agent §9b). Name-prompt for saving the current Load Builder
// state. Legacy uses window.prompt() (load-builder.html:2808) -- not ported: this session's own
// system prompt disallows triggering browser dialogs, and lb-ui-10 already established the same
// call for delete confirmation in this sprint. A real modal instead.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";

interface Props {
  isOpen: boolean;
  defaultName: string;
  isUpdate: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (name: string) => void;
}

const inputClass =
  "w-full min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";

export default function SaveLoadModal({ isOpen, defaultName, isUpdate, saving, error, onClose, onSave }: Props) {
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    if (isOpen) setName(defaultName);
  }, [isOpen, defaultName]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={isUpdate ? "Update saved load" : "Save load"}>
      <div className="space-y-3">
        {error && <p className="text-sm text-[var(--danger-text)]">{error}</p>}
        <label className="block space-y-1">
          <span className="block text-xs font-semibold text-muted">Name</span>
          <input
            type="text"
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultName}
            autoFocus
          />
        </label>
        {isUpdate && (
          <p className="text-xs text-muted">
            This replaces the previously saved version under the same name/id — a new save under a different name creates a separate entry instead.
          </p>
        )}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer border border-[var(--border)] text-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(name)}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg text-[13px] font-semibold min-h-[36px] cursor-pointer bg-[var(--brand)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : isUpdate ? "Update" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
