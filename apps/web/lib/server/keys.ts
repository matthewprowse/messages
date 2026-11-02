// Users' data keys on the server: read from user_keys and unwrapped by the wrapper named in wrapped_by, the same way
// the sync worker does. kms:v1 (Google Cloud KMS, when KMS_KEY_NAME is set) wraps new keys and local:v1
// (KEY_WRAPPING_KEY) still opens older ones until pnpm rewrap-keys has moved them. A user's key is made on first use.
// Never stored or logged here. A workspace's key (team_keys, one row per version) is handled the same way, and only for
// a user whose workspace_members row is active.

import { deriveUserKeys, type UserKeys } from "@messages/crypto";
import { dataKeyFor, deriveCredentialKey, teamKeyring, wrappersFromEnv, type KeyStore, type KeyWrapper, type TeamKeyring, type TeamKeyStore } from "@messages/crypto/wrap";
import { admin } from "./request";

const db = admin;
const store: KeyStore | null = db && {
  async read(userId) {
    const { data, error } = await db.from("user_keys").select("wrapped_key, wrapped_by").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data;
  },
  async insertIfAbsent(row) {
    const { error } = await db.from("user_keys").upsert(row, { onConflict: "user_id", ignoreDuplicates: true });
    if (error) throw error;
  },
};

const teamStore: TeamKeyStore | null = db && {
  async list(workspaceId) {
    const { data, error } = await db.from("team_keys").select("key_version, wrapped_key, wrapped_by, retired_at").eq("workspace_id", workspaceId);
    if (error) throw error;
    return data;
  },
  async insertVersion(row) {
    const { error } = await db.from("team_keys").upsert(row, { onConflict: "workspace_id,key_version", ignoreDuplicates: true });
    if (error) throw error;
  },
  async rotationDue(workspaceId) {
    const { data, error } = await db.rpc("team_key_rotation_due", { p_workspace: workspaceId });
    // The function arrives with 20261102300000_team_key_versions.sql: until then nothing rotates.
    if (error) {
      if (error.code === "PGRST202") return false;
      throw error;
    }
    return data === true;
  },
};

// One set of wrappers per server instance, so the KMS wrapper's 10 minute key cache and token live as long as it does.
let wrappers: Promise<KeyWrapper[]> | null = null;
function keyWrappers(): Promise<KeyWrapper[]> {
  wrappers ??= wrappersFromEnv();
  wrappers.catch(() => (wrappers = null));
  return wrappers;
}

export const keysReady = () => !!store && !!(process.env.KMS_KEY_NAME || process.env.KEY_WRAPPING_KEY);

/** The user's raw 32-byte data key, creating it if they have none. */
export async function dataKey(userId: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!store || !keysReady()) throw new Error("The key service is not set up.");
  return dataKeyFor(store, await keyWrappers(), userId);
}

/** The key that seals the user's connector sign-ins (packages/crypto/src/wrap.ts, sealCredential). */
export async function credentialKey(userId: string): Promise<Uint8Array<ArrayBuffer>> {
  const raw = await dataKey(userId);
  try {
    return await deriveCredentialKey(raw);
  } finally {
    raw.fill(0);
  }
}

/** The user's field and index keys. */
export async function userKeys(userId: string): Promise<UserKeys> {
  const raw = await dataKey(userId);
  try {
    return await deriveUserKeys(raw);
  } finally {
    raw.fill(0);
  }
}

/**
 * The workspace the user is an active member of, or null. Removed and invited members have no team key. A user active
 * in more than one gets the oldest membership, always the same one, with a warning (code only) so it is noticed.
 */
export async function activeWorkspaceId(userId: string): Promise<string | null> {
  if (!db) throw new Error("The key service is not set up.");
  // Two rows are enough to know there is more than one; maybeSingle would error on that and the team would silently be none.
  const { data, error } = await db.from("workspace_members").select("workspace_id").eq("user_id", userId).eq("status", "active")
    .order("created_at").order("workspace_id").limit(2);
  if (error) throw error;
  if ((data?.length ?? 0) > 1) console.warn("keys: more than one active workspace membership", { code: "MULTIPLE_ACTIVE_MEMBERSHIPS" });
  return data?.[0]?.workspace_id ?? null;
}

/**
 * A workspace's keyring: the current key, every version still holding values, and the index root. Creates the first
 * version, and the next one when a member has been removed since the current was made. Only for an active member.
 */
export async function teamKeys(workspaceId: string): Promise<TeamKeyring> {
  if (!teamStore || !keysReady()) throw new Error("The key service is not set up.");
  return teamKeyring(teamStore, await keyWrappers(), workspaceId);
}
