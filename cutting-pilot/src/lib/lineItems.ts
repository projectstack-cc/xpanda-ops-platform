// src/lib/lineItems.ts — job_line_items replace that PRESERVES ids (cutting-ids-01).
// Mirrored in _worker.js/lib/lineItems.js — keep in sync.
//
// cutting_line_progress.line_item_id points at job_line_items.id, so a delete-all/insert-all save
// orphaned every operator check. Instead, diff the incoming list against the job's existing rows:
//   (a) an incoming `id` that belongs to this job → UPDATE that row;
//   (b) else the first unmatched existing row with the same part_number + dimensions → UPDATE it;
//   (c) else INSERT with a fresh uuid.
// Each existing row matches at most once. Unmatched existing rows are DELETEd together with their
// cutting_line_progress rows. Rule (a) runs over the whole list before (b) so an id-carrying item
// can never be stolen by an earlier item's fallback match.
//
// `items` must already be normalized by the caller (the exact values to store); sort_order is the
// array index. Returns D1 statements — the caller batches them (alone or inside a larger batch).

import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

export interface LineItemRow {
  id?: string | null;
  part_id: string | null;
  part_number: string;
  description: string;
  quantity: number;
  dimensions: string;
  density: string | null;
  offload_seq?: number | null;
  zone_label?: string | null;
  zone_bdft?: number | null;
}

const norm = (v: unknown) => String(v ?? "").trim();

export async function replaceLineItemsPreservingIds(
  db: D1Database,
  jobId: string,
  items: LineItemRow[],
): Promise<D1PreparedStatement[]> {
  const existingRes = await db
    .prepare("SELECT id, part_number, dimensions FROM job_line_items WHERE job_id = ? ORDER BY sort_order ASC")
    .bind(jobId)
    .all<{ id: string; part_number: string | null; dimensions: string | null }>();
  const existing = existingRes.results ?? [];
  const existingIds = new Set(existing.map((r) => r.id));
  const used = new Set<string>();
  const list = Array.isArray(items) ? items : [];

  // (a) id match
  const assigned: (string | null)[] = list.map((li) => {
    const id = li && li.id ? String(li.id) : "";
    if (id && existingIds.has(id) && !used.has(id)) { used.add(id); return id; }
    return null;
  });
  // (b) part_number + dimensions match
  list.forEach((li, i) => {
    if (assigned[i]) return;
    const pn = norm(li?.part_number);
    const dim = norm(li?.dimensions);
    const m = existing.find((r) => !used.has(r.id) && norm(r.part_number) === pn && norm(r.dimensions) === dim);
    if (m) { used.add(m.id); assigned[i] = m.id; }
  });

  const stmts: D1PreparedStatement[] = [];
  for (const r of existing) {
    if (used.has(r.id)) continue;
    stmts.push(db.prepare("DELETE FROM cutting_line_progress WHERE job_id = ? AND line_item_id = ?").bind(jobId, r.id));
    stmts.push(db.prepare("DELETE FROM job_line_items WHERE id = ? AND job_id = ?").bind(r.id, jobId));
  }
  list.forEach((li, i) => {
    const vals = [
      li.part_id ?? null, li.part_number, li.description, li.quantity, li.dimensions, li.density ?? null, i,
      li.offload_seq ?? null, li.zone_label ?? null, li.zone_bdft ?? null,
    ];
    const matched = assigned[i];
    if (matched) {
      stmts.push(db.prepare(`
        UPDATE job_line_items
           SET part_id = ?, part_number = ?, description = ?, quantity = ?, dimensions = ?, density = ?,
               sort_order = ?, offload_seq = ?, zone_label = ?, zone_bdft = ?
         WHERE id = ? AND job_id = ?
      `).bind(...vals, matched, jobId));
    } else {
      stmts.push(db.prepare(`
        INSERT INTO job_line_items (id, job_id, part_id, part_number, description, quantity, dimensions, density, sort_order, offload_seq, zone_label, zone_bdft)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      `).bind(crypto.randomUUID(), jobId, ...vals));
    }
  });
  return stmts;
}
