"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

// Schedule board only (`autoHide` prop) — idle delay before the overlay nav auto-hides.
const NAV_AUTO_HIDE_IDLE_MS = 5_000;

const NAV_MODULES = [
  { label: "Job board",     href: "/jobs/",          perm: "jobs" },
  { label: "Logistics",     href: "/logistics/",      perm: "logistics.dashboard" },
  { label: "Manufacturing", href: "/manufacturing/",  perm: "manufacturing.calculators" },
  // Future: if a dedicated Cutting link is surfaced, gate it behind perm: "manufacturing.cutting"
  // and place it after Manufacturing. DO NOT add it now — cutting is reached via Manufacturing (legacy nesting).
  { label: "Production",    href: "/production/",     perm: "production.inventory" },
  { label: "QC",            href: "/qc/",             perm: "qc" },
  { label: "Reports",       href: "/reports/",        perm: "reports" },
  { label: "Safety",        href: "/safety/",         perm: "safety" },
  { label: "Admin",         href: "/admin/",          perm: "admin" },
] as const;

// The v2 cutting board lives at /v2/cutting but belongs to the Manufacturing module.
// Map it to the Manufacturing nav entry so operators see which module they're in.
function isNavActive(href: string, currentPath: string): boolean {
  if (currentPath.startsWith("/v2/cutting") && href === "/manufacturing/") return true;
  return currentPath.startsWith(href);
}

interface PlatformHeaderProps {
  title?: string;
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
  currentPath?: string;
  /**
   * Overlay the nav instead of taking layout space: hidden by default, reveals on
   * pointer/touch/key interaction or focus, auto-hides after `NAV_AUTO_HIDE_IDLE_MS` idle.
   * Schedule board ONLY — every other caller omits this and keeps the normal in-flow nav.
   */
  autoHide?: boolean;
}

export default function PlatformHeader({
  title = "Cutting · v2",
  userName,
  isAdmin,
  permissions,
  currentPath = "/v2/cutting",
  autoHide = false,
}: PlatformHeaderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [revealed, setRevealed] = useState(!autoHide);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reveal = useCallback(() => {
    setRevealed(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setRevealed(false), NAV_AUTO_HIDE_IDLE_MS);
  }, []);

  useEffect(() => {
    if (!autoHide) return;
    window.addEventListener("pointermove", reveal);
    window.addEventListener("keydown", reveal);
    window.addEventListener("touchstart", reveal, { passive: true });
    return () => {
      window.removeEventListener("pointermove", reveal);
      window.removeEventListener("keydown", reveal);
      window.removeEventListener("touchstart", reveal);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [autoHide, reveal]);

  const visibleModules = NAV_MODULES.filter(
    (m) => isAdmin || permissions[m.perm]?.view
  );

  async function handleSignOut(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore — redirect regardless so sign-out always completes
    }
    window.location.href = "/login.html";
  }

  return (
    <>
      {autoHide && (
        <button
          type="button"
          onClick={reveal}
          onPointerEnter={reveal}
          onFocus={reveal}
          aria-label="Show navigation"
          aria-hidden={revealed}
          tabIndex={revealed ? -1 : 0}
          className={[
            "fixed inset-x-0 top-0 z-50 h-11 flex items-start justify-center pt-1 bg-transparent border-0 cursor-pointer focus-visible:outline-none",
            revealed ? "pointer-events-none" : "pointer-events-auto",
          ].join(" ")}
        >
          <span
            aria-hidden="true"
            className="h-1 w-14 rounded-full bg-[var(--line)] opacity-60"
          />
        </button>
      )}
      <header
        onFocus={autoHide ? reveal : undefined}
        className={[
          "shrink-0 bg-surface border-b border-[var(--line)]",
          autoHide
            ? [
                "fixed inset-x-0 top-0 z-40 transition-transform duration-300 ease-out",
                "motion-reduce:transition-none focus-within:translate-y-0",
                revealed ? "translate-y-0" : "-translate-y-full",
              ].join(" ")
            : "",
        ].join(" ")}
      >
      {/* Main nav row */}
      <div className="flex items-center px-3 min-h-[48px] gap-1">
        {/* Logo — plain <a> + <img>: basePath does NOT prefix these, which is correct for /logo/xpanda.png served by the legacy app on the same host */}
        <a
          href="/"
          aria-label="xPanda Operations Platform"
          className="inline-flex items-center shrink-0 pr-2"
        >
          <img src="/logo/xpanda.png" alt="xPanda" height={30} className="h-[30px] w-auto block" />
        </a>

        {/* Desktop nav links (hidden below md) */}
        <div className="hidden md:flex items-center flex-1 gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {visibleModules.map((m) => {
            const active = isNavActive(m.href, currentPath);
            return (
              <a
                key={m.href}
                href={m.href}
                className={[
                  "inline-flex items-center px-3 py-1.5 text-[13px] font-medium rounded-lg whitespace-nowrap min-h-[36px] no-underline transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-1",
                  active
                    ? "text-[var(--brand)] font-semibold"
                    : "text-muted hover:text-text hover:bg-[var(--ghost-bg)]",
                ].join(" ")}
                style={active ? { background: "color-mix(in srgb, var(--brand) 8%, transparent)" } : undefined}
              >
                {m.label}
              </a>
            );
          })}
        </div>

        {/* Mobile flex spacer */}
        <div className="flex-1 md:hidden" />

        {/* Mobile hamburger (hidden on md+) */}
        <button
          type="button"
          onClick={() => setDrawerOpen((v) => !v)}
          aria-label={drawerOpen ? "Close menu" : "Open menu"}
          aria-expanded={drawerOpen}
          aria-controls="platform-nav-drawer"
          className="md:hidden inline-flex items-center justify-center w-[44px] h-[44px] rounded-lg border border-[var(--line)] bg-transparent text-text cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          {drawerOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>

        {/* Desktop right actions (hidden below md) */}
        <div className="hidden md:flex items-center gap-2 shrink-0">
          <span className="text-xs font-mono tabular-nums text-muted">{userName}</span>
          <a
            href="/login.html"
            onClick={handleSignOut}
            className="text-xs font-semibold text-[var(--brand)] no-underline hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
          >
            Sign Out
          </a>
          <ThemeToggle />
        </div>

        {/* Mobile: ThemeToggle always visible */}
        <ThemeToggle className="md:hidden" />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div
          id="platform-nav-drawer"
          className="md:hidden flex flex-col border-t border-[var(--line)] bg-surface"
        >
          {visibleModules.map((m) => {
            const active = isNavActive(m.href, currentPath);
            return (
              <a
                key={m.href}
                href={m.href}
                onClick={() => setDrawerOpen(false)}
                className={[
                  "flex items-center px-4 min-h-[44px] w-full text-[13px] font-medium no-underline transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]",
                  active
                    ? "text-[var(--brand)] font-semibold"
                    : "text-muted hover:text-text hover:bg-[var(--ghost-bg)]",
                ].join(" ")}
                style={active ? { background: "color-mix(in srgb, var(--brand) 8%, transparent)" } : undefined}
              >
                {m.label}
              </a>
            );
          })}
          <div className="flex items-center gap-3 px-4 py-3 border-t border-[var(--line)]">
            <span className="text-xs font-mono tabular-nums text-muted">{userName}</span>
            <a
              href="/login.html"
              onClick={handleSignOut}
              className="text-xs font-semibold text-[var(--brand)] no-underline hover:opacity-80"
            >
              Sign Out
            </a>
          </div>
        </div>
      )}

      {/* Page title strip */}
      <div className="px-4 h-9 flex items-center border-t border-[var(--line)] bg-[var(--surface-2)]">
        <h1 className="text-sm font-semibold text-text tracking-tight">{title}</h1>
      </div>
      </header>
    </>
  );
}
