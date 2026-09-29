"use client";
// src/app/carrier/CarrierChargeModal.tsx
// "Add fees / notes" for a carrier load (carrier-04). Composes the shared Modal. POSTs to
// /v2/api/carrier/charges; the server is the source of truth for validation — the client checks
// mirror it only so the carrier gets an inline error before a round-trip. Append-only: each
// submit adds a new entry; nothing is edited in place.
import { useState } from "react";
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

export default function CarrierChargeModal({ isOpen, onClose, token, title, onSaved }: Props) {
  const [fee, setFee] = useState("");
  const [notes, setNotes] = useState("");
  const [feeError, setFeeError] = useState<string | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    let okFlag = true;
    const cleaned = fee.replace(/[$,\s]/g, "");
    let feeNum = 0;
    if (cleaned) {
      if (!FEE_RE.test(cleaned)) {
        setFeeError("Enter a dollar amount like 125 or 125.50.");
        okFlag = false;
      } else {
        feeNum = parseFloat(cleaned);
        if (feeNum > 10_000) {
          setFeeError("Fee can't be more than $10,000.");
          okFlag = false;
        } else setFeeError(null);
      }
    } else setFeeError(null);

    if (!notes.trim()) {
      setNotesError(feeNum > 0 ? "Explain this fee here." : "Add a note.");
      okFlag = false;
    } else if (notes.trim().length > 2000) {
      setNotesError("Notes can be at most 2000 characters.");
      okFlag = false;
    } else setNotesError(null);
    return okFlag;
  }

  async function handleSubmit() {
    setError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/v2/api/carrier/charges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, fee_amount: fee.replace(/[$,\s]/g, "") || null, notes: notes.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.error === "notes_required") setNotesError(data.detail || "Additional Notes is required.");
        else if (data.error === "invalid_fee") setFeeError(data.detail || "Invalid fee.");
        else if (res.status === 403 && data.error !== "outside_window") {
          setError("You don't have permission to add fees. Ask XPanda logistics to enable it.");
        } else setError(data.detail || data.error || `Could not save (${res.status}).`);
        setSubmitting(false);
        return;
      }
      onSaved();
      onClose();
    } catch {
      setError("Network error — could not reach the server.");
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="space-y-4">
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
                id="carrier-fee"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={fee}
                onChange={(e) => setFee(e.target.value)}
                placeholder="0.00"
                aria-invalid={!!feeError}
                aria-describedby="carrier-fee-help"
                className="w-36 min-h-[44px] pl-7 pr-3 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm tabular-nums"
              />
            </div>
            <span id="carrier-fee-help" className="text-xs text-[var(--text-hint)]">
              Explain this fee in Additional Notes below.
            </span>
          </div>
          {feeError && <p className="mt-1 text-xs font-semibold text-[var(--danger-text)]">{feeError}</p>}
        </div>

        <div>
          <label htmlFor="carrier-notes" className="block text-sm font-semibold mb-1">
            Additional Notes
          </label>
          <textarea
            id="carrier-notes"
            rows={4}
            maxLength={2000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            aria-invalid={!!notesError}
            className="w-full min-h-[44px] px-3 py-2 rounded-md border border-[var(--border)] bg-[var(--surface)] text-sm"
          />
          {notesError && <p className="mt-1 text-xs font-semibold text-[var(--danger-text)]">{notesError}</p>}
        </div>

        {error && <p className="text-sm font-semibold text-[var(--danger-text)]">{error}</p>}

        <button
          type="button"
          disabled={submitting}
          onClick={handleSubmit}
          className="w-full min-h-[44px] px-4 rounded-md bg-[var(--accent)] text-[var(--surface)] text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitting ? "Sending…" : "Send to XPanda logistics"}
        </button>
      </div>
    </Modal>
  );
}
