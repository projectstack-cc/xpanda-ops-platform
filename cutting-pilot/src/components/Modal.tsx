"use client";
import type { ReactNode } from "react";
import { X } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: "md" | "lg" | "xl";
}

// Reusable modal primitive. Bottom-sheet on mobile, centered dialog on sm+.
// Closes only from inside: the X button or the caller's own actions (no backdrop click, no Escape — modal-01).
// Children own the action buttons.
export default function Modal({ isOpen, onClose, title, children, size = "md" }: Props) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
    >
      <div
        className={`w-full ${size === "xl" ? "sm:max-w-[min(52.5rem,92vw)]" : size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md"} bg-surface rounded-t-2xl sm:rounded-2xl shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto`}
        style={{ boxShadow: "var(--shadow-md)" }}
        // Not a close handler: keeps clicks inside the dialog from bubbling to a clickable ancestor
        // (e.g. a row with onClick) that renders this Modal inline.
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="flex items-center justify-between">
          <h2 id="modal-title" className="text-lg font-semibold text-text">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] text-muted hover:text-text rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            aria-label="Close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
