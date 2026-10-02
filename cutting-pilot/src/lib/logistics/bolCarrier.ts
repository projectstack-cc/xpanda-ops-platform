// src/lib/logistics/bolCarrier.ts — job carrier → BOL carrier rules (bolc-01, bolc-02).
// Mirrors legacy _worker.js/lib/bol-carrier.js. Keep both in lockstep.
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import { logActivity } from "@/lib/activityLog";

type Overrides = Record<string, unknown>;

export function normCarrier(x: unknown): string {
  return String(x ?? "").trim().toLowerCase();
}

function parseOverrides(raw: unknown): Overrides | null {
  if (raw == null || raw === "") return null;
  try {
    const o = typeof raw === "string" ? JSON.parse(raw) : raw;
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Overrides) : null;
  } catch {
    return null;
  }
}

function hasNonEmptyCarrierOverride(o: Overrides | null): o is Overrides & { carrierName: string } {
  return !!o && Object.prototype.hasOwnProperty.call(o, "carrierName")
    && typeof o.carrierName === "string" && o.carrierName.trim() !== "";
}

// The carrier a BOL actually prints: a non-empty carrierName override wins, otherwise
// carrier_name. An empty-string override means "blank on the printout" — deliberate, but it
// is not a carrier, so it does not count here.
export function effectiveCarrier(carrierName: string | null, renderOverrides: string | null): string | null {
  const o = parseOverrides(renderOverrides);
  return hasNonEmptyCarrierOverride(o) ? o.carrierName : carrierName;
}

// Drops a non-empty carrierName override (keeps "" blanks, _pos and every other key).
// Returns the re-serialized string, or null when no keys remain. Unparseable input is
// returned unchanged.
export function stripCarrierOverride(renderOverrides: string | null): string | null {
  const o = parseOverrides(renderOverrides);
  if (!o) return renderOverrides ?? null;
  if (hasNonEmptyCarrierOverride(o)) delete (o as Overrides).carrierName;
  return Object.keys(o).length ? JSON.stringify(o) : null;
}

// Best-effort: never throws. Rewrites unsigned BOLs on the job whose effective carrier is
// still the old job carrier. Returns the number of BOLs updated.
export async function propagateJobCarrierToBols(
  db: D1Database,
  jobId: string,
  oldCarrier: string | null,
  newCarrier: string | null,
  actorId: string | null
): Promise<number> {
  try {
    if (normCarrier(oldCarrier) === normCarrier(newCarrier)) return 0;
    const next = String(newCarrier ?? "").trim();
    const { results } = await db
      .prepare("SELECT id, carrier_name, render_overrides FROM bols WHERE job_id = ? AND signed_bol_photo_key IS NULL")
      .bind(jobId)
      .all<{ id: string; carrier_name: string | null; render_overrides: string | null }>();
    const stmts: D1PreparedStatement[] = [];
    const bolIds: string[] = [];
    for (const r of results || []) {
      if (normCarrier(effectiveCarrier(r.carrier_name, r.render_overrides)) !== normCarrier(oldCarrier)) continue;
      stmts.push(
        db.prepare("UPDATE bols SET carrier_name = ?, render_overrides = ? WHERE id = ?")
          .bind(next, stripCarrierOverride(r.render_overrides), r.id)
      );
      bolIds.push(r.id);
    }
    if (!stmts.length) return 0;
    await db.batch(stmts);
    await logActivity(db, "update", "bol", jobId,
      `Carrier propagated to ${bolIds.length} BOL(s): ${newCarrier}`,
      { job_id: jobId, from: oldCarrier, to: newCarrier, bol_ids: bolIds }, actorId);
    return bolIds.length;
  } catch (e) {
    console.error("propagateJobCarrierToBols failed:", String((e as Error)?.message || e));
    return 0;
  }
}
