import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM for credentials and session keys stored in Supabase.
// The key lives only in the worker's environment; the database only ever sees ciphertext.
// Format: "v1:" + base64(iv[12] | authTag[16] | ciphertext).

function key(raw: string): Buffer {
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
  return buf;
}

export function encrypt(plaintext: string, rawKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function decrypt(payload: string, rawKey: string): string {
  if (!payload.startsWith("v1:")) throw new Error("Unknown ciphertext format.");
  const buf = Buffer.from(payload.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(rawKey), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export function encryptJson(value: unknown, rawKey: string): string {
  return encrypt(JSON.stringify(value), rawKey);
}

export function decryptJson<T>(payload: string, rawKey: string): T {
  return JSON.parse(decrypt(payload, rawKey)) as T;
}
