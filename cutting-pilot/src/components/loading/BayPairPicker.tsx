"use client";
// src/components/loading/BayPairPicker.tsx
// dock-08: chooses which 1 or 2 bays a dock tablet's Bay Pair view shows. Display-only choice
// (the host persists it to localStorage + the URL) -- never writes to D1, so no permission gate.
// Composes the shared Modal primitive.
import { useState } from "react";
import Modal from "@/components/Modal";
import type { DockBay } from "./dockTypes";

interface BayPairPickerProps {
  bays: DockBay[];
  initial: number[];
  canCancel: boolean;
  onConfirm: (bayNumbers: number[]) => void;
  onClose: () => void;
}

export default function BayPairPicker({ bays, initial, canCancel, onConfirm, onClose }: BayPairPickerProps) {
  const activeBays = bays.filter((b) => b.is_active);
  const [selected, setSelected] = useState<number[]>(() =>
    initial.filter((n) => activeBays.some((b) => b.bay_number === n)).slice(0, 2)
  );

  // Tap toggles; a third pick replaces the oldest of the two.
  function toggle(n: number) {
    setSelected((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      if (prev.length < 2) return [...prev, n];
      return [prev[1], n];
    });
  }

  // First run (no pair yet): closing would leave the tablet blank, so Escape/backdrop/X no-op.
  const handleClose = canCancel ? onClose : () => {};

  return (
    <Modal isOpen onClose={handleClose} title="Choose bays for this screen">
      <p className="text-sm text-muted">Pick one or two bays.</p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {activeBays.map((b) => {
          const on = selected.includes(b.bay_number);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => toggle(b.bay_number)}
              aria-pressed={on}
              className="min-h-[56px] rounded border text-base font-bold cursor-pointer transition-colors"
              style={
                on
                  ? { background: "var(--accent)", color: "var(--bg)", borderColor: "var(--accent)" }
                  : { background: "var(--surface-2)", color: "var(--text)", borderColor: "var(--line)" }
              }
            >
              Bay {b.bay_number}
            </button>
          );
        })}
      </div>
      <p className="text-sm text-text">
        Selected: {selected.length === 0 ? "none" : selected.map((n) => `Bay ${n}`).join(" · ")}
      </p>
      <div className="flex justify-end gap-2 pt-2">
        {canCancel && (
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 rounded border border-[var(--card-border)] bg-[var(--card-bg)] text-sm font-semibold text-text cursor-pointer"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={() => selected.length > 0 && onConfirm(selected)}
          disabled={selected.length === 0}
          className="min-h-[44px] px-4 rounded bg-[var(--primary-bg)] text-[var(--primary-text)] text-sm font-semibold cursor-pointer disabled:opacity-50"
        >
          Show these bays
        </button>
      </div>
    </Modal>
  );
}
