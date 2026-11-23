"use client";
// Stop modal for the chunk board. cc (cc-blocks-01): "Blocks used this run" — the operator enters the
// block IDs (optional; the count is the number of IDs) and onSubmit sends { block_ids }.
// hc: "Holed this run" + required on-hand count (unchanged).
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import type { Board } from "./ChunkBoard";
import BlockIdInput from "./BlockIdInput";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  variant: Board;
  label: string;
  currentOnHand?: number;
  sizeText?: string | null;
  existingBlockIds?: string[];
  blockPrefix: string;
  onBlockPrefixChange: (prefix: string) => void;
  onSubmit: (values: { block_ids?: string[]; holed_delta?: number; on_hand?: number }) => void;
  acting: boolean;
}

export default function ChunkStopModal({
  isOpen,
  onClose,
  variant,
  label,
  currentOnHand,
  sizeText,
  existingBlockIds,
  blockPrefix,
  onBlockPrefixChange,
  onSubmit,
  acting,
}: Props) {
  const [blockIds, setBlockIds] = useState<string[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [holed, setHoled] = useState("");
  const [onHand, setOnHand] = useState("");

  useEffect(() => {
    if (isOpen) {
      setBlockIds([]);
      setPendingId(null);
      setHoled("");
      setOnHand(currentOnHand != null ? String(currentOnHand) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const onHandInvalid = variant === "hc" && (onHand === "" || isNaN(parseInt(onHand, 10)) || parseInt(onHand, 10) < 0);

  function handleSubmit() {
    if (variant === "cc") {
      // A valid ID typed but not yet added is included (operator tapped Stop without Add).
      onSubmit({ block_ids: pendingId ? [...blockIds, pendingId] : blockIds });
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
          <>
            {sizeText && <p className="-mt-2 text-sm text-muted">{sizeText}</p>}
            {isOpen && (
              <BlockIdInput
                id="stop-block-ids"
                label="Blocks used this run"
                optional
                value={blockIds}
                onChange={setBlockIds}
                existing={existingBlockIds}
                prefix={blockPrefix}
                onPrefixChange={onBlockPrefixChange}
                onPendingChange={setPendingId}
              />
            )}
          </>
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
