// src/lib/qb/crypto.ts
// qb-01: AES-GCM at-rest encryption for QuickBooks OAuth tokens (qb_connections.*_enc).
// Key = QB_TOKEN_KEY Worker secret, base64 of 32 random bytes (`openssl rand -base64 32`).
// Output format: base64(iv(12) || ciphertext). Throws on a missing/malformed key — never falls
// back to plaintext.

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function importKey(keyB64: string | undefined): Promise<CryptoKey> {
  if (!keyB64) throw new Error("QB_TOKEN_KEY not configured");
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = b64ToBytes(keyB64.trim());
  } catch {
    throw new Error("QB_TOKEN_KEY is not valid base64");
  }
  if (raw.length !== 32) throw new Error("QB_TOKEN_KEY must decode to 32 bytes");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptToken(plain: string, keyB64: string | undefined): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain))
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return bytesToB64(out);
}

export async function decryptToken(enc: string, keyB64: string | undefined): Promise<string> {
  const key = await importKey(keyB64);
  const bytes = b64ToBytes(enc);
  if (bytes.length <= 12) throw new Error("Encrypted token is malformed");
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  } catch {
    throw new Error("Token decryption failed (wrong QB_TOKEN_KEY?)");
  }
  return new TextDecoder().decode(pt);
}
