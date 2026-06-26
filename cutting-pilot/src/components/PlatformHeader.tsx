"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

const NAV_MODULES = [
  { label: "Job board",     href: "/jobs/",          perm: "jobs" },
  { label: "Logistics",     href: "/logistics/",      perm: "logistics.dashboard" },
  { label: "Manufacturing", href: "/manufacturing/",  perm: "manufacturing.calculators" },
  { label: "Production",    href: "/production/",     perm: "production.inventory" },
  { label: "QC",            href: "/qc/",             perm: "qc" },
  { label: "Reports",       href: "/reports/",        perm: "reports" },
  { label: "Safety",        href: "/safety/",         perm: "safety" },
  { label: "Admin",         href: "/admin/",          perm: "admin" },
] as const;

interface PlatformHeaderProps {
  title?: string;
  userName: string;
  isAdmin: boolean;
  permissions: Record<string, { view?: boolean; edit?: boolean }>;
  currentPath?: string;
}

export default function PlatformHeader({
  title = "Cutting · v2",
  userName,
  isAdmin,
  permissions,
  currentPath = "/v2/cutting",
}: PlatformHeaderProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const visibleModules = NAV_MODULES.filter(
    (m) => isAdmin || permissions[m.perm]?.view
  );

  async function handleSignOut(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login.html";
  }

  return (
    <header className="shrink-0 bg-surface border-b border-border">
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
            const active = currentPath.startsWith(m.href);
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
          className="md:hidden inline-flex items-center justify-center w-[44px] h-[44px] rounded-lg border border-border bg-transparent text-text cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
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
          className="md:hidden flex flex-col border-t border-border bg-surface"
        >
          {visibleModules.map((m) => {
            const active = currentPath.startsWith(m.href);
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
          <div className="flex items-center gap-3 px-4 py-3 border-t border-border">
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
      <div className="px-4 h-9 flex items-center border-t border-border bg-[var(--surface-2)]">
        <h1 className="text-sm font-semibold text-text tracking-tight">{title}</h1>
      </div>
    </header>
  );
}
