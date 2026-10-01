"use client";
// src/components/dashboard/SearchInput.tsx
// board-ui-01: toolbar search box with icon + clear-X, shared by the v2 Shipment Dashboard and Job
// Board (JSX + classes moved verbatim from ShipmentDashboard.tsx).
import { Search, X } from "lucide-react";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

export default function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  return (
    <div className="relative flex-1 md:w-64">
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-9 pl-9 pr-8 text-xs rounded-lg border border-[var(--border)] bg-surface text-text placeholder:text-muted focus:outline-hidden focus:border-[var(--brand)] transition-colors"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-text text-sm cursor-pointer"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
