"use client";
// src/components/schedule/ScheduleBoard.tsx
// Floor/office TV board: two stacked week bands (current on top, next below), both visible
// on one screen at once — no auto-scroll, no rotation. Polls GET /v2/api/schedule-board every
// 60s and swaps data in place; on fetch error it keeps the last-good render and shows a
// subtle stale indicator instead of ever blanking the wall.
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import PlatformHeader from "@/components/PlatformHeader";
import type { ScheduleBoardResponse } from "@/types/schedule";
import WeekBand from "./WeekBand";
import { computeDensity } from "./density";
import FreshnessClock from "./FreshnessClock";

const POLL_MS = 60_000;

// Mirrors PlatformHeader's own NAV_AUTO_HIDE_IDLE_MS. PlatformHeader is a shared component used
// by every /v2/* page and its `revealed` reveal state is local, unexposed React state — per the
// P365 scope boundary this schedule-only push effect must not alter that shared component or its
// overlay behavior for other routes, so the reveal trigger is duplicated here rather than adding
// a signal prop to PlatformHeader. Keep this in sync if PlatformHeader's idle delay changes.
const NAV_AUTO_HIDE_IDLE_MS = 5_000;

// P415 wall-display cursor hide: on the TV the pointer, once moved onto the screen, sits there
// forever. Hide it after this much pointer inactivity; any activity brings it back. Independent
// of the header auto-hide above (different delay, different concern).
const CURSOR_IDLE_MS = 15_000;

interface ScheduleBoardProps {
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
}

function formatWeekLabel(tab: string | undefined, prefix: string): string {
  const m = tab?.match(/^(\d{1,2})-(\d{1,2})-(\d{2})$/);
  if (!m) return prefix;
  return `${prefix} — ${Number(m[1])}/${Number(m[2])}`;
}

export default function ScheduleBoard({ userName, isAdmin, permissions }: ScheduleBoardProps) {
  const [data, setData] = useState<ScheduleBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const hasGoodDataRef = useRef(false);

  // Push-down state: the auto-hide header is an overlay (`fixed`), so revealing it doesn't move
  // this board on its own. `headerRevealed` drives a spacer sized to the header's own rendered
  // height (`headerHeight`, measured live off the DOM — no hardcoded/magic number) so the board
  // reflows down in sync with the header instead of being covered by it. No pointer input (the
  // wall TV) never fires these listeners, so `headerRevealed` stays false and the board renders
  // full-bleed with zero offset, unchanged from before.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [headerRevealed, setHeaderRevealed] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);
  const navPush = headerRevealed ? headerHeight : 0;

  const revealHeader = useCallback(() => {
    setHeaderRevealed(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setHeaderRevealed(false), NAV_AUTO_HIDE_IDLE_MS);
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", revealHeader);
    window.addEventListener("keydown", revealHeader);
    window.addEventListener("touchstart", revealHeader, { passive: true });
    return () => {
      window.removeEventListener("pointermove", revealHeader);
      window.removeEventListener("keydown", revealHeader);
      window.removeEventListener("touchstart", revealHeader);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [revealHeader]);

  // P415 wall-display cursor hide, hardened twice over reports it "doesn't go away" mid-screen:
  //
  // 1. The original cut set `style.cursor = "none"` on just the board's own root div and relied
  //    on CSS inheritance — but PlatformHeader's `autoHide` nav-reveal hotzone (a permanent,
  //    full-width, 44px-tall hit target pinned to the top of the screen) sets its own explicit
  //    `cursor-pointer` class, which wins over an inherited value whenever the pointer rests in
  //    that strip. Toggling a class on <html> instead (globals.css: `.wall-cursor-hidden *`,
  //    `!important`) beats any current or future explicit `cursor-*` utility in the tree — this
  //    alone doesn't explain a cursor stuck at screen CENTER though (no descendant there sets its
  //    own cursor), which points at #2:
  // 2. Wall-mounted PCs commonly run KVM/remote-desktop/"mouse jiggler" software to keep the
  //    display awake, which injects synthetic pointer events with zero movement — each one used
  //    to re-arm this timer forever, so the cursor would never hide no matter how long the wall
  //    was actually untouched. `movementX`/`movementY` are both 0 on these synthetic events (and
  //    essentially never both exactly 0 on real hardware input), so they're now filtered out.
  //
  // Deliberately its own listeners + timer (additive) so it can't perturb the P365 header
  // auto-hide effect above.
  useEffect(() => {
    const root = document.documentElement;
    const arm = () => {
      cursorTimerRef.current = setTimeout(() => {
        root.classList.add("wall-cursor-hidden");
      }, CURSOR_IDLE_MS);
    };
    const showThenArmHide = (e?: Event) => {
      if (
        e instanceof PointerEvent &&
        e.type === "pointermove" &&
        e.movementX === 0 &&
        e.movementY === 0
      ) {
        return; // synthetic/zero-delta move (KVM, remote desktop, jiggler) — not real activity
      }
      root.classList.remove("wall-cursor-hidden");
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
      arm();
    };
    arm(); // arm on mount so an untouched wall hides the pointer after the idle delay
    window.addEventListener("pointermove", showThenArmHide);
    window.addEventListener("keydown", showThenArmHide);
    window.addEventListener("touchstart", showThenArmHide, { passive: true });
    return () => {
      window.removeEventListener("pointermove", showThenArmHide);
      window.removeEventListener("keydown", showThenArmHide);
      window.removeEventListener("touchstart", showThenArmHide);
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
      root.classList.remove("wall-cursor-hidden"); // don't leak a hidden cursor to other v2 routes
    };
  }, []);

  // Measures the header actually rendered inside this component's own subtree (never queries
  // outside `rootRef`) — re-runs whenever the board swaps render branches (loading/error/data),
  // since each branch mounts its own header instance.
  useEffect(() => {
    const headerEl = rootRef.current?.querySelector<HTMLElement>("header");
    if (!headerEl) return;
    setHeaderHeight(headerEl.getBoundingClientRect().height);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeaderHeight(entry.target.getBoundingClientRect().height);
    });
    observer.observe(headerEl);
    return () => observer.disconnect();
  }, [loading, error, data]);

  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch("/v2/api/schedule-board");

      // 503 = the auth layer's D1 lookup blipped — transient, not a session verdict.
      // Never treat it as logged-out; just retry on the next tick.
      if (res.status === 503) {
        if (hasGoodDataRef.current) setStale(true);
        else setError("Reconnecting…");
        return;
      }

      // 401 from a background poll could be a genuinely dead session, or a stray one-off.
      // Confirm against the auth endpoint before showing anything scarier than "stale."
      if (res.status === 401) {
        let confirmedGone = true;
        try {
          const confirmRes = await fetch("/api/auth/me");
          confirmedGone = !confirmRes.ok;
        } catch {
          // couldn't even confirm — treat as transient, not as a verdict.
          confirmedGone = false;
        }
        if (!confirmedGone) {
          if (hasGoodDataRef.current) setStale(true);
          else setError("Reconnecting…");
          return;
        }
        setError("Signed out — sign back in to resume.");
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ScheduleBoardResponse = await res.json();
      hasGoodDataRef.current = true;
      setData(json);
      setStale(false);
      setError(null);
    } catch {
      if (hasGoodDataRef.current) {
        setStale(true);
      } else {
        setError("Couldn't load the schedule.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoard();
    const id = setInterval(fetchBoard, POLL_MS);
    return () => clearInterval(id);
  }, [fetchBoard]);

  if (loading) {
    return (
      <div ref={rootRef} className="h-screen flex flex-col bg-bg overflow-hidden">
        <PlatformHeader
          userName={userName}
          isAdmin={isAdmin}
          permissions={permissions}
          title="Schedule · v2"
          currentPath="/v2/schedule"
          autoHide
        />
        <div
          aria-hidden="true"
          className="shrink-0 transition-[height] duration-300 ease-out motion-reduce:transition-none"
          style={{ height: navPush }}
        />
        <div className="flex-1 min-h-0 flex flex-col gap-px bg-[var(--line)] p-px">
          {[0, 1].map((i) => (
            <div key={i} className="flex-1 grid grid-cols-5 gap-px">
              {[0, 1, 2, 3, 4].map((j) => (
                <div
                  key={j}
                  className="bg-[var(--surface)] animate-pulse motion-reduce:animate-none"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div ref={rootRef} className="h-screen flex flex-col bg-bg overflow-hidden">
        <PlatformHeader
          userName={userName}
          isAdmin={isAdmin}
          permissions={permissions}
          title="Schedule · v2"
          currentPath="/v2/schedule"
          autoHide
        />
        <div
          aria-hidden="true"
          className="shrink-0 transition-[height] duration-300 ease-out motion-reduce:transition-none"
          style={{ height: navPush }}
        />
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <AlertTriangle size={28} className="text-[var(--warn-text)]" aria-hidden="true" />
          <p className="text-sm text-muted max-w-sm">{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              fetchBoard();
            }}
            className="cursor-pointer inline-flex items-center px-4 py-2 min-h-[44px] rounded-lg text-sm font-medium bg-[var(--primary-bg)] text-[var(--primary-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const [currentTab, nextTab] = data.weeks;
  const currentDays = data.days.filter((d) => d.ship_week === currentTab);
  const nextDays = data.days.filter((d) => d.ship_week === nextTab);

  const maxColumnRows = Math.max(
    0,
    ...currentDays.map((d) => d.rows.length),
    ...nextDays.map((d) => d.rows.length)
  );
  const { density, rowCap } = computeDensity(maxColumnRows);

  return (
    <div ref={rootRef} className="h-screen flex flex-col bg-bg overflow-hidden">
      <PlatformHeader
        userName={userName}
        isAdmin={isAdmin}
        permissions={permissions}
        title="Schedule · v2"
        currentPath="/v2/schedule"
        autoHide
      />
      <div
        aria-hidden="true"
        className="shrink-0 transition-[height] duration-300 ease-out motion-reduce:transition-none"
        style={{ height: navPush }}
      />

      <div className="relative flex-1 min-h-0 overflow-hidden">
        {/* TV-safe inset (not a bug fix): consumer TV/HDMI overscan crops the outer edge of the
            picture on many displays, independent of anything this app renders — confirmed by
            P306 measuring this container pixel-exact against the browser viewport with zero
            clipping. `--tv-safe-inset` (globals.css) pulls the content in from the true edge so
            any hardware crop eats background color, not schedule data. Do not "simplify" this
            back to inset-0 thinking it's leftover pixel-shift cruft. */}
        <div className="absolute flex flex-col" style={{ inset: "var(--tv-safe-inset)" }}>
          <div className="shrink-0 flex items-center justify-between px-3 py-0.5 border-b border-[var(--line)] bg-bg">
            <h1 className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Shipping Schedule
            </h1>
            <div className="flex items-center gap-2">
              {stale && (
                <span className="font-mono text-[10px] text-[var(--warn-text)]">
                  showing last loaded data
                </span>
              )}
              <FreshnessClock sourceUpdatedAt={data.source_updated_at} />
            </div>
          </div>

          <div className="flex-1 min-h-0 flex flex-col gap-px bg-[var(--line)]">
            <WeekBand
              weekLabel={formatWeekLabel(currentTab, "THIS WEEK")}
              weekTab={currentTab}
              days={currentDays}
              density={density}
              rowCap={rowCap}
              birthdays={data.birthdays ?? []}
            />
            <WeekBand
              weekLabel={formatWeekLabel(nextTab, "NEXT WEEK")}
              weekTab={nextTab}
              days={nextDays}
              density={density}
              rowCap={rowCap}
              birthdays={data.birthdays ?? []}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
