// src/app/carrier/CarrierStatusPill.tsx
// 4-state carrier load status pill. Doesn't reuse components/StatusPill.tsx — that component's
// variants are job/line-cutting states (not_started/in_progress/complete), a different domain
// than loading_status (awaiting/loading/loaded/in_transit/delivered).

const CARRIER_STATUS_VARIANTS: Record<string, { label: string; cls: string }> = {
  awaiting: { label: "Not ready", cls: "border border-[var(--border)] text-[var(--text-hint)]" },
  not_started: { label: "Not ready", cls: "border border-[var(--border)] text-[var(--text-hint)]" },
  loading: { label: "Ready", cls: "bg-[var(--success-bg)] text-[var(--success-text)]" },
  loaded: { label: "Ready", cls: "bg-[var(--success-bg)] text-[var(--success-text)]" },
  in_transit: {
    label: "In transit",
    cls: "bg-[var(--info-bg)] text-[var(--info-text)] border border-[var(--info-border)]",
  },
  delivered: {
    label: "Delivered",
    cls: "bg-[var(--ghost-bg)] text-[var(--text-muted)] border border-[var(--border)]",
  },
};

export default function CarrierStatusPill({ status }: { status: string }) {
  const variant = CARRIER_STATUS_VARIANTS[status] ?? CARRIER_STATUS_VARIANTS.awaiting;
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${variant.cls}`}
    >
      {variant.label}
    </span>
  );
}
