"use client";
// src/components/schedule/LogoSweep.tsx
// Periodic full-repaint burn-in aid: the xPanda logo sweeps across the screen once every
// LOGO_SWEEP_INTERVAL_MS, then clears. Timer-based only — deliberately NOT tied to the cron or
// the board's refetch (FreshnessClock owns the data-freshness signal). Logo/graphic only, no
// text — language-neutral by design. Desktop/TV only; degrades to nothing on phone/tablet.
import { useEffect, useState } from "react";

const LOGO_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const LOGO_SWEEP_DURATION_MS = 3_800;

export default function LogoSweep() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), LOGO_SWEEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="hidden min-[1024px]:block fixed inset-0 z-30 overflow-hidden pointer-events-none motion-reduce:hidden"
    >
      <img
        key={tick}
        alt=""
        src="/logo/xpanda.png"
        className="xpanda-logo-sweep absolute top-1/2 h-[18vh] w-auto opacity-90 drop-shadow-lg"
        style={{ animationDuration: `${LOGO_SWEEP_DURATION_MS}ms` }}
      />
    </div>
  );
}
