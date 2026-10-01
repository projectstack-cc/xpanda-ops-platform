// src/lib/qb/client.ts
// qb-01: QuickBooks Online REST client — logic port of the deleted legacy
// _worker.js/lib/quickbooks.js (removed in ae47aa3), with fixes:
//   - fail-closed QB_ENV ("sandbox" | "production"; no default — legacy QB_SANDBOX dropped)
//   - tokens encrypted at rest (./crypto.ts)
//   - single-flight refresh: refresh tokens rotate, so the UPDATE is conditional on the old
//     ciphertext and a lost race re-reads instead of stranding the chain
//   - DocNumber validated before it is interpolated into the QBO query
// NEVER put token values in thrown messages, responses, or logs.
import type { D1Database } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { encryptToken, decryptToken } from "./crypto";

const QBO_PROD_BASE = "https://quickbooks.api.intuit.com/v3/company";
const QBO_SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com/v3/company";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh if <5 min remaining
const QUERY_PARAMS = "minorversion=75&include=enhancedAllCustomFields";

export interface QbEnv {
  QB_ENV?: string;
  QB_CLIENT_ID?: string;
  QB_CLIENT_SECRET?: string;
  QB_REALM_ID?: string;
  QB_TOKEN_KEY?: string;
}

interface QbConnectionRow {
  id: string;
  realm_id: string;
  access_token_enc: string;
  refresh_token_enc: string;
  token_expires_at: string;
  created_at: string;
  updated_at: string;
}

// Must be called inside a request handler (never at module top level).
export async function getQbEnv(): Promise<QbEnv> {
  const { env } = await getCloudflareContext();
  const e = env as any;
  return {
    QB_ENV: e.QB_ENV,
    QB_CLIENT_ID: e.QB_CLIENT_ID,
    QB_CLIENT_SECRET: e.QB_CLIENT_SECRET,
    QB_REALM_ID: e.QB_REALM_ID,
    QB_TOKEN_KEY: e.QB_TOKEN_KEY,
  };
}

export function qbMode(env: QbEnv): "sandbox" | "production" {
  if (env.QB_ENV === "sandbox" || env.QB_ENV === "production") return env.QB_ENV;
  throw new Error("QB_ENV not configured");
}

function base(env: QbEnv): string {
  return qbMode(env) === "sandbox" ? QBO_SANDBOX_BASE : QBO_PROD_BASE;
}

function realmOf(env: QbEnv): string {
  if (!env.QB_REALM_ID) throw new Error("QB_REALM_ID not configured");
  return env.QB_REALM_ID;
}

async function intuitError(prefix: string, resp: Response): Promise<Error> {
  let body = "";
  try { body = (await resp.text()).slice(0, 500); } catch { /* ignore */ }
  return new Error(`${prefix}: ${resp.status}${body ? ` ${body}` : ""}`);
}

export async function getConnection(db: D1Database, realmId: string): Promise<QbConnectionRow | null> {
  return db.prepare("SELECT * FROM qb_connections WHERE realm_id = ? LIMIT 1")
    .bind(realmId).first<QbConnectionRow>();
}

function expiringSoon(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true;
  const t = new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return true;
  return Date.now() >= t - REFRESH_BUFFER_MS;
}

function expired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true;
  const t = new Date(expiresAt).getTime();
  return !Number.isFinite(t) || Date.now() >= t;
}

export async function saveConnection(
  db: D1Database,
  env: QbEnv,
  { realmId, accessToken, refreshToken, expiresIn }: { realmId: string; accessToken: string; refreshToken: string; expiresIn: number },
): Promise<{ token_expires_at: string }> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Number(expiresIn) * 1000).toISOString();
  const accessEnc = await encryptToken(accessToken, env.QB_TOKEN_KEY);
  const refreshEnc = await encryptToken(refreshToken, env.QB_TOKEN_KEY);
  await db.prepare(`
    INSERT INTO qb_connections (id, realm_id, access_token_enc, refresh_token_enc, token_expires_at, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(realm_id) DO UPDATE SET
      access_token_enc = excluded.access_token_enc,
      refresh_token_enc = excluded.refresh_token_enc,
      token_expires_at = excluded.token_expires_at,
      updated_at = excluded.updated_at
  `).bind(crypto.randomUUID(), realmId, accessEnc, refreshEnc, expiresAt, now, now).run();
  return { token_expires_at: expiresAt };
}

export async function getValidToken(db: D1Database, env: QbEnv): Promise<string> {
  qbMode(env);
  const realmId = realmOf(env);
  const conn = await getConnection(db, realmId);
  if (!conn) throw new Error(`No QB connection for realm ${realmId}. POST /v2/api/qb/connect first.`);
  if (!expiringSoon(conn.token_expires_at)) return decryptToken(conn.access_token_enc, env.QB_TOKEN_KEY);

  // Single-flight refresh — step 1: remember the refresh ciphertext we read.
  const oldRefreshEnc = conn.refresh_token_enc;
  const clientId = env.QB_CLIENT_ID;
  const clientSecret = env.QB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("QB_CLIENT_ID or QB_CLIENT_SECRET not configured");
  const refreshToken = await decryptToken(oldRefreshEnc, env.QB_TOKEN_KEY);

  // Step 2: POST the refresh.
  const resp = await fetch(QBO_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
  });

  if (!resp.ok) {
    // Step 4: someone else may have rotated between our read and our POST.
    const err = await intuitError("QB token refresh failed", resp);
    const again = await getConnection(db, realmId);
    if (again && again.refresh_token_enc !== oldRefreshEnc && !expired(again.token_expires_at)) {
      return decryptToken(again.access_token_enc, env.QB_TOKEN_KEY);
    }
    throw err;
  }

  const data: any = await resp.json();
  if (!data?.access_token || !data?.refresh_token) throw new Error("QB token refresh returned no tokens");
  const expiresAt = new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString();
  const now = new Date().toISOString();
  const accessEnc = await encryptToken(String(data.access_token), env.QB_TOKEN_KEY);
  // Always persist the new (rotated) refresh token.
  const refreshEnc = await encryptToken(String(data.refresh_token), env.QB_TOKEN_KEY);

  // Step 3: conditional on the OLD ciphertext — 0 changes means another request already rotated.
  const upd = await db.prepare(`
    UPDATE qb_connections SET access_token_enc=?, refresh_token_enc=?, token_expires_at=?, updated_at=?
     WHERE id=? AND refresh_token_enc=?
  `).bind(accessEnc, refreshEnc, expiresAt, now, conn.id, oldRefreshEnc).run();

  if ((upd.meta as any)?.changes === 0) {
    const winner = await getConnection(db, realmId);
    if (!winner) throw new Error("QB connection disappeared during refresh");
    return decryptToken(winner.access_token_enc, env.QB_TOKEN_KEY);
  }
  return String(data.access_token);
}

export async function fetchInvoice(token: string, env: QbEnv, invoiceId: string): Promise<any> {
  if (!/^\d{1,20}$/.test(invoiceId)) throw new Error("Invalid invoiceId");
  const url = `${base(env)}/${realmOf(env)}/invoice/${invoiceId}?${QUERY_PARAMS}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!resp.ok) throw await intuitError("QBO invoice fetch failed", resp);
  const data: any = await resp.json();
  if (!data?.Invoice) throw new Error(`Invoice ${invoiceId} not found in QBO`);
  return data.Invoice;
}

export async function fetchInvoiceByDocNumber(token: string, env: QbEnv, docNumber: string): Promise<any> {
  // Validate BEFORE interpolating — the legacy client injected raw input into the query.
  if (!/^[A-Za-z0-9-]{1,21}$/.test(docNumber)) throw new Error("Invalid docNumber");
  const q = encodeURIComponent(`SELECT * FROM Invoice WHERE DocNumber = '${docNumber}'`);
  const url = `${base(env)}/${realmOf(env)}/query?query=${q}&${QUERY_PARAMS}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!resp.ok) throw await intuitError("QBO invoice query failed", resp);
  const data: any = await resp.json();
  const list = data?.QueryResponse?.Invoice;
  if (!Array.isArray(list) || !list.length) throw new Error(`Invoice DocNumber ${docNumber} not found in QBO`);
  return list[0];
}
