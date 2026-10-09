// src/lib/logistics/bolDelete.ts — lgx-boldel-01. Shared by DELETE /v2/api/bols/:id and
// DELETE /v2/api/bols?job_id=. Server is authoritative for the shipped lock (bolLock.ts).
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { isBolLocked } from "@/lib/logistics/bolLock";

export interface BolDeleteRow {
  id: string;
  bol_number: string | null;
  job_id: string | null;
  load_number: number | string | null;
}

/** Same lookups as PUT /v2/api/bols/:id's bol-lock-01 check, factored so delete can reuse them. */
export async function isBolRowLocked(DB: D1Database, bol: BolDeleteRow): Promise<boolean> {
  if (!bol.job_id) return false;
  const ship = await DB.prepare(
    "SELECT status FROM shipments WHERE job_id = ? AND direction = 'outbound' ORDER BY updated_at DESC LIMIT 1"
  ).bind(bol.job_id).first<any>();
  let assignmentStatus: string | null = null;
  if (bol.load_number != null && bol.load_number !== "") {
    const la = await DB.prepare(
      "SELECT loading_status FROM loading_assignments WHERE job_id = ? AND load_number = ? AND loading_status != 'archived' ORDER BY updated_at DESC LIMIT 1"
    ).bind(bol.job_id, bol.load_number).first<any>();
    if (la) assignmentStatus = la.loading_status ?? null;
  }
  return isBolLocked({ loadNumber: bol.load_number, assignmentStatus, shipmentStatus: ship?.status ?? null });
}

/** Deletes one BOL plus its signed-copy rows and R2 objects (R2 best-effort, like POST's regenerate path). */
export async function deleteBolCascade(DB: D1Database, BOL_PHOTOS: R2Bucket | undefined, bolId: string): Promise<void> {
  const docs = await DB.prepare("SELECT r2_key FROM bol_documents WHERE bol_id = ?").bind(bolId).all();
  for (const d of (docs.results ?? []) as any[]) {
    if (d.r2_key && BOL_PHOTOS) {
      try {
        await BOL_PHOTOS.delete(d.r2_key);
      } catch {
        // best-effort cleanup
      }
    }
  }
  await DB.prepare("DELETE FROM bol_documents WHERE bol_id = ?").bind(bolId).run();
  await DB.prepare("DELETE FROM bols WHERE id = ?").bind(bolId).run();
}
