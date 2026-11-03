// src/lib/board/statusOptions.ts
// jb-15 — the single home for what the board may do with a job's status. The three pickers
// (JobQuickEdit, BoardRowEdit, OrderEditModal) read the options from here, and both PUT routes
// (/v2/api/board/:id, /v2/api/orders/:id) enforce the same rule through boardStatusChangeError.
// Loading and Shipped belong to the logistics and dock flows, so the board can't set them.

export const BOARD_SETTABLE_STATUSES = [
  { value: "not_started", label: "Not started" },
  { value: "in_production", label: "In production" },
  { value: "done", label: "Done" },
];

export const STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_production: "In production",
  done: "Done",
  loading: "Loading",
  shipped: "Shipped",
};

function isDockStatus(status: string) {
  return status === "loading" || status === "shipped";
}

// A locked job keeps its real value as an extra option, so its disabled select isn't blank.
export function statusOptionsFor(current: string) {
  return isDockStatus(current)
    ? [...BOARD_SETTABLE_STATUSES, { value: current, label: STATUS_LABELS[current] }]
    : BOARD_SETTABLE_STATUSES;
}

// null = allowed. Re-sending the current status always passes (full-form saves include it).
export function boardStatusChangeError(current: string, next: string): string | null {
  if (next === current) return null;
  if (isDockStatus(current)) return "Can't change a loading/shipped job from the board.";
  if (isDockStatus(next)) return "Loading and Shipped are set from the Logistics / Dock flow, not the board.";
  return null;
}
