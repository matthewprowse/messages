// Each user's field keys for the sync worker, and opening and sealing text with them. Keys are created on
// first use (a user's first stored message) and cached for the life of the process.
//
// open() reads encrypted and plain values alike, so rows written before encryption keep working. seal()
// encrypts only when ENCRYPT_CONTENT is on, so every process can switch to writing ciphertext together.

import { decryptField, deriveUserKeys, encryptField, isCiphertext, type UserKeys } from "@messages/crypto";
import { FIELD, type Field } from "@messages/crypto/fields";
import { dataKeyFor, localWrapper, type KeyStore } from "@messages/crypto/wrap";
import { db, must } from "./db";
import { env } from "./env";
import { log, errorCode } from "./log";

const store: KeyStore = {
  async read(userId) {
    return must(await db.from("user_keys").select("wrapped_key, wrapped_by").eq("user_id", userId).maybeSingle(), "load user key");
  },
  async insertIfAbsent(row) {
    must(await db.from("user_keys").upsert(row, { onConflict: "user_id", ignoreDuplicates: true }), "create user key");
  },
};

const cache = new Map<string, Promise<UserKeys>>();

/** A user's field keys, creating their data key if they have none. */
export function keysFor(userId: string): Promise<UserKeys> {
  let keys = cache.get(userId);
  if (!keys) {
    if (!env.keyWrappingKey) throw new Error("KEY_WRAPPING_KEY is missing from apps/worker/.env.");
    keys = localWrapper(env.keyWrappingKey)
      .then((wrapper) => dataKeyFor(store, [wrapper], userId))
      .then((raw) => deriveUserKeys(raw));
    keys.catch(() => cache.delete(userId));
    cache.set(userId, keys);
  }
  return keys;
}

/** A stored value as text: encrypted values are decrypted, plain ones and null come back as they are. */
export async function open(userId: string, field: Field, value: string | null | undefined): Promise<string | null> {
  if (value == null || !isCiphertext(value)) return value ?? null;
  try {
    return await decryptField(await keysFor(userId), field, value);
  } catch (err) {
    log.warn("could not open a stored value", { field, code: errorCode(err) });
    return "";
  }
}

/** Text to store: encrypted when ENCRYPT_CONTENT is on, as it is otherwise. null stays null. */
export async function seal(userId: string, field: Field, value: string | null | undefined): Promise<string | null> {
  if (value == null) return null;
  if (!env.encryptContent) return value;
  return encryptField(await keysFor(userId), field, value);
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

/** Opens every encrypted address in these rows (all one user's) and anything nested in them, in place. */
export async function openAddresses<T>(userId: string, rows: T): Promise<T> {
  const work: Promise<void>[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (!node || typeof node !== "object") return;
    const row = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(row)) {
      if (isCiphertext(value)) {
        const field = key === "domain" ? FIELD.domain : ADDRESS_KEYS.has(key) || (key === "value" && "kind" in row) ? FIELD.address : null;
        if (field) work.push(open(userId, field, value).then((v) => { row[key] = v ?? ""; }));
      } else if (ADDRESS_LISTS.has(key) && Array.isArray(value)) {
        value.forEach((v, i) => { if (isCiphertext(v)) work.push(open(userId, FIELD.address, v).then((o) => { value[i] = o ?? ""; })); });
      } else if (value && typeof value === "object") {
        walk(value);
      }
    }
  };
  walk(rows);
  await Promise.all(work);
  return rows;
}

/** openAddresses for rows of several users, each opened with its own user_id. */
export async function openAddressRows<T extends { user_id: string }>(rows: T[]): Promise<T[]> {
  await Promise.all(rows.map((r) => openAddresses(r.user_id, r)));
  return rows;
}
