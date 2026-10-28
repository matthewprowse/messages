import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { encryptField } from "@messages/crypto";
import { flagOn } from "@messages/crypto/flags";
import { addressIndex } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import { openCredential, sealCredential } from "@messages/crypto/wrap";
import type { TablesInsert } from "@messages/db";
import { credentialKey, keysReady, userKeys } from "./keys";
import { admin } from "./request";

// Saving a connected account from the app: the account row and its sign-in, stored exactly as the terminal
// connect commands store them (apps/worker/scripts/owner.ts), so the sync worker cannot tell them apart.

/**
 * The old static key. It now seals only short-lived handoffs that no account owns yet (the 10 minute OAuth cookies,
 * a sign-in code waiting for the connector): sealJson and openJson below. Stored sign-ins and sessions use the owner's
 * own key (sealAccountJson). The same value as ENCRYPTION_KEY in apps/worker/.env, which still reads old "v1:" rows.
 */
const encryptionKey = process.env.ENCRYPTION_KEY;

export const accountsReady = () => !!admin && !!encryptionKey && keysReady();

function key(): Buffer {
  const buf = Buffer.from(encryptionKey ?? "", "base64");
  if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64 encoded.");
  return buf;
}

/** AES-256-GCM under the static key, "v1:" + base64(iv | tag | ciphertext): apps/worker/src/crypto.ts reads it. For short-lived handoffs only. */
export function sealJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function openJson<T>(payload: string): T {
  if (!payload.startsWith("v1:")) throw new Error("Unknown ciphertext format.");
  const buf = Buffer.from(payload.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8")) as T;
}

/** The user an account belongs to. */
async function ownerOf(accountId: string): Promise<string> {
  if (!admin) throw new Error("Supabase is not set up.");
  const { data, error } = await admin.from("accounts").select("user_id").eq("id", accountId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Unknown account.");
  return data.user_id;
}

/**
 * Seals an account's sign-in or session as "v2:": under a key derived from its owner's data key, the account's ID as
 * additional data (packages/crypto/src/wrap.ts, sealCredential). apps/worker/src/crypto.ts and the AI worker read it.
 */
export async function sealAccountJson(accountId: string, value: unknown): Promise<string> {
  const key = await credentialKey(await ownerOf(accountId));
  try {
    return await sealCredential(key, accountId, JSON.stringify(value));
  } finally {
    key.fill(0);
  }
}

/** Opens an account's sign-in or session: "v2:" with its owner's key, or an older "v1:" with the static key. */
export async function openAccountJson<T>(accountId: string, payload: string): Promise<T> {
  if (!payload.startsWith("v2:")) return openJson<T>(payload);
  const key = await credentialKey(await ownerOf(accountId));
  try {
    return JSON.parse(await openCredential(key, accountId, payload)) as T;
  } finally {
    key.fill(0);
  }
}

/**
 * Saves the user's account for this provider and address and returns its id, like saveAccountRow in the
 * worker's scripts: an existing account is found by its blind index (or plain address) and set connecting,
 * a new one is stored with its address sealed and indexed. onePerUser: a provider you have one of (iCloud
 * Calendar), so signing in with another address takes over the account you have rather than adding a second.
 */
export async function saveAccountRow(
  userId: string,
  provider: TablesInsert<"accounts">["provider"],
  label: string,
  address: string,
  opts: { onePerUser?: boolean } = {},
): Promise<string> {
  const db = admin;
  if (!db) throw new Error("Supabase is not set up.");
  const keys = await userKeys(userId);
  const index = await addressIndex(keys, address);
  const find = async (column: "address_index" | "address", value: string) => {
    const { data, error } = await db.from("accounts").select("id").eq("user_id", userId).eq("provider", provider).eq(column, value).limit(1);
    if (error) throw error;
    return data[0];
  };
  const existing = (await find("address_index", index)) ?? (await find("address", address));
  const fields = { label, status: "connecting" as const, status_detail: null };
  if (existing) {
    const { error } = await db.from("accounts").update(fields).eq("id", existing.id);
    if (error) throw error;
    return existing.id;
  }
  const sealed = flagOn(process.env.NEXT_PUBLIC_ENCRYPT_ADDRESSES) ? await encryptField(keys, FIELD.address, address) : address;
  if (opts.onePerUser) {
    const { data: only, error: findError } = await db.from("accounts").select("id").eq("user_id", userId).eq("provider", provider).order("created_at").limit(1);
    if (findError) throw findError;
    if (only[0]) {
      const { error } = await db.from("accounts").update({ ...fields, address: sealed, address_index: index }).eq("id", only[0].id);
      if (error) throw error;
      return only[0].id;
    }
  }
  const { data, error } = await db.from("accounts").insert({ user_id: userId, provider, address: sealed, address_index: index, ...fields }).select("id").single();
  if (error) throw error;
  return data.id;
}

/**
 * Stores an account's sign-in encrypted. The worker starts the account within seconds. A refresh token the
 * worker kept from the last sign-in (refreshed, for Microsoft and Zoom, which replace it on every refresh) is
 * cleared, as pnpm connect:microsoft does, so the new sign-in is the one used.
 */
export async function saveCredentials(accountId: string, credentials: unknown) {
  if (!admin) throw new Error("Supabase is not set up.");
  const { error } = await admin
    .from("account_credentials")
    .upsert({ account_id: accountId, ciphertext: await sealAccountJson(accountId, credentials), refreshed: null, updated_at: new Date().toISOString() }, { onConflict: "account_id" });
  if (error) throw error;
}

/** Makes sure the user has a profile row, as the connect commands do. */
export async function ensureProfile(userId: string) {
  if (!admin) return;
  await admin.from("profiles").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
}
