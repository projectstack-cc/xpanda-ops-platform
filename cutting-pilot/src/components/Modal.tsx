"use client";
import { useEffect, type ReactNode } from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

// Reusable modal primitive. Bottom-sheet on mobile, centered dialog on sm+.
// Closes on Escape or backdrop click. Children own the action buttons.
export default function Modal({ isOpen, onClose, title, children }: Props) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-surface rounded-t-2xl sm:rounded-2xl shadow-xl p-6 space-y-4"
        style={{ boxShadow: "var(--shadow-md)" }}
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
            onClick={onClose}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] text-2xl leading-none text-muted hover:text-text rounded-lg"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
