"use client";
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

// Reusable right-anchored slide-over. Overlays from the right on ALL breakpoints
// (distinct from <Sheet>, which becomes a static side column on md+).
// Scrim, Escape, and the close button all dismiss.
export default function SlideOver({ isOpen, onClose, title, children }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  return (
    <>
      {isOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[55] bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />
      )}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={[
          "fixed inset-y-0 right-0 z-[56] w-full sm:max-w-sm bg-surface border-l border-border",
          "flex flex-col overflow-hidden",
          "transition-transform duration-200 motion-reduce:transition-none",
          isOpen ? "translate-x-0" : "translate-x-full",
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
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </>
  );
}
