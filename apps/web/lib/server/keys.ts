import { deriveUserKeys, type UserKeys } from "@messages/crypto";
import { dataKeyFor, localWrapper, type KeyStore } from "@messages/crypto/wrap";
import { admin } from "./request";

// Users' data keys on the server: read from user_keys and unwrapped with KEY_WRAPPING_KEY, the same way
// the sync worker does. A user's key is made on first use. Never stored or logged here.

const wrappingKey = process.env.KEY_WRAPPING_KEY;

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

export const keysReady = () => !!store && !!wrappingKey;

/** The user's raw 32-byte data key, creating it if they have none. */
export async function dataKey(userId: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!store || !wrappingKey) throw new Error("The key service is not set up.");
  return dataKeyFor(store, [await localWrapper(wrappingKey)], userId);
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
