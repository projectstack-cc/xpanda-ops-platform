"use client";
import { useState, useEffect } from "react";
import { AlertTriangle } from "lucide-react";
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

interface Props {
  lineLabel: string;
  customer: string;
  invoice: string;
  // qc-05: optional scrap capture — posted to /v2/api/cutting/scrap before onSubmit runs.
  jobId: string;
  lineItems: CuttingLineItem[];
  operatorName: string;
  onScrapResult?: (count: number, skipped: boolean) => void;
  isOpen: boolean;
  onClose: () => void;
  // cutting-ids-01: parts checklist state for this line — soft guard only, never blocks.
  checkedCount: number;
  totalCount: number;
  onSubmit: (note: string) => void;
  acting: boolean;
}

export default function CompleteLineModal({
  lineLabel,
  customer,
  invoice,
  jobId,
  lineItems,
  operatorName,
  onScrapResult,
  isOpen,
  onClose,
  checkedCount,
  totalCount,
  onSubmit,
  acting,
}: Props) {
  const [note, setNote] = useState("");
  const [scrap, setScrap] = useState<CuttingScrapDraft>(() => emptyCuttingScrapDraft());
  const [scrapError, setScrapError] = useState<string | null>(null);
  const [scrapBusy, setScrapBusy] = useState(false);
  const [showScrapProblems, setShowScrapProblems] = useState(false);
  const unchecked = totalCount > 0 && checkedCount < totalCount ? totalCount - checkedCount : 0;
  const scrapEnabled = !!jobId && SCRAP_LINES.includes(lineLabel);
  const scrapProblems = cuttingScrapProblems(scrap);
  const busy = acting || scrapBusy;

  useEffect(() => {
    if (isOpen) {
      setNote("");
      setScrap(emptyCuttingScrapDraft());
      setScrapError(null);
      setScrapBusy(false);
      setShowScrapProblems(false);
    }
  }, [isOpen]);

  // Scrap first; the existing complete flow (onSubmit) runs only after it saves, or when skipped.
  async function handleSubmit() {
    if (busy) return;
    if (!scrapEnabled || !draftHasEntries(scrap)) {
      onSubmit(note);
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
    // Clear the draft before completing so a failed complete + retry never re-posts the scrap.
    const count = scrap.entries.length;
    setScrap(emptyCuttingScrapDraft());
    onScrapResult?.(count, false);
    onSubmit(note);
  }

  function continueWithoutScrap() {
    setScrap(emptyCuttingScrapDraft());
    setScrapError(null);
    setShowScrapProblems(false);
    onScrapResult?.(0, true);
    onSubmit(note);
  }

  return (
    <Modal isOpen={isOpen} onClose={scrapBusy ? () => {} : onClose} title={`Mark Complete — ${lineLabel}`} size={scrap.open ? "lg" : "md"}>
      <div className="space-y-4">
        {/* Confirmation context */}
        <p className="text-sm text-muted">
          Completing <span className="font-medium text-text">{lineLabel}</span> for{" "}
          <span className="font-medium text-text">{customer}</span>
          <span className="font-mono tabular-nums"> · {invoice}</span>. This marks the line done; when
          every required line is complete the job is marked done. This cannot be undone.
        </p>

        {/* cutting-ids-01: soft guard — unchecked parts warn, but Complete is never blocked. */}
        {unchecked > 0 && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded border border-[var(--warn-border)] bg-[var(--warn-bg)] text-[var(--warn-text)] px-3 py-2 text-sm"
          >
            <AlertTriangle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              <span className="font-mono tabular-nums">{unchecked}</span> of{" "}
              <span className="font-mono tabular-nums">{totalCount}</span> parts unchecked — complete anyway?
            </span>
          </div>
        )}

        {/* Optional completion note (stored as the closing session's handoff note) */}
        <div>
          <label htmlFor="complete-note" className="block text-sm font-medium text-text mb-1">
            Completion note
            <span className="ml-1 text-xs text-muted font-normal">(optional)</span>
          </label>
          <textarea
            id="complete-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Anything the next step should know about this finished line."
            className="w-full rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
          />
        </div>

        {/* qc-05: optional scrap — collapsed by default, never blocks completing when skipped. */}
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
              <CuttingScrapSaveError error={scrapError} busy={busy} onRetry={handleSubmit} onSkip={continueWithoutScrap} />
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={handleSubmit}
            className="flex-1 min-h-[44px] bg-[var(--success-bg)] text-[var(--success-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
          >
            {scrapBusy ? "Saving scrap…" : acting ? "Saving…" : unchecked > 0 ? "Complete anyway" : "Mark Complete"}
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
