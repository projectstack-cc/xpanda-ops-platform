"use client";
// src/components/board/CoreCoverLabelsModal.tsx
// jb-12 — Core Covers bag labels (4 pcs/bag default, editable per line (jb-13)) for the v2 board.
// Thin wrapper over LabelChecklistModal; the PDF is bagLabels.ts (the Block Calculator's P413/P417
// generator) fed by the coreCoverLabels.ts job-line adapter. Bag numbering stays whole-order under
// any selection. jb-13: pcs/bag lives in this dialog only — not saved, every open starts at 4.
import { useEffect, useMemo, useState } from "react";
import LabelChecklistModal from "@/components/board/LabelChecklistModal";
import {
  buildBagLabelsPdf,
  DEFAULT_PIECES_PER_BAG,
  densityString,
  InvalidPiecesPerBagError,
  isValidPiecesPerBag,
  sizeString,
  UnparsedRowsError,
} from "@/lib/bagLabels";
import { coreCoverSkuLines, type CoreCoverLineItem } from "@/lib/coreCoverLabels";

interface CoreCoverLabelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  lineItems: CoreCoverLineItem[];
  /** Used for the download filename: core-covers-labels-<fileKey>.pdf (invoice number or job id). */
  fileKey: string;
}

const PER_BAG_ERROR = "Pieces per bag must be a whole number from 1 to 999.";

/** jb-13: raw input text → pieces per bag, or NaN when it isn't a plain whole number. */
function parsePerBag(raw: string): number {
  const t = raw.trim();
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

const perBagInput =
  "w-16 min-h-[44px] rounded-md border bg-[var(--input-bg)] text-text text-sm px-2 font-mono tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
const ghostBtn =
  "min-h-[44px] px-4 rounded-md border border-[var(--input-border)] text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 disabled:cursor-not-allowed";

export default function CoreCoverLabelsModal({ isOpen, onClose, lineItems, fileKey }: CoreCoverLabelsModalProps) {
  const skuLines = useMemo(() => coreCoverSkuLines(lineItems), [lineItems]);
  const [perBag, setPerBag] = useState<string[]>([]);
  const [setAllText, setSetAllText] = useState("");

  // jb-13: every open starts at the default (matches the checklist's own per-open reset). Also reset
  // on close, so a reopen never flashes the previous values for a frame.
  useEffect(() => {
    setPerBag(lineItems.map(() => String(DEFAULT_PIECES_PER_BAG)));
    setSetAllText("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const perBagValue = (i: number) => parsePerBag(perBag[i] ?? String(DEFAULT_PIECES_PER_BAG));
  const setAllValue = parsePerBag(setAllText);
  const setAllValid = isValidPiecesPerBag(setAllValue);

  return (
    <LabelChecklistModal
      isOpen={isOpen}
      onClose={onClose}
      items={lineItems}
      rowLabel={(_, i) => {
        const s = skuLines[i];
        if (!s?.parsed) return s?.item || "Untitled";
        return `${s.item} · ${sizeString(s)} · ${densityString(s)}`;
      }}
      rowQty={(li) => Number(li.quantity) || 0}
      rowWarning={(_, i) =>
        skuLines[i]?.parsed ? null : "Couldn't read size/density — fix this order line before printing."
      }
      rowExtra={(li, i) => {
        const v = perBagValue(i);
        const valid = isValidPiecesPerBag(v);
        const qty = Number(li.quantity) || 0;
        const bags = valid ? Math.ceil(qty / v) : 0;
        return (
          <div className="flex items-center gap-2 shrink-0 text-sm">
            <input
              type="text"
              inputMode="numeric"
              aria-label={`Pieces per bag for ${skuLines[i]?.item || "Untitled"}`}
              value={perBag[i] ?? ""}
              onChange={(e) => {
                const t = e.target.value;
                setPerBag((prev) => prev.map((p, j) => (j === i ? t : p)));
              }}
              className={`${perBagInput} ${valid ? "border-[var(--input-border)]" : "border-[var(--warn-border)]"}`}
            />
            <span className="text-muted">pcs/bag</span>
            <span className="text-muted font-mono tabular-nums w-20">
              → {valid ? `${bags} bag${bags === 1 ? "" : "s"}` : "—"}
            </span>
          </div>
        );
      }}
      headerExtra={
        <div className="flex items-center gap-2 text-sm text-text">
          <span>Set all to</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label="Pieces per bag for all lines"
            value={setAllText}
            onChange={(e) => setSetAllText(e.target.value)}
            className={`${perBagInput} ${setAllText === "" || setAllValid ? "border-[var(--input-border)]" : "border-[var(--warn-border)]"}`}
          />
          <span className="text-muted">pcs/bag</span>
          <button
            type="button"
            disabled={!setAllValid}
            onClick={() => setPerBag(lineItems.map(() => String(setAllValue)))}
            className={ghostBtn}
          >
            Apply
          </button>
        </div>
      }
      printStatus={(selected) => {
        let blocked = false;
        let labels = 0;
        selected.forEach((sel, i) => {
          if (!sel) return;
          const qty = skuLines[i]?.qty ?? 0;
          if (qty <= 0) return;
          const v = perBagValue(i);
          if (!isValidPiecesPerBag(v)) blocked = true;
          else labels += Math.ceil(qty / v);
        });
        return {
          blocked: blocked ? PER_BAG_ERROR : null,
          summary: blocked ? undefined : `Prints ${labels} label${labels === 1 ? "" : "s"}`,
        };
      }}
      buildPdf={(selected) => {
        const onlyLines = new Set<number>();
        selected.forEach((s, i) => { if (s) onlyLines.add(i); });
        // jb-13: an unselected line's invalid entry is not blocked by the UI, so it falls back to the
        // default for whole-order numbering instead of failing the build.
        const piecesPerBag = perBag.map((_, i) => {
          const v = perBagValue(i);
          return selected[i] || isValidPiecesPerBag(v) ? v : undefined;
        });
        return buildBagLabelsPdf(skuLines, { onlyLines, piecesPerBag });
      }}
      errorMessage={(e) =>
        e instanceof UnparsedRowsError
          ? "Can't print — these lines couldn't be read: " + e.rows.map((r) => r.item || r.raw).join(", ")
          : e instanceof InvalidPiecesPerBagError
            ? PER_BAG_ERROR
            : "Couldn't generate the labels. Please try again."
      }
      filename={`core-covers-labels-${fileKey}.pdf`}
      viewerTitle="Core Covers labels"
    />
  );
}
