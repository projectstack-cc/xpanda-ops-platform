// src/components/schedule/flags.ts
// Status badges are live as of P278 (schedule-status.ts derivation fix). The flag is kept in
// place, not inlined or deleted, as a one-line kill switch if the floor reports something
// wrong — flip back to false to suppress badges without touching derivation.
export const SHOW_STATUS_BADGES = true;
