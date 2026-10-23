// src/app/reports/ui.ts — rpt-01
// Shared class strings for the v2 Reports pages. HEADER_BTN / CHIP are copied from QcBoard (as marina
// did — QcBoard stays untouched); the table classes mirror QcBoard's day tables. Tokens only.

export const HEADER_BTN =
  "inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[var(--border)] bg-surface text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] no-underline transition-colors cursor-pointer";

export const CHIP = "inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border whitespace-nowrap";
export const CHIP_WARN = `${CHIP} bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]`;
export const CHIP_GHOST = `${CHIP} bg-[var(--ghost-bg)] text-text border-[var(--border)]`;
export const CHIP_INFO = `${CHIP} bg-[var(--info-bg)] text-[var(--info-text)] border-[var(--info-border)]`;

export const CARD = "rounded-xl border border-[var(--card-border)] bg-surface";
export const TABLE_WRAP = "relative overflow-x-auto rounded-xl border border-[var(--card-border)] bg-surface shadow-xs";
export const THEAD_ROW = "border-b border-[var(--line)] bg-[var(--ghost-bg)] text-left text-xs font-semibold text-muted";
export const ROW = "border-b border-[var(--line)] last:border-b-0";
export const TH = "px-3.5 py-2.5";
export const TD = "px-3.5 py-2.5";
export const NUM = "font-mono tabular-nums text-right";

export const GHOST_BTN =
  "inline-flex items-center min-h-[44px] px-3 rounded-lg border border-[var(--border)] text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] cursor-pointer";
