"use client";
// Shared hook (prod-c-04): resolve design tokens to real color strings for recharts. Recharts
// writes fill/stroke as raw SVG presentation attributes, so var(--token) can't be passed through
// reliably — resolve on mount and again whenever the theme toggles. SSR-safe: returns the
// fallbacks until mounted. (FinancialsPanel still has its own inline copy — BACKLOG.)
import { useEffect, useState } from "react";
import { useTheme } from "@/components/theme";

export function useTokenColors<K extends string>(
  tokens: Record<K, { var: string; fallback: string }>
): Record<K, string> {
  const { theme } = useTheme();
  const fallbacks = () =>
    Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, (v as { fallback: string }).fallback])) as Record<K, string>;
  const [colors, setColors] = useState<Record<K, string>>(fallbacks);

  useEffect(() => {
    // setTheme() sets data-theme before its state update, so the new values are already live here.
    const style = getComputedStyle(document.documentElement);
    setColors(
      Object.fromEntries(
        Object.entries(tokens).map(([k, v]) => {
          const t = v as { var: string; fallback: string };
          return [k, style.getPropertyValue(t.var).trim() || t.fallback];
        })
      ) as Record<K, string>
    );
    // tokens is a module-level constant at every call site; re-resolve on theme change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  return colors;
}
