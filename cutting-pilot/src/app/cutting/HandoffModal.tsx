"use client";
import { useState, useEffect } from "react";
import Modal from "@/components/Modal";
import CuttingScrapSection, {
  CuttingScrapProblems,
  CuttingScrapSaveError,
  cuttingScrapProblems,
  draftHasEntries,
  emptyCuttingScrapDraft,
  toCuttingScrapEntries,
  type CuttingScrapDraft,
} from "@/components/qc/CuttingScrapSection";
import { postCuttingScrap } from "@/lib/qc/scrapClient";
import type { CuttingLineItem } from "./types";

const SCRAP_LINES = ["Main Line", "Blue Line"];

interface UncheckedItem {
  id: string;
  label: string;
  orderedQty: number | null;
  completedQty: number | null;
}

interface Props {
  lineLabel: string;
  items: UncheckedItem[];
  // qc-05: optional scrap capture — posted to /v2/api/cutting/scrap before onSubmit runs.
  // lineItems is ALL of the job's items (not just the unchecked `items`).
  jobId: string;
  invoice: string;
  lineItems: CuttingLineItem[];
  operatorName: string;
  onScrapResult?: (count: number, skipped: boolean) => void;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    note: string,
    photo: File | null,
    itemQtys: { line_item_id: string; completed_qty: number }[]
  ) => void;
  acting: boolean;
}

export default function HandoffModal({
  lineLabel,
  items,
  jobId,
  invoice,
  lineItems,
  operatorName,
  onScrapResult,
  isOpen,
  onClose,
  onSubmit,
  acting,
}: Props) {
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [scrap, setScrap] = useState<CuttingScrapDraft>(() => emptyCuttingScrapDraft());
  const [scrapError, setScrapError] = useState<string | null>(null);
  const [scrapBusy, setScrapBusy] = useState(false);
  const [showScrapProblems, setShowScrapProblems] = useState(false);
  const scrapEnabled = !!jobId && SCRAP_LINES.includes(lineLabel);
  const scrapProblems = cuttingScrapProblems(scrap);
  const busy = acting || scrapBusy;

  useEffect(() => {
    if (isOpen) {
      setNote("");
      setPhoto(null);
      setScrap(emptyCuttingScrapDraft());
      setScrapError(null);
      setScrapBusy(false);
      setShowScrapProblems(false);
      const seed: Record<string, string> = {};
      for (const it of items) seed[it.id] = String(it.completedQty ?? 0);
      setQtys(seed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const missingQty = items.some((it) => {
    const v = qtys[it.id];
    return v === undefined || v === "" || isNaN(parseInt(v, 10));
  });

  function runClockOut() {
    const itemQtys = items.map((it) => ({
      line_item_id: it.id,
      completed_qty: Math.max(0, parseInt(qtys[it.id], 10) || 0),
    }));
    onSubmit(note, photo, itemQtys);
  }

  // Scrap first; the existing clock-out flow (qtys → photo → clock-out) runs only after it saves, or when skipped.
  async function handleSubmit() {
    if (busy) return;
    if (!scrapEnabled || !draftHasEntries(scrap)) {
      runClockOut();
      return;
    }
    if (scrapProblems.length) {
      setShowScrapProblems(true);
      return;
    }
    setScrapBusy(true);
    setScrapError(null);
    const r = await postCuttingScrap({ job_id: jobId, line: lineLabel, shift: scrap.shift, entries: toCuttingScrapEntries(scrap) });
    setScrapBusy(false);
    if (!r.ok) {
      setScrapError(r.error);
      return;
    }
    // Clear the draft before clocking out so a failed clock-out + retry never re-posts the scrap.
    const count = scrap.entries.length;
    setScrap(emptyCuttingScrapDraft());
    onScrapResult?.(count, false);
    runClockOut();
  }

  function continueWithoutScrap() {
    setScrap(emptyCuttingScrapDraft());
    setScrapError(null);
    setShowScrapProblems(false);
    onScrapResult?.(0, true);
    runClockOut();
  }

  return (
    <Modal isOpen={isOpen} onClose={scrapBusy ? () => {} : onClose} title={`Stop — ${lineLabel}`} size={scrap.open ? "lg" : "md"}>
      <div className="space-y-4">
        <div>
          <label htmlFor="handoff-note" className="block text-sm font-medium text-text mb-1">
            Handoff note
            <span className="ml-1 text-xs text-muted font-normal">
              (where you stopped, what to watch)
            </span>
          </label>
          <textarea
            id="handoff-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            placeholder="e.g. Stopped at 3rd stack — glue needs to cure. Watch blade tension."
            className="w-full rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
          />
        </div>

        {items.length > 0 && (
          <div>
            <p className="block text-sm font-medium text-text mb-1">
              Unchecked parts — total completed
              <span className="ml-1 text-xs text-muted font-normal">(required, 0 is fine)</span>
            </p>
            <ul className="border border-border rounded divide-y divide-border max-h-56 overflow-y-auto">
              {items.map((it) => (
                <li key={it.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 text-sm text-text truncate">
                    {it.label}
                    {it.orderedQty != null && (
                      <span className="text-muted font-mono tabular-nums"> / {it.orderedQty}</span>
                    )}
                  </span>
                  <input
                    type="number"
                    min="0"
                    inputMode="numeric"
                    value={qtys[it.id] ?? ""}
                    onChange={(e) => setQtys((p) => ({ ...p, [it.id]: e.target.value }))}
                    className="w-20 shrink-0 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-2 py-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-text mb-1">
            Cut-list photo
            <span className="ml-1 text-xs text-muted font-normal">(optional)</span>
          </label>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted file:mr-3 file:py-2 file:px-3 file:rounded file:border file:border-border file:bg-[var(--ghost-bg)] file:text-text file:text-sm file:font-semibold file:cursor-pointer"
          />
          {photo && <p className="mt-1 text-xs text-muted truncate">Selected: {photo.name}</p>}
        </div>

        {/* qc-05: optional scrap — collapsed by default, never blocks clocking out when skipped. */}
        {scrapEnabled && (
          <div className="space-y-2">
            <CuttingScrapSection
              lineItems={lineItems}
              value={scrap}
              onChange={setScrap}
              disabled={busy}
              line={lineLabel}
              invoice={invoice}
              operatorName={operatorName}
            />
            {showScrapProblems && <CuttingScrapProblems problems={scrapProblems} />}
            {scrapError && (
              <CuttingScrapSaveError
                error={scrapError}
                busy={busy || missingQty}
                onRetry={handleSubmit}
                onSkip={continueWithoutScrap}
              />
            )}
          </div>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            disabled={busy || missingQty}
            title={
              missingQty ? "Enter a quantity for each unchecked part (0 is fine)." : undefined
            }
            onClick={handleSubmit}
            className="touch-manipulation flex-1 min-h-[44px] bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
          >
            {scrapBusy ? "Saving scrap…" : acting ? "Saving…" : "Stop"}
          </button>
          <button
            type="button"
            disabled={scrapBusy}
            onClick={onClose}
            className="min-h-[44px] px-4 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
