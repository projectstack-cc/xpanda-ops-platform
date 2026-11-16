// src/components/safety/safetyUi.ts
// saf-02: small shared bits for the v2 Safety hub + block pages (class strings, {x} fill, /me fetch).
export const SDS_URL = "https://xpanda-sds.pages.dev/";
export const SDS_BROWSE_URL = "https://xpanda-sds.pages.dev/sds.html";

export const CARD = "bg-[var(--surface)] border border-[var(--card-border)] rounded-xl";
export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
export const BTN_PRIMARY =
  `min-h-[44px] inline-flex items-center justify-center px-4 rounded-lg bg-[var(--primary-bg)] text-[var(--primary-text)] font-semibold text-sm no-underline hover:opacity-90 ${FOCUS}`;
export const BTN_OUTLINE =
  `min-h-[44px] inline-flex items-center justify-center px-4 rounded-lg border border-[var(--input-border)] bg-[var(--surface)] text-text font-semibold text-sm no-underline hover:bg-[var(--ghost-bg)] ${FOCUS}`;
export const CHIP = "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap border";
export const CHIP_DONE = `${CHIP} bg-[var(--surface)] border-[var(--success-ink)] text-success-ink`;
export const CHIP_TODO = `${CHIP} bg-[var(--ghost-bg)] border-[var(--input-border)] text-muted`;

/** Fill {name} placeholders (the v2 t() has no interpolation). */
export function fill(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export interface MeCompletion {
  id: string;
  block_id: string;
  completed_on: string;
  source: "self" | "group";
}

export interface MeResponse {
  ok: boolean;
  blocks: Array<{ id: string; ready: boolean }>;
  completions: MeCompletion[];
}

export async function fetchMe(): Promise<MeResponse> {
  const res = await fetch("/v2/api/safety/me", { cache: "no-store" });
  const json = (await res.json().catch(() => null)) as MeResponse | null;
  if (!res.ok || !json?.ok) throw new Error(`me ${res.status}`);
  return json;
}
