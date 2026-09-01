"use client";
// src/components/schedule/AutoScrollColumn.tsx
// Wraps a day column's rows region. If the rendered rows are taller than the available column
// height, they crawl upward in a seamless vertical loop (departures-board style) so every order is
// shown in turn — without shrinking rows or shedding fields. If they fit, renders them statically
// with no motion. Replaces the retired shrink-to-fit density tiering (density.ts).
import { useLayoutEffect, useRef, useState } from "react";

// Steve-locked crawl rate (P423, from wall testing): slow enough to read a row as it passes.
export const SCHEDULE_SCROLL_PX_PER_SEC = 10;

interface AutoScrollColumnProps {
  children: React.ReactNode;
}

export default function AutoScrollColumn({ children }: AutoScrollColumnProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [contentH, setContentH] = useState(0);

  // Re-measure on children change (60s poll swaps data) and on any resize of either the viewport
  // (band height) or the content (rows added/removed). ResizeObserver covers both.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const measure = measureRef.current;
    if (!viewport || !measure) return;

    const recompute = () => {
      const vpH = viewport.clientHeight;
      const cH = measure.scrollHeight;
      setContentH(cH);
      setOverflow(cH > vpH + 1);
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(viewport);
    ro.observe(measure);
    return () => ro.disconnect();
  }, [children]);

  const durationS = overflow && contentH > 0 ? contentH / SCHEDULE_SCROLL_PX_PER_SEC : 0;

  return (
    <div ref={viewportRef} className="flex-1 min-h-0 overflow-hidden">
      {overflow ? (
        // Two identical copies stacked; the track animates up by exactly one copy's height, so the
        // moment copy #2 reaches the top it's pixel-identical to the start → seamless loop.
        <div
          className="sched-scroll-track"
          style={
            {
              "--sched-scroll-h": `${contentH}px`,
              animationDuration: `${durationS}s`,
            } as React.CSSProperties
          }
        >
          <div ref={measureRef}>{children}</div>
          <div aria-hidden="true">{children}</div>
        </div>
      ) : (
        <div ref={measureRef}>{children}</div>
      )}
    </div>
  );
}
