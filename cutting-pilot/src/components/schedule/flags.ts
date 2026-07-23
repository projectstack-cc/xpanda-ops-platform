// src/components/schedule/flags.ts
// Temporary: production-status badges suppressed on the floor board while platform-wide
// status routing is reworked. Flip to true to restore. Derivation (schedule-status.ts) and
// the API response are untouched — only rendering of matched-row badges is gated by this.
export const SHOW_STATUS_BADGES = false;
