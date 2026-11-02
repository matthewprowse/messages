// Wrapping users' data keys, server side only (the sync worker and the key service). A data key is never
// stored as it is: user_keys holds it encrypted by a key-wrapping key, and `wrapped_by` says which one.
//
// Two wrappers live side by side, and a reader picks by `wrapped_by`:
//   "local:v1"  AES-256-GCM under a 32-byte master key from the environment (KEY_WRAPPING_KEY).
//   "kms:v1"    Google Cloud KMS Encrypt and Decrypt (KMS_KEY_NAME), over the REST API with a bearer token from
//               Application Default Credentials, so no SDK is needed. Unwrapped keys are cached in memory for about
//               10 minutes and never written anywhere.
// Both use "user_keys:<user id>" as additional authenticated data (a workspace's key, in team_keys, uses
// "team_keys:<workspace id>"), so a wrapped key cannot be swapped onto another user or workspace or passed off as
// a user's. Writers (wrappersFromEnv) use kms:v1 when KMS_KEY_NAME is set and local:v1 otherwise.
// apps/ai/ai/keys.py unwraps the same way.

import { newDataKey } from "./index";

/** Whose key it is: a user's (user_keys) or a workspace's (team_keys). Part of the additional data. */
export type KeyScope = "user" | "team";

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

const b64url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

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

/** A KMS or token call that takes longer than this is abandoned: a hung request must not hold every unwrap behind it. */
export const KMS_TIMEOUT_MS = 10_000;

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
 * A bearer token for Google APIs, cached until a minute before it expires. In order:
 *  1. GOOGLE_APPLICATION_CREDENTIALS_JSON (or the file named by GOOGLE_APPLICATION_CREDENTIALS): a service account
 *     key, exchanged for a token with a signed JWT. For Vercel and for the developer's machine.
 *  2. KMS_ACCESS_TOKEN: a token given as it is (for a quick test with `gcloud auth print-access-token`).
 *  3. The metadata server, which is how a Confidential Space or other Google Cloud VM gets its identity.
 */
export function googleAccessToken(env: Env = process.env, doFetch: typeof fetch = globalThis.fetch): () => Promise<string> {
  let cached: { token: string; until: number } | null = null;
  const fetchToken = async (): Promise<{ token: string; ttlS: number }> => {
    let json = env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (!json && env.GOOGLE_APPLICATION_CREDENTIALS) {
      const fs = await import("node:fs/promises");
      json = await fs.readFile(env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
    }
    if (json) {
      const account = JSON.parse(json) as { client_email: string; private_key: string; token_uri?: string };
      const aud = account.token_uri ?? "https://oauth2.googleapis.com/token";
      const iat = Math.floor(Date.now() / 1000);
      const claims = { iss: account.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud, iat, exp: iat + 3600 };
      const unsigned = `${b64url(utf8.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })))}.${b64url(utf8.encode(JSON.stringify(claims)))}`;
      const pem = account.private_key.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
      const key = await subtle.importKey("pkcs8", fromB64(pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
      const sig = new Uint8Array(await subtle.sign("RSASSA-PKCS1-v1_5", key, utf8.encode(unsigned)));
      const res = await doFetch(aud, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }),
        signal: AbortSignal.timeout(KMS_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Google token request failed (${res.status}).`);
      const out = (await res.json()) as { access_token: string; expires_in?: number };
      return { token: out.access_token, ttlS: out.expires_in ?? 3600 };
    }
    if (env.KMS_ACCESS_TOKEN) return { token: env.KMS_ACCESS_TOKEN, ttlS: 300 };
    const host = env.GCE_METADATA_HOST || "metadata.google.internal";
    const res = await doFetch(`http://${host}/computeMetadata/v1/instance/service-accounts/default/token`, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(KMS_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Metadata server token request failed (${res.status}).`);
    const out = (await res.json()) as { access_token: string; expires_in?: number };
    return { token: out.access_token, ttlS: out.expires_in ?? 300 };
  };
  let refreshing: Promise<string> | null = null; // concurrent callers share one refresh
  return async () => {
    if (cached && cached.until > Date.now()) return cached.token;
    refreshing ??= fetchToken().then(({ token, ttlS }) => {
      cached = { token, until: Date.now() + Math.max(0, ttlS - 60) * 1000 };
      return token;
    }).finally(() => { refreshing = null; });
    return refreshing;
  };
}

/**
 * The wrappers this process is set up for, the one that writes first: kms:v1 when KMS_KEY_NAME is set, then
 * local:v1 when KEY_WRAPPING_KEY is set (kept so rows made before the move still open until they are rewrapped).
 */
export async function wrappersFromEnv(env: Env = process.env): Promise<KeyWrapper[]> {
  const out: KeyWrapper[] = [];
  if (env.KMS_KEY_NAME) out.push(kmsWrapper({ keyName: env.KMS_KEY_NAME, token: googleAccessToken(env) }));
  if (env.KEY_WRAPPING_KEY) out.push(await localWrapper(env.KEY_WRAPPING_KEY));
  if (!out.length) throw new Error("Set KMS_KEY_NAME or KEY_WRAPPING_KEY.");
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

const credAad = (accountId: string) => utf8.encode(`account:${accountId}`);

/** Seals text for one account as "v2:". `iv` is only passed by the test vectors. */
export async function sealCredential(credKey: Uint8Array<ArrayBuffer>, accountId: string, plaintext: string, iv?: Uint8Array<ArrayBuffer>): Promise<string> {
  const key = await subtle.importKey("raw", credKey, "AES-GCM", false, ["encrypt"]);
  const nonce = iv ?? globalThis.crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: credAad(accountId) }, key, utf8.encode(plaintext)));
  // WebCrypto puts the tag after the ciphertext; the v1 layout has it before.
  const out = new Uint8Array(12 + sealed.length);
  out.set(nonce);
  out.set(sealed.subarray(sealed.length - 16), 12);
  out.set(sealed.subarray(0, sealed.length - 16), 28);
  return CREDENTIAL_PREFIX + toB64(out);
}

/** Opens a "v2:" value made for this account. Throws if it was altered or belongs to another account. */
export async function openCredential(credKey: Uint8Array<ArrayBuffer>, accountId: string, payload: string): Promise<string> {
  if (!payload.startsWith(CREDENTIAL_PREFIX)) throw new Error("Not a v2 credential.");
  const raw = fromB64(payload.slice(CREDENTIAL_PREFIX.length));
  if (raw.length < 28) throw new Error("Credential is too short.");
  const body = new Uint8Array(raw.length - 12);
  body.set(raw.subarray(28));
  body.set(raw.subarray(12, 28), raw.length - 28);
  const key = await subtle.importKey("raw", credKey, "AES-GCM", false, ["decrypt"]);
  const plain = await subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12), additionalData: credAad(accountId) }, key, body);
  return new TextDecoder("utf-8", { fatal: true }).decode(plain);
}

// ---------------------------------------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------------------------------------

/** The rows a key store reads and writes: user_keys, through whichever database client the caller has. */
export interface KeyStore {
  read(userId: string): Promise<{ wrapped_key: string; wrapped_by: string } | null>;
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
  const wrapper = wrappers.find((w) => w.id === row.wrapped_by);
  if (!wrapper) throw new Error(`No key wrapper for ${row.wrapped_by}.`);
  return wrapper.unwrap(row.wrapped_key, userId);
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
  const all: TeamKeyring["all"] = [];
  let indexRoot: TeamKeyring["indexRoot"] | undefined;
  for (const row of sorted) {
    if (row.retired_at && row !== first) continue; // nothing is sealed under it any more
    try {
      const wrapper = wrappers.find((w) => w.id === row.wrapped_by);
      if (!wrapper) throw new Error(`No key wrapper for ${row.wrapped_by}.`);
      const key = await wrapper.unwrap(row.wrapped_key, workspaceId, "team");
      if (!row.retired_at) all.push({ version: row.key_version, key });
      if (row === first) indexRoot = { version: row.key_version, key: key.slice() };
    } catch (err) {
      if (row === newest || row === first) throw err; // the current key and the index root are needed; another version is not
    }
  }
  if (!all.length || !indexRoot) throw new Error("Could not open the team key.");
  return { current: all[0], all, indexRoot };
}

/** A workspace's current data key, created on first use. */
export async function teamDataKeyFor(store: TeamKeyStore, wrappers: KeyWrapper[], workspaceId: string): Promise<Uint8Array<ArrayBuffer>> {
  return (await teamKeyring(store, wrappers, workspaceId)).current.key;
}
