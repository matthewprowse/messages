// Each user's field keys for the sync worker, and opening and sealing text with them. Keys are created on
// first use (a user's first stored message) and cached for about 10 minutes, never written anywhere. A workspace's
// keys (team_keys, one per version) are made and cached the same way, and looked at again every 30 seconds so a
// new version made after a member left is used promptly; a value sealed with them ("t1:") is opened with the keys of
// the row's workspace_id, the current version first. Only the share job (src/share) seals with them: a chat marked
// as work moves from the agent's key to the team's, and back. src/share/rotate.ts re-seals when the key rotates.
//
// The same data key seals the account sign-ins and sessions (credentialSealer, below): "v2:", under a key derived
// from it with the account's ID as additional data.
//
// open() reads encrypted and plain values alike, so rows written before encryption keep working. seal()
// encrypts only when ENCRYPT_CONTENT is on, so every process can switch to writing ciphertext together.

import { decryptAny, deriveTeamKeys, deriveUserKeys, encryptBytes, encryptField, isCiphertext, isTeamCiphertext, type KeySet, type TeamKeys, type UserKeys } from "@messages/crypto";
import { FIELD, type Field } from "@messages/crypto/fields";
import { dataKeyFor, deriveCredentialKey, KEY_CACHE_MS, teamKeyring, wrappersFromEnv, type KeyStore, type KeyWrapper, type TeamKeyStore } from "@messages/crypto/wrap";
import { makeSealer, type CredentialSealer } from "./crypto";
import { db, must } from "./db";
import { env } from "./env";
import { log, errorCode } from "./log";

let wrappers: Promise<KeyWrapper[]> | null = null;
/** kms:v1 first when KMS_KEY_NAME is set, then local:v1 when KEY_WRAPPING_KEY is (rows made before the move). */
export function keyWrappers(): Promise<KeyWrapper[]> {
  wrappers ??= wrappersFromEnv({ ...process.env, KMS_KEY_NAME: env.kmsKeyName, KEY_WRAPPING_KEY: env.keyWrappingKey });
  wrappers.catch(() => (wrappers = null));
  return wrappers;
}

const store: KeyStore = {
  async read(userId) {
    return must(await db.from("user_keys").select("wrapped_key, wrapped_by").eq("user_id", userId).maybeSingle(), "load user key");
  },
  async insertIfAbsent(row) {
    must(await db.from("user_keys").upsert(row, { onConflict: "user_id", ignoreDuplicates: true }), "create user key");
  },
};

export const teamStore: TeamKeyStore = {
  async list(workspaceId) {
    return must(await db.from("team_keys").select("key_version, wrapped_key, wrapped_by, retired_at").eq("workspace_id", workspaceId), "load team keys");
  },
  async insertVersion(row) {
    must(await db.from("team_keys").upsert(row, { onConflict: "workspace_id,key_version", ignoreDuplicates: true }), "create team key");
  },
  async rotationDue(workspaceId) {
    const { data, error } = await db.rpc("team_key_rotation_due", { p_workspace: workspaceId });
    // The function arrives with 20261102300000_team_key_versions.sql: until then nothing rotates.
    if (error) {
      if (error.code === "PGRST202") return false;
      throw Object.assign(new Error("team key check failed"), { code: error.code });
    }
    return data === true;
  },
};

interface Material {
  keys: UserKeys;
  /** Seals the user's connector sign-ins (wrap.ts, deriveCredentialKey). */
  credential: Uint8Array<ArrayBuffer>;
}
const cache = new Map<string, { until: number; material: Promise<Material> }>();

/** Drops expired entries, so key material is not held past its time by a user nobody reads for. Run when an entry is added. */
function evictExpired(entries: Map<string, { until: number }>) {
  const now = Date.now();
  for (const [key, entry] of entries) if (entry.until <= now) entries.delete(key);
}

function materialFor(userId: string): Promise<Material> {
  const hit = cache.get(userId);
  if (hit && hit.until > Date.now()) return hit.material;
  cache.delete(userId);
  evictExpired(cache);
  const material = keyWrappers()
    .then((w) => dataKeyFor(store, w, userId))
    .then(async (raw) => {
      try {
        return { keys: await deriveUserKeys(raw), credential: await deriveCredentialKey(raw) };
      } finally {
        raw.fill(0);
      }
    });
  material.catch(() => cache.delete(userId));
  cache.set(userId, { until: Date.now() + KEY_CACHE_MS, material });
  return material;
}

/** A user's field keys, creating their data key if they have none. */
export function keysFor(userId: string): Promise<UserKeys> {
  return materialFor(userId).then((m) => m.keys);
}

/** The workspace's keys: the current version, and every version still readable (current first). */
export interface TeamRing {
  current: TeamKeys;
  version: number;
  all: TeamKeys[];
}
const TEAM_RECHECK_MS = 30_000;
const teamCache = new Map<string, { until: number; ring: Promise<TeamRing> }>();

/** A workspace's keyring. Making the next version when a removal is waiting for one is done inside (teamKeyring). */
export function teamRingFor(workspaceId: string): Promise<TeamRing> {
  const hit = teamCache.get(workspaceId);
  if (hit && hit.until > Date.now()) return hit.ring;
  teamCache.delete(workspaceId);
  evictExpired(teamCache);
  const ring = keyWrappers()
    .then((w) => teamKeyring(teamStore, w, workspaceId))
    .then(async (r) => {
      // Each version seals with its own key, but the blind index always comes from the first version's key (wrap.ts, TeamKeyring).
      const root = await deriveTeamKeys(r.indexRoot.key);
      const all = await Promise.all(r.all.map(async (k): Promise<TeamKeys> => ({ ...(await deriveTeamKeys(k.key)), index: root.index })));
      for (const k of [...r.all, r.indexRoot]) k.key.fill(0);
      return { current: all[0], version: r.current.version, all };
    });
  ring.catch(() => teamCache.delete(workspaceId));
  teamCache.set(workspaceId, { until: Date.now() + TEAM_RECHECK_MS, ring });
  return ring;
}

/** A workspace's current field keys, creating its data key if it has none. */
export function teamKeysFor(workspaceId: string): Promise<TeamKeys> {
  return teamRingFor(workspaceId).then((r) => r.current);
}

const accountOwners = new Map<string, { until: number; user: string }>();

/** The user an account belongs to. An account never changes hands, so this is remembered (for KEY_CACHE_MS, so the map cannot grow for good). */
async function ownerOf(accountId: string): Promise<string> {
  const known = accountOwners.get(accountId);
  if (known && known.until > Date.now()) return known.user;
  const row = must(await db.from("accounts").select("user_id").eq("id", accountId).maybeSingle(), "load account owner");
  if (!row) throw Object.assign(new Error("Unknown account"), { code: "NO_ACCOUNT" });
  accountOwners.set(accountId, { until: Date.now() + KEY_CACHE_MS, user: row.user_id });
  return row.user_id;
}

/**
 * Seals and opens one account's sign-in and session ("v2:", under its user's key, the account as additional data;
 * "v1:" is still read). The key is fetched per call from the cache above, so it is never held longer than that.
 */
export async function credentialSealer(accountId: string, userId?: string): Promise<CredentialSealer> {
  const user = userId ?? (await ownerOf(accountId));
  return makeSealer(accountId, () => materialFor(user).then((m) => m.credential), env.encryptionKey);
}

const workspaceCache = new Map<string, { at: number; ids: string[] }>();
const WORKSPACES_TTL_MS = 60_000;

// Entries are also dropped when nobody asks for them again: a sweep a minute, so key material never outlives KEY_CACHE_MS by long.
setInterval(() => {
  evictExpired(cache);
  evictExpired(teamCache);
  evictExpired(accountOwners);
  const now = Date.now();
  for (const [user, entry] of workspaceCache) if (now - entry.at >= WORKSPACES_TTL_MS) workspaceCache.delete(user);
}, 60_000).unref();

/** The workspaces a user is or was in, newest first. Cached briefly: who is in a team changes rarely. */
async function workspacesOf(userId: string): Promise<string[]> {
  const hit = workspaceCache.get(userId);
  if (hit && Date.now() - hit.at < WORKSPACES_TTL_MS) return hit.ids;
  const rows = must(await db.from("workspace_members").select("workspace_id").eq("user_id", userId).order("created_at", { ascending: false }), "load user workspaces");
  const ids = rows.map((r) => r.workspace_id);
  workspaceCache.set(userId, { at: Date.now(), ids });
  return ids;
}

/**
 * A stored value as text: encrypted values are decrypted, plain ones and null come back as they are. A user's
 * value (e1:) opens with their keys, a team's (t1:) with the keys of the row's `workspaceId`.
 */
export async function open(userId: string, field: Field, value: string | null | undefined, workspaceId?: string | null): Promise<string | null> {
  try {
    return await openStrict(userId, field, value, workspaceId);
  } catch (err) {
    log.warn("could not open a stored value", { field, code: errorCode(err) });
    return "";
  }
}

/**
 * Like open(), but a value that cannot be opened throws instead of coming back as "". For work that writes
 * something derived from the text (the blind indexes), where "" would be stored as if it were the real value.
 */
export async function openStrict(userId: string, field: Field, value: string | null | undefined, workspaceId?: string | null): Promise<string | null> {
  if (value == null || !isCiphertext(value)) return value ?? null;
  if (isTeamCiphertext(value)) {
    // Most queries do not select a row's workspace_id, so without one the user's own workspaces are tried: a team
    // value in their row can only be from one of them (the worker holds every team's key).
    for (const id of workspaceId ? [workspaceId] : await workspacesOf(userId)) {
      // Every readable version, the current one first: a value sealed before the last rotation opens until the
      // re-seal job has moved it. Another team's value fails all of them and the next team is tried.
      for (const team of (await teamRingFor(id)).all) {
        try {
          return await decryptAny({ team }, field, value);
        } catch {
          // another version or team
        }
      }
    }
    throw Object.assign(new Error("no team key"), { code: "no_team_key" });
  }
  const keys: KeySet = { user: await keysFor(userId) };
  return await decryptAny(keys, field, value);
}

/** Text to store: encrypted when ENCRYPT_CONTENT is on, as it is otherwise. null stays null. */
export async function seal(userId: string, field: Field, value: string | null | undefined): Promise<string | null> {
  if (value == null) return null;
  if (!env.encryptContent) return value;
  return encryptField(await keysFor(userId), field, value);
}

/**
 * A file's bytes to store: sealed with the user's data key (the "e1b:" format, fields.ts) when ENCRYPT_CONTENT is on,
 * else null, meaning store the bytes as they are. The caller records which it was.
 */
export async function sealBytes(userId: string, field: Field, bytes: Buffer): Promise<Buffer | null> {
  if (!env.encryptContent) return null;
  const sealed = await encryptBytes(await keysFor(userId), field, new Uint8Array(bytes));
  return Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
}

/** Whether new text is being stored encrypted. */
export const sealing = () => env.encryptContent;

/**
 * An address, number or chat ID to store (encryption stage 2): encrypted when ENCRYPT_ADDRESSES is on, as it
 * is otherwise. Whichever it is, the database matches on its blind index, never on this.
 */
export async function sealAddress(userId: string, value: string): Promise<string>;
export async function sealAddress(userId: string, value: string | null): Promise<string | null>;
export async function sealAddress(userId: string, value: string | null): Promise<string | null> {
  if (value == null || !env.encryptAddresses) return value;
  return encryptField(await keysFor(userId), FIELD.address, value);
}

/** A company's domain to store, like sealAddress. */
export async function sealDomain(userId: string, value: string): Promise<string> {
  if (!env.encryptAddresses) return value;
  return encryptField(await keysFor(userId), FIELD.domain, value);
}

// Addresses, numbers and chat IDs wherever they sit in a row or the rows nested in it: the keys below,
// and a contact identity's value. A company's domain has its own field. The same keys as the web app's
// openAddresses (apps/web/lib/open-rows.ts).
const ADDRESS_KEYS = new Set(["sender_address", "from_address", "provider_thread_id", "address", "target", "chat", "participant"]);
const ADDRESS_LISTS = new Set(["to_addresses", "send_addresses", "emails", "phones"]);
// Other text found by its column name wherever it sits in a row, such as a message's attachments or a contact nested
// in a conversation: a file's name and a contact's company, role, relationship, style note and AI summary.
const CONTENT_KEYS: Record<string, Field> = {
  filename: FIELD.filename,
  company: FIELD.contactCompany,
  role: FIELD.contactRole,
  relationship: FIELD.contactRelationship,
  style_note: FIELD.contactStyleNote,
  ai_summary: FIELD.contactSummary,
};

/** Opens every encrypted address in these rows (all one user's) and anything nested in them, in place. */
export async function openAddresses<T>(userId: string, rows: T, workspaceId?: string | null): Promise<T> {
  const work: Promise<void>[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    const row = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(row)) {
      if (isCiphertext(value)) {
        const field = key === "domain" ? FIELD.domain : ADDRESS_KEYS.has(key) || (key === "value" && "kind" in row) ? FIELD.address : CONTENT_KEYS[key] ?? null;
        if (field) work.push(open(userId, field, value, workspaceId).then((v) => { row[key] = v ?? ""; }));
      } else if (ADDRESS_LISTS.has(key) && Array.isArray(value)) {
        value.forEach((v, i) => { if (isCiphertext(v)) work.push(open(userId, FIELD.address, v, workspaceId).then((o) => { value[i] = o ?? ""; })); });
      } else if (value && typeof value === "object") {
        walk(value);
      }
    }
  };
  walk(rows);
  await Promise.all(work);
  return rows;
}

/** openAddresses for rows of several users, each opened with its own user_id (and workspace_id, when it has one). */
export async function openAddressRows<T extends { user_id: string; workspace_id?: string | null }>(rows: T[]): Promise<T[]> {
  await Promise.all(rows.map((r) => openAddresses(r.user_id, r, r.workspace_id)));
  return rows;
}
