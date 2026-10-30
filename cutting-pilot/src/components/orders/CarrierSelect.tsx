"use client";
// mlc-05: the one carrier dropdown used by every v2 carrier input (order entry, board edit, shipment
// edit, BOL generate, per-load carrier column). Options come from GET /v2/api/carrier-options
// (bol_carriers, active, sort_order) through a module-level cache, so one fetch serves every select
// on the page and refresh() after an add updates them all.
// - A saved value that isn't in the list shows as "{value} (not in list)" and round-trips unchanged.
// - A value that matches an option in a different casing displays as that option; the parent's
//   value is NOT rewritten on open (that would raise unsaved-changes banners) — the canonical
//   spelling is written once the user picks it.
// - "+ Add carrier…" (when can_add) opens a small dialog composed from Modal. It is portaled to
//   <body> (call sites sit inside <label>s and <form>s). Like every v2 Modal it closes only from inside
//   (X / Add / Cancel); Escape is swallowed and does nothing (modal-02).
import { useEffect, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Modal from "@/components/Modal";

export interface CarrierOption {
  id: string;
  name: string;
}

interface CarrierOptionsState {
  carriers: CarrierOption[];
  canAdd: boolean;
  loaded: boolean;
}

let cache: CarrierOptionsState = { carriers: [], canAdd: false, loaded: false };
let inflight: Promise<void> | null = null;
const listeners = new Set<(s: CarrierOptionsState) => void>();

function load(force = false): Promise<void> {
  if (inflight) return inflight;
  if (cache.loaded && !force) return Promise.resolve();
  inflight = fetch("/v2/api/carrier-options")
    .then((r) => r.json())
    .then((d: any) => {
      if (d?.ok) {
        cache = { carriers: Array.isArray(d.carriers) ? d.carriers : [], canAdd: !!d.can_add, loaded: true };
        listeners.forEach((fn) => fn(cache));
      }
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useCarrierOptions() {
  const [state, setState] = useState<CarrierOptionsState>(cache);
  useEffect(() => {
    listeners.add(setState);
    setState(cache);
    load();
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return { ...state, refresh: () => load(true) };
}

const ADD_SENTINEL = "__mlc05_add_carrier__";
const norm = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();

const defaultClass =
  "w-full min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";

interface Props {
  value: string;
  onChange(v: string): void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  className?: string;
}

export default function CarrierSelect({ value, onChange, disabled, placeholder, id, className }: Props) {
  const { carriers, canAdd, refresh } = useCarrierOptions();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const raw = String(value ?? "");
  const match = raw.trim() ? carriers.find((c) => norm(c.name) === norm(raw)) : undefined;
  const preserved = raw.trim() !== "" && !match;
  const selected = !raw.trim() ? "" : match ? match.name : raw;

  function closeAdd() {
    setAdding(false);
    setNewName("");
    setError("");
  }

  async function submitAdd() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/v2/api/carrier-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const d: any = await res.json().catch(() => ({}));
      if (!res.ok || !d?.ok || !d?.carrier?.name) {
        setError(d?.error || `Couldn't add carrier (HTTP ${res.status}).`);
        return;
      }
      await refresh();
      onChange(d.carrier.name);
      closeAdd();
    } catch (e: any) {
      setError(String(e?.message || e) || "Couldn't add carrier.");
    } finally {
      setSaving(false);
    }
  }

  function onDialogKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      // modal-02: Escape never closes this dialog (modal-01 rule: close only via X / Add / Cancel).
      // Still swallowed here so it can't reach any document-level listener behind the dialog
      // (popovers, the dock tablet's menu, the Load Builder editor).
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
    } else if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
      submitAdd();
    }
  }

  return (
    <>
      <select
        id={id}
        value={selected}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === ADD_SENTINEL) {
            setAdding(true);
            return;
          }
          onChange(e.target.value);
        }}
        className={className || defaultClass}
      >
        <option value="">{placeholder || "Select carrier"}</option>
        {carriers.map((c) => (
          <option key={c.id} value={c.name}>
            {c.name}
          </option>
        ))}
        {preserved && <option value={raw}>{`${raw} (not in list)`}</option>}
        {canAdd && <option value={ADD_SENTINEL}>+ Add carrier…</option>}
      </select>
      {adding &&
        typeof document !== "undefined" &&
        createPortal(
          <div onKeyDown={onDialogKeyDown}>
            <Modal isOpen={adding} onClose={closeAdd} title="Add carrier">
              <label className="block">
                <span className="block text-xs font-semibold text-muted mb-1">Carrier name</span>
                <input
                  type="text"
                  autoFocus
                  maxLength={60}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className={defaultClass}
                  placeholder="e.g. Seal Express - Dry Van"
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-[var(--danger-ink)]">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeAdd}
                  className="min-h-[44px] px-4 rounded-md border border-[var(--border)] text-text text-sm cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitAdd}
                  disabled={saving || newName.trim().length < 2}
                  className="min-h-[44px] px-4 rounded-md bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
                >
                  {saving ? "Adding…" : "Add"}
                </button>
              </div>
            </Modal>
          </div>,
          document.body
        )}
    </>
  );
}
