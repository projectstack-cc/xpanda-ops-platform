"use client";
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";

export interface OpenSession {
  session_id: string;
  job_id: string;
  line: string;
  invoice_number: string | null;
  customer: string | null;
  orphaned: boolean;
}

interface Props {
  isOpen: boolean;
  sessions: OpenSession[];
  busy: boolean;
  onCancel: () => void;
  onSignOutWithoutStopping: () => void;
  onConfirmStopped: (qtyBySession: Record<string, number>) => void;
}

function sessionLabel(s: OpenSession): string {
  const job = [s.invoice_number, s.customer].filter(Boolean).join(" — ");
  const base = job ? `${s.line} — ${job}` : s.line;
  return s.orphaned ? `${base} (job no longer on the board)` : base;
}

// Sign-out gate: an operator forgetting to Stop before signing out leaves the line
// "in progress" with nobody attached. This does not mark any line Complete — that's
// a separate action on the board itself.
export default function SignOutSessionModal({
  isOpen,
  sessions,
  busy,
  onCancel,
  onSignOutWithoutStopping,
  onConfirmStopped,
}: Props) {
  const [step, setStep] = useState<"confirm" | "quantities">("confirm");
  const [qty, setQty] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      setStep("confirm");
      setQty({});
    }
  }, [isOpen]);

  function handleSubmit() {
    const qtyBySession: Record<string, number> = {};
    for (const s of sessions) {
      const n = parseInt(qty[s.session_id] ?? "", 10);
      qtyBySession[s.session_id] = !isNaN(n) && n > 0 ? n : 0;
    }
    onConfirmStopped(qtyBySession);
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={step === "confirm" ? "Sign out — stop your job first?" : "Final quantities"}
    >
      {step === "confirm" ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="text-sm text-text">
              You&apos;re still clocked in. The line stays &quot;in progress&quot; for the next
              operator whether you stop it now or not — this does not mark it Complete.
            </p>
            <ul className="text-sm text-muted list-disc pl-5 space-y-0.5">
              {sessions.map((s) => (
                <li key={s.session_id}>{sessionLabel(s)}</li>
              ))}
            </ul>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={() => setStep("quantities")}
              className="touch-manipulation flex-1 min-h-[44px] bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90"
            >
              Stop & Sign Out
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onSignOutWithoutStopping}
              className="touch-manipulation min-h-[44px] px-4 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] disabled:opacity-50"
            >
              {busy ? "Signing out…" : "Sign Out Without Stopping"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-3">
            {sessions.map((s) => (
              <div key={s.session_id}>
                <label
                  htmlFor={`signout-qty-${s.session_id}`}
                  className="block text-sm font-medium text-text mb-1"
                >
                  {sessionLabel(s)}
                  <span className="ml-1 text-xs text-muted font-normal">(optional)</span>
                </label>
                <input
                  id={`signout-qty-${s.session_id}`}
                  type="number"
                  min="0"
                  inputMode="numeric"
                  value={qty[s.session_id] ?? ""}
                  onChange={(e) =>
                    setQty((prev) => ({ ...prev, [s.session_id]: e.target.value }))
                  }
                  placeholder="0"
                  className="w-28 min-h-[44px] rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-text px-3 py-2 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                />
              </div>
            ))}
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={handleSubmit}
              className="touch-manipulation flex-1 min-h-[44px] bg-[var(--primary-bg)] text-[var(--primary-text)] rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Signing out…" : "Confirm & Sign Out"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStep("confirm")}
              className="touch-manipulation min-h-[44px] px-4 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] disabled:opacity-50"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
