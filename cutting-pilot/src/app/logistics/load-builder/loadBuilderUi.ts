// src/app/logistics/load-builder/loadBuilderUi.ts
// lbr-05: the class strings and formatters the Load Builder tab components share, defined once so
// LoadTab / ResultsTab / LoadBuilderTabs don't each copy them. Floor-grade: every control >= 44px.
// Tokens only (the thickness data colors live in src/lib/thicknessPalette.ts).

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]";
const BASE = `inline-flex items-center justify-center gap-1.5 px-3.5 min-h-[44px] rounded-lg text-sm font-semibold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`;

/** Filled brand button — the one primary action in a row. */
export const BTN_PRIMARY = `${BASE} bg-[var(--brand)] text-white hover:opacity-90`;
/** Brand-outline button. */
export const BTN_OUTLINE = `${BASE} border border-[var(--brand)] text-[var(--brand)] hover:bg-[color-mix(in_srgb,var(--brand)_8%,transparent)]`;
/** Quiet bordered button. */
export const BTN_GHOST = `${BASE} border border-[var(--border)] text-muted hover:text-text hover:bg-[var(--ghost-bg)]`;

export const SELECT = `min-h-[44px] pl-2.5 pr-1 rounded-lg border border-[var(--border)] bg-[var(--card-bg)] text-text text-sm font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`;

export const CARD = "rounded-xl border border-[var(--card-border)] bg-surface p-4";

/** "Oct 12, 3:42 PM ET" (or "3:42 PM ET") — saved-load timestamps are read on the dock in Eastern time. */
export function formatEt(iso: string, withDate: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const s = d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    ...(withDate ? { month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
  return `${s} ET`;
}

/** lbr-06: what this user may do on the page, from the middleware's X-User-Permissions (page.tsx).
 * Viewing is already gated by middleware (logistics.load-builder view); these cover the writes that
 * call APIs gated on their own keys, so the page degrades instead of erroring. */
export interface LoadBuilderAccess {
  /** logistics.load-builder edit — Save / Update, auto-save, the leave prompt. */
  canSave: boolean;
  /** logistics.bol edit — Generate BOLs. */
  canGenerateBol: boolean;
  /** manufacturing.calculators view / edit — the Parts tab (/api/parts). */
  canViewParts: boolean;
  canEditParts: boolean;
}

export const NO_SAVE_REASON = "You can view loads but not save them (needs Load Builder edit access).";
export const NO_BOL_REASON = "Generating BOLs needs BOL edit access.";

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
