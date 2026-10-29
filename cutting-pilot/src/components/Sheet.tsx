"use client";
import type { ReactNode } from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

// Responsive detail surface:
//   narrow  → fixed bottom-sheet overlay (scrim + slide-up); closes only from the caller's own close
//             control inside its children (no scrim click, no Escape — modal-01). `onClose` stays in
//             the props contract; callers still pass it.
//   md+     → static flex-1 side column in the flex layout; no scrim, no close affordance
// The scrim is the only place backdrop-blur is used per design doctrine.
export default function Sheet({ isOpen, children }: Props) {
  return (
    <>
      {/* Scrim: narrow only, when open */}
      {isOpen && (
        <div
          aria-hidden="true"
          className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        />
      )}

      {/*
        Panel classes:
          narrow  : fixed bottom-0, slide in/out via translate-y, max 80vh
          md+     : static, flex-1, no max-height, always in layout
      */}
      <div
        role="region"
        aria-label="Job detail"
        className={[
          "fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto bg-surface rounded-t-xl",
          "transition-transform duration-200 motion-reduce:transition-none",
          isOpen ? "translate-y-0" : "translate-y-full",
          "md:static md:flex-1 md:translate-y-0 md:max-h-none md:rounded-none md:z-auto",
          "md:border-l md:border-border md:overflow-y-auto",
        ].join(" ")}
      >
        {children}
      </div>
    </>
  );
}
