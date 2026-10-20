// src/lib/qc/scrapClient.ts — qc-05
// Browser-side POST /v2/api/cutting/scrap for the cutting board's Mark Complete + clock-out modals.
// Never throws: a network error, timeout (20 s) or unreadable body comes back as { ok: false, error }.
import type { ShiftValue } from "./scrap";
import type { toCuttingScrapEntries } from "./cuttingScrap";

export async function postCuttingScrap(body: {
  job_id: string;
  line: string;
  shift: ShiftValue;
  entries: ReturnType<typeof toCuttingScrapEntries>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch("/v2/api/cutting/scrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) return { ok: true };
    return { ok: false, error: data?.error || `Saving scrap failed (HTTP ${res.status}).` };
  } catch (e: any) {
    return { ok: false, error: e?.name === "AbortError" ? "Saving scrap timed out." : "Network error — scrap not saved." };
  } finally {
    clearTimeout(timer);
  }
}
