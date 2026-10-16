"use client";
// src/components/loading/tablet/DockBayPicker.tsx
// dock-10: full-screen "Which bays is this tablet at?" overlay for /v2/dock (approved mockup --
// deliberately not the generic Modal). Display-only choice; the page persists it to localStorage
// + the URL and never writes D1. Same selection rules as dock-08: tap toggles, a third pick
// replaces the oldest. With canCancel false (no pair yet) Escape/backdrop do nothing.
import { useEffect, useState } from "react";
import type { DockBay } from "../dockTypes";
import { DOCK_TABLET as P } from "./palette";

interface DockBayPickerProps {
  bays: DockBay[];
  initial: number[];
  canCancel: boolean;
  onConfirm: (bayNumbers: number[]) => void;
  onClose: () => void;
}

export default function DockBayPicker({ bays, initial, canCancel, onConfirm, onClose }: DockBayPickerProps) {
  const activeBays = bays.filter((b) => b.is_active);
  const [selected, setSelected] = useState<number[]>(() =>
    initial.filter((n) => activeBays.some((b) => b.bay_number === n)).slice(0, 2)
  );

  useEffect(() => {
    if (!canCancel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [canCancel, onClose]);

  function toggle(n: number) {
    setSelected((prev) => {
      if (prev.includes(n)) return prev.filter((x) => x !== n);
      if (prev.length < 2) return [...prev, n];
      return [prev[1], n];
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: P.pickerBackdrop }}
      onClick={canCancel ? onClose : undefined}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dock-bay-picker-title"
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col overflow-y-auto"
        style={{
          width: 820,
          maxWidth: "calc(100vw - 32px)",
          maxHeight: "calc(100dvh - 32px)",
          background: P.surface,
          borderRadius: 20,
          padding: 32,
          gap: 24,
          boxShadow: "var(--shadow-md)",
        }}
      >
        <div>
          <h2 id="dock-bay-picker-title" className="font-bold" style={{ fontSize: 30, color: P.ink, margin: 0 }}>
            Which bays is this tablet at?
          </h2>
          <p style={{ fontSize: 17, color: P.muted, margin: "6px 0 0" }}>
            Pick one or two. This only changes what this screen shows.
          </p>
        </div>

        <div className="grid" style={{ gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 12 }}>
          {activeBays.map((b) => {
            const idx = selected.indexOf(b.bay_number);
            const on = idx >= 0;
            return (
              <button
                key={b.id}
                type="button"
                aria-pressed={on}
                aria-label={`Bay ${b.bay_number}`}
                onClick={() => toggle(b.bay_number)}
                className="flex flex-col items-center justify-center cursor-pointer"
                style={{
                  height: 96,
                  borderRadius: 14,
                  background: on ? P.pickerSelectedBg : P.pickerTileBg,
                  border: `2px solid ${on ? P.pickerSelectedBg : P.btnBorder}`,
                  color: on ? P.pickerSelectedInk : P.pickerTileInk,
                }}
              >
                <span className="font-mono font-bold" style={{ fontSize: 34, lineHeight: 1 }}>
                  {b.bay_number}
                </span>
                {on && (
                  <span style={{ fontSize: 13, color: P.pickerCaption, marginTop: 4 }}>
                    {idx === 0 ? "Left" : "Right"}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div
          className="flex items-center justify-between flex-wrap gap-3"
          style={{ borderTop: `1px solid ${P.cardBorder}`, paddingTop: 20 }}
        >
          <div style={{ fontSize: 17, color: P.ink }}>
            Showing{" "}
            {selected.length === 0 ? (
              <span style={{ color: P.muted }}>no bays yet</span>
            ) : (
              selected.map((n, i) => (
                <span key={n}>
                  {i > 0 && " · "}
                  <strong>Bay {n}</strong>
                </span>
              ))
            )}
          </div>
          <div className="flex gap-3">
            {canCancel && (
              <button
                type="button"
                onClick={onClose}
                className="font-semibold cursor-pointer"
                style={{
                  height: 56,
                  padding: "0 24px",
                  borderRadius: 10,
                  background: P.surface,
                  color: P.ink,
                  border: `1px solid ${P.btnBorder}`,
                  fontSize: 17,
                }}
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={() => selected.length > 0 && onConfirm(selected)}
              disabled={selected.length === 0}
              className="font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default"
              style={{
                height: 56,
                padding: "0 24px",
                borderRadius: 10,
                background: P.pickerSelectedBg,
                color: P.pickerSelectedInk,
                fontSize: 17,
              }}
            >
              Show these bays
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
