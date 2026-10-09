// src/lib/admin/client.ts — admin-03
// The one fetch helper every /v2/admin tab uses (generic port of BolEmailQueue's api()), plus the shared
// control classes so the tabs stay visually identical. Never throws.

const BASE = "/v2/api/admin";

export type AdminApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function adminApi<T = any>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<AdminApiResult<T>> {
  try {
    const res = await fetch(BASE + path, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      const error = data?.error || `HTTP ${res.status}`;
      return { ok: false, error: data?.detail ? `${error} — ${data.detail}` : error };
    }
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Network error" };
  }
}

// Shared control classes (tokens only, radius ≤4px, ≥44px touch targets on phones).
export const btnSm =
  "min-h-[44px] md:min-h-[32px] px-3 rounded border border-[var(--border)] bg-[var(--surface)] text-xs font-semibold text-text cursor-pointer hover:border-[var(--brand)] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
export const btnPrimary =
  "min-h-[44px] md:min-h-[36px] px-4 rounded bg-[var(--brand)] text-white text-sm font-semibold cursor-pointer hover:bg-[var(--brand-hover)] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
export const btnDangerSm =
  "min-h-[44px] md:min-h-[32px] px-3 rounded bg-[var(--danger-bg)] text-[var(--danger-text)] text-xs font-semibold cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
export const inputCls =
  "w-full min-h-[44px] md:min-h-[36px] px-3 rounded border border-[var(--input-border)] bg-[var(--input-bg)] text-sm text-text focus:outline-none focus:border-[var(--brand)]";
export const errorBannerCls =
  "flex items-start justify-between gap-3 rounded border border-[var(--danger-bg)] bg-[var(--surface)] text-[var(--danger-bg)] px-3 py-2 text-sm font-semibold";
