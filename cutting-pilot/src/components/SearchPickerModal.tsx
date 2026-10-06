"use client";
// src/components/SearchPickerModal.tsx
// jb-06 — the one reusable searchable pick-list (trailer-group candidates, saved combos, …).
// Composes @/components/Modal; callers map their records to { id, primary, secondary }.
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import Modal from "@/components/Modal";

export interface SearchPickerItem {
  id: string;
  primary: string;
  secondary?: string;
}

interface SearchPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  items: SearchPickerItem[];
  onPick: (id: string) => void;
  loading?: boolean;
  error?: string | null;
  emptyText: string;
  searchPlaceholder?: string;
}

export default function SearchPickerModal({
  isOpen, onClose, title, items, onPick, loading = false, error = null, emptyText, searchPlaceholder = "Search…",
}: SearchPickerModalProps) {
  const [query, setQuery] = useState("");

  // Every open starts with an empty search.
  useEffect(() => {
    if (isOpen) setQuery("");
  }, [isOpen]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? items.filter((it) => it.primary.toLowerCase().includes(q) || (it.secondary ?? "").toLowerCase().includes(q))
    : items;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <label className="relative block">
        <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="w-full min-h-[44px] rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] text-text text-sm pl-9 pr-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        />
      </label>

      {error && <p className="text-sm text-[var(--warn-text)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted py-2">Loading…</p>
      ) : !error && filtered.length === 0 ? (
        <p className="text-sm text-muted py-2">{items.length === 0 ? emptyText : "No matches."}</p>
      ) : (
        <div className="rounded-lg border border-[var(--card-border)] divide-y divide-[var(--line)] max-h-[50vh] overflow-y-auto">
          {filtered.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onPick(it.id)}
              className="w-full min-h-[44px] px-3 py-2 text-left cursor-pointer hover:bg-[var(--ghost-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
            >
              <div className="text-sm font-semibold text-text">{it.primary}</div>
              {it.secondary && <div className="text-xs text-muted">{it.secondary}</div>}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
