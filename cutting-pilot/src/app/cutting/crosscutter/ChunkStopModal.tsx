"use client";
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import type { Board } from "./ChunkBoard";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  variant: Board;
  label: string;
  currentOnHand?: number;
  onSubmit: (values: { qty_done_delta?: number; holed_delta?: number; on_hand?: number }) => void;
  acting: boolean;
}

export default function ChunkStopModal({
  isOpen,
  onClose,
  variant,
  label,
  currentOnHand,
  onSubmit,
  acting,
}: Props) {
  const [qtyDone, setQtyDone] = useState("");
  const [holed, setHoled] = useState("");
  const [onHand, setOnHand] = useState("");

  useEffect(() => {
    if (isOpen) {
      setQtyDone("");
      setHoled("");
      setOnHand(currentOnHand != null ? String(currentOnHand) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const onHandInvalid = variant === "hc" && (onHand === "" || isNaN(parseInt(onHand, 10)) || parseInt(onHand, 10) < 0);

  function handleSubmit() {
    if (variant === "cc") {
      const n = parseInt(qtyDone, 10);
      onSubmit({ qty_done_delta: !isNaN(n) && n > 0 ? n : 0 });
    } else {
      const h = parseInt(holed, 10);
      const oh = parseInt(onHand, 10);
      onSubmit({
        holed_delta: !isNaN(h) && h > 0 ? h : 0,
        on_hand: !isNaN(oh) && oh >= 0 ? oh : 0,
      });
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Stop — ${label}`}>
      <div className="space-y-4">
        {variant === "cc" ? (
          <div>
            <label htmlFor="stop-qty-done" className="block text-sm font-medium text-text mb-1">
              Chunks done this run
              <span className="ml-1 text-xs text-muted font-normal">(optional)</span>
            </label>
            <input
              id="stop-qty-done"
              type="number"
              min="0"
              inputMode="numeric"
              value={qtyDone}
              onChange={(e) => setQtyDone(e.target.value)}
              placeholder="0"
              className="w-28 min-h-[44px] rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            />
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="stop-holed" className="block text-sm font-medium text-text mb-1">
                Holed this run
                <span className="ml-1 text-xs text-muted font-normal">(optional)</span>
              </label>
              <input
                id="stop-holed"
                type="number"
                min="0"
                inputMode="numeric"
                value={holed}
                onChange={(e) => setHoled(e.target.value)}
                placeholder="0"
                className="w-28 min-h-[44px] rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
            <div>
              <label htmlFor="stop-on-hand" className="block text-sm font-medium text-text mb-1">
                Current on-hand finished
                <span className="ml-1 text-xs text-muted font-normal">(required — physical count)</span>
              </label>
              <input
                id="stop-on-hand"
                type="number"
                min="0"
                inputMode="numeric"
                value={onHand}
                onChange={(e) => setOnHand(e.target.value)}
                className="w-28 min-h-[44px] rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              />
            </div>
          </>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            disabled={acting || onHandInvalid}
            title={onHandInvalid ? "Enter the current on-hand finished count." : undefined}
            onClick={handleSubmit}
            className="flex-1 min-h-[44px] bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {acting ? "Saving…" : "Stop"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
