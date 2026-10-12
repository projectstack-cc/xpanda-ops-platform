"use client";
// src/app/logistics/load-builder/LoadBuilderTabs.tsx
// lbr-05: legacy-style tab bar — Load · Parts · Results — with the lbr-04 order-save status chip on
// the right. Presentational only: the active tab and the chip's status come in as props. Tabs scroll
// horizontally on a phone instead of wrapping; every tab is >= 44px.
import type { OrderLoadStatus } from "@/components/logistics/useOrderLoadPersistence";
import { formatEt } from "./loadBuilderUi";

export type LoadBuilderTab = "load" | "parts" | "results";

export const LOAD_BUILDER_TABS: { id: LoadBuilderTab; label: string }[] = [
  { id: "load", label: "Load" },
  { id: "parts", label: "Parts" },
  { id: "results", label: "Results" },
];

export function isLoadBuilderTab(v: string | null): v is LoadBuilderTab {
  return v === "load" || v === "parts" || v === "results";
}

interface LoadBuilderTabsProps {
  tab: LoadBuilderTab;
  onChange: (tab: LoadBuilderTab) => void;
  status: OrderLoadStatus;
  savedAt: string | null;
  /** True when the load belongs to an order ("Saved to order" vs "Saved"). */
  isOrderLoad: boolean;
}

export default function LoadBuilderTabs({ tab, onChange, status, savedAt, isOrderLoad }: LoadBuilderTabsProps) {
  return (
    <div className="flex flex-wrap-reverse items-center gap-x-3 gap-y-1 border-b border-[var(--line)]">
      <div role="tablist" aria-label="Load Builder" className="flex gap-1 overflow-x-auto -mb-px max-w-full">
        {LOAD_BUILDER_TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`lb-tab-${t.id}`}
              aria-selected={active}
              aria-controls={`lb-panel-${t.id}`}
              onClick={() => onChange(t.id)}
              className={[
                "shrink-0 min-h-[44px] px-5 text-sm font-semibold cursor-pointer border-b-2 transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                active ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-muted hover:text-text",
              ].join(" ")}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {status !== "none" && (
        <span
          role="status"
          className={[
            "ml-auto shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap border",
            status === "saved"
              ? "bg-[var(--loaded-bg)] text-[var(--loaded-text)] border-[var(--loaded-border)]"
              : status === "saving"
                ? "border-[var(--border)] text-muted"
                : "bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]",
          ].join(" ")}
        >
          {status === "saved"
            ? `${isOrderLoad ? "Saved to order" : "Saved"}${savedAt ? ` · ${formatEt(savedAt, false)}` : ""}`
            : status === "saving"
              ? "Saving…"
              : status === "error"
                ? "Unsaved changes · save failed"
                : "Unsaved changes"}
        </span>
      )}
    </div>
  );
}
