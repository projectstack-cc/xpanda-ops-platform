"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_LANG, LANG_STORAGE_KEY, getStoredLang, translate, type Lang } from "@/lib/i18n";

interface LangContextValue {
  lang: Lang;
  t: (key: string) => string;
}

const LangContext = createContext<LangContextValue | null>(null);

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    setLang(getStoredLang());

    function handleStorage(e: StorageEvent) {
      if (e.key === LANG_STORAGE_KEY) setLang(getStoredLang());
    }
    function handleLangChange() {
      setLang(getStoredLang());
    }

    window.addEventListener("storage", handleStorage);
    document.addEventListener("xpanda:langchange", handleLangChange);
    return () => {
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("xpanda:langchange", handleLangChange);
    };
  }, []);

  function t(key: string) {
    return translate(lang, key);
  }

  return <LangContext.Provider value={{ lang, t }}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within LangProvider");
  return ctx;
}
