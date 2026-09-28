"use client";
// Shared form styling + the Cancel/Submit footer for the prod-b-03 silo / bead modals — one
// definition so the new modals don't each carry their own copy.
import { useLang } from "@/components/lang";

export const FIELD_CLASS =
  "w-full min-h-[44px] px-3 rounded border border-border bg-bg text-text text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
export const LABEL_CLASS = "block text-xs font-semibold text-muted mb-1";
export const BTN_GHOST =
  "min-h-[44px] px-4 py-2 bg-[var(--ghost-bg)] text-text border border-border rounded text-sm font-semibold cursor-pointer hover:bg-[var(--border-light)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
export const BTN_PRIMARY =
  "min-h-[44px] px-4 py-2 bg-[var(--brand)] text-white rounded text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";

// Translates an API error code (or falls back to a generic key). Built once in ProductionBoard
// from its ERROR_KEY map and passed down.
export type DescribeError = (code: string | undefined, fallbackKey: string) => string;

export function FormActions({
  onCancel,
  acting,
  submitKey,
  actingKey,
  disabled,
}: {
  onCancel: () => void;
  acting: boolean;
  submitKey: string;
  actingKey: string;
  disabled?: boolean;
}) {
  const { t } = useLang();
  return (
    <div className="flex gap-2 justify-end pt-1">
      <button type="button" onClick={onCancel} className={BTN_GHOST}>
        {t("production.common.cancel")}
      </button>
      <button type="submit" disabled={acting || disabled} className={BTN_PRIMARY}>
        {acting ? t(actingKey) : t(submitKey)}
      </button>
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-[var(--danger-bg)]">
      {message}
    </p>
  );
}
