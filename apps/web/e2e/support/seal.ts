// Sealing and opening text for a test user the way the workers do (apps/worker/src/vault.ts): the user's data key made as
// /api/keys makes it (local:v1, the test KEY_WRAPPING_KEY), the field keys derived from it, and the "e1:" format the
// workers write while SEAL_BOUND_FIELDS is off. Test side only: the keys live in memory for the run and are never printed.

import { decryptAny, deriveUserKeyring, encryptField, isCiphertext, type UserKeys } from "@messages/crypto";
import { FIELD, type Field } from "@messages/crypto/fields";
import { localWrapper, userKeyringFor, zeroKeyring, type KeyStore } from "@messages/crypto/wrap";
import { admin, type Admin } from "./admin";
import { loadTestEnv } from "./test-env";

export { FIELD };

/** The user's data key, made if they have none, and the field keys derived from it. */
export async function userKeysOf(db: Admin, userId: string): Promise<UserKeys> {
  const store: KeyStore = {
    async read(id) {
      const { data, error } = await db.from("user_keys").select("*").eq("user_id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
    async insertIfAbsent(row) {
      const { error } = await db.from("user_keys").upsert(row, { onConflict: "user_id", ignoreDuplicates: true });
      if (error) throw error;
    },
  };
  const ring = await userKeyringFor(store, [await localWrapper(loadTestEnv().KEY_WRAPPING_KEY)], userId);
  try {
    return await deriveUserKeyring(ring.current, ring.older, ring.indexKey, userId);
  } finally {
    zeroKeyring(ring);
  }
}

const cache = new Map<string, Promise<UserKeys>>();

/** The user's keys, read once per run. */
export function keysFor(userId: string): Promise<UserKeys> {
  let keys = cache.get(userId);
  if (!keys) {
    keys = userKeysOf(admin(), userId);
    keys.catch(() => cache.delete(userId));
    cache.set(userId, keys);
  }
  return keys;
}

/** Sealed as the worker seals with SEAL_BOUND_FIELDS off, as it runs today: "e1:". null stays null. */
export async function seal(userId: string, field: Field, value: string | null): Promise<string | null> {
  return value == null ? null : encryptField(await keysFor(userId), field, value);
}

/** A sealed value as text. Plain text comes back as it is, as the apps read old rows. */
export async function openText(userId: string, field: Field, value: string | null | undefined): Promise<string | null> {
  if (value == null) return null;
  return isCiphertext(value) ? decryptAny({ user: await keysFor(userId) }, field, value) : value;
}
