// src/components/marina/ui.ts — marina-04
// Shared class strings + a tiny fetch helper for the Marina Foam pages (/v2/qc/marina). Tokens only.
// HEADER_BTN / CHIP mirror QcBoard's look (copied, not imported — QcBoard stays untouched).

export const HEADER_BTN =
  "inline-flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-lg border border-[var(--border)] bg-surface text-xs font-semibold text-text hover:bg-[var(--ghost-bg)] no-underline transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";

export const CHIP = "inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border whitespace-nowrap";
export const CHIP_NEUTRAL = `${CHIP} bg-[var(--ghost-bg)] text-text border-[var(--border)]`;
export const CHIP_GOOD = `${CHIP} bg-[var(--loaded-bg)] text-[var(--loaded-text)] border-[var(--loaded-border)]`;
export const CHIP_DANGER = `${CHIP} bg-surface text-[var(--danger-ink)] border-[var(--danger-ink)]`;
export const CHIP_INFO = `${CHIP} bg-[var(--info-bg)] text-[var(--info-text)] border-[var(--info-border)]`;

// The prominent "N rework pending" badge.
export const REWORK_BADGE =
  "inline-flex items-center px-2.5 py-1 rounded-md text-sm font-bold border bg-[var(--info-bg)] text-[var(--info-text)] border-[var(--info-border)] whitespace-nowrap";

export const CARD = "rounded-xl border border-[var(--border)] bg-surface p-4";
export const LABEL = "flex flex-col gap-1 min-w-0 text-xs font-semibold text-muted";
export const INPUT =
  "w-full min-h-[44px] px-3 rounded-lg border border-[var(--border)] bg-surface text-text text-sm focus:outline-hidden focus:border-[var(--brand)]";
export const TEXTAREA =
  "w-full min-h-[88px] px-3 py-2 rounded-lg border border-[var(--border)] bg-surface text-text text-sm focus:outline-hidden focus:border-[var(--brand)]";
export const PRIMARY =
  "inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed";
export const GHOST =
  "inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg border border-[var(--input-border)] bg-surface text-text text-sm font-semibold cursor-pointer hover:bg-[var(--ghost-bg)] disabled:opacity-50 disabled:cursor-not-allowed";
export const DANGER =
  "inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 rounded-lg bg-[var(--danger-bg)] text-[var(--danger-text)] text-sm font-semibold cursor-pointer hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed";
export const ERROR_TEXT = "text-sm text-[var(--danger-ink)]";

export const API = "/v2/api/qc/marina";

// JSON call → { ok, data, error }. The API's `error` text is surfaced as-is; network / non-JSON
// failures get a plain message. Never throws.
export async function marinaFetch<T = any>(
  path: string,
  init?: RequestInit
): Promise<{ ok: true; data: T; status: number } | { ok: false; error: string; code?: string; status: number }> {
  try {
    const res = await fetch(`${API}${path}`, init);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      return { ok: false, error: data?.error || `Request failed (HTTP ${res.status}).`, code: data?.code, status: res.status };
    }
    return { ok: true, data: data as T, status: res.status };
  } catch (e: any) {
    return { ok: false, error: `Network error: ${String(e?.message || e)}`, status: 0 };
  }
}

export function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
