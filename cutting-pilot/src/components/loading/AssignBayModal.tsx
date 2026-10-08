"use client";
// src/components/loading/AssignBayModal.tsx
// Ports legacy's "Assign to Bay" modal (openAssignBayModal/confirmAssignBay). Manager-only,
// called from an awaiting card's "Assign to bay" button.
import { useState } from "react";
import Modal from "@/components/Modal";
import type { DockBay } from "./dockTypes";

interface AssignBayModalProps {
  bays: DockBay[];
  onClose: () => void;
  onConfirm: (bayId: string) => void;
}

export default function AssignBayModal({ bays, onClose, onConfirm }: AssignBayModalProps) {
  const [bayId, setBayId] = useState(bays[0]?.id ?? "");

  return (
    <Modal isOpen onClose={onClose} title="Assign to bay">
      <label className="block text-xs font-semibold text-text">
        Select bay
        <select
          value={bayId}
          onChange={(e) => setBayId(e.target.value)}
          className="mt-1 w-full min-h-[44px] px-3 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm"
        >
          {bays.map((b) => (
            <option key={b.id} value={b.id}>
              Bay {b.bay_number}
              {b.label && b.label !== `Bay ${b.bay_number}` ? ` — ${b.label}` : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] px-4 rounded border border-[var(--card-border)] bg-[var(--card-bg)] text-sm font-semibold text-text cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => bayId && onConfirm(bayId)}
          disabled={!bayId}
          className="min-h-[44px] px-4 rounded bg-[var(--primary-bg)] text-[var(--primary-text)] text-sm font-semibold cursor-pointer disabled:opacity-50"
        >
          Assign
        </button>
      </div>
    </Modal>
  );
}
