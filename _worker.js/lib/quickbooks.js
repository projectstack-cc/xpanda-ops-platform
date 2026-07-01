const QBO_PROD_BASE    = 'https://quickbooks.api.intuit.com/v3/company';
const QBO_SANDBOX_BASE = 'https://sandbox-quickbooks.api.intuit.com/v3/company';
const QBO_TOKEN_URL    = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh if <5 min remaining

function base(env) {
  return env.QB_SANDBOX === '1' ? QBO_SANDBOX_BASE : QBO_PROD_BASE;
}

async function getConnection(db, realmId) {
  return db.prepare('SELECT * FROM qb_connections WHERE realm_id = ? LIMIT 1')
    .bind(realmId).first();
}

function expiringSoon(conn) {
  if (!conn?.token_expires_at) return true;
  return Date.now() >= new Date(conn.token_expires_at).getTime() - REFRESH_BUFFER_MS;
}

async function doRefresh(db, conn, env) {
  const clientId     = env.QB_CLIENT_ID;
  const clientSecret = env.QB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('QB_CLIENT_ID or QB_CLIENT_SECRET not configured');

  const resp = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      Accept:         'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(conn.refresh_token)}`,
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`QB token refresh failed: ${resp.status} ${body}`);
  }

  const data = await resp.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  const now = new Date().toISOString();

  await db.prepare(`
    UPDATE qb_connections
    SET access_token = ?, refresh_token = ?, token_expires_at = ?, updated_at = ?
    WHERE id = ?
  `).bind(data.access_token, data.refresh_token, expiresAt, now, conn.id).run();

  return data.access_token;
}

export async function getValidToken(db, realmId, env) {
  const conn = await getConnection(db, realmId);
  if (!conn) throw new Error(`No QB connection for realm ${realmId}. Run POST /api/qb/connect first.`);
  if (expiringSoon(conn)) return doRefresh(db, conn, env);
  return conn.access_token;
}

export async function saveConnection(db, { realmId, accessToken, refreshToken, expiresIn }) {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Number(expiresIn) * 1000).toISOString();
  const existing = await getConnection(db, realmId);
  if (existing) {
    await db.prepare(`
      UPDATE qb_connections SET access_token=?, refresh_token=?, token_expires_at=?, updated_at=? WHERE realm_id=?
    `).bind(accessToken, refreshToken, expiresAt, now, realmId).run();
  } else {
    await db.prepare(`
      INSERT INTO qb_connections (id, realm_id, access_token, refresh_token, token_expires_at, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?)
    `).bind(crypto.randomUUID(), realmId, accessToken, refreshToken, expiresAt, now, now).run();
  }
}

export async function fetchInvoice(token, realmId, invoiceId, env) {
  const url = `${base(env)}/${realmId}/invoice/${invoiceId}?minorversion=75`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`QBO invoice fetch failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  if (!data.Invoice) throw new Error(`Invoice ${invoiceId} not found in QBO`);
  return data.Invoice;
}

export async function fetchInvoiceByDocNumber(token, realmId, docNumber, env) {
  const q = encodeURIComponent(`SELECT * FROM Invoice WHERE DocNumber = '${docNumber}' MAXRESULTS 1`);
  const url = `${base(env)}/${realmId}/query?query=${q}&minorversion=75`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!resp.ok) throw new Error(`QBO invoice query failed: ${resp.status} ${await resp.text()}`);
  const data = await resp.json();
  const list = data.QueryResponse?.Invoice;
  if (!list?.length) throw new Error(`Invoice DocNumber ${docNumber} not found in QBO`);
  return list[0];
}

const QBO_AUTH_BASE   = 'https://appcenter.intuit.com/connect/oauth2';
const QB_REDIRECT_URI = 'https://www.xpandaops.com/api/qb/callback';

export function buildAuthUrl(state, env) {
  const params = new URLSearchParams({
    client_id:     env.QB_CLIENT_ID,
    response_type: 'code',
    scope:         'com.intuit.quickbooks.accounting',
    redirect_uri:  QB_REDIRECT_URI,
    state,
  });
  return `${QBO_AUTH_BASE}?${params}`;
}

export async function exchangeCodeForTokens(code, env) {
  const resp = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${btoa(`${env.QB_CLIENT_ID}:${env.QB_CLIENT_SECRET}`)}`,
      Accept:         'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: QB_REDIRECT_URI,
    }),
  });
  if (!resp.ok) throw new Error(`QB token exchange failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

// Verifies the intuit-signature header on incoming webhook POSTs.
// Intuit signs the raw body with HMAC-SHA256 using the webhook verifier token, base64-encoded.
export async function verifyWebhookSignature(rawBody, signature, verifierToken) {
  if (!signature || !verifierToken) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(verifierToken),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const mac     = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
    const computed = btoa(String.fromCharCode(...new Uint8Array(mac)));
    return computed === signature;
  } catch {
    return false;
  }
}
