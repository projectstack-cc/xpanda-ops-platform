// src/app/production/siloStateStyle.ts
// quickwin-08: single source for silo state → i18n key + token classes. Used by SiloGrid (sheets)
// and the /v2/production/tv board. Token classes only — never hex.
import type { SiloState } from "@/lib/productionSilos";

export const SILO_STATE_KEY: Record<SiloState, string> = {
  empty: "production.silo.state.empty",
  filling: "production.silo.state.filling",
  full: "production.silo.state.full",
  in_use: "production.silo.state.inUse",
};

export const SILO_STATE_CLS: Record<SiloState, string> = {
  empty: "bg-[var(--ghost-bg)] text-muted border-border",
  filling: "bg-[var(--info-bg)] text-[var(--info-text)] border-[var(--info-border)]",
  full: "bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-text)]",
  in_use: "bg-[var(--warn-bg)] text-[var(--warn-text)] border-[var(--warn-border)]",
};
