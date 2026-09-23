"use client";
// Compact language picker. Fires the same "xpanda:langchange" CustomEvent the legacy
// shared/i18n.js dispatches, so LangProvider (components/lang.tsx) picks it up regardless of
// which surface changed it. Language names are shown in their own language, not translated —
// same convention used by every native-name language switcher.
import { useLang } from "@/components/lang";
import { LANG_STORAGE_KEY, type Lang } from "@/lib/i18n";

const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  es: "Español",
  ht: "Kreyòl",
};

export default function LangSelect() {
  const { lang } = useLang();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value as Lang;
    try {
      localStorage.setItem(LANG_STORAGE_KEY, v);
    } catch {
      // best-effort; LangProvider still updates for this tab via the dispatched event below
    }
    document.dispatchEvent(new CustomEvent("xpanda:langchange", { detail: { lang: v } }));
  }

  return (
    <select
      aria-label="Language"
      value={lang}
      onChange={onChange}
      className="min-h-[44px] px-2 rounded border border-border bg-bg text-text text-sm cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
        <option key={l} value={l}>
          {LANG_NAMES[l]}
        </option>
      ))}
    </select>
  );
}
