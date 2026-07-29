// src/components/schedule/PixelShiftLayer.tsx
// Continuous burn-in mitigation for the 24/7 wall TV: wraps the board content (everything below
// the header) in a slightly overscanned container that CSS-animates via `transform: translate()`
// only, so nothing reflows and text never jumps. The animation itself (amplitude + cycle) lives
// in globals.css (`.xpanda-pixel-shift-layer` / `@keyframes xpanda-pixel-shift`) — single
// definition, disabled below 1024px and under prefers-reduced-motion there.
import type { ReactNode } from "react";

interface PixelShiftLayerProps {
  children: ReactNode;
}

export default function PixelShiftLayer({ children }: PixelShiftLayerProps) {
  return (
    <div className="relative flex-1 min-h-0 overflow-hidden">
      <div className="xpanda-pixel-shift-layer flex flex-col">{children}</div>
    </div>
  );
}
