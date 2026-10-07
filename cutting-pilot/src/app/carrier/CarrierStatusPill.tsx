// src/app/carrier/CarrierStatusPill.tsx
// 4-state carrier load status pill (+ the 3 Schedule-tab labels, carrier-05). Doesn't reuse components/StatusPill.tsx — that component's
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
  delivered: { label: "Delivered", cls: "text-[var(--text-muted)]" },
  // carrier-05: Schedule-tab labels (from /v2/api/carrier/schedule's carrier-facing status map).
  "Not ready": { label: "Not ready", cls: "border border-[var(--border)] text-[var(--text-hint)]" },
  Ready: { label: "Ready", cls: "bg-[var(--success-bg)] text-[var(--success-text)]" },
  Shipped: { label: "Shipped", cls: "text-[var(--text-muted)]" },
};

export default function CarrierStatusPill({ status }: { status: string }) {
  const variant = CARRIER_STATUS_VARIANTS[status] ?? CARRIER_STATUS_VARIANTS.awaiting;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wide whitespace-nowrap ${variant.cls}`}
    >
      {variant.label}
    </span>
  );
}
