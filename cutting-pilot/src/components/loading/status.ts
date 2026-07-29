// src/components/loading/status.ts
// Copied verbatim from logistics/loading.html's LD_STATUS_COLORS — single source for THIS
// board. Do not scatter hexes elsewhere in components/loading/.
export interface LoadingStatusVariant {
  bg: string;
  border: string;
  text: string;
  label: string;
}

export const LD_STATUS_COLORS: Record<string, LoadingStatusVariant> = {
  awaiting:    { bg: '#f3f4f6', border: '#9ca3af', text: '#374151', label: 'Awaiting' },
  not_started: { bg: '#fee2e2', border: '#ef4444', text: '#991b1b', label: 'Not Started' },
  loading:     { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', label: 'Loading' },
  loaded:      { bg: '#d1fae5', border: '#10b981', text: '#065f46', label: 'Loaded' },
  in_transit:  { bg: '#e0e7ff', border: '#6366f1', text: '#3730a3', label: 'In Transit' },
  delivered:   { bg: '#ccfbf1', border: '#0d9488', text: '#115e59', label: 'Delivered' },
};

export function statusVariant(status: string | null | undefined): LoadingStatusVariant {
  return LD_STATUS_COLORS[status ?? ""] ?? LD_STATUS_COLORS.awaiting;
}
