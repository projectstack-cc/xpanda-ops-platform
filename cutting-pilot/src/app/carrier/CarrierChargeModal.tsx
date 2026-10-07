"use client";
// src/app/carrier/CarrierChargeModal.tsx
// "Add fees / notes" for a carrier load (carrier-04). Composes the shared Modal. POSTs to
// /v2/api/carrier/charges; the server is the source of truth for validation — the client checks
// mirror it only so the carrier gets an inline error before a round-trip. Append-only: each
// submit adds a new entry; nothing is edited in place.
// carrier-09: root cause of "Send does nothing" — every error line here was coloured
// var(--danger-text), which is the WHITE foreground meant for text ON a danger-bg fill, so in light
// mode each failure (a fee with no note, or any server error) rendered white-on-white: invisible.
// Field messages now use var(--danger-bg) (red text, like the rest of the app), and every failure also
// shows a top-of-modal alert banner (danger fill) and moves focus to the first invalid field. The
// modal stays open on failure so typed text is never lost; success still closes it + refetches + toasts.
import { useRef, useState } from "react";
import Modal from "@/components/Modal";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  title: string;
  /** Called after a successful submit (parent refetches + shows the toast). */
  onSaved: () => void;
}

const FEE_RE = /^(\d+(\.\d{0,2})?|\.\d{1,2})$/;

type Field = "fee" | "notes";

export default function CarrierChargeModal({ isOpen, onClose, token, title, onSaved }: Props) {
  const [fee, setFee] = useState("");
  const [notes, setNotes] = useState("");
  const [feeError, setFeeError] = useState<string | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const feeRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  function focusField(field: Field | null) {
    (field === "fee" ? feeRef.current : field === "notes" ? notesRef.current : null)?.focus();
  }

  /** Sets the field-level messages; returns the first invalid field + a banner summary, or null. */
  function validate(): { field: Field; summary: string } | null {
    let first: { field: Field; summary: string } | null = null;
    const cleaned = fee.replace(/[$,\s]/g, "");
    let feeNum = 0;
    if (cleaned) {
      if (!FEE_RE.test(cleaned)) {
        setFeeError("Enter a dollar amount like 125 or 125.50.");
        first = { field: "fee", summary: "The fee isn't a valid dollar amount." };
      } else {
        feeNum = parseFloat(cleaned);
        if (feeNum > 10_000) {
          setFeeError("Fee can't be more than $10,000.");
          first = { field: "fee", summary: "Fee can't be more than $10,000." };
        } else setFeeError(null);
      }
    } else setFeeError(null);

    if (!notes.trim()) {
      setNotesError(feeNum > 0 ? "Explain this fee here." : "Add a note.");
      first ??= { field: "notes", summary: feeNum > 0 ? "Add a note explaining this fee." : "Add a note before sending." };
    } else if (notes.trim().length > 2000) {
      setNotesError("Notes can be at most 2000 characters.");
      first ??= { field: "notes", summary: "Notes can be at most 2000 characters." };
    } else setNotesError(null);
    return first;
  }

  function fail(summary: string, field: Field | null = null) {
    setError(summary);
    setSubmitting(false);
    focusField(field);
  }

  async function handleSubmit() {
    setError(null);
    const invalid = validate();
    if (invalid) {
      fail(invalid.summary, invalid.field);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/v2/api/carrier/charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, fee_amount: fee.replace(/[$,\s]/g, "") || null, notes: notes.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.error === "notes_required" || data.error === "notes_too_long") {
          const msg = data.detail || "Additional Notes is required.";
          setNotesError(msg);
          fail(msg, "notes");
        } else if (data.error === "invalid_fee") {
          const msg = data.detail || "Invalid fee.";
          setFeeError(msg);
          fail(msg, "fee");
        } else if (res.status === 403 && data.error !== "outside_window") {
          fail("You don't have permission to add fees. Ask XPanda logistics to enable it.");
        } else fail(data.detail || data.error || `Could not save (${res.status}).`);
        return;
      }
      onSaved();
      onClose();
    } catch {
      fail("Network error — could not reach the server. Your text is still here; try Send again.");
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-4">
        {error && (
          <div
            role="alert"
            className="rounded px-3 py-2 text-sm font-semibold bg-[var(--danger-bg)] text-[var(--danger-text)]"
          >
            {error}
          </div>
        )}

        <div>
          <label htmlFor="carrier-fee" className="block text-sm font-semibold mb-1">
            Additional fees
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--text-hint)]" aria-hidden="true">
                $
              </span>
              <input
                ref={feeRef}
                id="carrier-fee"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                placeholder="0.00"
                aria-invalid={!!feeError}
                aria-describedby="carrier-fee-help"
                className="w-36 min-h-[44px] pl-7 pr-3 rounded border border-[var(--border)] bg-[var(--surface)] text-sm tabular-nums"
              />
            </div>
            <span id="carrier-fee-help" className="text-xs text-[var(--text-hint)]">
              Explain this fee in Additional Notes below.
            </span>
          </div>
          {feeError && <p className="mt-1 text-xs font-semibold text-[var(--danger-bg)]">{feeError}</p>}
        </div>

        <div>
          <label htmlFor="carrier-notes" className="block text-sm font-semibold mb-1">
            Additional Notes
          </label>
          <textarea
            ref={notesRef}
            id="carrier-notes"
            rows={4}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-invalid={!!notesError}
            className="w-full min-h-[44px] px-3 py-2 rounded border border-[var(--border)] bg-[var(--surface)] text-sm"
          />
          {notesError && <p className="mt-1 text-xs font-semibold text-[var(--danger-bg)]">{notesError}</p>}
        </div>

        <div>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="w-full min-h-[44px] px-4 rounded bg-[var(--accent)] text-[var(--surface)] text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? "Sending…" : "Send to XPanda logistics"}
          </button>
          <p className="mt-1.5 text-xs text-center text-[var(--text-muted)]">Goes to XPanda logistics and shows on this load.</p>
        </div>
      </div>
    </Modal>
  );
}
