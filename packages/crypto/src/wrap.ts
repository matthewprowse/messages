// Wrapping users' data keys, server side only (the sync worker and the key service). A data key is never
// stored as it is: user_keys holds it encrypted by a key-wrapping key, and `wrapped_by` says which one.
//
// Two wrappers live side by side, and a reader picks by `wrapped_by`:
//   "local:v1"  AES-256-GCM under a 32-byte master key from the environment (KEY_WRAPPING_KEY).
//   "kms:v1"    Google Cloud KMS Encrypt and Decrypt (KMS_KEY_NAME), over the REST API with a bearer token from
//               Workload Identity Federation, a service account key or the metadata server (google-token.ts), so no
//               SDK is needed. Unwrapped keys are cached in memory for about
//               10 minutes and never written anywhere.
// Both use "user_keys:<user id>" as additional authenticated data (a workspace's key, in team_keys, uses
// "team_keys:<workspace id>"), so a wrapped key cannot be swapped onto another user or workspace or passed off as
// a user's. Writers (wrappersFromEnv) use kms:v1 when KMS_KEY_NAME is set and local:v1 otherwise.
// apps/ai/ai/keys.py unwraps the same way.
//
// local:v1 is being retired: once `pnpm --filter worker keys:readiness` reports no local:v1 row left, KEY_WRAPPING_KEY is
// unset everywhere, and a row still made by it fails with the code legacy_wrapper_missing rather than anything worse.
//
// A user's key can be rotated (apps/worker/src/rekey): user_keys then also holds, beside the current key, the next one
// (being made ready, opens only) or the previous one (being re-sealed away from, opens only), and the index key their
// blind indexes are made with (wrapped with "user_index_keys:<user id>"). userKeyringFor reads all of them.

import { deriveIndexKey, newDataKey } from "./index";
import { googleAccessToken, KMS_TIMEOUT_MS } from "./google-token";

export { googleAccessToken, KMS_TIMEOUT_MS, usesWorkloadIdentity, vercelOidcToken, type TokenOptions } from "./google-token";

/**
 * Whose key it is: a user's (user_keys), a workspace's (team_keys), or a user's index key kept after a rotation
 * (user_keys.index_wrapped_key). Part of the additional data, so one can never be passed off as another.
 */
export type KeyScope = "user" | "team" | "user_index";

/** The wrapped_by of the retired local wrapper: rows it made open only while KEY_WRAPPING_KEY is still set. */
export const LOCAL_WRAPPER = "local:v1";

/** The wrapper named by a row's wrapped_by. Throws with a stable code when this process is not set up for it. */
function wrapperFor(wrappers: KeyWrapper[], by: string): KeyWrapper {
  const wrapper = wrappers.find((w) => w.id === by);
  if (wrapper) return wrapper;
  throw Object.assign(new Error(`No key wrapper for ${by}.`), { code: by === LOCAL_WRAPPER ? "legacy_wrapper_missing" : "no_key_wrapper" });
}

export interface KeyWrapper {
  /** The `wrapped_by` value written beside keys this wrapper makes. */
  readonly id: string;
  /** `ownerId` is the user's ID, or the workspace's when `scope` is "team". */
  wrap(dataKey: Uint8Array<ArrayBuffer>, ownerId: string, scope?: KeyScope): Promise<string>;
  unwrap(wrapped: string, ownerId: string, scope?: KeyScope): Promise<Uint8Array<ArrayBuffer>>;
}

const subtle = globalThis.crypto.subtle;
const utf8 = new TextEncoder();

const aad = (scope: KeyScope, ownerId: string) => utf8.encode(`${scope}_keys:${ownerId}`);

function toB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromB64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** The local wrapper: AES-256-GCM under a master key given as base64. */
export async function localWrapper(masterKeyBase64: string): Promise<KeyWrapper> {
  const raw = Uint8Array.from(atob(masterKeyBase64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("KEY_WRAPPING_KEY must be 32 bytes, base64 encoded.");
  const master = await subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  return {
    id: "local:v1",
    async wrap(dataKey, ownerId, scope = "user") {
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(scope, ownerId) }, master, dataKey));
      const out = new Uint8Array(12 + sealed.length);
      out.set(iv);
      out.set(sealed, 12);
      return btoa(String.fromCharCode(...out));
    },
    async unwrap(wrapped, ownerId, scope = "user") {
      const bytes = Uint8Array.from(atob(wrapped), (c) => c.charCodeAt(0));
      const key = await subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12), additionalData: aad(scope, ownerId) }, master, bytes.subarray(12));
      return new Uint8Array(key);
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Google Cloud KMS
// ---------------------------------------------------------------------------------------------------------

/** How long an unwrapped key stays in memory. Keeps KMS calls (and their cost) low without holding keys for long. */
export const KEY_CACHE_MS = 10 * 60_000;


export interface KmsOptions {
  /** projects/<project>/locations/<region>/keyRings/<ring>/cryptoKeys/<key>. Decrypt picks the version itself. */
  keyName: string;
  /** A bearer token for cloudkms.googleapis.com (see googleAccessToken). */
  token: () => Promise<string>;
  /** Tests point these at a fake server. */
  fetch?: typeof fetch;
  endpoint?: string;
  now?: () => number;
}

/** The Cloud KMS wrapper. The cache holds copies, so a caller zeroing the key it was given does not break the next. */
export function kmsWrapper(opts: KmsOptions): KeyWrapper {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const endpoint = (opts.endpoint ?? "https://cloudkms.googleapis.com").replace(/\/$/, "");
  const now = opts.now ?? Date.now;
  const cache = new Map<string, { until: number; key: Uint8Array<ArrayBuffer> }>();
  // One decrypt per key at a time: a page of N concurrent unwraps of the same key makes one KMS call.
  const inflight = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

  async function call(op: "encrypt" | "decrypt", body: Record<string, string>): Promise<Record<string, string>> {
    const res = await doFetch(`${endpoint}/v1/${opts.keyName}:${op}`, {
      method: "POST",
      headers: { authorization: `Bearer ${await opts.token()}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(KMS_TIMEOUT_MS),
    });
    // Only the status is reported: a response body could echo parts of a request.
    if (!res.ok) throw Object.assign(new Error(`KMS ${op} failed (${res.status}).`), { code: `kms_${res.status}` });
    return (await res.json()) as Record<string, string>;
  }

  return {
    id: "kms:v1",
    async wrap(dataKey, ownerId, scope = "user") {
      const out = await call("encrypt", { plaintext: toB64(dataKey), additionalAuthenticatedData: toB64(aad(scope, ownerId)) });
      if (!out.ciphertext) throw new Error("KMS encrypt returned nothing.");
      return out.ciphertext;
    },
    async unwrap(wrapped, ownerId, scope = "user") {
      const id = `${scope}:${ownerId}:${wrapped}`;
      const hit = cache.get(id);
      if (hit && hit.until > now()) return hit.key.slice();
      let pending = inflight.get(id);
      if (!pending) {
        pending = (async () => {
          const out = await call("decrypt", { ciphertext: wrapped, additionalAuthenticatedData: toB64(aad(scope, ownerId)) });
          const key = fromB64(out.plaintext ?? "");
          if (key.length !== 32) throw new Error("KMS returned a key of the wrong size.");
          for (const [k, v] of cache) if (v.until <= now()) cache.delete(k);
          cache.set(id, { until: now() + KEY_CACHE_MS, key: key.slice() });
          return key;
        })();
        inflight.set(id, pending);
        // Cleared on success and failure alike, so a failed call is retried by the next caller.
        const clear = () => { inflight.delete(id); };
        pending.then(clear, clear);
      }
      // Every caller gets its own copy, since callers zero the key they are given.
      return (await pending).slice();
    },
  };
}

type Env = Record<string, string | undefined>;

/**
 * The wrappers this process is set up for, the one that writes first: kms:v1 when KMS_KEY_NAME is set, then
 * local:v1 when KEY_WRAPPING_KEY is set (kept so rows made before the move still open until they are rewrapped).
 */
export async function wrappersFromEnv(env: Env = process.env): Promise<KeyWrapper[]> {
  const out: KeyWrapper[] = [];
  if (env.KMS_KEY_NAME) out.push(kmsWrapper({ keyName: env.KMS_KEY_NAME, token: googleAccessToken(env) }));
  if (env.KEY_WRAPPING_KEY) out.push(await localWrapper(env.KEY_WRAPPING_KEY));
  if (!out.length) throw Object.assign(new Error("Set KMS_KEY_NAME (or, until it is retired, KEY_WRAPPING_KEY)."), { code: "no_key_wrapper" });
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Connector credentials, sealed under the user's own key
// ---------------------------------------------------------------------------------------------------------
// Sign-ins and sessions (WhatsApp, iCloud, IMAP, Instagram, LinkedIn, Microsoft, Zoom, Google) used to be sealed
// with one static ENCRYPTION_KEY shared by every service. Now each user's are sealed with a key derived from their
// data key: HKDF-SHA256 (salt 32 zero bytes, info "messages/credential-seal/v1"), AES-256-GCM, the account's ID
// as additional data ("account:<account id>") so a sealed sign-in cannot be moved to another account. Format:
// "v2:" + base64(iv 12 | GCM tag 16 | ciphertext), the same layout as the old "v1:" (static key, no additional
// data), which stays readable until credentials:reseal has moved every row. apps/ai/ai/connectors/instagram/sealing.py
// does the same; credential-vectors.json pins both.

export const CREDENTIAL_PREFIX = "v2:";
const CRED_INFO = "messages/credential-seal/v1";

/** The key that seals a user's connector credentials, from their 32-byte data key. */
export async function deriveCredentialKey(dataKey: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (dataKey.length !== 32) throw new Error("A data key is 32 bytes.");
  const base = await subtle.importKey("raw", dataKey, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: utf8.encode(CRED_INFO) }, base, 256);
  return new Uint8Array(bits);
}

// The same sealing binds other short-lived secrets to where they belong (the "context", the additional data): a handoff
// stored in a table row, such as an iCloud sign-in waiting for the connector or a code typed in the app, uses
// handoffContext ("handoff:<table>.<column>:<row id>"), so it opens only in that column of that row; an OAuth cookie uses
// "handoff:<purpose>:<user id>" (apps/web/lib/server/handoff.ts). An account's context, "account:<id>", can never equal one.

/** The additional data of a handoff stored in a table row. */
export const handoffContext = (table: string, column: string, rowId: string) => `handoff:${table}.${column}:${rowId.toLowerCase()}`;

/** Seals text bound to `context` as "v2:". `iv` is only passed by the test vectors. */
export async function sealBound(credKey: Uint8Array<ArrayBuffer>, context: string, plaintext: string, iv?: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await subtle.importKey("raw", credKey, "AES-GCM", false, ["encrypt"]);
  const nonce = iv ?? globalThis.crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: utf8.encode(context) }, key, utf8.encode(plaintext)));
  // WebCrypto puts the tag after the ciphertext; the v1 layout has it before.
  const out = new Uint8Array(12 + sealed.length);
  out.set(nonce);
  out.set(sealed.subarray(sealed.length - 16), 12);
  out.set(sealed.subarray(0, sealed.length - 16), 28);
  return CREDENTIAL_PREFIX + toB64(out);
}

/**
 * Opens a "v2:" value sealed for `context`, with the one key given or the first of several that opens it (the current
 * credential key first, then older ones during a rotation). Throws if it was altered, belongs elsewhere or no key opens it.
 */
export async function openBound(credKeys: Uint8Array<ArrayBuffer> | Uint8Array<ArrayBuffer>[], context: string, payload: string): Promise<string> {
  if (!payload.startsWith(CREDENTIAL_PREFIX)) throw new Error("Not a v2 credential.");
  const raw = fromB64(payload.slice(CREDENTIAL_PREFIX.length));
  if (raw.length < 28) throw new Error("Credential is too short.");
  const body = new Uint8Array(raw.length - 12);
  body.set(raw.subarray(28));
  body.set(raw.subarray(12, 28), raw.length - 28);
  const keys = Array.isArray(credKeys) ? credKeys : [credKeys];
  if (!keys.length) throw new Error("No credential key.");
  let first: unknown;
  for (const credKey of keys) {
    try {
      const key = await subtle.importKey("raw", credKey, "AES-GCM", false, ["decrypt"]);
      const plain = await subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12), additionalData: utf8.encode(context) }, key, body);
      return new TextDecoder("utf-8", { fatal: true }).decode(plain);
    } catch (err) {
      first ??= err;
    }
  }
  throw first;
}

/** Seals text for one account as "v2:". `iv` is only passed by the test vectors. */
export async function sealCredential(credKey: Uint8Array<ArrayBuffer>, accountId: string, plaintext: string, iv?: Uint8Array<ArrayBuffer>): Promise<string> {
  return sealBound(credKey, `account:${accountId}`, plaintext, iv);
}

/** Opens a "v2:" value made for this account, with any of the keys given. Throws if it was altered or belongs to another account. */
export async function openCredential(credKeys: Uint8Array<ArrayBuffer> | Uint8Array<ArrayBuffer>[], accountId: string, payload: string): Promise<string> {
  return openBound(credKeys, `account:${accountId}`, payload);
}

// ---------------------------------------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------------------------------------

/**
 * A user_keys row. The current key seals and opens. During a rotation (apps/worker/src/rekey) `next_*` is the key being
 * made ready (it opens, nothing is sealed with it yet) and `previous_*` the key being re-sealed away from (it opens until
 * the job retires it). `index_*` is the raw index key (deriveIndexKey) the user's blind indexes are made with, set at
 * their first rotation; without it the current key makes them.
 */
export interface UserKeyRow {
  wrapped_key: string;
  wrapped_by: string;
  next_wrapped_key?: string | null;
  next_wrapped_by?: string | null;
  previous_wrapped_key?: string | null;
  previous_wrapped_by?: string | null;
  index_wrapped_key?: string | null;
  index_wrapped_by?: string | null;
}

/** The rows a key store reads and writes: user_keys, through whichever database client the caller has. */
export interface KeyStore {
  /** The whole row (select "*", so it reads the same before and after the rotation columns exist). */
  read(userId: string): Promise<UserKeyRow | null>;
  /** Inserts unless a key already exists, so two processes racing to create one keep the first. */
  insertIfAbsent(row: { user_id: string; wrapped_key: string; wrapped_by: string }): Promise<void>;
}

/** One version of a workspace's data key as stored in team_keys. */
export interface TeamKeyRow {
  key_version: number;
  wrapped_key: string;
  wrapped_by: string;
  /** Set once no value is left sealed under this version (apps/worker/src/share/rotate.ts). */
  retired_at?: string | null;
}

/** The rows a team key store reads and writes: team_keys, through whichever database client the caller has. */
export interface TeamKeyStore {
  /** Every version, retired ones too, in any order. Empty when the workspace has no key yet. */
  list(workspaceId: string): Promise<TeamKeyRow[]>;
  /** Inserts the version unless it exists, so two processes racing to make the same one keep the first. */
  insertVersion(row: TeamKeyRow & { workspace_id: string }): Promise<void>;
  /** Whether someone has been removed from the workspace since its current key was made (team_key_rotation_due). */
  rotationDue(workspaceId: string): Promise<boolean>;
}

/**
 * A user's data key, created on first use. Wrapped keys made by another wrapper are refused rather than
 * guessed at: this process must be configured with every wrapper its users' keys were made with.
 */
export async function dataKeyFor(store: KeyStore, wrappers: KeyWrapper[], userId: string): Promise<Uint8Array<ArrayBuffer>> {
  let row = await store.read(userId);
  if (!row) {
    await store.insertIfAbsent({ user_id: userId, wrapped_key: await wrappers[0].wrap(newDataKey(), userId), wrapped_by: wrappers[0].id });
    row = await store.read(userId);
    if (!row) throw new Error("Could not create a data key.");
  }
  return wrapperFor(wrappers, row.wrapped_by).unwrap(row.wrapped_key, userId);
}

/** A user's keys as their keyring holds them, raw. Callers zero them once derived (zeroKeyring). */
export interface UserKeyring {
  /** Seals and opens. */
  current: Uint8Array<ArrayBuffer>;
  /** Open only: the next key while a rotation is being made ready, and the previous one while it is re-sealed away from. */
  older: Uint8Array<ArrayBuffer>[];
  /** The raw index key, or null when the blind indexes still come from `current`. */
  indexKey: Uint8Array<ArrayBuffer> | null;
}

/**
 * A user's keyring, creating their data key on first use like dataKeyFor. Every key the row names must unwrap: a value
 * sealed under a key this process cannot open would otherwise read as empty, so a failure throws instead.
 */
export async function userKeyringFor(store: KeyStore, wrappers: KeyWrapper[], userId: string): Promise<UserKeyring> {
  let row = await store.read(userId);
  if (!row) {
    await store.insertIfAbsent({ user_id: userId, wrapped_key: await wrappers[0].wrap(newDataKey(), userId), wrapped_by: wrappers[0].id });
    row = await store.read(userId);
    if (!row) throw new Error("Could not create a data key.");
  }
  const open = (wrapped: string, by: string, scope: KeyScope = "user") => wrapperFor(wrappers, by).unwrap(wrapped, userId, scope);
  const olders: [string | null | undefined, string | null | undefined][] = [[row.next_wrapped_key, row.next_wrapped_by], [row.previous_wrapped_key, row.previous_wrapped_by]];
  // Unwrapped at once: each can be a KMS call.
  const [current, older, indexKey] = await Promise.all([
    open(row.wrapped_key, row.wrapped_by),
    Promise.all(olders.filter(([k, by]) => k && by).map(([k, by]) => open(k!, by!))),
    row.index_wrapped_key && row.index_wrapped_by ? open(row.index_wrapped_key, row.index_wrapped_by, "user_index") : Promise.resolve(null),
  ]);
  return { current, older, indexKey };
}

/** The index key to keep when a user's key is first rotated: the one their blind indexes were made with so far. */
export async function indexKeyOf(ring: UserKeyring): Promise<Uint8Array<ArrayBuffer>> {
  return ring.indexKey ? ring.indexKey.slice() : deriveIndexKey(ring.current);
}

/** Every credential key of a keyring, the current one first (it seals), then the older ones (they only open). */
export async function credentialKeysOf(ring: UserKeyring): Promise<Uint8Array<ArrayBuffer>[]> {
  return Promise.all([ring.current, ...ring.older].map((k) => deriveCredentialKey(k)));
}

/** Zeroes every raw key of a keyring, once the caller has derived what it needs. */
export function zeroKeyring(ring: UserKeyring): void {
  for (const k of [ring.current, ...ring.older, ...(ring.indexKey ? [ring.indexKey] : [])]) k.fill(0);
}

/**
 * A workspace's keys: the current version (new writes use it), every version still holding values (newest first, what
 * a reader tries), and the index root. The team's blind indexes (the client list's) are always made with the key of
 * the FIRST version, not the current one: a rotation changes what seals the content but must not change the index
 * tokens the database matches on, or every client would be added a second time. So a member keeps the first
 * version's key for indexing even after it is retired. Someone removed who kept it can only test guesses against
 * index tokens, which they can no longer read, and decrypts nothing: retired versions seal nothing.
 */
export interface TeamKeyring {
  current: { version: number; key: Uint8Array<ArrayBuffer> };
  all: { version: number; key: Uint8Array<ArrayBuffer> }[];
  indexRoot: { version: number; key: Uint8Array<ArrayBuffer> };
}

/**
 * A workspace's keyring. The first call creates version 1. A call made while a removal is not yet answered by a new
 * version (team_key_rotation_due) makes the next version first, so nothing is sealed under a key a removed member
 * holds. Only call it for a caller allowed to hold the team's keys. See apps/worker/src/share/rotate.ts for the
 * whole rotation.
 */
export async function teamKeyring(store: TeamKeyStore, wrappers: KeyWrapper[], workspaceId: string): Promise<TeamKeyring> {
  let rows = await store.list(workspaceId);
  if (!rows.length) {
    await store.insertVersion({ workspace_id: workspaceId, key_version: 1, wrapped_key: await wrappers[0].wrap(newDataKey(), workspaceId, "team"), wrapped_by: wrappers[0].id });
    rows = await store.list(workspaceId);
  } else if (await store.rotationDue(workspaceId)) {
    const next = Math.max(...rows.map((r) => r.key_version)) + 1;
    await store.insertVersion({ workspace_id: workspaceId, key_version: next, wrapped_key: await wrappers[0].wrap(newDataKey(), workspaceId, "team"), wrapped_by: wrappers[0].id });
    rows = await store.list(workspaceId);
  }
  if (!rows.length) throw new Error("Could not create a data key.");
  const sorted = [...rows].sort((a, b) => b.key_version - a.key_version);
  const newest = sorted[0];
  const first = sorted[sorted.length - 1];
  const wanted = sorted.filter((row) => !row.retired_at || row === first); // nothing is sealed under a retired one any more
  // Unwrapped at once (each can be a KMS call), then read in version order, so the outcome and the error thrown are
  // what one at a time would give.
  const opened = await Promise.allSettled(wanted.map(async (row) => {
    return wrapperFor(wrappers, row.wrapped_by).unwrap(row.wrapped_key, workspaceId, "team");
  }));
  const all: TeamKeyring["all"] = [];
  let indexRoot: TeamKeyring["indexRoot"] | undefined;
  wanted.forEach((row, i) => {
    const result = opened[i];
    // The current key and the index root are needed; another version is not.
    if (result.status === "rejected") {
      if (row === newest || row === first) throw result.reason;
      return;
    }
    const key = result.value;
    if (!row.retired_at) all.push({ version: row.key_version, key });
    if (row === first) indexRoot = { version: row.key_version, key: key.slice() };
  });
  if (!all.length || !indexRoot) throw new Error("Could not open the team key.");
  return { current: all[0], all, indexRoot };
}

/** A workspace's current data key, created on first use. */
export async function teamDataKeyFor(store: TeamKeyStore, wrappers: KeyWrapper[], workspaceId: string): Promise<Uint8Array<ArrayBuffer>> {
  return (await teamKeyring(store, wrappers, workspaceId)).current.key;
}
