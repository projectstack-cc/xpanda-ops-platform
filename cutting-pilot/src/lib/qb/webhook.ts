// src/lib/qb/webhook.ts
// qb-02: pure helpers for the Intuit CloudEvents webhook (no I/O).
//   - verifyIntuitSignature: HMAC-SHA256(raw body, verifier) base64, constant-time compare, fail closed
//   - parseCloudEvents: CloudEvents 1.0 array → invoice events for our realm
//   - buildDiff: current job vs proposed QB state, for the review queue
import type { JobCreateInput } from "@/lib/jobCreate";

export type InvoiceOp = "create" | "update" | "delete" | "void";

export interface InvoiceEvent {
  op: InvoiceOp;
  invoiceId: string;
  eventId: string;
  time: string;
  type: string; // raw CloudEvents `type`, for payload-capture logging
  raw: unknown; // the raw event object
}

export interface ParsedEvents {
  invoiceEvents: InvoiceEvent[];
  ignored: number;
  otherRealm: number;
  // Invoice-looking types (qbo.invoice.*) whose operation word we didn't recognize.
  unknownInvoiceTypes: string[];
}

const OP_MAP: Record<string, InvoiceOp> = {
  created: "create",
  updated: "update",
  deleted: "delete",
  voided: "void",
};

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export async function verifyIntuitSignature(
  rawBody: string,
  signatureHeader: string | null,
  verifier: string | undefined,
): Promise<boolean> {
  try {
    if (!signatureHeader || !verifier) return false;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(verifier), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(rawBody)));
    const a = enc.encode(bytesToB64(mac));
    const b = enc.encode(signatureHeader.trim());
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export function parseCloudEvents(body: unknown, realmId: string): ParsedEvents {
  if (!Array.isArray(body)) throw new Error("Webhook body is not a CloudEvents array");
  const out: ParsedEvents = { invoiceEvents: [], ignored: 0, otherRealm: 0, unknownInvoiceTypes: [] };
  for (const ev of body as any[]) {
    if (!ev || typeof ev !== "object" || String(ev.specversion) !== "1.0") { out.ignored++; continue; }
    const type = String(ev.type ?? "");
    const account = String(ev.intuitaccountid ?? "");
    if (account !== realmId) { out.otherRealm++; continue; }
    const m = type.match(/^qbo\.invoice\.(created|updated|deleted|voided)\.v\d+$/i);
    if (!m) {
      if (/^qbo\.invoice\./i.test(type) && !out.unknownInvoiceTypes.includes(type)) out.unknownInvoiceTypes.push(type);
      out.ignored++;
      continue;
    }
    const invoiceId = String(ev.intuitentityid ?? "").trim();
    if (!invoiceId) { out.ignored++; continue; }
    out.invoiceEvents.push({
      op: OP_MAP[m[1].toLowerCase()],
      invoiceId,
      eventId: String(ev.id ?? ""),
      time: String(ev.time ?? ""),
      type,
      raw: ev,
    });
  }
  return out;
}

export interface HeaderChange { field: string; from: string; to: string }
export interface DiffLine { part_number: string; description: string; quantity: number }
export interface ChangedLine { key: string; field: string; from: string | number; to: string | number }
export interface JobDiff {
  header: HeaderChange[];
  lines: { added: DiffLine[]; removed: DiffLine[]; changed: ChangedLine[] };
}

const HEADER_FIELDS = [
  "customer", "po_number",
  "ship_to_street", "ship_to_street2", "ship_to_city", "ship_to_state", "ship_to_zip",
] as const;

const tr = (v: unknown) => String(v ?? "").trim();
const qn = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function buildDiff(current: JobCreateInput, proposed: JobCreateInput): JobDiff {
  const header: HeaderChange[] = [];
  for (const f of HEADER_FIELDS) {
    const from = tr((current as any)[f]);
    const to = tr((proposed as any)[f]);
    if (from !== to) header.push({ field: f, from, to });
  }

  const cur = (current.line_items || []).map((l) => ({ part_number: tr(l.part_number), description: tr(l.description), quantity: qn(l.quantity) }));
  const prop = (proposed.line_items || []).map((l) => ({ part_number: tr(l.part_number), description: tr(l.description), quantity: qn(l.quantity) }));
  const used = new Array(cur.length).fill(false);
  const added: DiffLine[] = [];
  const changed: ChangedLine[] = [];

  // Greedy, in order: match by part_number, falling back to trimmed description.
  for (const p of prop) {
    let idx = p.part_number ? cur.findIndex((c, i) => !used[i] && c.part_number === p.part_number) : -1;
    if (idx < 0 && p.description) idx = cur.findIndex((c, i) => !used[i] && c.description === p.description);
    if (idx < 0) { added.push(p); continue; }
    used[idx] = true;
    const c = cur[idx];
    const key = p.part_number || p.description;
    if (c.quantity !== p.quantity) changed.push({ key, field: "quantity", from: c.quantity, to: p.quantity });
    if (c.description !== p.description) changed.push({ key, field: "description", from: c.description, to: p.description });
  }
  const removed = cur.filter((_, i) => !used[i]);
  return { header, lines: { added, removed, changed } };
}

export function diffCounts(d: JobDiff | null | undefined): { header: number; lines: number } {
  if (!d) return { header: 0, lines: 0 };
  return { header: d.header.length, lines: d.lines.added.length + d.lines.removed.length + d.lines.changed.length };
}
