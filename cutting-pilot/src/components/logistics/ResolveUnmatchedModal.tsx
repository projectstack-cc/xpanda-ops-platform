"use client";
// src/components/logistics/ResolveUnmatchedModal.tsx
// Lets Steve manually complete a line the auto-resolver couldn't (no BOL/order on file, or
// mileage unavailable) by typing in the BOL # and ship-to address for each stop. Posts one line at
// a time to /v2/api/logistics/invoice/resolve-line; each success replaces the caller's `result`
// with the freshly recomputed InvoiceResult for that invoice (summary/flags included) so the
// report reflects the fix immediately. One stop → matched; 2–6 stops (inv-resolve-01) → stored as
// a multi-destination line, routed in the order entered — matches the resolve-line API.
// inv-resolve-02: a stop's BOL # is looked up (on blur / Enter, and once on open for prefilled BOLs)
// via /v2/api/logistics/invoice/bol-lookup — the ingest's own linkage — and fills that stop's
// address unless the user typed one. Filling is not resolving; Resolve is still a click.
import { useEffect, useRef, useState } from "react";
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

interface StopForm {
  bol: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  autoFilledFrom: string | null;
}

interface LookupState {
  kind: "loading" | "filled" | "notfound" | "error";
  text: string;
}

const ADDRESS_FIELDS: (keyof StopForm)[] = ["street", "city", "state", "zip"];

interface FormState {
  stops: StopForm[];
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  lines: UnresolvedLine[];
  onResolved: (result: any) => void;
}

const MAX_STOPS = 6;

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function keyFor(l: UnresolvedLine): string {
  return `${l.invoiceNumber}:${l.lineNo}`;
}

function blankStop(bol = ""): StopForm {
  return { bol, street: "", city: "", state: "", zip: "", autoFilledFrom: null };
}

function StopRow({
  stop,
  disabled,
  onChange,
  onBolCommit,
}: {
  stop: StopForm;
  disabled: boolean;
  onChange: (field: "bol" | "street" | "city" | "state" | "zip", value: string) => void;
  onBolCommit: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <input
        value={stop.bol}
        onChange={(e) => onChange("bol", e.target.value)}
        onBlur={onBolCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onBolCommit();
          }
        }}
        placeholder="BOL #"
        disabled={disabled}
        className="min-h-[44px] w-28 rounded-md border border-[var(--input-border)] bg-surface text-text text-sm px-2"
      />
      <input
        value={stop.street}
        onChange={(e) => onChange("street", e.target.value)}
        placeholder="Street"
        disabled={disabled}
        className="min-h-[44px] flex-1 min-w-[160px] rounded-md border border-[var(--input-border)] bg-surface text-text text-sm px-2"
      />
      <input
        value={stop.city}
        onChange={(e) => onChange("city", e.target.value)}
        placeholder="City"
        disabled={disabled}
        className="min-h-[44px] w-36 rounded-md border border-[var(--input-border)] bg-surface text-text text-sm px-2"
      />
      <input
        value={stop.state}
        onChange={(e) => onChange("state", e.target.value.toUpperCase())}
        placeholder="ST"
        maxLength={2}
        disabled={disabled}
        className="min-h-[44px] w-16 rounded-md border border-[var(--input-border)] bg-surface text-text text-sm px-2 uppercase"
      />
      <input
        value={stop.zip}
        onChange={(e) => onChange("zip", e.target.value)}
        placeholder="ZIP"
        disabled={disabled}
        className="min-h-[44px] w-24 rounded-md border border-[var(--input-border)] bg-surface text-text text-sm px-2"
      />
    </div>
  );
}

export default function ResolveUnmatchedModal({ isOpen, onClose, lines, onResolved }: Props) {
  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Per-stop lookup status, keyed `${lineKey}#${stopIndex}`; cleared for a line when a stop is removed.
  const [lookups, setLookups] = useState<Record<string, LookupState>>({});
  const lastLookedUp = useRef<Record<string, string>>({});
  // Latest forms for async lookups, so a fill decision never uses a stale render's state.
  const formsRef = useRef(forms);
  formsRef.current = forms;

  function defaultForm(l: UnresolvedLine): FormState {
    // A line already carrying several BOL tokens is most likely multi-stop — one stop per token.
    if (l.bolNumbers.length > 1) return { stops: l.bolNumbers.map((b) => blankStop(b)) };
    return { stops: [blankStop(l.bolNumbers[0] ?? "")] };
  }

  function formFor(l: UnresolvedLine): FormState {
    return forms[keyFor(l)] ?? defaultForm(l);
  }

  function setStops(l: UnresolvedLine, update: (stops: StopForm[]) => StopForm[]) {
    const k = keyFor(l);
    setForms((prev) => {
      const next = { ...prev, [k]: { stops: update((prev[k] ?? defaultForm(l)).stops) } };
      formsRef.current = next;
      return next;
    });
  }

  function setLookup(stopKey: string, state: LookupState | null) {
    setLookups((prev) => {
      const next = { ...prev };
      if (state) next[stopKey] = state;
      else delete next[stopKey];
      return next;
    });
  }

  function setStopField(l: UnresolvedLine, index: number, field: "bol" | "street" | "city" | "state" | "zip", value: string) {
    const isAddress = ADDRESS_FIELDS.includes(field);
    // A manual address edit makes the address the user's own: never auto-overwrite it again.
    if (isAddress && formFor(l).stops[index]?.autoFilledFrom) setLookup(`${keyFor(l)}#${index}`, null);
    setStops(l, (stops) =>
      stops.map((st, i) => (i === index ? { ...st, [field]: value, ...(isAddress ? { autoFilledFrom: null } : {}) } : st))
    );
  }

  function removeStop(l: UnresolvedLine, index: number) {
    const k = keyFor(l);
    setStops(l, (s) => s.filter((_, j) => j !== index));
    // Stop indexes shift — drop this line's lookup state rather than mislabel the remaining stops.
    setLookups((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(`${k}#`))));
    for (const key of Object.keys(lastLookedUp.current)) {
      if (key.startsWith(`${k}#`)) delete lastLookedUp.current[key];
    }
  }

  async function lookupStop(l: UnresolvedLine, index: number) {
    const k = keyFor(l);
    const stopKey = `${k}#${index}`;
    const current = (formsRef.current[k] ?? defaultForm(l)).stops[index];
    const bol = current?.bol.trim() ?? "";
    if (!bol || lastLookedUp.current[stopKey] === bol) return;
    lastLookedUp.current[stopKey] = bol;

    setLookup(stopKey, { kind: "loading", text: "Looking up…" });
    try {
      const res = await fetch(`/v2/api/logistics/invoice/bol-lookup?bol=${encodeURIComponent(bol)}`, {
        credentials: "same-origin",
      });
      const body = await res.json();
      if (!body.ok) {
        setLookup(stopKey, { kind: "error", text: body.error || "Could not look up that BOL." });
        return;
      }
      if (!body.found) {
        setLookup(stopKey, { kind: "notfound", text: "No BOL or order on file — enter the address." });
        return;
      }

      const latest = (formsRef.current[k] ?? defaultForm(l)).stops[index];
      if (!latest) return;
      const addressEmpty = ADDRESS_FIELDS.every((f) => String(latest[f] ?? "").trim() === "");
      if (!addressEmpty && !latest.autoFilledFrom) {
        // The user typed this address — leave it alone.
        setLookup(stopKey, null);
        return;
      }
      setStops(l, (stops) =>
        stops.map((st, i) =>
          i === index
            ? {
                ...st,
                street: body.address.street ?? "",
                city: body.address.city ?? "",
                state: String(body.address.state ?? "").toUpperCase(),
                zip: body.address.zip ?? "",
                autoFilledFrom: body.bolNumber,
              }
            : st
        )
      );
      setLookup(stopKey, {
        kind: "filled",
        text:
          body.source === "job" && body.fallbackBase
            ? `Address from order INV# ${body.fallbackBase}`
            : `Address from BOL ${body.bolNumber}`,
      });
    } catch (e: any) {
      setLookup(stopKey, { kind: "error", text: e?.message || "Could not reach the server." });
    }
  }

  // On open, look up each prefilled BOL once — sequentially, only stops that have a BOL.
  const prefetchedOpen = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      prefetchedOpen.current = false;
      return;
    }
    if (prefetchedOpen.current) return;
    prefetchedOpen.current = true;
    (async () => {
      for (const l of lines) {
        if (doneKeys.has(keyFor(l))) continue;
        const stops = (formsRef.current[keyFor(l)] ?? defaultForm(l)).stops;
        for (let i = 0; i < stops.length; i++) {
          if (stops[i].bol.trim()) await lookupStop(l, i);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function resolve(l: UnresolvedLine) {
    const k = keyFor(l);
    const stops = formFor(l).stops.map((st) => ({
      bolNumber: st.bol.trim(),
      street: st.street.trim(),
      city: st.city.trim(),
      state: st.state.trim(),
      zip: st.zip.trim(),
    }));
    for (let i = 0; i < stops.length; i++) {
      const prefix = stops.length > 1 ? `Stop ${i + 1}: ` : "";
      if (!stops[i].bolNumber) {
        setErrors((prev) => ({ ...prev, [k]: `${prefix}BOL # is required.` }));
        return;
      }
      if (!stops[i].city || !stops[i].state || !stops[i].zip) {
        setErrors((prev) => ({ ...prev, [k]: `${prefix}City, state, and ZIP are required.` }));
        return;
      }
    }

    setErrors((prev) => ({ ...prev, [k]: "" }));
    setBusyKey(k);
    try {
      const res = await fetch("/v2/api/logistics/invoice/resolve-line", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        // Flat fields mirror stop 1 so the body is valid against a server without `stops` support.
        body: JSON.stringify({
          invoiceNumber: l.invoiceNumber,
          lineNo: l.lineNo,
          bolNumber: stops[0].bolNumber,
          street: stops[0].street,
          city: stops[0].city,
          state: stops[0].state,
          zip: stops[0].zip,
          stops,
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
          Enter the BOL # and destination address for each line below. For a multi-stop load, add
          each stop in delivery order.
        </p>
      )}
      <div className="space-y-3">
        {lines.map((l) => {
          const k = keyFor(l);
          const isDone = doneKeys.has(k);
          const isBusy = busyKey === k;
          const { stops } = formFor(l);
          const multi = stops.length > 1;
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
                  <div className="space-y-2">
                    {stops.map((st, i) => (
                      <div key={i}>
                        {multi && (
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-muted">Stop {i + 1}</span>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => removeStop(l, i)}
                              className="min-h-[44px] px-3 rounded-md text-xs font-medium text-muted hover:text-text hover:bg-[var(--surface-2)] disabled:opacity-60 cursor-pointer"
                            >
                              Remove
                            </button>
                          </div>
                        )}
                        <StopRow
                          stop={st}
                          disabled={isBusy}
                          onChange={(field, value) => setStopField(l, i, field, value)}
                          onBolCommit={() => lookupStop(l, i)}
                        />
                        {lookups[`${k}#${i}`] && (
                          <div
                            className={`text-xs mt-1 ${
                              lookups[`${k}#${i}`].kind === "error" ? "text-[var(--warn-text)]" : "text-muted"
                            }`}
                          >
                            {lookups[`${k}#${i}`].text}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {errors[k] && <div className="text-xs text-[var(--warn-text)] mt-1">{errors[k]}</div>}
                  <div className="flex flex-wrap justify-between gap-2 mt-2">
                    {stops.length < MAX_STOPS ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setStops(l, (s) => [...s, blankStop()])}
                        className="min-h-[44px] px-4 rounded-md border border-[var(--card-border)] text-sm font-medium text-text hover:bg-[var(--surface-2)] disabled:opacity-60 cursor-pointer"
                      >
                        + Add stop
                      </button>
                    ) : (
                      <span />
                    )}
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
