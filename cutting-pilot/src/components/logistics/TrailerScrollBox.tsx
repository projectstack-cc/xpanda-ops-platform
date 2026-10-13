// src/components/logistics/TrailerScrollBox.tsx
// lbr-09 (Steve, 2026-10-13): the Load Builder's trailer cards (Results and Customize) sit in a
// scroll box about two trailers tall, so the side panel with the tools stays in place while the
// planner scrolls through trucks. Presentational only — the children are the trailer cards.
//
// xl and up, with 3+ trailers: the box is its own vertical scroll area, max-height = the measured
// height of the first card × 2 + the gap (ResizeObserver; 80vh until measured), focusable
// (tabIndex 0, role="region", aria-label "Trailers") with a visible focus ring, and a small
// "Trailer N of M" count above it (N = the card at the top of the box). With one or two trailers it
// doesn't scroll. Below xl it's a plain stack in the page's own scroll — no nested scroll areas on
// phones or tablets.
"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const XL_QUERY = "(min-width: 1280px)";
const GAP_PX = 16; // gap-4, between cards

interface TrailerScrollBoxProps {
  /** How many trailer cards are passed as children. */
  count: number;
  children: ReactNode;
}

export default function TrailerScrollBox({ count, children }: TrailerScrollBoxProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [isXl, setIsXl] = useState(false);
  const [maxPx, setMaxPx] = useState<number | null>(null);
  const [topIndex, setTopIndex] = useState(0);
  const scrolls = isXl && count > 2;

  useEffect(() => {
    const mq = window.matchMedia(XL_QUERY);
    const update = () => setIsXl(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!scrolls) return;
    const first = boxRef.current?.firstElementChild as HTMLElement | null;
    if (!first) return;
    const measure = () => setMaxPx(first.getBoundingClientRect().height * 2 + GAP_PX);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(first);
    return () => observer.disconnect();
  }, [scrolls, count]);

  useEffect(() => {
    if (topIndex > count - 1) setTopIndex(Math.max(0, count - 1));
  }, [count, topIndex]);

  function handleScroll() {
    const box = boxRef.current;
    if (!box) return;
    const cards = Array.from(box.children) as HTMLElement[];
    const index = cards.findIndex((el) => el.offsetTop + el.offsetHeight > box.scrollTop + 1);
    setTopIndex(index < 0 ? 0 : index);
  }

  return (
    <div className="min-w-0">
      {scrolls && (
        <p className="mb-2 text-xs font-mono tabular-nums text-muted" aria-live="polite">
          Trailer {topIndex + 1} of {count}
        </p>
      )}
      <div
        ref={boxRef}
        {...(scrolls ? { tabIndex: 0, role: "region", "aria-label": "Trailers", onScroll: handleScroll } : {})}
        className={[
          "relative flex flex-col gap-4 min-w-0",
          scrolls ? "overflow-y-auto rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]" : "",
        ].join(" ")}
        style={scrolls ? { maxHeight: maxPx ? `${maxPx}px` : "80vh" } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
