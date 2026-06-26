"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme";

interface ThemeToggleProps {
  className?: string;
}

export default function ThemeToggle({ className = "" }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={[
        "inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded",
        "border border-[var(--input-border)] bg-transparent text-[var(--muted)]",
        "hover:text-text cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {isDark ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
    </button>
  );
}
