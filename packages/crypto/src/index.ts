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
//
// A user's data key can be rotated (apps/worker/src/rekey): while the re-seal job runs, a reader holds the new key and
// the old one, and an "e1:" value opens with whichever sealed it (UserKeys.older, tried after the current key; GCM
// tells them apart). The blind indexes stay under the index key the user's tokens were first made with
// (deriveUserKeyring), so a rotation never changes what the database matches on.
//
// "e1:", "t1:" and "e1b:" are the legacy formats: their additional data is the field kind alone, so a value opens in any
// column of that kind of its owner's. New values are bound to their owner and place (bound.ts: "e2:", "t2:", "e2b:"):
// keys derived with an owner (deriveUserKeyring's `owner`, deriveTeamKeys' `workspaceId`) seal with encryptAt and
// encryptBytesAt, and every reader here opens both, so rows of either format read the same while the re-seal job
// (apps/worker/src/rekey) moves the old ones. openExpected is the strict read for columns that drive an action.

import { BOUND_MAGIC, BOUND_PREFIX, boundError, isBoundBytes, openFileAt, openPlaced, sealFileAt, sealPlaced, TEAM_BOUND_PREFIX, type Expect, type Owner, type Place } from "./bound";

export { at, BOUND_PREFIX, boundError, checkExpected, isBoundBytes, placeOf, TEAM_BOUND_PREFIX, type Expect, type Place } from "./bound";

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
  /** Field keys of older data keys still holding values during a rotation, tried after `enc` when opening. Never used to seal. */
  older?: Key[];
  /** The user these keys are for: bound values ("e2:") name it in their additional data. Without it only e1 opens. */
  owner?: string;
  /** Never set: keeps a team's keys from being passed where a user's are wanted. */
  team?: undefined;
}

/** The two keys derived from a team's data key, the same pair as a user's under their own HKDF info. */
export interface TeamKeys {
  enc: Key;
  index: Key;
  team: true;
  /** The workspace these keys are for: bound team values ("t2:") name it. Without it only t1 opens. */
  owner?: string;
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

/** Derives a user's field and index keys from their 32-byte data key, for `owner` (their user id) when given. The keys cannot be exported. */
export async function deriveUserKeys(dataKey: Uint8Array<ArrayBuffer>, owner?: string): Promise<UserKeys> {
  const keys = await derive(dataKey, ENC_INFO, INDEX_INFO);
  return owner ? { ...keys, owner } : keys;
}

/**
 * The raw index key of a data key: the HMAC key blind indexes are made with. A rotation stores it (wrapped) so the index
 * tokens outlive the data key they came from, without keeping that data key itself.
 */
export async function deriveIndexKey(dataKey: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (dataKey.length !== 32) throw new Error("A data key is 32 bytes.");
  const base = await subtle.importKey("raw", dataKey, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits(hkdf(INDEX_INFO), base, 256));
}

/**
 * A user's keys from their keyring (wrap.ts, userKeyringFor): `current` seals and opens, each of `older` only opens,
 * and `indexKey` (a raw key from deriveIndexKey) makes the blind indexes; without one they come from `current`, as for a
 * user whose key was never rotated.
 */
export async function deriveUserKeyring(current: Uint8Array<ArrayBuffer>, older: Uint8Array<ArrayBuffer>[] = [], indexKey?: Uint8Array<ArrayBuffer> | null, owner?: string): Promise<UserKeys> {
  const keys = await derive(current, ENC_INFO, INDEX_INFO);
  const olds = await Promise.all(older.map(async (k) => (await derive(k, ENC_INFO, INDEX_INFO)).enc));
  if (indexKey && indexKey.length !== 32) throw new Error("An index key is 32 bytes.");
  const index = indexKey ? await subtle.importKey("raw", indexKey, { name: "HMAC", hash: "SHA-256", length: 256 }, false, ["sign"]) : keys.index;
  const ring: UserKeys = olds.length ? { enc: keys.enc, index, older: olds } : { enc: keys.enc, index };
  if (owner) ring.owner = owner;
  return ring;
}

/** Derives a team's field and index keys from the workspace's 32-byte data key, for `workspaceId` when given. The keys cannot be exported. */
export async function deriveTeamKeys(dataKey: Uint8Array<ArrayBuffer>, workspaceId?: string): Promise<TeamKeys> {
  const keys: TeamKeys = { ...(await derive(dataKey, TEAM_ENC_INFO, TEAM_INDEX_INFO)), team: true };
  if (workspaceId) keys.owner = workspaceId;
  return keys;
}

/** A new random 32-byte data key. */
export function newDataKey(): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(32));
}

/** Whether a stored value is sealed, with a user's key (e1:, e2:) or a team's (t1:, t2:). */
export function isCiphertext(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith(PREFIX) || value.startsWith(BOUND_PREFIX) || value.startsWith(TEAM_PREFIX) || value.startsWith(TEAM_BOUND_PREFIX));
}

/** Whether a stored value is sealed with a team's key (t1:, t2:). */
export function isTeamCiphertext(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith(TEAM_PREFIX) || value.startsWith(TEAM_BOUND_PREFIX));
}

/** Whether a stored value is in a legacy format (e1:, t1:) that names no owner or place. */
export function isLegacyCiphertext(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith(PREFIX) || value.startsWith(TEAM_PREFIX));
}

const userOwner = (keys: UserKeys): Owner => {
  if (!keys.owner) throw boundError("no_owner", "A bound value needs keys that know their user.");
  return { user: keys.owner };
};
const teamOwner = (keys: TeamKeys): Owner => {
  if (!keys.owner) throw boundError("no_owner", "A bound value needs keys that know their workspace.");
  return { team: keys.owner };
};

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

/**
 * Seals one field's text bound to its owner (the keys' user) and place ("e2:", bound.ts). `where` names the table and
 * column, and the row when the writer knows it. A nonce is only passed by the test vectors.
 */
export async function encryptAt(keys: UserKeys, field: string, where: Place, plaintext: string, nonce?: Uint8Array<ArrayBuffer>): Promise<string> {
  return sealPlaced(keys.enc, BOUND_PREFIX, userOwner(keys), field, where, plaintext, nonce);
}

/**
 * Decrypts a user's field ("e1:", or "e2:" for the keys' user) for the same field name, with the current key or, during
 * a rotation, an older one. `expect` is checked against a bound value's place and row first (a legacy one has none).
 * Throws if it was altered or moved, or no key held opens it.
 */
export async function decryptField(keys: UserKeys, field: string, payload: string, expect?: Expect): Promise<string> {
  if (typeof payload === "string" && payload.startsWith(BOUND_PREFIX)) {
    const owner = userOwner(keys);
    return firstThatOpens(keys, (enc) => openPlaced(enc, BOUND_PREFIX, owner, field, payload, expect));
  }
  if (typeof payload !== "string" || !payload.startsWith(PREFIX)) throw new Error("Not an encrypted value.");
  return firstThatOpens(keys, (enc) => unseal(enc, PREFIX, field, payload));
}

/** Tries the current key, then each older one, and rethrows the current key's error when none opens. */
async function firstThatOpens<T>(keys: UserKeys, open: (enc: Key) => Promise<T>): Promise<T> {
  try {
    return await open(keys.enc);
  } catch (err) {
    for (const old of keys.older ?? []) {
      try {
        return await open(old);
      } catch {
        // the next older key
      }
    }
    throw err;
  }
}

/** encryptField with a team's key: the same layout and field additional data, marked "t1:". */
export async function encryptTeamField(keys: TeamKeys, field: string, plaintext: string, nonce?: Uint8Array<ArrayBuffer>): Promise<string> {
  return seal(keys.enc, TEAM_PREFIX, field, plaintext, nonce);
}

/** encryptAt with a team's key ("t2:"), bound to the keys' workspace and the place. */
export async function encryptTeamAt(keys: TeamKeys, field: string, where: Place, plaintext: string, nonce?: Uint8Array<ArrayBuffer>): Promise<string> {
  return sealPlaced(keys.enc, TEAM_BOUND_PREFIX, teamOwner(keys), field, where, plaintext, nonce);
}

/** Decrypts a team's field ("t1:", or "t2:" for the keys' workspace) for the same field name. Throws if it was altered or moved. */
export async function decryptTeamField(keys: TeamKeys, field: string, payload: string, expect?: Expect): Promise<string> {
  if (typeof payload === "string" && payload.startsWith(TEAM_BOUND_PREFIX)) return openPlaced(keys.enc, TEAM_BOUND_PREFIX, teamOwner(keys), field, payload, expect);
  if (typeof payload !== "string" || !payload.startsWith(TEAM_PREFIX)) throw new Error("Not a team encrypted value.");
  return unseal(keys.enc, TEAM_PREFIX, field, payload);
}

/**
 * Decrypts a field of either kind, choosing the key by its prefix: e1 with the user's keys, t1 with the team's
 * keys (the team of the row's workspace). Throws a clear error when the key it needs is not held.
 */
export async function decryptAny(keys: KeySet, field: string, payload: string, expect?: Expect): Promise<string> {
  if (isTeamCiphertext(payload)) {
    if (!keys.team) throw new Error("A team value needs the team's keys.");
    return decryptTeamField(keys.team, field, payload, expect);
  }
  if (!keys.user) throw new Error("A user value needs the user's keys.");
  return decryptField(keys.user, field, payload, expect);
}

/**
 * How a strict reader treats a column that drives an action (a send, a calendar or task write): `places` (and `row`) it
 * accepts, whether the column is always sealed now (`sealed`: encryption is on, so plain text is refused), and whether
 * the legacy unbound formats are still accepted (`legacy`: until the re-seal has moved them, REQUIRE_BOUND_FIELDS).
 * Team values are never accepted: these columns hold only their user's own.
 */
export interface Strict extends Expect {
  sealed: boolean;
  legacy: boolean;
}

/**
 * The plain text of a value in a column that drives an action, or a thrown error with a stable code: plaintext_refused,
 * legacy_value, team_value_refused, sealed_elsewhere, no_owner, or the decryption's own error. Never "" for a value
 * that will not open, so nothing is sent blank or with text moved in from elsewhere. null stays null.
 */
export async function openExpected(keys: UserKeys, field: string, value: string | null | undefined, rule: Strict): Promise<string | null> {
  if (value == null) return null;
  if (!isCiphertext(value)) {
    if (rule.sealed) throw boundError("plaintext_refused", "A value that must be sealed is plain text.");
    return value;
  }
  if (isTeamCiphertext(value)) throw boundError("team_value_refused", "A team value is not accepted here.");
  if (isLegacyCiphertext(value) && !rule.legacy) throw boundError("legacy_value", "An unbound value is not accepted here any more.");
  return decryptField(keys, field, value, { places: rule.places, row: rule.row });
}

// Files are sealed the same way as fields, but as raw bytes: MAGIC (8 bytes) | nonce 12 bytes | ciphertext |
// GCM tag 16 bytes, with the field name as additional data. The magic marks a stored file as sealed (and
// carries the format version, "e1b:"), so files uploaded before sealing can still be told apart and read.
const MAGIC = Uint8Array.of(0x65, 0x31, 0x62, 0x3a, 0x00, 0xff, 0x4b, 0x4e); // "e1b:" 00 FF "KN"
const HEADER_BYTES = MAGIC.length + NONCE_BYTES;

/** Whether these bytes (or the first few of them) start with a sealed-file header, legacy (e1b:) or bound (e2b:). */
export function isSealedBytes(bytes: Uint8Array): boolean {
  return isLegacyBytes(bytes) || isBoundBytes(bytes);
}

/** Whether these bytes start with the legacy sealed-file header (e1b:), which names no owner or place. */
export function isLegacyBytes(bytes: Uint8Array): boolean {
  return bytes.length >= MAGIC.length && MAGIC.every((b, i) => bytes[i] === b);
}

/** The bound sealed-file header (e2b:), for code that looks for it in base64 or in a stream. */
export const SEALED_BOUND_MAGIC = BOUND_MAGIC;

/** How many leading bytes isSealedBytes needs to see. */
export const SEALED_MAGIC_BYTES = MAGIC.length;

/** How many bytes sealing adds to a file: the header (magic and nonce) and the 16-byte GCM tag. */
export const SEALED_OVERHEAD_BYTES = HEADER_BYTES + 16;

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

/**
 * Seals a file's bytes bound to its owner (the keys' user) and where it is stored ("<bucket>/<path>", or
 * "<table>.<column>" for bytes kept in a column): the "e2b:" format. A nonce is only passed by tests.
 */
export async function encryptBytesAt(keys: UserKeys, field: string, where: string, plain: Uint8Array<ArrayBuffer>, nonce?: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return sealFileAt(keys.enc, userOwner(keys), field, where, plain, nonce);
}

/** encryptBytesAt with a team's key, bound to the keys' workspace. */
export async function encryptTeamBytesAt(keys: TeamKeys, field: string, where: string, plain: Uint8Array<ArrayBuffer>, nonce?: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return sealFileAt(keys.enc, teamOwner(keys), field, where, plain, nonce);
}

/**
 * Opens bytes written by encryptBytes or encryptBytesAt for the same field (any key the user holds). A bound file needs
 * `where`, the place it was read from. Throws if they were altered, moved or are not sealed.
 */
export async function decryptBytes(keys: UserKeys, field: string, sealed: Uint8Array<ArrayBuffer>, where?: string): Promise<Uint8Array<ArrayBuffer>> {
  if (isBoundBytes(sealed)) {
    if (!where) throw boundError("no_place", "A bound sealed file opens only with the place it is stored.");
    const owner = userOwner(keys);
    return firstThatOpens(keys, (enc) => openFileAt(enc, owner, field, where, sealed));
  }
  return firstThatOpens(keys, (enc) => openBytes(enc, field, sealed));
}

/** Opens bytes written by encryptTeamBytes or encryptTeamBytesAt for the same field and the same key version. */
export async function decryptTeamBytes(keys: TeamKeys, field: string, sealed: Uint8Array<ArrayBuffer>, where?: string): Promise<Uint8Array<ArrayBuffer>> {
  if (isBoundBytes(sealed)) {
    if (!where) throw boundError("no_place", "A bound sealed file opens only with the place it is stored.");
    return openFileAt(keys.enc, teamOwner(keys), field, where, sealed);
  }
  return openBytes(keys.enc, field, sealed);
}

/** How a strict reader treats a stored file: as Strict for text, and the row's own sealed flag when it has one. */
export interface StrictFile {
  sealed: boolean;
  legacy: boolean;
  /** attachments.sealed and the like: must agree with the header, or the file was swapped. Undefined: no flag. */
  flagged?: boolean;
}

/**
 * The plain bytes of a stored file a strict reader uses (an attachment it sends), or a thrown error with a stable code:
 * sealed_mismatch (the row's flag and the header disagree), plaintext_refused, legacy_value, or the decryption's own.
 */
export async function openFileExpected(keys: UserKeys, field: string, bytes: Uint8Array<ArrayBuffer>, where: string, rule: StrictFile): Promise<Uint8Array<ArrayBuffer>> {
  const sealed = isSealedBytes(bytes);
  if (rule.flagged !== undefined && rule.flagged !== sealed) throw boundError("sealed_mismatch", "A file's sealed flag and its header disagree.");
  if (!sealed) {
    if (rule.sealed) throw boundError("plaintext_refused", "A file that must be sealed is not.");
    return bytes;
  }
  if (isLegacyBytes(bytes) && !rule.legacy) throw boundError("legacy_value", "An unbound file is not accepted here any more.");
  return decryptBytes(keys, field, bytes, where);
}

async function openBytes(enc: Key, field: string, sealed: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (!isLegacyBytes(sealed)) throw new Error("Not a sealed file.");
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

/** encryptAt for a value that may be missing: null and undefined stay null. */
export async function encryptOptionalAt(keys: UserKeys, field: string, where: Place, plaintext: string | null | undefined): Promise<string | null> {
  return plaintext == null ? null : encryptAt(keys, field, where, plaintext);
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
