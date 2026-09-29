// src/app/carrier/CarrierErrorBox.tsx
// Shared error + Retry box for every Carrier View tab (pairs with useCarrierFetch).
export default function CarrierErrorBox({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-[var(--danger-bg)] bg-[var(--surface)] px-4 py-4 text-center">
      <p className="text-sm font-semibold text-[var(--danger-bg)] mb-3">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-[44px] px-5 rounded-md bg-[var(--accent)] text-[var(--surface)] text-sm font-semibold"
      >
        Retry
      </button>
    </div>
  );
}
