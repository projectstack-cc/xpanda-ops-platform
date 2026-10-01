// src/lib/qb/process.ts
// qb-02: background processing for verified Intuit webhooks (runs inside ctx.waitUntil). Every
// QB-originated create/update/void/delete lands in qb_pending_changes for human review — nothing
// auto-applies to a job. Read-only against QBO (GET only).
//
// Never reads request headers: the webhook route is ungated, so X-User-* would be client-controlled.
import type { D1Database } from "@cloudflare/workers-types";
import { logActivity } from "@/lib/activityLog";
import { dispatchNotification, type PushEnv } from "@/lib/push";
import type { JobCreateInput } from "@/lib/jobCreate";
import { getValidToken, fetchInvoice, type QbEnv } from "./client";
import { loadPartsServer } from "./parts";
import { mapInvoiceToJobInput, relevantHash } from "./mapper";
import { parseCloudEvents, buildDiff, diffCounts, type InvoiceEvent, type JobDiff } from "./webhook";
import { findJobForInvoice, getLink, loadJobAsInput, upsertLink } from "./jobState";

export type PendingKind = "create" | "update" | "void" | "delete";
const KIND_RANK: Record<PendingKind, number> = { create: 0, update: 1, void: 2, delete: 3 };

export interface PendingRow {
  id: string;
  realm_id: string;
  qbo_invoice_id: string;
  doc_number: string | null;
  job_id: string | null;
  kind: PendingKind;
  status: string;
  proposed_json: string | null;
  diff_json: string | null;
  warnings_json: string | null;
  sync_token: string | null;
  new_hash: string | null;
  base_hash: string | null;
  event_count: number;
  first_event_at: string;
  last_event_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

interface QueueInput {
  realmId: string;
  qboInvoiceId: string;
  docNumber: string | null;
  jobId: string | null;
  kind: PendingKind;
  proposed: JobCreateInput | null;
  diff: JobDiff | null;
  warnings: string[];
  syncToken: string | null;
  newHash: string | null;
  baseHash: string | null;
}

export async function getOpenPending(db: D1Database, realmId: string, qboInvoiceId: string): Promise<PendingRow | null> {
  return db.prepare(`SELECT * FROM qb_pending_changes WHERE realm_id = ? AND qbo_invoice_id = ? AND status = 'open' LIMIT 1`)
    .bind(realmId, qboInvoiceId).first<PendingRow>();
}

// Coalescing upsert: one OPEN row per (realm, invoice). Kind only escalates
// (create < update < void < delete). Returns whether to notify (new row or escalation).
export async function queuePending(
  db: D1Database,
  q: QueueInput,
): Promise<{ id: string; isNew: boolean; escalated: boolean; kind: PendingKind; eventCount: number }> {
  const ts = new Date().toISOString();
  const proposedJson = q.proposed ? JSON.stringify(q.proposed) : null;
  const diffJson = q.diff ? JSON.stringify(q.diff) : null;
  const warningsJson = JSON.stringify(q.warnings || []);

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await getOpenPending(db, q.realmId, q.qboInvoiceId);
    if (existing) {
      const kind: PendingKind = KIND_RANK[q.kind] > KIND_RANK[existing.kind] ? q.kind : existing.kind;
      await db.prepare(`
        UPDATE qb_pending_changes SET
          kind = ?, doc_number = COALESCE(?, doc_number), job_id = COALESCE(?, job_id),
          proposed_json = COALESCE(?, proposed_json), diff_json = COALESCE(?, diff_json), warnings_json = ?,
          sync_token = COALESCE(?, sync_token), new_hash = COALESCE(?, new_hash), base_hash = COALESCE(?, base_hash),
          event_count = event_count + 1, last_event_at = ?, updated_at = ?
        WHERE id = ?
      `).bind(kind, q.docNumber, q.jobId, proposedJson, diffJson, warningsJson, q.syncToken, q.newHash, q.baseHash, ts, ts, existing.id).run();
      return { id: existing.id, isNew: false, escalated: kind !== existing.kind, kind, eventCount: (existing.event_count || 1) + 1 };
    }
    const id = crypto.randomUUID();
    try {
      await db.prepare(`
        INSERT INTO qb_pending_changes
          (id, realm_id, qbo_invoice_id, doc_number, job_id, kind, status, proposed_json, diff_json, warnings_json,
           sync_token, new_hash, base_hash, event_count, first_event_at, last_event_at, created_at, updated_at)
        VALUES (?,?,?,?,?,?,'open',?,?,?,?,?,?,1,?,?,?,?)
      `).bind(id, q.realmId, q.qboInvoiceId, q.docNumber, q.jobId, q.kind, proposedJson, diffJson, warningsJson,
        q.syncToken, q.newHash, q.baseHash, ts, ts, ts, ts).run();
      return { id, isNew: true, escalated: false, kind: q.kind, eventCount: 1 };
    } catch (e: any) {
      // Lost a race on uq_qb_pending_open — loop once more and coalesce into the winner.
      if (attempt === 0 && /UNIQUE/i.test(String(e?.message || e))) continue;
      throw e;
    }
  }
  throw new Error("queuePending: could not insert or coalesce");
}

function pendingSummary(kind: PendingKind, diff: JobDiff | null): string {
  if (kind === "create") return "new order";
  if (kind === "delete") return "invoice deleted in QuickBooks";
  const c = diffCounts(diff);
  return `${c.header} header / ${c.lines} line changes`;
}

async function recordQueued(
  db: D1Database,
  pushEnv: PushEnv,
  q: QueueInput,
  result: Awaited<ReturnType<typeof queuePending>>,
  customer: string,
): Promise<void> {
  const doc = q.docNumber || q.qboInvoiceId;
  const c = diffCounts(q.diff);
  await logActivity(
    db, "queue", "qb_pending_change", result.id,
    `QB ${result.kind} queued: invoice ${doc} (${customer || "unknown customer"})`,
    { qbo_invoice_id: q.qboInvoiceId, kind: result.kind, header_changes: c.header, line_changes: c.lines, event_count: result.eventCount, new: result.isNew, escalated: result.escalated },
    null,
  );
  if (result.isNew || result.escalated) {
    await dispatchNotification(
      db, pushEnv, "qb.review", "QuickBooks change to review",
      `Invoice ${doc} — ${result.kind}: ${pendingSummary(result.kind, q.diff)}`,
      "qb_pending_change", result.id,
    );
  }
}

// qb.error notifications are throttled to once per hour per message class, tracked in activity_log.
export async function notifyQbError(db: D1Database, pushEnv: PushEnv, cls: string, message: string): Promise<void> {
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = await db.prepare(
      `SELECT 1 FROM activity_log WHERE entity_type = 'qb_webhook' AND action = 'notify_error' AND entity_id = ? AND timestamp > ? LIMIT 1`
    ).bind(cls, since).first();
    if (recent) return;
    await logActivity(db, "notify_error", "qb_webhook", cls, `QB error notification sent: ${message.slice(0, 200)}`, { class: cls }, null);
    await dispatchNotification(db, pushEnv, "qb.error", "QuickBooks sync error", message, "qb_webhook", cls);
  } catch (e) {
    console.error("notifyQbError failed:", String((e as any)?.message || e));
  }
}

async function typeSeenBefore(db: D1Database, action: string, type: string): Promise<boolean> {
  const hit = await db.prepare(
    `SELECT 1 FROM activity_log WHERE entity_type = 'qb_webhook' AND action = ? AND detail LIKE ? LIMIT 1`
  ).bind(action, `%${JSON.stringify(type).slice(1, -1)}%`).first();
  return !!hit;
}

// QBO marks voided invoices in PrivateNote ("Voided") with zeroed amounts; some payloads may
// carry a TxnStatus. Best-effort until a captured real payload confirms the shape.
function looksVoided(invoice: any): boolean {
  if (/void/i.test(String(invoice?.TxnStatus ?? ""))) return true;
  return /^\s*voided\b/i.test(String(invoice?.PrivateNote ?? ""));
}

async function processOne(db: D1Database, pushEnv: PushEnv, qb: QbEnv, realmId: string, ev: InvoiceEvent): Promise<void> {
  const first = !(await typeSeenBefore(db, "receive", ev.type));
  await logActivity(
    db, "receive", "qb_webhook", ev.invoiceId, `QB ${ev.op} invoice ${ev.invoiceId}`,
    first ? { eventId: ev.eventId, type: ev.type, time: ev.time, raw_event: ev.raw } : { eventId: ev.eventId, type: ev.type, time: ev.time },
    null,
  );

  // Delete: the invoice can't be fetched — resolve via the link only.
  if (ev.op === "delete") {
    const link = await getLink(db, realmId, ev.invoiceId);
    const open = await getOpenPending(db, realmId, ev.invoiceId);
    if (!link && !open) {
      await logActivity(db, "noop", "qb_webhook", ev.invoiceId, `QB delete for untracked invoice ${ev.invoiceId}`, { eventId: ev.eventId }, null);
      return;
    }
    const q: QueueInput = {
      realmId, qboInvoiceId: ev.invoiceId, docNumber: link?.doc_number ?? open?.doc_number ?? null,
      jobId: link?.job_id ?? null, kind: "delete", proposed: null, diff: null, warnings: [],
      syncToken: null, newHash: null, baseHash: null,
    };
    if (link) {
      const cur = await loadJobAsInput(db, link.job_id);
      if (cur) q.baseHash = await relevantHash(cur);
    }
    const r = await queuePending(db, q);
    await recordQueued(db, pushEnv, q, r, "");
    return;
  }

  const token = await getValidToken(db, qb);
  const invoice = await fetchInvoice(token, qb, ev.invoiceId);
  const { input, warnings } = mapInvoiceToJobInput(invoice, await loadPartsServer(db));
  const newHash = await relevantHash(input);
  const syncToken = invoice?.SyncToken != null ? String(invoice.SyncToken) : null;
  const docNumber = input.invoice_number || null;
  const isVoid = ev.op === "void" || looksVoided(invoice);

  const found = await findJobForInvoice(db, realmId, ev.invoiceId, input.invoice_number);

  // Idempotency: Intuit retries / duplicate events carry the same SyncToken.
  if (found?.link && syncToken != null && found.link.sync_token === syncToken) {
    await logActivity(db, "noop", "qb_webhook", ev.invoiceId, `QB event already applied (SyncToken ${syncToken})`, { eventId: ev.eventId }, null);
    return;
  }

  if (!found) {
    if (isVoid) {
      // Voided invoice with no job: nothing to create. Escalate an open create row if one exists.
      const open = await getOpenPending(db, realmId, ev.invoiceId);
      if (!open) {
        await logActivity(db, "noop", "qb_webhook", ev.invoiceId, `QB void for untracked invoice ${docNumber || ev.invoiceId}`, { eventId: ev.eventId }, null);
        return;
      }
      const q: QueueInput = { realmId, qboInvoiceId: ev.invoiceId, docNumber, jobId: null, kind: "void", proposed: input, diff: null, warnings, syncToken, newHash, baseHash: null };
      const r = await queuePending(db, q);
      await recordQueued(db, pushEnv, q, r, input.customer);
      return;
    }
    const q: QueueInput = { realmId, qboInvoiceId: ev.invoiceId, docNumber, jobId: null, kind: "create", proposed: input, diff: null, warnings, syncToken, newHash, baseHash: null };
    const r = await queuePending(db, q);
    await recordQueued(db, pushEnv, q, r, input.customer);
    return;
  }

  const cur = await loadJobAsInput(db, found.jobId);
  if (!cur) throw new Error(`Linked job ${found.jobId} not found`);
  const curHash = await relevantHash(cur);

  if (!found.link) {
    // Pre-existing (packing-slip) job: link immediately as a baseline — metadata, not a job mutation.
    await upsertLink(db, { realmId, qboInvoiceId: ev.invoiceId, docNumber: input.invoice_number, jobId: found.jobId, syncToken, hash: curHash });
    await logActivity(db, "link", "qb_webhook", ev.invoiceId, `QB invoice ${docNumber} linked to existing job (baseline)`, { job_id: found.jobId, matches: newHash === curHash }, null);
    if (newHash === curHash && !isVoid) return;
  } else if (newHash === found.link.last_applied_hash && !isVoid) {
    // Billing-only edit: nothing job-relevant changed. Track the SyncToken and move on.
    await db.prepare(`UPDATE qb_invoice_links SET sync_token = ?, last_synced_at = ? WHERE id = ?`)
      .bind(syncToken, new Date().toISOString(), found.link.id).run();
    await logActivity(db, "noop", "qb_webhook", ev.invoiceId, `QB invoice ${docNumber} changed but no job-relevant fields`, { eventId: ev.eventId, sync_token: syncToken }, null);
    return;
  }

  const q: QueueInput = {
    realmId, qboInvoiceId: ev.invoiceId, docNumber, jobId: found.jobId,
    kind: isVoid ? "void" : "update", proposed: input, diff: buildDiff(cur, input), warnings,
    syncToken, newHash, baseHash: curHash,
  };
  const r = await queuePending(db, q);
  await recordQueued(db, pushEnv, q, r, input.customer);
}

function errorClass(msg: string): { cls: string; message: string } {
  if (/invalid_grant/i.test(msg)) return { cls: "connection_lost", message: "QuickBooks connection lost — reconnect required" };
  return { cls: "processing_failed", message: `QuickBooks webhook processing failed: ${msg.slice(0, 200)}` };
}

// Entry point for the webhook route's waitUntil. `raw` is the already-verified body.
export async function processWebhook(db: D1Database, pushEnv: PushEnv, qb: QbEnv, raw: string): Promise<void> {
  const realmId = qb.QB_REALM_ID || "";
  let parsed;
  try {
    if (!realmId) throw new Error("QB_REALM_ID not configured");
    parsed = parseCloudEvents(JSON.parse(raw), realmId);
  } catch (e: any) {
    const msg = String(e?.message || e).slice(0, 300);
    await logActivity(db, "error", "qb_webhook", "-", `QB webhook parse failed: ${msg}`, { len: raw.length }, null);
    await notifyQbError(db, pushEnv, "parse", `QuickBooks webhook could not be read: ${msg.slice(0, 200)}`);
    return;
  }

  for (const t of parsed.unknownInvoiceTypes) {
    if (await typeSeenBefore(db, "unknown_type", t)) continue;
    await logActivity(db, "unknown_type", "qb_webhook", "-", `QB webhook: unrecognized invoice event type ${t}`, { type: t }, null);
  }

  for (const ev of parsed.invoiceEvents) {
    try {
      await processOne(db, pushEnv, qb, realmId, ev);
    } catch (e: any) {
      const msg = String(e?.message || e);
      await logActivity(db, "error", "qb_webhook", ev.invoiceId, `QB processing failed: ${msg.slice(0, 300)}`, { eventId: ev.eventId }, null);
      const { cls, message } = errorClass(msg);
      await notifyQbError(db, pushEnv, cls, message);
    }
  }
}
