"use client";
// src/components/marina/PartEditor.tsx — marina-05
// Shared label / notes / dim-row editor for a Marina part: the cut-sheet setup screen (with chips from
// the page text), "Add part by hand", "Edit label & notes" and "Edit dims" on the job page. Controlled:
// the caller owns the PartDraft and does the API call. Pure helpers live in lib/marina/partDraft.ts.
import { Plus, X } from "lucide-react";
import { parseInches } from "@/lib/inches";
import type { DimChip } from "@/lib/marina/cutSheet";
import {
  NAMES, checkDraft, chipKey, chipUseCount, dimName, firstProblem, newRow, withName,
  type DimRowState, type EditorFields, type PartDraft,
} from "@/lib/marina/partDraft";
import { INPUT, LABEL, TEXTAREA } from "./ui";

// Pure helpers moved to lib/marina/partDraft.ts (marina-fix-01); re-exported for the existing callers.
export { checkDraft, dimsPayload, draftFromPart, emptyDraft } from "@/lib/marina/partDraft";
export type { EditorFields, PartDraft } from "@/lib/marina/partDraft";

interface Props {
  draft: PartDraft;
  onChange: (next: PartDraft) => void;
  fields?: EditorFields;
  readOnly?: boolean;
  chips?: DimChip[] | null;        // null/undefined = no chip section (hand entry / edit)
  hasText?: boolean;               // with chips: false → "No text on this page"
  labelHint?: string | null;       // e.g. "Couldn't read the label — check it."
  existingLabels?: string[];       // other parts' labels in this job (duplicate warning, not a block)
  idPrefix?: string;
}

export default function PartEditor({
  draft, onChange, fields = "all", readOnly = false, chips, hasText = true, labelHint, existingLabels = [], idPrefix = "pe",
}: Props) {
  const check = checkDraft(draft, fields);
  const showLabelNotes = fields !== "dims";
  const showDims = fields !== "labelNotes";
  const labelDup = draft.label.trim() !== ""
    && existingLabels.some((l) => l.trim().toLowerCase() === draft.label.trim().toLowerCase());

  const setDims = (dims: DimRowState[]) => onChange({ ...draft, dims });
  const patchRow = (key: string, patch: Partial<DimRowState>) =>
    setDims(draft.dims.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  // Always appends (a part can have two equal dims); a row is removed only with its ×.
  function addChip(c: DimChip) {
    setDims([...draft.dims, newRow(draft.dims, c.text, chipKey(c))]);
  }

  const problem = readOnly ? null : firstProblem(draft, fields);

  return (
    <div className="space-y-4">
      {showLabelNotes && (
        <>
          <label className={LABEL} htmlFor={`${idPrefix}-label`}>
            Label
            <input
              id={`${idPrefix}-label`}
              className={INPUT}
              value={draft.label}
              maxLength={80}
              disabled={readOnly}
              onChange={(e) => onChange({ ...draft, label: e.target.value })}
              autoComplete="off"
            />
            {labelHint && <span className="text-xs font-normal text-muted">{labelHint}</span>}
            {!readOnly && labelDup && (
              <span className="text-xs font-semibold text-[var(--info-text)]">Another part in this job already uses this label.</span>
            )}
          </label>
          <label className={LABEL} htmlFor={`${idPrefix}-notes`}>
            Notes
            <textarea
              id={`${idPrefix}-notes`}
              className={TEXTAREA}
              value={draft.notes}
              maxLength={2000}
              disabled={readOnly}
              onChange={(e) => onChange({ ...draft, notes: e.target.value })}
            />
          </label>
        </>
      )}

      {showDims && chips !== undefined && chips !== null && !readOnly && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted">Dims found on this page — tap to add</p>
          {!hasText ? (
            <p className="text-sm text-muted">No text on this page — add dims by hand.</p>
          ) : chips.length === 0 ? (
            <p className="text-sm text-muted">No measurements found — add dims by hand.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {chips.map((c) => {
                const uses = chipUseCount(draft.dims, chipKey(c));
                const on = uses > 0;
                return (
                  <button
                    key={chipKey(c)}
                    type="button"
                    aria-label={`${c.text}, added ${uses} times`}
                    onClick={() => addChip(c)}
                    className={`min-h-[44px] min-w-[44px] px-3 rounded-lg border text-sm font-semibold cursor-pointer transition-colors ${
                      on
                        ? "bg-[var(--brand)] text-white border-[var(--brand)]"
                        : "bg-surface text-text border-[var(--input-border)] hover:bg-[var(--ghost-bg)]"
                    }`}
                  >
                    {c.text}{uses > 1 && ` ×${uses}`}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showDims && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted">Dims ({draft.dims.length})</p>
          {draft.dims.length === 0 && <p className="text-sm text-muted">No dims yet.</p>}
          <ul className="space-y-2">
            {draft.dims.map((r, i) => {
              const v = parseInches(r.text);
              const badValue = r.text.trim() !== "" && (v === null || !(v > 0));
              const dup = check.dupNames.has(dimName(r).toUpperCase());
              return (
                <li key={r.key} className="rounded-lg border border-[var(--border)] p-2 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <div role="radiogroup" aria-label={`Dim ${i + 1} name`} className="inline-flex rounded-lg border border-[var(--input-border)] overflow-hidden">
                      {NAMES.map((n) => (
                        <button
                          key={n}
                          type="button"
                          role="radio"
                          aria-checked={r.name === n}
                          disabled={readOnly}
                          onClick={() => setDims(withName(draft.dims, r.key, n))}
                          className={`min-h-[44px] min-w-[44px] px-2.5 text-sm font-semibold cursor-pointer disabled:cursor-default ${
                            r.name === n ? "bg-[var(--brand)] text-white" : "bg-surface text-text hover:bg-[var(--ghost-bg)]"
                          }`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <input
                      aria-label={`Dim ${i + 1} value`}
                      className={`${INPUT} flex-1 min-w-[7rem] w-auto ${badValue ? "border-[var(--danger-ink)] focus:border-[var(--danger-ink)]" : ""}`}
                      value={r.text}
                      inputMode="decimal"
                      placeholder={`e.g. 41 3/8`}
                      disabled={readOnly}
                      onChange={(e) => patchRow(r.key, { text: e.target.value })}
                      autoComplete="off"
                    />
                    {!readOnly && (
                      <button
                        type="button"
                        aria-label={`Remove dim ${i + 1}`}
                        onClick={() => setDims(draft.dims.filter((x) => x.key !== r.key))}
                        className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg border border-[var(--input-border)] bg-surface text-muted hover:text-text cursor-pointer"
                      >
                        <X size={18} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {r.name === "Other" && (
                    <input
                      aria-label={`Dim ${i + 1} custom name`}
                      className={INPUT}
                      value={r.other}
                      maxLength={40}
                      placeholder="Dim name (e.g. Notch)"
                      disabled={readOnly}
                      onChange={(e) => patchRow(r.key, { other: e.target.value })}
                      autoComplete="off"
                    />
                  )}
                  {badValue && <p className="text-xs font-semibold text-[var(--danger-ink)]">Not a measurement</p>}
                  {!readOnly && dup && <p className="text-xs font-semibold text-[var(--danger-ink)]">Another dim on this part has the same name.</p>}
                </li>
              );
            })}
          </ul>
          {!readOnly && (
            <button
              type="button"
              disabled={draft.dims.length >= 20}
              onClick={() => setDims([...draft.dims, newRow(draft.dims)])}
              className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-dashed border-[var(--input-border)] bg-surface text-sm font-semibold text-text cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={16} aria-hidden="true" /> Add dim by hand
            </button>
          )}
        </div>
      )}

      {problem && (
        <p role="status" aria-live="polite" className="text-xs font-semibold text-[var(--danger-ink)]">{problem}</p>
      )}
    </div>
  );
}
