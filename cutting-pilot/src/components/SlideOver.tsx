"use client";
import type { ReactNode } from "react";
import { X } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** ord-dash-02: panel width on sm+. "sm" (default) = sm:max-w-sm; "xl" = sm:max-w-[820px] (order form). */
  size?: "sm" | "xl";
}

// Literal classes so Tailwind generates both.
const SIZE_CLASS: Record<NonNullable<Props["size"]>, string> = {
  sm: "sm:max-w-sm",
  xl: "sm:max-w-[820px]",
};

// Reusable right-anchored slide-over. Overlays from the right on ALL breakpoints
// (distinct from <Sheet>, which becomes a static side column on md+).
// Only the close button dismisses (no scrim click, no Escape — modal-01).
// ord-dash-02: children are UNMOUNTED while closed ({isOpen && children}), so every open starts
// fresh (no form / slip / blob state leaks between opens). The header (title + close) stays fixed;
// the body scrolls inside the panel. When open the panel carries no transform (transform-none), so
// `position: fixed` modals rendered inside it (Modal.tsx has no portal) still cover the viewport.
export default function SlideOver({ isOpen, onClose, title, children, size = "sm" }: Props) {
  return (
    <>
      {isOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm"
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-hidden={!isOpen}
        className={[
          `fixed inset-y-0 right-0 z-[56] w-full ${SIZE_CLASS[size]} bg-surface border-l border-border`,
          "flex flex-col overflow-hidden",
          "transition-[transform,visibility] duration-200 motion-reduce:transition-none",
          isOpen ? "transform-none" : "translate-x-full invisible",
        ].join(" ")}
        style={{ boxShadow: "var(--shadow-md)" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <h2 className="font-semibold text-sm text-text truncate">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 flex items-center justify-center min-w-[44px] min-h-[44px] text-muted hover:text-text rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">{isOpen && children}</div>
      </div>
    </>
  );
}
