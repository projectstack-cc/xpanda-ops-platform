"use client";
// src/components/orders/PartsPicker.tsx
// P429 — "From parts library" picker for /v2/orders. Composes the shared <Modal> primitive
// (no copy-paste overlay). Fetches the legacy unified parts library (/api/parts, same host +
// shared session cookie); selecting a part appends a prefilled line item, carrying part_id
// through to POST /v2/api/orders.
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import type { OrderLineItem } from "@/components/orders/OrderEntryForm";

interface Part {
  id: string;
  part_number: string;
  customer: string;
  density_material: string;
  length_in: number | string;
  width_in: number | string;
  height_in: number | string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onPick: (line: OrderLineItem) => void;
}

// Module-level cache so re-opening the picker doesn't refetch within a session.
let partsCache: Part[] | null = null;

export default function PartsPicker({ isOpen, onClose, onPick }: Props) {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    if (partsCache) {
      setParts(partsCache);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch("/api/parts");
        const body = await res.json();
        if (!res.ok || !body?.ok) throw new Error("load failed");
        partsCache = (body.parts as Part[]) || [];
        if (!cancelled) setParts(partsCache);
      } catch {
        if (!cancelled) setError("Failed to load parts.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const dims = (p: Part) => `${p.length_in}×${p.width_in}×${p.height_in}`;
  const q = query.toLowerCase();
  const filtered = parts.filter(
    (p) =>
      (p.part_number || "").toLowerCase().includes(q) ||
      (p.customer || "").toLowerCase().includes(q)
  );

  function pick(p: Part) {
    onPick({
      part_id: p.id,
      part_number: p.part_number || "",
      description: `${p.density_material} ${dims(p)}`.trim(),
      quantity: "1",
      dimensions: dims(p),
      density: p.density_material || "",
    });
    onClose();
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add from parts library" size="lg">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by part # or customer…"
        className="w-full min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
      />
      <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1">
        {loading && <p className="text-sm text-muted px-2 py-3">Loading…</p>}
        {error && <p className="text-sm text-[var(--warn-text)] px-2 py-3">{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="text-sm text-muted px-2 py-3">No parts found.</p>
        )}
        <div className="space-y-2">
          {filtered.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pick(p)}
              className="w-full text-left min-h-[44px] rounded-md border border-[var(--card-border)] px-3 py-2 cursor-pointer hover:bg-[var(--ghost-bg)]"
            >
              <div className="text-sm font-semibold text-text">{p.part_number || "—"}</div>
              <div className="text-xs text-muted font-mono tabular-nums">
                {[p.customer, p.density_material, dims(p)].filter(Boolean).join(" · ")}
              </div>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
