// src/components/LiveLoadMarker.tsx
// live-02: the "dock hazard stripe" — the only place the live-load pattern lives. A live load is a
// third-party driver waiting at the dock while we load (rule: lib/logistics/liveLoad.ts, flags on
// every v2 API since live-01). Black + safety yellow, used nowhere else on the platform; never the
// amber --warn-* tokens (amber means "in progress"). Tokens: --live-yellow / --live-ink (same in
// both themes — hazard colors don't invert) + --live-pill-border (yellow ring in dark mode so the
// black pill doesn't vanish).
import type { CSSProperties, ReactNode } from "react";
import { Truck } from "lucide-react";

export const LIVE_LOAD_TITLE = "Live load — driver waits at the dock";

// Bands ≥ 6px so they still read as stripes on the plant TV.
const STRIPES = "repeating-linear-gradient(45deg, var(--live-yellow) 0 6px, var(--live-ink) 6px 12px)";

const PILL_CLS =
  "inline-flex items-center gap-1 rounded px-1 font-bold leading-tight whitespace-nowrap " +
  "bg-[var(--live-ink)] text-[var(--live-yellow)] border border-[var(--live-pill-border)]";

/** Left-edge hazard stripe. The parent must be `position: relative` and pad its content past `width`. */
export function LiveLoadStripe({ width = 6 }: { width?: number }) {
  return (
    <span
      role="img"
      aria-label={LIVE_LOAD_TITLE}
      title={LIVE_LOAD_TITLE}
      className="pointer-events-none absolute inset-y-0 left-0"
      style={{ width, background: STRIPES }}
    />
  );
}

/** Wraps EXISTING text (a load/time label, a load suffix) — never a new field. */
export function LiveLoadPill({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  /** Inline sizing for inline-styled surfaces (the dock tablet); colors stay on the tokens. */
  style?: CSSProperties;
}) {
  return (
    <span className={`${PILL_CLS} font-mono ${className}`} style={style} title={LIVE_LOAD_TITLE}>
      {children}
      <span className="sr-only"> (live load)</span>
    </span>
  );
}

/** live-03: the first live load's arrival display (in load order), with "+" when the live loads'
 *  times differ (or only some are set). null when none is set. */
export function liveTimeLabel(times: Record<number, string> | null | undefined, loads: number[] | null | undefined): string | null {
  if (!times || !loads?.length) return null;
  const set = loads.map((n) => times[n] || null);
  const first = set.find((t) => !!t) ?? null;
  if (!first) return null;
  return set.every((t) => t === first) ? first : `${first}+`;
}

/** "Live load" chip for surfaces with room. `loads` → "Live load · L2" when only some loads are live;
 *  live-03 `time` → "Live load · Mon 10:00 AM" (the driver's arrival at our dock). */
export function LiveLoadChip({
  label = "Live load",
  loads,
  time,
  size = "md",
  className = "",
}: {
  label?: string;
  loads?: number[];
  time?: string | null;
  /** sm = fits a 16px compact line (dock board compact cards). */
  size?: "sm" | "md";
  className?: string;
}) {
  const suffix =
    (loads && loads.length ? ` · ${loads.map((n) => `L${n}`).join(", ")}` : "") + (time ? ` · ${time}` : "");
  return (
    <span
      className={`${PILL_CLS} ${size === "sm" ? "py-0 text-[10px]" : "py-px text-[11px]"} ${className}`}
      title={LIVE_LOAD_TITLE}
      aria-label={`${LIVE_LOAD_TITLE}${loads && loads.length ? ` (loads ${loads.join(", ")})` : ""}${time ? `, arrives ${time}` : ""}`}
    >
      <Truck size={size === "sm" ? 10 : 12} aria-hidden="true" className="shrink-0" />
      {label}
      {suffix}
    </span>
  );
}

/** Small "▮ Live load" key for board headers (stripe swatch + text). */
export function LiveLoadLegend() {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10px] text-muted" title={LIVE_LOAD_TITLE}>
      <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: STRIPES }} />
      Live load
    </span>
  );
}
