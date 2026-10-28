import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { CREDENTIAL_PREFIX, openCredential, sealCredential } from "@messages/crypto/wrap";

// AES-256-GCM for credentials and session keys stored in Supabase.
// "v1:" is the old format, one static key (ENCRYPTION_KEY) for everyone, no additional data:
// "v1:" + base64(iv[12] | authTag[16] | ciphertext). It is kept for reading old rows and for credentials:reseal.

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

// ---------------------------------------------------------------------------------------------------------
// Connector credentials under the user's own key
// ---------------------------------------------------------------------------------------------------------
// New values are sealed "v2:" with a key derived from the user's data key and the account's ID as additional data
// (packages/crypto/src/wrap.ts, sealCredential). "v1:" values (the static ENCRYPTION_KEY) are still read, so a row
// sealed before the move keeps working until `pnpm credentials:reseal` has moved it. Get a sealer for an account
// from vault.ts (credentialSealer); it finds the user and their key.


export interface CredentialSealer {
  /** Seals text as "v2:" for this account. */
  seal(plain: string): Promise<string>;
  /** Opens a "v2:" value of this account, or a "v1:" value with the old static key. */
  open(payload: string): Promise<string>;
  sealJson(value: unknown): Promise<string>;
  openJson<T>(payload: string): Promise<T>;
}

/** `credKey` is asked for on every call, so a key that has aged out of the cache is fetched again, never held here. */
export function makeSealer(accountId: string, credKey: () => Promise<Uint8Array<ArrayBuffer>>, legacyKey: string): CredentialSealer {
  const sealer: CredentialSealer = {
    async seal(plain) {
      return sealCredential(await credKey(), accountId, plain);
    },
    async open(payload) {
      if (payload.startsWith(CREDENTIAL_PREFIX)) return openCredential(await credKey(), accountId, payload);
      if (payload.startsWith("v1:")) {
        if (!legacyKey) throw new Error("A v1 credential needs ENCRYPTION_KEY, which is not set.");
        return decrypt(payload, legacyKey);
      }
      throw new Error("Unknown ciphertext format.");
    },
    sealJson: (value) => sealer.seal(JSON.stringify(value)),
    async openJson<T>(payload: string) {
      return JSON.parse(await sealer.open(payload)) as T;
    },
  };
  return sealer;
}
