// src/lib/trailerStops.ts
// stops-01 — stop order inside a trailer group (jobs.trailer_stop, copied onto bols.trailer_stop).
// 1 = first stop. NULL = not set (no auto-numbering). Pure helpers, shared by the
// PUT /v2/api/board/trailer-stops route, the v2 Stops picker (OrderLinksSection.tsx) and the
// display surfaces (stops-02/03). Legacy mirrors of stopLabel live in logistics/bol-shared.js.

// jb-16: most orders per trailer group. The legacy worker (_worker.js/routes/jobs.js) enforces the
// same cap on link (409 group_full).
export const MAX_TRAILER_GROUP_JOBS = 4;

/** English ordinal + " Stop": 1 → "1st Stop", 2 → "2nd Stop", 11 → "11th Stop", 23 → "23rd Stop". */
export function stopLabel(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  let suffix = "th";
  if (mod100 < 11 || mod100 > 13) {
    if (mod10 === 1) suffix = "st";
    else if (mod10 === 2) suffix = "nd";
    else if (mod10 === 3) suffix = "rd";
  }
  return `${n}${suffix} Stop`;
}

export interface TrailerStopMember {
  id: string;
  status: string | null;
  archived_at: string | null;
  trailer_stop: number | null;
}

export type ValidateStopsResult = { ok: true } | { ok: false; status: number; error: string };

/** A member whose stop can no longer change: archived, or shipped (Loading is still editable). */
export function isStopLocked(m: { status?: string | null; archived_at?: string | null }): boolean {
  // Old rows can carry the string 'null' in archived_at — treat it as not archived.
  const archived = !!m.archived_at && m.archived_at !== "null";
  return archived || m.status === "shipped";
}

/**
 * Validates a whole group's stop map against the group's current members (all rows with
 * trailer_group_id = group_id). Pure — the route reads members in one SELECT and calls this.
 */
export function validateStops(
  members: TrailerStopMember[],
  stops: Record<string, unknown>
): ValidateStopsResult {
  if (!stops || typeof stops !== "object" || Array.isArray(stops)) {
    return { ok: false, status: 400, error: "Stops must be a map of order to stop number." };
  }
  const byId = new Map(members.map((m) => [m.id, m]));
  const count = members.length;
  const seen = new Set<number>();

  for (const [jobId, raw] of Object.entries(stops)) {
    const m = byId.get(jobId);
    if (!m) return { ok: false, status: 400, error: "One of these orders isn't in this trailer group." };
    if (raw !== null) {
      // A saved stop sent back unchanged is allowed above the member count: unlinking an order
      // leaves the others' stops as they were (e.g. "3rd" in what is now a 2-order group).
      const unchanged = raw === (m.trailer_stop ?? null);
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || (raw > count && !unchanged)) {
        return { ok: false, status: 400, error: `Stop numbers must be 1 to ${count} for this trailer group.` };
      }
      if (seen.has(raw)) return { ok: false, status: 400, error: "Two orders can't be the same stop." };
      seen.add(raw);
    }
  }

  // Values the map leaves out keep their saved stop, so they still count against duplicates.
  for (const m of members) {
    if (m.id in stops) continue;
    if (m.trailer_stop != null) {
      if (seen.has(m.trailer_stop)) return { ok: false, status: 400, error: "Two orders can't be the same stop." };
      seen.add(m.trailer_stop);
    }
  }

  for (const [jobId, raw] of Object.entries(stops)) {
    const m = byId.get(jobId)!;
    const next = raw === null ? null : (raw as number);
    if ((m.trailer_stop ?? null) !== next && isStopLocked(m)) {
      return { ok: false, status: 409, error: "A shipped or archived order's stop can't change." };
    }
  }

  return { ok: true };
}
