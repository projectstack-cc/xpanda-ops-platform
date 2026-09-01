"use client";
// src/components/schedule/InteractiveScrollColumn.tsx
// Desk (non-TV) counterpart to AutoScrollColumn. Same slow crawl for an overflowing column, but:
//  - a native scrollbar (overflow-y-auto) so the user can scroll manually, and
//  - the crawl PAUSES while the pointer is over the column (resumes on leave) so a user can read
//    or click a row without it moving.
// Single content copy (no seamless duplicate) so the scrollbar thumb reflects the real position; on
// reaching the bottom it dwells briefly, then resets to the top.
import { useEffect, useRef } from "react";
import { SCHEDULE_SCROLL_PX_PER_SEC } from "./AutoScrollColumn";

const BOTTOM_DWELL_MS = 1500;

export default function InteractiveScrollColumn({ children }: { children: React.ReactNode }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(false);
  const posRef = useRef(0);
  const dwellUntilRef = useRef(0);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const canScroll = vp.scrollHeight > vp.clientHeight + 1;
      if (!canScroll || pausedRef.current) {
        // stay synced with the native/manual position so the crawl resumes from where the user left
        posRef.current = vp.scrollTop;
      } else if (now >= dwellUntilRef.current) {
        const maxTop = vp.scrollHeight - vp.clientHeight;
        if (posRef.current >= maxTop - 0.5) {
          dwellUntilRef.current = now + BOTTOM_DWELL_MS;
          posRef.current = 0;
        } else {
          posRef.current += SCHEDULE_SCROLL_PX_PER_SEC * dt; // float accumulator (scrollTop may floor)
        }
        vp.scrollTop = posRef.current;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={viewportRef}
      className="flex-1 min-h-0 overflow-y-auto"
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}
    >
      {children}
    </div>
  );
}
