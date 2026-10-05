"use client";
// src/components/schedule/InteractiveScrollColumn.tsx
// Desk (non-TV) counterpart to AutoScrollColumn. Same slow crawl for an overflowing column, but:
//  - a native scrollbar (overflow-y-auto) so the user can scroll manually, and
//  - the crawl PAUSES while the pointer is over the column (resumes on leave) so a user can read
//    or click a row without it moving.
// Single content copy (no seamless duplicate) so the scrollbar thumb reflects the real position; on
// reaching the bottom it dwells briefly, then resets to the top.
// sched-mobile-01: below `sm` the viewport is unconstrained (content-height, overflow visible), so the crawl idles (canScroll=false) and ScrollWrapMarker never renders — the whole day shows and the page scrolls.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SCHEDULE_SCROLL_PX_PER_SEC } from "./AutoScrollColumn";
import ScrollWrapMarker from "./ScrollWrapMarker";

const BOTTOM_DWELL_MS = 1500;

export default function InteractiveScrollColumn({ children }: { children: React.ReactNode }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(false);
  const posRef = useRef(0);
  const dwellUntilRef = useRef(0);
  const [overflowing, setOverflowing] = useState(false);

  // Re-measure on children change (60s poll swaps data) and on any resize of either the
  // viewport (band height) or the content (rows added/removed) — same two-node approach as
  // AutoScrollColumn, so ScrollWrapMarker only appears once this column is actually overflowing.
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) return;
    const recompute = () => setOverflowing(content.scrollHeight > vp.clientHeight + 1);
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(vp);
    ro.observe(content);
    return () => ro.disconnect();
  }, [children]);

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
      className="sm:flex-1 sm:min-h-0 sm:overflow-y-auto"
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}
    >
      <div ref={contentRef}>
        {children}
        {overflowing && <ScrollWrapMarker />}
      </div>
    </div>
  );
}
