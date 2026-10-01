// src/lib/qb/review.ts
// qb-02: review-queue actions behind /v2/api/qb/pending/* (session-gated; middleware maps
// /v2/api/qb → `jobs`, GET=view, POST=edit). Actor identity always comes from X-User-* headers
// injected by middleware — never from the request body.
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { logActivity } from "@/lib/activityLog";
import { dispatchNotification, type PushEnv } from "@/lib/push";
import { computeAndPersistHoleyChunks } from "@/lib/holeyChunks";
import { createJob, lineItemInsertStatements, type JobCreateInput } from "@/lib/jobCreate";
import { relevantHash } from "./mapper";
import { buildDiff, diffCounts, type JobDiff } from "./webhook";
import { floorState, getLink, loadJobAsInput, upsertLink } from "./jobState";
import type { PendingRow } from "./process";

export function parseJson<T>(v: string | null | undefined): T | null {
  if (!v) return null;
  try { return JSON.parse(v) as T; } catch { return null; }
}

export async function getPending(db: D1Database, id: string): Promise<PendingRow | null> {
  return db.prepare(`SELECT * FROM qb_pending_changes WHERE id = ?`).bind(id).first<PendingRow>();
}

export function publicRow(row: PendingRow) {
  const proposed = parseJson<JobCreateInput>(row.proposed_json);
  return {
    id: row.id,
    realm_id: row.realm_id,
    qbo_invoice_id: row.qbo_invoice_id,
    doc_number: row.doc_number,
    job_id: row.job_id,
    kind: row.kind,
    status: row.status,
    diff: parseJson<JobDiff>(row.diff_json),
    warnings: parseJson<string[]>(row.warnings_json) ?? [],
    event_count: row.event_count,
    first_event_at: row.first_event_at,
    last_event_at: row.last_event_at,
    resolved_by: row.resolved_by,
    resolved_at: row.resolved_at,
    resolution_note: row.resolution_note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    proposed,
  };
}

// For an open update/void/delete item: recompute the diff and base_hash against the job as it is
// now, so what the reviewer sees is exactly what apply checks against (the "re-open to refresh").
export async function refreshOpenItem(db: D1Database, row: PendingRow): Promise<PendingRow> {
  if (row.status !== "open" || !row.job_id || row.kind === "create") return row;
  const cur = await loadJobAsInput(db, row.job_id);
  if (!cur) return row;
  const curHash = await relevantHash(cur);
  const proposed = parseJson<JobCreateInput>(row.proposed_json);
  const diff = proposed ? buildDiff(cur, proposed) : null;
  const diffJson = diff ? JSON.stringify(diff) : row.diff_json;
  if (curHash === row.base_hash && diffJson === row.diff_json) return row;
  await db.prepare(`UPDATE qb_pending_changes SET base_hash = ?, diff_json = ? WHERE id = ? AND status = 'open'`)
    .bind(curHash, diffJson, row.id).run();
  return { ...row, base_hash: curHash, diff_json: diffJson };
}

export type ReviewResult =
  | { ok: true; status: number; body: Record<string, unknown> }
  | { ok: false; status: number; body: Record<string, unknown> };

const fail = (status: number, body: Record<string, unknown>): ReviewResult => ({ ok: false, status, body: { ok: false, ...body } });

async function markResolved(db: D1Database, id: string, status: string, actorName: string, note: string | null): Promise<boolean> {
  const r = await db.prepare(`
    UPDATE qb_pending_changes SET status = ?, resolved_by = ?, resolved_at = ?, resolution_note = ?, updated_at = ?
     WHERE id = ? AND status = 'open'
  `).bind(status, actorName, new Date().toISOString(), note, new Date().toISOString(), id).run();
  return ((r.meta as any)?.changes ?? 0) > 0;
}

export async function closeWithoutApply(
  db: D1Database,
  pushEnv: PushEnv,
  id: string,
  status: "dismissed" | "resolved_manual",
  actor: { id: string | null; name: string },
  note: string | null,
): Promise<ReviewResult> {
  const row = await getPending(db, id);
  if (!row) return fail(404, { error: "Review item not found." });
  if (row.status !== "open") return fail(409, { code: "already_resolved", error: "This item was already resolved.", status: row.status });
  if (!(await markResolved(db, id, status, actor.name, note))) {
    return fail(409, { code: "already_resolved", error: "This item was already resolved." });
  }
  const doc = row.doc_number || row.qbo_invoice_id;
  const verb = status === "dismissed" ? "dismissed" : "resolved manually";
  await logActivity(db, status === "dismissed" ? "dismiss" : "resolve_manual", "qb_pending_change", id,
    `${actor.name || "Someone"} ${verb} QB ${row.kind} for invoice ${doc}`, { note, job_id: row.job_id, kind: row.kind }, actor.id);
  await dispatchNotification(db, pushEnv, "qb.review", "QuickBooks review resolved",
    `Invoice ${doc} — ${row.kind} ${verb} by ${actor.name || "someone"}`, "qb_pending_change", id);
  return { ok: true, status: 200, body: { ok: true, id, status } };
}

export async function applyPending(
  env: { DB: D1Database; BOL_PHOTOS: R2Bucket },
  pushEnv: PushEnv,
  id: string,
  actor: { id: string | null; name: string },
  opts: { confirmOverwrite: boolean },
): Promise<ReviewResult> {
  const { DB } = env;
  const row = await getPending(DB, id);
  if (!row) return fail(404, { error: "Review item not found." });
  if (row.status !== "open") return fail(409, { code: "already_resolved", error: "This item was already resolved.", status: row.status });
  const doc = row.doc_number || row.qbo_invoice_id;
  const proposed = parseJson<JobCreateInput>(row.proposed_json);
  let jobId = row.job_id;
  let detail: Record<string, unknown> = { kind: row.kind, qbo_invoice_id: row.qbo_invoice_id };

  if (row.kind === "create") {
    if (!proposed) return fail(400, { error: "Nothing to apply — no proposed order on this item." });
    const result = await createJob(env, proposed, actor, { source: "quickbooks", via: "qb-review" });
    if (!result.ok) {
      if (result.code === "duplicate_invoice") {
        return fail(409, { code: "duplicate_invoice", error: `A job with invoice # ${proposed.invoice_number} already exists.`, job_id: result.job_id });
      }
      return fail(400, { error: result.error });
    }
    jobId = result.id;
    await upsertLink(DB, { realmId: row.realm_id, qboInvoiceId: row.qbo_invoice_id, docNumber: proposed.invoice_number, jobId, syncToken: row.sync_token, hash: row.new_hash });
    detail = { ...detail, customer: proposed.customer, line_items: proposed.line_items.length };
  } else {
    if (!jobId) return fail(400, { code: "no_job", error: "This invoice has no job on the platform — dismiss it instead." });
    const floor = await floorState(DB, jobId);
    if (floor.blocked) return fail(409, { code: "floor_records", error: "The floor has already recorded work on this job.", reasons: floor.reasons });

    if (row.kind === "update") {
      if (!proposed) return fail(400, { error: "Nothing to apply — no proposed order on this item." });
      const cur = await loadJobAsInput(DB, jobId);
      if (!cur) return fail(404, { error: "Job not found." });
      const curHash = await relevantHash(cur);
      if (curHash !== row.base_hash) {
        return fail(409, { code: "stale", error: "The job changed after this item was queued. Re-open it to refresh the diff." });
      }
      const link = await getLink(DB, row.realm_id, row.qbo_invoice_id);
      if (link && link.last_applied_hash && curHash !== link.last_applied_hash && !opts.confirmOverwrite) {
        return fail(409, { code: "platform_edits", error: "This job was edited on the platform since the last QuickBooks sync. Confirm to overwrite." });
      }
      const diff = buildDiff(cur, proposed);
      const addressChanged = diff.header.some((h) => h.field.startsWith("ship_to_"));
      const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
      await DB.batch([
        DB.prepare(`
          UPDATE jobs SET customer = ?, po_number = ?, ship_to_street = ?, ship_to_street2 = ?, ship_to_city = ?,
                          ship_to_state = ?, ship_to_zip = ?, total_bdft = ?, updated_at = ?
           WHERE id = ?
        `).bind(proposed.customer, proposed.po_number, proposed.ship_to_street, proposed.ship_to_street2, proposed.ship_to_city,
          proposed.ship_to_state, proposed.ship_to_zip, proposed.total_bdft, ts, jobId),
        // Address changed → the old verification no longer describes it.
        ...(addressChanged
          ? [DB.prepare(`UPDATE jobs SET ship_to_verified = 'unverified', ship_to_standardized = NULL, ship_to_verified_at = NULL WHERE id = ?`).bind(jobId)]
          : []),
        DB.prepare(`DELETE FROM job_line_items WHERE job_id = ?`).bind(jobId),
        ...lineItemInsertStatements(DB, jobId, proposed.line_items),
        // createJob-derived mirror: outbound shipment customer + total_bdft. (destination mirrors
        // jobs.location, which QB never sets, so it is left alone.)
        DB.prepare(`UPDATE shipments SET customer = ?, total_bdft = ?, updated_at = datetime('now') WHERE job_id = ? AND direction = 'outbound'`)
          .bind(proposed.customer, proposed.total_bdft, jobId),
      ]);
      try {
        await computeAndPersistHoleyChunks(DB, jobId);
      } catch (e: any) {
        console.error("computeAndPersistHoleyChunks failed:", String(e?.message || e));
      }
      await upsertLink(DB, { realmId: row.realm_id, qboInvoiceId: row.qbo_invoice_id, docNumber: proposed.invoice_number || doc, jobId, syncToken: row.sync_token, hash: row.new_hash });
      const c = diffCounts(diff);
      detail = { ...detail, diff, header_changes: c.header, line_changes: c.lines, overwrote_platform_edits: opts.confirmOverwrite };
    } else {
      // void / delete → archive only (legacy semantics: set archived_at, never status).
      await DB.prepare(`UPDATE jobs SET archived_at = ?, updated_at = ? WHERE id = ? AND archived_at IS NULL`)
        .bind(new Date().toISOString(), new Date().toISOString().replace("T", " ").slice(0, 19), jobId).run();
      detail = { ...detail, archived: true };
    }
  }

  if (!(await markResolved(DB, id, "applied", actor.name, null))) {
    return fail(409, { code: "already_resolved", error: "This item was resolved by someone else." });
  }
  const summary = `${actor.name || "Someone"} applied QB ${row.kind} for invoice ${doc}`;
  await logActivity(DB, "apply", "qb_pending_change", id, summary, { ...detail, job_id: jobId }, actor.id);
  if (jobId) await logActivity(DB, "apply", "job", jobId, summary, { ...detail, pending_id: id }, actor.id);
  await dispatchNotification(DB, pushEnv, "qb.review", "QuickBooks change applied",
    `Invoice ${doc} — ${row.kind} applied by ${actor.name || "someone"}`, "qb_pending_change", id);
  return { ok: true, status: 200, body: { ok: true, id, kind: row.kind, job_id: jobId } };
}
