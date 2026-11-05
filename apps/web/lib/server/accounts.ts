// Saving a connected account from the app: the account row and its sign-in, stored exactly as the terminal
// connect commands store them (apps/worker/scripts/owner.ts), so the sync worker cannot tell them apart.

import { createDecipheriv } from "node:crypto";
import { encryptField } from "@messages/crypto";
import { flagOn } from "@messages/crypto/flags";
import type { UserKeys } from "@messages/crypto";
import { addressIndex } from "@messages/crypto/addresses";
import { FIELD } from "@messages/crypto/fields";
import { openCredential, sealCredential } from "@messages/crypto/wrap";
import type { TablesInsert } from "@messages/db";
import { cookieUser, openCookie, openRowHandoff, sealCookie, sealRowHandoff, type HandoffColumn, type HandoffPurpose } from "./handoff";
import { credentialKey, credentialKeys, keysReady, userKeys } from "./keys";
import { admin, limiter } from "./request";

export type { HandoffPurpose } from "./handoff";

/**
 * The old static key, now only read: a sign-in or handoff sealed "v1:" before per-user keys opens with it while it is set.
 * Nothing is sealed with it any more. Once `pnpm --filter worker keys:readiness` reports no "v1:" value left it is
 * removed, and such a value then fails with the code legacy_key_missing.
 */
const encryptionKey = process.env.ENCRYPTION_KEY;

export const accountsReady = () => !!admin && keysReady();

/** Opens a "v1:" value sealed with the old static key, "v1:" + base64(iv | tag | ciphertext), no additional data. */
export function openJson<T>(payload: string): T {
  if (!payload.startsWith("v1:")) throw Object.assign(new Error("Unknown ciphertext format."), { code: "unknown_format" });
  const key = Buffer.from(encryptionKey ?? "", "base64");
  if (key.length !== 32) throw Object.assign(new Error("A v1 value needs ENCRYPTION_KEY, which is not set."), { code: "legacy_key_missing" });
  const buf = Buffer.from(payload.slice(3), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8")) as T;
}

/** Seals an OAuth sign-in cookie for this purpose under the user's own key (handoff.ts). Makes their key if they have none. */
export async function sealHandoff(value: { userId: string }, purpose: HandoffPurpose): Promise<string> {
  const key = await credentialKey(value.userId);
  try {
    return await sealCookie(key, value, purpose);
  } finally {
    key.fill(0);
  }
}

/**
 * Opens an OAuth sign-in cookie for this purpose with the key of the user it names. The callback has no session, so the
 * key is only read, never made: a cookie naming someone without a key fails (no_key), as does any change to it.
 */
export async function openHandoff<T extends { userId: string }>(payload: string, purpose: HandoffPurpose, request?: Request): Promise<T> {
  const user = cookieUser(payload);
  if (!user) throw Object.assign(new Error("Unknown handoff format."), { code: "handoff_format" });
  // The user id rides in the clear and opening needs a KMS unwrap of their key, so a forged cookie naming a guessed id
  // would cost a KMS call each: counted per named user and per address first, far above what one sign-in takes.
  if ((await overHandoffLimit(user, request)) > 0) throw Object.assign(new Error("Too many sign-in attempts."), { code: "handoff_limited" });
  const keys = await credentialKeys(user, { existing: true });
  try {
    return await openCookie<T>(keys, payload, purpose);
  } finally {
    for (const k of keys) k.fill(0);
  }
}

// 12 callbacks per named user in 10 minutes, and 60 per address: a person connecting four providers needs a handful.
const overHandoffLimit = limiter(12, 10 * 60_000, { name: "handoff", perAddress: 60 });

/** Seals a handoff to store in one column of one row (a sign-in code, an iCloud setup) under the user's own key. */
export async function sealRowJson(userId: string, where: HandoffColumn, rowId: string, value: unknown): Promise<string> {
  const key = await credentialKey(userId);
  try {
    return await sealRowHandoff(key, where, rowId, value);
  } finally {
    key.fill(0);
  }
}

/** Opens a handoff stored in this column of this row: "v2:" with the user's keys, or a "v1:" one from before with the static key. */
export async function openRowJson<T>(userId: string, where: HandoffColumn, rowId: string, payload: string): Promise<T> {
  let held: Uint8Array<ArrayBuffer>[] = [];
  try {
    return await openRowHandoff<T>(async () => (held = await credentialKeys(userId)), (v) => openJson<T>(v), where, rowId, payload);
  } finally {
    for (const k of held) k.fill(0);
  }
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
export async function sealAccountJson(accountId: string, value: unknown, ownerId?: string): Promise<string> {
  const key = await credentialKey(ownerId ?? (await ownerOf(accountId)));
  try {
    return await sealCredential(key, accountId, JSON.stringify(value));
  } finally {
    key.fill(0);
  }
}

/**
 * Opens an account's sign-in or session: "v2:" with its owner's keys (during a rotation of their key, the old one too), or
 * an older "v1:" with the static key while it is set.
 */
export async function openAccountJson<T>(accountId: string, payload: string, ownerId?: string): Promise<T> {
  if (!payload.startsWith("v2:")) return openJson<T>(payload);
  const keys = await credentialKeys(ownerId ?? (await ownerOf(accountId)));
  try {
    return JSON.parse(await openCredential(keys, accountId, payload)) as T;
  } finally {
    for (const k of keys) k.fill(0);
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
  opts: { onePerUser?: boolean; /** The user's keys, when the caller already has them. */ keys?: UserKeys } = {},
): Promise<string> {
  const db = admin;
  if (!db) throw new Error("Supabase is not set up.");
  const keys = opts.keys ?? (await userKeys(userId));
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
  if (error) {
    // A double click or two callbacks at once: the other insert won (a unique index on the address), so take its row.
    if (error.code !== "23505") throw error;
    const raced = (await find("address_index", index)) ?? (await find("address", address));
    if (!raced) throw error;
    const { error: updateError } = await db.from("accounts").update(fields).eq("id", raced.id);
    if (updateError) throw updateError;
    return raced.id;
  }
  return data.id;
}

/**
 * Stores an account's sign-in encrypted. The worker starts the account within seconds. A refresh token the
 * worker kept from the last sign-in (refreshed, for Microsoft and Zoom, which replace it on every refresh) is
 * cleared, as pnpm connect:microsoft does, so the new sign-in is the one used.
 */
export async function saveCredentials(accountId: string, credentials: unknown, ownerId?: string) {
  if (!admin) throw new Error("Supabase is not set up.");
  const { error } = await admin
    .from("account_credentials")
    .upsert({ account_id: accountId, ciphertext: await sealAccountJson(accountId, credentials, ownerId), refreshed: null, updated_at: new Date().toISOString() }, { onConflict: "account_id" });
  if (error) throw error;
}

/**
 * Saves several accounts that share one sign-in (Gmail and Calendar, the Microsoft set) at once, deriving the user's
 * keys a single time. Each is saved on its own, so one failing does not stop the others: the result names the
 * labels saved and those that were not.
 */
export async function saveAccounts(
  userId: string,
  rows: { provider: TablesInsert<"accounts">["provider"]; label: string; address: string }[],
  credentials: unknown,
): Promise<{ saved: string[]; failed: string[] }> {
  const keys = await userKeys(userId);
  const results = await Promise.allSettled(
    rows.map(async (row) => {
      const accountId = await saveAccountRow(userId, row.provider, row.label, row.address, { keys });
      await saveCredentials(accountId, credentials, userId);
    }),
  );
  const saved: string[] = [];
  const failed: string[] = [];
  results.forEach((result, i) => (result.status === "fulfilled" ? saved : failed).push(rows[i].label));
  return { saved, failed };
}

/** Makes sure the user has a profile row, as the connect commands do. */
export async function ensureProfile(userId: string) {
  if (!admin) return;
  const { error } = await admin.from("profiles").upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  if (error) throw error;
}
