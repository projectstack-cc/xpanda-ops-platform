"use client";
// src/components/marina/MeasurePanel.tsx — marina-06
// Measure one Marina piece: a new piece (POST /parts/{id}/pieces) or a re-measure of a rework_pending
// piece (POST /pieces/{id}/measure). One row per dim (label + nominal, measured value) driven by the
// FractionKeypad; rows are buttons with an aria-live <output>, never native inputs, so the phone's OS
// keyboard never opens. Live ✓/✗ + words per row (UX only — the server's in_tol is saved). Any dim out
// → the disposition step (Rework / Scrap + optional note) BEFORE posting; a server
// `disposition_required` reopens it with the values kept. Errors keep the values. Re-measures prefill
// nothing. The caller owns the container (inline card or full-screen) and what happens after saving.
import { useEffect, useMemo, useState } from "react";
import { formatInches } from "@/lib/inches";
import { EMPTY_KEYPAD, applyKey, keypadText, measureFeedback, type KeypadKey, type KeypadState } from "@/lib/marina/keypad";
import type { MarinaDim, MarinaPartSummary, MarinaPiece } from "@/lib/marina/types";
import FractionKeypad from "./FractionKeypad";
import { ERROR_TEXT, GHOST, PRIMARY, TEXTAREA, jsonInit, marinaFetch, plural } from "./ui";

export type MeasureMode = { kind: "new"; pieceNo: number } | { kind: "remeasure"; piece: MarinaPiece };

interface Props {
  partId: string;
  partLabel: string;
  dims: MarinaDim[];
  tolerance: number;
  mode: MeasureMode;
  onSaved: (piece: MarinaPiece, part: MarinaPartSummary) => void;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

type Disposition = "rework" | "scrap";

export default function MeasurePanel({ partId, partLabel, dims, tolerance, mode, onSaved, onCancel, onDirtyChange }: Props) {
  const ordered = useMemo(() => [...dims].sort((a, b) => a.sort_order - b.sort_order), [dims]);
  const [values, setValues] = useState<Record<string, KeypadState>>({});
  const [focus, setFocus] = useState(0);
  const [step, setStep] = useState<"measure" | "disposition">("measure");
  const [disposition, setDisposition] = useState<Disposition | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const textOf = (d: MarinaDim) => keypadText(values[d.id] ?? EMPTY_KEYPAD);
  const rows = ordered.map((d) => ({ dim: d, text: textOf(d), fb: measureFeedback(textOf(d), d.nominal_in, tolerance) }));
  const dirty = rows.some((r) => r.text !== "") || note.trim() !== "";
  const allParse = rows.every((r) => r.fb !== null);
  const outRows = rows.filter((r) => r.fb && !r.fb.inTol);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const focusedDim = ordered[focus] ?? ordered[0];

  function onKey(k: KeypadKey) {
    if (!focusedDim) return;
    setError(null);
    setValues((v) => ({ ...v, [focusedDim.id]: applyKey(v[focusedDim.id] ?? EMPTY_KEYPAD, k) }));
  }

  // Enter / Next → the next empty row after the focused one (wrapping); none left → stay.
  function next() {
    for (let i = 1; i <= ordered.length; i++) {
      const j = (focus + i) % ordered.length;
      if (!textOf(ordered[j])) {
        setFocus(j);
        return;
      }
    }
  }

  async function post(disp: Disposition | null) {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { measurements: rows.map((r) => ({ dim_id: r.dim.id, value: r.text })) };
    if (disp) body.disposition = disp;
    const n = note.trim();
    // A re-measure only sends `note` when one was typed (sending null would wipe the earlier note).
    if (disp && n) body.note = n;
    else if (disp && mode.kind === "new") body.note = null;
    const path = mode.kind === "new"
      ? `/parts/${encodeURIComponent(partId)}/pieces`
      : `/pieces/${encodeURIComponent(mode.piece.id)}/measure`;
    const r = await marinaFetch<{ piece: MarinaPiece; part: MarinaPartSummary }>(path, jsonInit("POST", body));
    setBusy(false);
    if (!r.ok) {
      if (r.code === "disposition_required") {
        setStep("disposition");
        setError("The server found a dimension out of tolerance — choose Rework or Scrap.");
      } else if (r.code === "job_complete") {
        setError("This job was completed — reopen it to inspect.");
      } else {
        setError(r.error);
      }
      return;
    }
    onDirtyChange?.(false);
    onSaved(r.data.piece, r.data.part);
  }

  function save() {
    if (!allParse || busy) return;
    if (outRows.length > 0) {
      setStep("disposition");
      setError(null);
      return;
    }
    post(null);
  }

  function cancel() {
    if (dirty && !confirmCancel) {
      setConfirmCancel(true);
      return;
    }
    onDirtyChange?.(false);
    onCancel();
  }

  const title = mode.kind === "new" ? `Inspect piece #${mode.pieceNo}` : `Re-measure piece #${mode.piece.piece_no}`;
  const tolText = `±${formatInches(tolerance)}"`;

  return (
    <div className="space-y-4" aria-label={title} role="region">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xl font-bold break-words">{title}</h2>
          <p className="text-sm text-muted break-words">
            {partLabel} · tolerance {tolText}
            {mode.kind === "remeasure" ? ` · attempt ${mode.piece.attempts + 1}` : ""}
          </p>
        </div>
        <button type="button" className={GHOST} onClick={cancel} disabled={busy}>Cancel</button>
      </div>

      {confirmCancel && (
        <div role="alert" className="rounded-lg border border-[var(--info-border)] bg-[var(--info-bg)] p-3 space-y-2">
          <p className="text-sm font-semibold text-[var(--info-text)]">Discard the values you entered?</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={GHOST} onClick={() => setConfirmCancel(false)}>Keep measuring</button>
            <button type="button" className={PRIMARY} onClick={cancel}>Discard</button>
          </div>
        </div>
      )}

      {step === "measure" ? (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] items-start">
          <ul className="space-y-2" aria-label="Dimensions">
            {rows.map((r, i) => {
              const on = i === focus;
              const fb = r.fb;
              return (
                <li key={r.dim.id}>
                  <button
                    type="button"
                    onClick={() => setFocus(i)}
                    aria-pressed={on}
                    aria-label={`${r.dim.label}, nominal ${r.dim.nominal_text ?? formatInches(r.dim.nominal_in)}`}
                    className={`w-full text-left rounded-xl border-2 p-3 cursor-pointer min-h-[72px] ${
                      fb ? (fb.inTol ? "border-[var(--loaded-border)]" : "border-[var(--danger-ink)]") : on ? "border-[var(--brand)]" : "border-[var(--border)]"
                    } ${on ? "bg-[var(--ghost-bg)]" : "bg-surface"} ${on && fb ? "ring-2 ring-[var(--brand)]" : ""}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-muted">{r.dim.label} · nominal</span>
                        <span className="block text-2xl font-bold text-text">{r.dim.nominal_text ?? formatInches(r.dim.nominal_in)}</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-xs font-semibold text-muted">measured</span>
                        <output aria-live="polite" className={`block text-3xl font-bold tabular-nums ${r.text ? "text-text" : "text-muted"}`}>
                          {r.text || "—"}
                        </output>
                      </span>
                    </div>
                    {fb && (
                      <p className={`mt-1 text-base font-bold ${fb.inTol ? "text-[var(--loaded-text)]" : "text-[var(--danger-ink)]"}`}>
                        {fb.inTol ? `✓ In tolerance · ${fb.text === "0" ? "exact" : fb.text}` : `✗ ${fb.text}`}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="space-y-3">
            <FractionKeypad
              state={focusedDim ? values[focusedDim.id] ?? EMPTY_KEYPAD : EMPTY_KEYPAD}
              onKey={onKey}
              onNext={next}
              keyboard={!confirmCancel}
              disabled={busy}
            />
            {error && <p role="alert" className={ERROR_TEXT}>{error}</p>}
            <button type="button" className={`${PRIMARY} w-full min-h-[56px] text-base`} onClick={save} disabled={!allParse || busy}>
              {busy ? "Saving…" : allParse ? "Save piece" : `Enter all ${plural(rows.length, "dim")}`}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div role="alert" className="rounded-xl border-2 border-[var(--danger-ink)] p-3 space-y-2">
            <p className="text-lg font-bold text-[var(--danger-ink)]">
              ✗ {outRows.length > 0 ? `${plural(outRows.length, "dim")} out of tolerance` : "Out of tolerance (server check)"}
            </p>
            <ul className="space-y-1">
              {outRows.map((r) => (
                <li key={r.dim.id} className="text-sm text-text">
                  <span className="font-semibold">{r.dim.label}</span> {r.dim.nominal_text ?? formatInches(r.dim.nominal_in)} → {r.text}{" "}
                  <span className="font-bold text-[var(--danger-ink)]">{r.fb?.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Disposition">
            {(["rework", "scrap"] as Disposition[]).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={disposition === d}
                onClick={() => setDisposition(d)}
                className={`min-h-[72px] rounded-xl border-2 text-lg font-bold cursor-pointer ${
                  disposition === d
                    ? d === "scrap" ? "bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger-ink)]" : "bg-[var(--brand)] text-white border-[var(--brand)]"
                    : "bg-surface text-text border-[var(--input-border)] hover:bg-[var(--ghost-bg)]"
                }`}
              >
                {d === "rework" ? "Rework" : "Scrap"}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Note (optional)
            <textarea className={TEXTAREA} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="What's wrong / what to fix" />
          </label>
          {error && <p role="alert" className={ERROR_TEXT}>{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={GHOST} onClick={() => { setStep("measure"); setError(null); }} disabled={busy}>Back to values</button>
            <button type="button" className={`${PRIMARY} min-h-[56px] px-6 text-base`} onClick={() => disposition && post(disposition)} disabled={!disposition || busy}>
              {busy ? "Saving…" : "Confirm"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
