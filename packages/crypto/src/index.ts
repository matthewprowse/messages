// Field encryption for Messages: one ciphertext format shared by the browser, the Node sync worker and the
// Python AI worker (apps/ai/ai/crypto.py mirrors this file). Uses WebCrypto, built into browsers and Node.
//
// A value is stored as "e1:" + base64(nonce 12 bytes | ciphertext | GCM tag 16 bytes), AES-256-GCM. The
// additional data names the kind of text it is (fields.ts: "subject", "body"), so a ciphertext copied into
// a field of another kind fails to decrypt. Each user has one random 32-byte data key; the encryption key and the
// blind-index key are derived from it with HKDF-SHA256, so one unwrapped key serves both.
// vectors.json pins the format: the TS and Python tests both check against it.

export const PREFIX = "e1:";
const ENC_INFO = "messages/field-encryption/v1";
const INDEX_INFO = "messages/blind-index/v1";
const NONCE_BYTES = 12;

const subtle = globalThis.crypto.subtle;
const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder("utf-8", { fatal: true });

// WebCrypto's key type, named the same way in browser and Node type definitions.
type Key = Awaited<ReturnType<typeof subtle.importKey>>;

/** The two keys derived from a user's data key: one encrypts fields, one makes blind indexes. */
export interface UserKeys {
  enc: Key;
  index: Key;
}

function hkdf(info: string) {
  return { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: utf8.encode(info) };
}

/** Derives a user's field and index keys from their 32-byte data key. The keys cannot be exported. */
export async function deriveUserKeys(dataKey: Uint8Array<ArrayBuffer>): Promise<UserKeys> {
  if (dataKey.length !== 32) throw new Error("A data key is 32 bytes.");
  const base = await subtle.importKey("raw", dataKey, "HKDF", false, ["deriveKey"]);
  const [enc, index] = await Promise.all([
    subtle.deriveKey(hkdf(ENC_INFO), base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
    subtle.deriveKey(hkdf(INDEX_INFO), base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]),
  ]);
  return { enc, index };
}

/** A new random 32-byte data key. */
export function newDataKey(): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

export function isCiphertext(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Encrypts one field's text. `field` is its kind from fields.ts. A nonce is only passed by the
 * test vectors; otherwise every call takes a fresh random one.
 */
export async function encryptField(keys: UserKeys, field: string, plaintext: string, nonce?: Uint8Array<ArrayBuffer>): Promise<string> {
  const iv = nonce ?? globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  if (iv.length !== NONCE_BYTES) throw new Error("A nonce is 12 bytes.");
  const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8.encode(field) }, keys.enc, utf8.encode(plaintext)));
  const out = new Uint8Array(NONCE_BYTES + sealed.length);
  out.set(iv);
  out.set(sealed, NONCE_BYTES);
  return PREFIX + toBase64(out);
}

/** Decrypts a field written by encryptField for the same field name. Throws if it was altered or moved. */
export async function decryptField(keys: UserKeys, field: string, payload: string): Promise<string> {
  if (!isCiphertext(payload)) throw new Error("Not an encrypted value.");
  const bytes = fromBase64(payload.slice(PREFIX.length));
  if (bytes.length < NONCE_BYTES + 16) throw new Error("Encrypted value is too short.");
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: bytes.subarray(0, NONCE_BYTES), additionalData: utf8.encode(field) },
    keys.enc,
    bytes.subarray(NONCE_BYTES),
  );
  return fromUtf8.decode(plain);
}

/** encryptField for a value that may be missing: null and undefined stay null. */
export async function encryptOptional(keys: UserKeys, field: string, plaintext: string | null | undefined): Promise<string | null> {
  return plaintext == null ? null : encryptField(keys, field, plaintext);
}

/** decryptField for a value that may be missing: null stays null. */
export async function decryptOptional(keys: UserKeys, field: string, payload: string | null | undefined): Promise<string | null> {
  return payload == null ? null : decryptField(keys, field, payload);
}

/**
 * A blind index: the same value always gives the same token for one user, so the database can match an
 * address or number without ever holding it. The caller normalises first (an email lowercased, a phone
 * number in E.164); this only trims. Base64url of HMAC-SHA256.
 */
export async function blindIndex(keys: UserKeys, value: string): Promise<string> {
  const mac = new Uint8Array(await subtle.sign("HMAC", keys.index, utf8.encode(value.trim())));
  return toBase64(mac).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
