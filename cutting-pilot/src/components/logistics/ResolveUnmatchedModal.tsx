"use client";
// src/components/logistics/ResolveUnmatchedModal.tsx
// Lets Steve manually complete a line the auto-resolver couldn't (no BOL/order on file, or
// mileage unavailable) by typing in the BOL # and a single ship-to address. Posts one line at a
// time to /v2/api/logistics/invoice/resolve-line; each success replaces the caller's `result`
// with the freshly recomputed InvoiceResult for that invoice (summary/flags included) so the
// report reflects the fix immediately. Single destination only — matches the resolve-line API.
import { useState } from "react";
import Modal from "@/components/Modal";

export interface UnresolvedLine {
  invoiceNumber: string;
  lineNo: number;
  shipDate: string | null;
  loadNumber: string | null;
  poText: string;
  amount: number;
  bolNumbers: string[];
  note: string | null;
}

interface FormState {
  bol: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  lines: UnresolvedLine[];
  onResolved: (result: any) => void;
}

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function keyFor(l: UnresolvedLine): string {
  return `${l.invoiceNumber}:${l.lineNo}`;
}

export default function ResolveUnmatchedModal({ isOpen, onClose, lines, onResolved }: Props) {
  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  function formFor(l: UnresolvedLine): FormState {
    return forms[keyFor(l)] ?? { bol: l.bolNumbers[0] ?? "", street: "", city: "", state: "", zip: "" };
  }

  function setFormField(l: UnresolvedLine, field: keyof FormState, value: string) {
    const k = keyFor(l);
    setForms((prev) => ({ ...prev, [k]: { ...formFor(l), [field]: value } }));
  }

  async function resolve(l: UnresolvedLine) {
    const k = keyFor(l);
    const f = formFor(l);
    if (!f.bol.trim()) {
      setErrors((prev) => ({ ...prev, [k]: "BOL # is required." }));
      return;
    }
    if (!f.city.trim() || !f.state.trim() || !f.zip.trim()) {
      setErrors((prev) => ({ ...prev, [k]: "City, state, and ZIP are required." }));
      return;
    }

    setErrors((prev) => ({ ...prev, [k]: "" }));
    setBusyKey(k);
    try {
      const res = await fetch("/v2/api/logistics/invoice/resolve-line", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceNumber: l.invoiceNumber,
          lineNo: l.lineNo,
          bolNumber: f.bol.trim(),
          street: f.street.trim(),
          city: f.city.trim(),
          state: f.state.trim(),
          zip: f.zip.trim(),
        }),
      });
      const body = await res.json();
      if (!body.ok) {
        setErrors((prev) => ({ ...prev, [k]: body.error || "Could not resolve this line." }));
        return;
      }
      setDoneKeys((prev) => new Set(prev).add(k));
      onResolved(body);
    } catch (e: any) {
      setErrors((prev) => ({ ...prev, [k]: e?.message || "Could not reach the server." }));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Resolve unmatched lines (${lines.length})`} size="xl">
      {lines.length === 0 ? (
        <p className="text-sm font-medium text-[var(--success-ink)]">
          All lines resolved — the report is up to date.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Enter the BOL # and destination address for each line below. This is a single
          destination per line — for a multi-stop load, use the final delivery address.
        </p>
      )}
      <div className="space-y-3">
        {lines.map((l) => {
          const k = keyFor(l);
          const isDone = doneKeys.has(k);
          const isBusy = busyKey === k;
          const f = formFor(l);
          return (
            <div key={k} className={`rounded-lg border border-[var(--card-border)] p-3 ${isDone ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <div className="text-sm font-medium text-text">
                  {l.invoiceNumber} · Line {l.lineNo}
                  {l.loadNumber ? ` · Load ${l.loadNumber}` : ""}
                </div>
                <div className="text-xs text-muted">
                  {l.shipDate ?? "—"} · {money(l.amount)}
                </div>
              </div>
              <div className="text-xs text-muted mb-2 truncate" title={l.poText}>
                {l.poText || "—"}
              </div>
              {l.note && !isDone && <div className="text-xs text-[var(--warn-text)] mb-2">{l.note}</div>}

              {isDone ? (
                <div className="text-sm font-medium text-[var(--success-ink)]">Resolved.</div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={f.bol}
                      onChange={(e) => setFormField(l, "bol", e.target.value)}
                      placeholder="BOL #"
                      disabled={isBusy}
                      className="min-h-[44px] w-28 rounded-md border border-[var(--input-border)] bg-surface text-text text-sm px-2"
                    />
                    <input
                      value={f.street}
                      onChange={(e) => setFormField(l, "street", e.target.value)}
                      placeholder="Street"
                      disabled={isBusy}
                      className="min-h-[44px] flex-1 min-w-[160px] rounded-md border border-[var(--input-border)] bg-surface text-text text-sm px-2"
                    />
                    <input
                      value={f.city}
                      onChange={(e) => setFormField(l, "city", e.target.value)}
                      placeholder="City"
                      disabled={isBusy}
                      className="min-h-[44px] w-36 rounded-md border border-[var(--input-border)] bg-surface text-text text-sm px-2"
                    />
                    <input
                      value={f.state}
                      onChange={(e) => setFormField(l, "state", e.target.value.toUpperCase())}
                      placeholder="ST"
                      maxLength={2}
                      disabled={isBusy}
                      className="min-h-[44px] w-16 rounded-md border border-[var(--input-border)] bg-surface text-text text-sm px-2 uppercase"
                    />
                    <input
                      value={f.zip}
                      onChange={(e) => setFormField(l, "zip", e.target.value)}
                      placeholder="ZIP"
                      disabled={isBusy}
                      className="min-h-[44px] w-24 rounded-md border border-[var(--input-border)] bg-surface text-text text-sm px-2"
                    />
                  </div>
                  {errors[k] && <div className="text-xs text-[var(--warn-text)] mt-1">{errors[k]}</div>}
                  <div className="flex justify-end mt-2">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => resolve(l)}
                      className="min-h-[44px] px-4 rounded-md bg-[var(--brand)] text-white text-sm font-medium hover:bg-[var(--brand-hover)] disabled:opacity-60 cursor-pointer"
                    >
                      {isBusy ? "Resolving…" : "Resolve"}
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
