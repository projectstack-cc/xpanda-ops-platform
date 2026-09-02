"use client";
// src/components/orders/AddressCorrectionModal.tsx
// P430 — ship-to correction prompt for /v2/orders. Composes the shared <Modal>. Shows the
// entered address beside the USPS-standardized suggestion (from Lob via /api/address/validate);
// the operator picks one. Ported 1:1 from jobs/index.html's openAddressCorrectionModal().
import Modal from "@/components/Modal";

export interface AddressParts {
  street?: string;
  street2?: string;
  city?: string;
  state?: string;
  zip?: string;
}

interface Props {
  isOpen: boolean;
  entered: AddressParts;
  standardized: AddressParts;
  onUse: () => void;
  onKeep: () => void;
}

function lines(a: AddressParts): string[] {
  return [
    [a.street, a.street2].filter(Boolean).join(" "),
    [a.city, a.state, a.zip].filter(Boolean).join(", "),
  ].filter(Boolean);
}

function AddrBlock({ label, a }: { label: string; a: AddressParts }) {
  const ls = lines(a);
  return (
    <div className="rounded-md border border-[var(--card-border)] p-3">
      <div className="text-xs font-semibold text-muted mb-1">{label}</div>
      {ls.length ? (
        ls.map((l, i) => (
          <div key={i} className="text-sm text-text">
            {l}
          </div>
        ))
      ) : (
        <div className="text-sm text-muted">—</div>
      )}
    </div>
  );
}

export default function AddressCorrectionModal({ isOpen, entered, standardized, onUse, onKeep }: Props) {
  return (
    <Modal isOpen={isOpen} onClose={onKeep} title="Verify ship-to address" size="lg">
      <p className="text-sm text-muted">USPS suggested a standardized address. Which do you want to save?</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <AddrBlock label="As entered" a={entered} />
        <AddrBlock label="Suggested" a={standardized} />
      </div>
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onKeep}
          className="min-h-[44px] px-5 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)]"
        >
          Keep as entered
        </button>
        <button
          type="button"
          onClick={onUse}
          className="min-h-[44px] px-5 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90"
        >
          Use suggested
        </button>
      </div>
    </Modal>
  );
}
