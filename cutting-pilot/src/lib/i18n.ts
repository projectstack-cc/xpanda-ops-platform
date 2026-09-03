export const LANGS = ["en", "es", "ht"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "en";
export const LANG_STORAGE_KEY = "xpanda_lang";

export const catalog: Record<string, Record<Lang, string>> = {
  "orders.newOrder": { en: "New order", es: "Pedido nuevo", ht: "Nouvo kòmand" },
  "orders.customerOrderSection": {
    en: "Customer & order",
    es: "Cliente y pedido",
    ht: "Kliyan & kòmand",
  },
  "orders.customer": { en: "Customer", es: "Cliente", ht: "Kliyan" },
  "orders.poNumber": { en: "PO number", es: "Número de OC", ht: "Nimewo PO" },
  "orders.invoiceNumber": { en: "Invoice number", es: "Número de factura", ht: "Nimewo fakti" },
  "orders.orderSaved": { en: "Order saved", es: "Pedido guardado", ht: "Kòmand anrejistre" },
};

export function getStoredLang(): Lang {
  try {
    const val = localStorage.getItem(LANG_STORAGE_KEY);
    if (val === "en" || val === "es" || val === "ht") return val;
  } catch {
    /* ignore */
  }
  return DEFAULT_LANG;
}

export function translate(lang: Lang, key: string): string {
  const entry = catalog[key];
  if (!entry) return key;
  return entry[lang] ?? entry[DEFAULT_LANG] ?? key;
}
