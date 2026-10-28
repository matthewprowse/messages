// Field encryption for Messages: one ciphertext format shared by the browser, the Node sync worker and the
// Python AI worker (apps/ai/ai/crypto.py mirrors this file). Uses WebCrypto, built into browsers and Node.
//
// A value is stored as "e1:" + base64(nonce 12 bytes | ciphertext | GCM tag 16 bytes), AES-256-GCM. The
// additional data names the kind of text it is (fields.ts: "subject", "body"), so a ciphertext copied into
// a field of another kind fails to decrypt. Each user has one random 32-byte data key; the encryption key and the
// blind-index key are derived from it with HKDF-SHA256, so one unwrapped key serves both.
// vectors.json pins the format: the TS and Python tests both check against it.
//
// A team (a workspace) has a data key of its own, one level up from the user's. A value sealed with it is
// "t1:" + the same layout and the same field additional data, and its keys are derived with their own HKDF
// info strings ("messages/team-field-encryption/v1", "messages/team-blind-index/v1"), so a team key can never be
// mistaken for a user key even by accident, and a team's blind index of a value never equals a user's. A
// reader picks the key by the prefix: e1 is the user's, t1 the team's of the row's workspace.

export const PREFIX = "e1:";
export const TEAM_PREFIX = "t1:";
const ENC_INFO = "messages/field-encryption/v1";
const INDEX_INFO = "messages/blind-index/v1";
const TEAM_ENC_INFO = "messages/team-field-encryption/v1";
const TEAM_INDEX_INFO = "messages/team-blind-index/v1";
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
  /** Never set: keeps a team's keys from being passed where a user's are wanted. */
  team?: undefined;
}

/** The two keys derived from a team's data key, the same pair as a user's under their own HKDF info. */
export interface TeamKeys {
  enc: Key;
  index: Key;
  team: true;
}

/** The keys a reader holds, whichever it has: the user's, and the team's when they are in a workspace. */
export interface KeySet {
  user?: UserKeys | null;
  team?: TeamKeys | null;
}

function hkdf(info: string) {
  return { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: utf8.encode(info) };
}

async function derive(dataKey: Uint8Array<ArrayBuffer>, encInfo: string, indexInfo: string) {
  if (dataKey.length !== 32) throw new Error("A data key is 32 bytes.");
  const base = await subtle.importKey("raw", dataKey, "HKDF", false, ["deriveKey"]);
  const [enc, index] = await Promise.all([
    subtle.deriveKey(hkdf(encInfo), base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]),
    subtle.deriveKey(hkdf(indexInfo), base, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]),
  ]);
  return { enc, index };
}

/** Derives a user's field and index keys from their 32-byte data key. The keys cannot be exported. */
export async function deriveUserKeys(dataKey: Uint8Array<ArrayBuffer>): Promise<UserKeys> {
  return derive(dataKey, ENC_INFO, INDEX_INFO);
}

/** Derives a team's field and index keys from the workspace's 32-byte data key. The keys cannot be exported. */
export async function deriveTeamKeys(dataKey: Uint8Array<ArrayBuffer>): Promise<TeamKeys> {
  return { ...(await derive(dataKey, TEAM_ENC_INFO, TEAM_INDEX_INFO)), team: true };
}

/** A new random 32-byte data key. */
export function newDataKey(): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

/** Whether a stored value is sealed, with a user's key (e1:) or a team's (t1:). */
export function isCiphertext(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith(PREFIX) || value.startsWith(TEAM_PREFIX));
}

/** Whether a stored value is sealed with a team's key (t1:). */
export function isTeamCiphertext(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(TEAM_PREFIX);
}

async function seal(enc: Key, prefix: string, field: string, plaintext: string, nonce?: Uint8Array<ArrayBuffer>): Promise<string> {
  const iv = nonce ?? globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  if (iv.length !== NONCE_BYTES) throw new Error("A nonce is 12 bytes.");
  const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8.encode(field) }, enc, utf8.encode(plaintext)));
  const out = new Uint8Array(NONCE_BYTES + sealed.length);
  out.set(iv);
  out.set(sealed, NONCE_BYTES);
  return prefix + toBase64(out);
}

async function unseal(enc: Key, prefix: string, field: string, payload: string): Promise<string> {
  const bytes = fromBase64(payload.slice(prefix.length));
  if (bytes.length < NONCE_BYTES + 16) throw new Error("Encrypted value is too short.");
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: bytes.subarray(0, NONCE_BYTES), additionalData: utf8.encode(field) },
    enc,
    bytes.subarray(NONCE_BYTES),
  );
  return fromUtf8.decode(plain);
}

/**
 * Encrypts one field's text. `field` is its kind from fields.ts. A nonce is only passed by the
 * test vectors; otherwise every call takes a fresh random one.
 */
export async function encryptField(keys: UserKeys, field: string, plaintext: string, nonce?: Uint8Array<ArrayBuffer>): Promise<string> {
  return seal(keys.enc, PREFIX, field, plaintext, nonce);
}

/** Decrypts a field written by encryptField for the same field name. Throws if it was altered or moved. */
export async function decryptField(keys: UserKeys, field: string, payload: string): Promise<string> {
  if (typeof payload !== "string" || !payload.startsWith(PREFIX)) throw new Error("Not an encrypted value.");
  return unseal(keys.enc, PREFIX, field, payload);
}

/** encryptField with a team's key: the same layout and field additional data, marked "t1:". */
export async function encryptTeamField(keys: TeamKeys, field: string, plaintext: string, nonce?: Uint8Array<ArrayBuffer>): Promise<string> {
  return seal(keys.enc, TEAM_PREFIX, field, plaintext, nonce);
}

/** Decrypts a field written by encryptTeamField for the same field name. Throws if it was altered or moved. */
export async function decryptTeamField(keys: TeamKeys, field: string, payload: string): Promise<string> {
  if (!isTeamCiphertext(payload)) throw new Error("Not a team encrypted value.");
  return unseal(keys.enc, TEAM_PREFIX, field, payload);
}

/**
 * Decrypts a field of either kind, choosing the key by its prefix: e1 with the user's keys, t1 with the team's
 * keys (the team of the row's workspace). Throws a clear error when the key it needs is not held.
 */
export async function decryptAny(keys: KeySet, field: string, payload: string): Promise<string> {
  if (isTeamCiphertext(payload)) {
    if (!keys.team) throw new Error("A team value needs the team's keys.");
    return decryptTeamField(keys.team, field, payload);
  }
  if (!keys.user) throw new Error("A user value needs the user's keys.");
  return decryptField(keys.user, field, payload);
}

// Files are sealed the same way as fields, but as raw bytes: MAGIC (8 bytes) | nonce 12 bytes | ciphertext |
// GCM tag 16 bytes, with the field name as additional data. The magic marks a stored file as sealed (and
// carries the format version, "e1b:"), so files uploaded before sealing can still be told apart and read.
const MAGIC = Uint8Array.of(0x65, 0x31, 0x62, 0x3a, 0x00, 0xff, 0x4b, 0x4e); // "e1b:" 00 FF "KN"
const HEADER_BYTES = MAGIC.length + NONCE_BYTES;

/** Whether these bytes (or the first few of them) start with the sealed-file header. */
export function isSealedBytes(bytes: Uint8Array): boolean {
  return bytes.length >= MAGIC.length && MAGIC.every((b, i) => bytes[i] === b);
}

/** How many leading bytes isSealedBytes needs to see. */
export const SEALED_MAGIC_BYTES = MAGIC.length;

/** Seals a file's bytes for `field` (fields.ts). A nonce is only passed by tests. */
export async function encryptBytes(keys: UserKeys, field: string, plain: Uint8Array<ArrayBuffer>, nonce?: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return sealBytes(keys.enc, field, plain, nonce);
}

/** The same for a shared chat's file, sealed with the team's key (a copy of the agent's file for the team). */
export async function encryptTeamBytes(keys: TeamKeys, field: string, plain: Uint8Array<ArrayBuffer>, nonce?: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return sealBytes(keys.enc, field, plain, nonce);
}

async function sealBytes(enc: Key, field: string, plain: Uint8Array<ArrayBuffer>, nonce?: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const iv = nonce ?? globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  if (iv.length !== NONCE_BYTES) throw new Error("A nonce is 12 bytes.");
  const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: utf8.encode(field) }, enc, plain));
  const out = new Uint8Array(HEADER_BYTES + sealed.length);
  out.set(MAGIC);
  out.set(iv, MAGIC.length);
  out.set(sealed, HEADER_BYTES);
  return out;
}

/** Opens bytes written by encryptBytes for the same field. Throws if they were altered, moved or are not sealed. */
export async function decryptBytes(keys: UserKeys, field: string, sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return openBytes(keys.enc, field, sealed);
}

/** Opens bytes written by encryptTeamBytes for the same field and the same key version. */
export async function decryptTeamBytes(keys: TeamKeys, field: string, sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return openBytes(keys.enc, field, sealed);
}

async function openBytes(enc: Key, field: string, sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (!isSealedBytes(sealed)) throw new Error("Not a sealed file.");
  if (sealed.length < HEADER_BYTES + 16) throw new Error("Sealed file is too short.");
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: sealed.subarray(MAGIC.length, HEADER_BYTES), additionalData: utf8.encode(field) },
    enc,
    sealed.subarray(HEADER_BYTES),
  );
  return new Uint8Array(plain);
}

/**
 * A content hash for de-duplicating files: HMAC-SHA256 of the plaintext bytes under the user's index key, so a
 * stored hash says nothing about the file (and two users never share one). Base64url, no padding.
 */
export async function contentHash(keys: UserKeys, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const tag = new Uint8Array(await subtle.sign("HMAC", keys.index, bytes));
  return toBase64(tag).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** encryptField for a value that may be missing: null and undefined stay null. */
export async function encryptOptional(keys: UserKeys, field: string, plaintext: string | null | undefined): Promise<string | null> {
  return plaintext == null ? null : encryptField(keys, field, plaintext);
}

/** decryptField for a value that may be missing: null stays null. */
export async function decryptOptional(keys: UserKeys, field: string, payload: string | null | undefined): Promise<string | null> {
  return payload == null ? null : decryptField(keys, field, payload);
}

/** encryptTeamField for a value that may be missing: null and undefined stay null. */
export async function encryptTeamOptional(keys: TeamKeys, field: string, plaintext: string | null | undefined): Promise<string | null> {
  return plaintext == null ? null : encryptTeamField(keys, field, plaintext);
}

/** decryptTeamField for a value that may be missing: null stays null. */
export async function decryptTeamOptional(keys: TeamKeys, field: string, payload: string | null | undefined): Promise<string | null> {
  return payload == null ? null : decryptTeamField(keys, field, payload);
}

/**
 * A blind index: the same value always gives the same token for one user, so the database can match an
 * address or number without ever holding it. The caller normalises first (an email lowercased, a phone
 * number in E.164); this only trims. Base64url of HMAC-SHA256.
 */
export async function blindIndex(keys: UserKeys, value: string): Promise<string> {
  return mac(keys.index, value);
}

/** blindIndex under a team's index key: the same token for the same value across the whole team, and never equal to a user's. */
export async function teamBlindIndex(keys: TeamKeys, value: string): Promise<string> {
  return mac(keys.index, value);
}

async function mac(key: Key, value: string): Promise<string> {
  const tag = new Uint8Array(await subtle.sign("HMAC", key, utf8.encode(value.trim())));
  return toBase64(tag).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
