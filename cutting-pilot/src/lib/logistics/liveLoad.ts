// src/lib/logistics/liveLoad.ts — live-load classifier (live-01).
// A live load = a third-party driver waits at the dock while we load. Anything that isn't Seal
// Express / our own truck is live; customer pickups and hand deliveries are not. Unknown (blank)
// carriers are never flagged — a false alarm would train people to ignore the marker.
// Single source for every v2 surface (schedule board, job board, logistics, dock).
import type { D1Database } from "@cloudflare/workers-types";
import { normCarrier } from "./bolCarrier";
import { effectiveLoadCarrier } from "./loadCarriers";

const NOT_LIVE_METHODS = new Set(["customer pickup", "cpu", "hand deliver"]);
const OWN_FLEET_PREFIXES = ["seal", "lisma", "xpanda", "xp truck", "xp co", "xp "];
const PICKUP_MARKERS = ["pick up", "pickup", "cpu", "hand deliver"];

/** true = live load. Pure; no I/O. */
export function isLiveLoadCarrier(carrier: string | null | undefined, method?: string | null): boolean {
  if (NOT_LIVE_METHODS.has(String(method ?? "").trim().toLowerCase())) return false;
  const c = normCarrier(carrier);
  if (!c) return false;
  // Whole word only — "Hand Deliver" contains "live" as a substring.
  if (/\blive\b/.test(c)) return true;
  if (OWN_FLEET_PREFIXES.some((p) => c.startsWith(p))) return false;
  if (PICKUP_MARKERS.some((m) => c.includes(m))) return false;
  return true;
}

export interface LiveLoadInfo {
  live: boolean;
  live_loads: number[];
}

const CHUNK = 90; // D1 100-bound-param ceiling

/** Per-job flags from the platform (job carrier + mlc per-load overrides). Chunk ids ≤ 90 per query.
 *  Best-effort: on error logs and returns an empty map — never fails the parent request. */
export async function fetchLiveLoadByJob(DB: D1Database, jobIds: string[]): Promise<Map<string, LiveLoadInfo>> {
  const out = new Map<string, LiveLoadInfo>();
  try {
    const ids = Array.from(new Set(jobIds.filter(Boolean)));
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => "?").join(",");
      const [jobsRes, jlcRes] = await Promise.all([
        DB.prepare(`SELECT id, carrier, method, load_count FROM jobs WHERE id IN (${placeholders})`)
          .bind(...chunk)
          .all<{ id: string; carrier: string | null; method: string | null; load_count: number | null }>(),
        DB.prepare(
          `SELECT jlc.job_id, jlc.load_number, jlc.carrier
             FROM job_load_carriers jlc JOIN jobs j ON j.id = jlc.job_id
            WHERE jlc.job_id IN (${placeholders})
              AND jlc.load_number <= MAX(COALESCE(j.load_count, 1), 1)`
        )
          .bind(...chunk)
          .all<{ job_id: string; load_number: number; carrier: string }>(),
      ]);
      const overrides = new Map<string, Map<number, string>>();
      for (const r of jlcRes.results ?? []) {
        const m = overrides.get(r.job_id) ?? new Map<number, string>();
        m.set(Number(r.load_number), r.carrier);
        overrides.set(r.job_id, m);
      }
      for (const j of jobsRes.results ?? []) {
        const loadCount = Math.max(Number(j.load_count) || 1, 1);
        const jobOverrides = overrides.get(j.id) ?? new Map<number, string>();
        const live_loads: number[] = [];
        for (let n = 1; n <= loadCount; n++) {
          if (isLiveLoadCarrier(effectiveLoadCarrier(j.carrier, jobOverrides, n), j.method)) live_loads.push(n);
        }
        out.set(j.id, { live: live_loads.length > 0, live_loads });
      }
    }
  } catch (e) {
    console.error("fetchLiveLoadByJob failed:", e);
    return new Map();
  }
  return out;
}
