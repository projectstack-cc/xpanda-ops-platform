"use client";
// Complete modal for the chunk board. cc (cc-blocks-01, replaces cc-complete-01's number input): the
// operator enters the block IDs used this run ("Blocks used this run"); the count is the number of IDs
// and onSubmit sends { block_ids }. No max — block yield can beat target_chunks (over-target is only
// an info note). An empty list is allowed only when blocks were already logged on earlier Stops
// (qty_done > 0); the server enforces the same rule (block_ids_required). hc: plain confirm, counts stay.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import type { Board } from "./ChunkBoard";
import BlockIdInput from "./BlockIdInput";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  variant: Board;
  label: string;
  qtyDone?: number;
  targetChunks?: number;
  sizeText?: string | null;
  existingBlockIds?: string[];
  blockPrefix: string;
  onBlockPrefixChange: (prefix: string) => void;
  onSubmit: (values: { block_ids?: string[] }) => void;
  acting: boolean;
}

export default function ChunkCompleteModal({
  isOpen,
  onClose,
  variant,
  label,
  qtyDone,
  targetChunks,
  sizeText,
  existingBlockIds,
  blockPrefix,
  onBlockPrefixChange,
  onSubmit,
  acting,
}: Props) {
  const [blockIds, setBlockIds] = useState<string[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setBlockIds([]);
      setPendingId(null);
    }
  }, [isOpen]);

  // A valid ID typed but not yet added counts (operator tapped Complete without Add).
  const ids = pendingId ? [...blockIds, pendingId] : blockIds;
  const done = qtyDone ?? 0;
  const target = targetChunks ?? 0;
  const over = target > 0 ? done + ids.length - target : 0;
  const needsIds = variant === "cc" && ids.length === 0 && done === 0;
  const disabled = acting || needsIds;

  function handleSubmit() {
    if (variant === "cc") {
      if (needsIds) return;
      onSubmit({ block_ids: ids });
    } else {
      onSubmit({});
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={variant === "hc" ? "Complete run" : `Complete — ${label}`}>
      <div className="space-y-4">
        {variant === "cc" ? (
          <div>
            {sizeText && <p className="-mt-2 mb-3 text-sm text-muted">{sizeText}</p>}
            {isOpen && (
              <BlockIdInput
                id="complete-block-ids"
                label="Blocks used this run"
                value={blockIds}
                onChange={setBlockIds}
                existing={existingBlockIds}
                prefix={blockPrefix}
                onPrefixChange={onBlockPrefixChange}
                onPendingChange={setPendingId}
              />
            )}
            <p className="mt-1.5 text-xs text-muted tabular-nums">
              {target > 0 ? `So far: ${done} of ${target}` : `So far: ${done}`}
            </p>
            {over > 0 && (
              <p
                role="status"
                className="mt-2 rounded border border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info-text)] px-3 py-2 text-xs tabular-nums"
              >
                That&apos;s {over} over the {target} assigned — it&apos;ll be recorded as cut.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-text">
            Complete just ends your run on <span className="font-semibold">{label}</span> —
            counts stay.
          </p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={disabled}
            title={needsIds ? "Enter the block IDs you used." : undefined}
            onClick={handleSubmit}
            className="min-h-[44px] px-4 py-2 bg-[var(--success-bg)] text-[var(--success-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {acting ? "Saving…" : "Complete"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
