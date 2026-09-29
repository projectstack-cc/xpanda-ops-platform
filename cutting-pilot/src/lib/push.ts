// src/lib/push.ts — push notification dispatch + Web Push crypto helpers (carrier-04)
// Ported 1:1 from `_worker.js/lib/push.js` — keep in sync. Same role-subscription query
// (roles.notification_types JSON), same `notifications` inbox insert, same 410/404
// push_subscriptions cleanup, same swallow-and-log on failure. VAPID keys come from the `env`
// the caller reads inside its request handler (getCloudflareContext) — never at module top-level.
// If VAPID secrets are absent, inbox rows still land and push is skipped — identical to legacy.
import type { D1Database } from "@cloudflare/workers-types";

export interface PushEnv {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}

export async function dispatchNotification(
  db: D1Database,
  env: PushEnv,
  type: string,
  title: string,
  message: string,
  entityType: string,
  entityId: string
): Promise<void> {
  try {
    const roles = await db.prepare("SELECT id, notification_types FROM roles").all<any>();

    const subscribedRoleIds = (roles.results || [])
      .filter((r: any) => {
        try { return JSON.parse(r.notification_types || "[]").includes(type); } catch { return false; }
      })
      .map((r: any) => r.id);

    if (!subscribedRoleIds.length) return;

    const placeholders = subscribedRoleIds.map(() => "?").join(",");
    const userRows = await db.prepare(
      `SELECT DISTINCT ur.user_id FROM user_roles ur WHERE ur.role_id IN (${placeholders})`
    ).bind(...subscribedRoleIds).all<any>();

    const userIds = (userRows.results || []).map((r: any) => r.user_id);
    if (!userIds.length) return;

    const now = new Date().toISOString();
    for (const userId of userIds) {
      const nid = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO notifications (id, user_id, type, title, message, entity_type, entity_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(nid, userId, type, title, message, entityType, entityId, now).run();
    }

    if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
      for (const userId of userIds) {
        const subs = await db.prepare("SELECT * FROM push_subscriptions WHERE user_id = ?").bind(userId).all<any>();
        for (const sub of (subs.results || [])) {
          try {
            await sendPushNotification(env, sub, { title, body: message, type, entityType, entityId });
          } catch (e: any) {
            if (e.statusCode === 410 || e.statusCode === 404) {
              await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("Notification dispatch failed:", e);
  }
}

// ── Web Push Helpers (VAPID + RFC 8291 encryption) ──────────────────────

function base64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
}

function base64UrlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBuffers(...buffers: Array<ArrayBuffer | Uint8Array>): Uint8Array {
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    // Same as legacy's `new Uint8Array(buf.buffer)` for the whole-buffer views this file builds,
    // but offset-safe for sliced views too.
    result.set(buf instanceof Uint8Array ? buf : new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return result;
}

async function importVapidPrivateKey(base64UrlPrivateKey: string): Promise<CryptoKey> {
  const rawPrivate = base64UrlDecode(base64UrlPrivateKey);
  const pkcs8Prefix = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48,
    0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03,
    0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20,
  ]);
  const pkcs8 = concatBuffers(pkcs8Prefix, rawPrivate);

  return crypto.subtle.importKey(
    "pkcs8", pkcs8.buffer as ArrayBuffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
}

async function createVapidJwt(env: PushEnv, audience: string): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: audience,
    exp: now + 86400,
    sub: "mailto:ops@xpandafoam.com",
  };

  const enc = new TextEncoder();
  const headerB64 = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const privateKey = await importVapidPrivateKey(env.VAPID_PRIVATE_KEY as string);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    enc.encode(signingInput)
  );

  const sigBytes = new Uint8Array(signature);
  let r: Uint8Array, s: Uint8Array;
  if (sigBytes[0] === 0x30) {
    let offset = 2;
    const rLen = sigBytes[offset + 1];
    r = sigBytes.slice(offset + 2, offset + 2 + rLen);
    offset = offset + 2 + rLen;
    const sLen = sigBytes[offset + 1];
    s = sigBytes.slice(offset + 2, offset + 2 + sLen);
    if (r.length > 32) r = r.slice(r.length - 32);
    if (r.length < 32) { const p = new Uint8Array(32); p.set(r, 32 - r.length); r = p; }
    if (s.length > 32) s = s.slice(s.length - 32);
    if (s.length < 32) { const p = new Uint8Array(32); p.set(s, 32 - s.length); s = p; }
  } else {
    r = sigBytes.slice(0, 32);
    s = sigBytes.slice(32, 64);
  }
  const rawSig = concatBuffers(r, s);

  return `${signingInput}.${base64UrlEncode(rawSig)}`;
}

async function encryptPushPayload(p256dhKey: string, authSecret: string, payloadText: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const payloadBytes = enc.encode(payloadText);

  const subscriberPubBytes = base64UrlDecode(p256dhKey);
  const subscriberPubKey = await crypto.subtle.importKey(
    "raw", subscriberPubBytes as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const authBytes = base64UrlDecode(authSecret);

  const localKeyPair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  )) as CryptoKeyPair;

  const localPubBytes = new Uint8Array(
    (await crypto.subtle.exportKey("raw", localKeyPair.publicKey)) as ArrayBuffer
  );

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: subscriberPubKey },
      localKeyPair.privateKey,
      256
    )
  );

  const authKey = await crypto.subtle.importKey(
    "raw", authBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const prk = new Uint8Array(
    await crypto.subtle.sign("HMAC", authKey, sharedSecret)
  );

  const infoPrefix = enc.encode("WebPush: info\0");
  const ikm_info = concatBuffers(infoPrefix, subscriberPubBytes, localPubBytes);
  const ikm = await hkdfExpand(prk, ikm_info, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));

  const saltKey = await crypto.subtle.importKey(
    "raw", salt, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const prk2 = new Uint8Array(
    await crypto.subtle.sign("HMAC", saltKey, ikm as BufferSource)
  );

  const cekInfo = enc.encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = enc.encode("Content-Encoding: nonce\0");

  const cek = await hkdfExpand(prk2, cekInfo, 16);
  const nonce = await hkdfExpand(prk2, nonceInfo, 12);

  const padded = concatBuffers(payloadBytes, new Uint8Array([2]));

  const aesKey = await crypto.subtle.importKey(
    "raw", cek as BufferSource, { name: "AES-GCM" }, false, ["encrypt"]
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      aesKey,
      padded as BufferSource
    )
  );

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  const idlen = new Uint8Array([65]);

  return concatBuffers(salt, rs, idlen, localPubBytes, ciphertext);
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", prk as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const input = concatBuffers(info, new Uint8Array([1]));
  const output = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, input as BufferSource)
  );
  return output.slice(0, length);
}

async function sendPushNotification(env: PushEnv, subscription: any, payload: Record<string, unknown>): Promise<void> {
  try {
    const endpointUrl = new URL(subscription.endpoint);
    const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;

    const jwt = await createVapidJwt(env, audience);
    const vapidPubBytes = base64UrlEncode(base64UrlDecode(env.VAPID_PUBLIC_KEY as string));

    const payloadJson = JSON.stringify(payload);
    const encryptedBody = await encryptPushPayload(
      subscription.p256dh,
      subscription.auth_key,
      payloadJson
    );

    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        "Authorization": `vapid t=${jwt}, k=${vapidPubBytes}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": "86400",
        "Urgency": "normal",
      },
      body: encryptedBody as BodyInit,
    });

    if (res.status === 410 || res.status === 404) {
      const err: any = new Error("Subscription expired");
      err.statusCode = res.status;
      throw err;
    }

    if (!res.ok) {
      console.error("Push send failed:", res.status, await res.text());
    }
  } catch (e: any) {
    if (e.statusCode === 410 || e.statusCode === 404) throw e;
    console.error("Push notification error:", e);
  }
}
