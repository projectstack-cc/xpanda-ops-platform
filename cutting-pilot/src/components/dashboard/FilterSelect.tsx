"use client";
// src/components/dashboard/FilterSelect.tsx
// board-ui-01: toolbar <select> filter with a leading "all" option, shared by the v2 Shipment
// Dashboard and Job Board (JSX + classes moved verbatim from ShipmentDashboard.tsx).

export interface FilterOption {
  value: string;
  label: string;
}

interface FilterSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  allLabel: string;
}

export default function FilterSelect({ value, onChange, options, allLabel }: FilterSelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 px-3 text-xs rounded-lg border border-[var(--border)] bg-surface text-text focus:outline-hidden focus:border-[var(--brand)] cursor-pointer"
    >
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
